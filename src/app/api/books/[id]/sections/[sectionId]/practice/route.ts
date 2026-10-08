import { createHash, randomUUID } from "node:crypto";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { AiProviderError, callAiProvider, resolveAiProviderConfig, type AiProviderConfig, type AiUsageMode } from "@/lib/ai-provider";
import { getAiPracticeFallbackMessage } from "@/lib/ai-practice-failure";
import { checkExistingAiAttempt, completeAiAttempt, getAiQuotaStatus, releaseAiAttempt, reserveAiAttempt, startAiProviderDispatch } from "@/lib/ai-quota";
import { buildReservationInputHash, getAiDailyLimit, getQuotaDay, isAiQuotaEnabled, isValidRequestId } from "@/lib/ai-quota-contract";
import { AiQuotaError, getAiQuotaFailureFromError, getAiQuotaFailureResponse, mapAiQuotaStorageError } from "@/lib/ai-quota-errors";

type Context = { params: Promise<{ id: string; sectionId: string }> };
type StoredQuestion = {
  id: string;
  type: "CLOZE" | "DEFINITION" | "COMPREHENSION";
  prompt: string;
  context?: string;
  options: string[];
  correctIndex: number;
  userVocabularyId?: string;
  explanation: string;
};

function publicQuestion(question: StoredQuestion) {
  const { id, type, prompt, context, options } = question;
  return { id, type, prompt, context, options };
}

const commonDistractors = ["however", "although", "because", "between", "another", "without", "through", "before", "during", "within"];

function cleanWords(text: string) {
  return Array.from(new Set((text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || []).map((word) => word.toLowerCase()).filter((word) => word.length >= 5)));
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function makeOptions(answer: string, pool: string[], position: number) {
  const distractors = Array.from(new Set(pool.filter((item) => item.toLowerCase() !== answer.toLowerCase()))).slice(0, 3);
  for (const fallback of commonDistractors) {
    if (distractors.length >= 3) break;
    if (fallback !== answer.toLowerCase() && !distractors.includes(fallback)) distractors.push(fallback);
  }
  const options = [...distractors.slice(0, 3)];
  const correctIndex = Math.min(position % 4, options.length);
  options.splice(correctIndex, 0, answer);
  return { options, correctIndex };
}

function clozeQuestion(text: string, answer: string, pool: string[], index: number, userVocabularyId?: string): StoredQuestion | null {
  const pattern = new RegExp(`\\b${escapeRegExp(answer)}\\b`, "i");
  if (!pattern.test(text)) return null;
  const { options, correctIndex } = makeOptions(answer.toLowerCase(), pool, index);
  return { id: `q-${index + 1}`, type: "CLOZE", prompt: "选择最适合填入空白处的单词", context: text.replace(pattern, "____"), options, correctIndex, userVocabularyId, explanation: `原文中的正确单词是 “${answer.toLowerCase()}”。` };
}

function parseAiQuestions(output: string): StoredQuestion[] {
  const normalized = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(normalized) as { questions?: unknown[] };
  if (!Array.isArray(parsed.questions) || parsed.questions.length < 3 || parsed.questions.length > 5) throw new Error("AI question count invalid");
  return parsed.questions.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    const options = Array.isArray(item.options) ? item.options.map((value) => String(value).trim().slice(0, 300)) : [];
    const correctIndex = Number(item.correctIndex);
    const prompt = String(item.prompt || "").trim().slice(0, 500);
    if (!prompt || options.length !== 4 || options.some((option) => !option) || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) throw new Error("AI question schema invalid");
    return {
      id: `ai-${index + 1}`,
      type: "COMPREHENSION" as const,
      prompt,
      context: String(item.context || "").trim().slice(0, 1200) || undefined,
      options,
      correctIndex,
      explanation: String(item.explanation || `正确答案是 ${options[correctIndex]}。`).trim().slice(0, 1000),
    };
  });
}

async function createBasicQuestions(userId: string, contentId: string, sectionId: string, section: { plainText: string; segments: Array<{ text: string; wordCount: number }> }) {
  const [vocabulary, highlights] = await Promise.all([
    prisma.userVocabulary.findMany({ where: { userId, occurrences: { some: { contentId, sectionId } } }, include: { entry: true, occurrences: { where: { contentId, sectionId }, orderBy: { createdAt: "desc" }, take: 1 } }, take: 8 }),
    prisma.highlight.findMany({ where: { userId, contentId, sectionId, color: { in: ["RED", "YELLOW"] } }, orderBy: { createdAt: "asc" }, take: 8 }),
  ]);
  const wordPool = cleanWords(section.plainText);
  const questions: StoredQuestion[] = [];
  for (const item of vocabulary) {
    if (questions.length >= 5) break;
    const question = clozeQuestion(item.occurrences[0]?.context || "", item.entry.lemma, wordPool, questions.length, item.id);
    if (question) questions.push(question);
  }
  for (const highlight of highlights) {
    if (questions.length >= 5) break;
    const answer = cleanWords(highlight.quote).find((word) => !questions.some((question) => question.options.includes(word)));
    if (answer) { const question = clozeQuestion(highlight.quote, answer, wordPool, questions.length); if (question) questions.push(question); }
  }
  const contentSegments = [...section.segments].sort((left, right) => right.wordCount - left.wordCount);
  for (const segment of contentSegments) {
    if (questions.length >= 3) break;
    for (const answer of cleanWords(segment.text)) {
      if (questions.length >= 3) break;
      if (questions.some((question) => question.options.includes(answer))) continue;
      const question = clozeQuestion(segment.text, answer, wordPool, questions.length);
      if (question) questions.push(question);
    }
  }
  return questions;
}

class AiQuotaRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type AiQuestionResult =
  | { kind: "cached"; questions: StoredQuestion[]; remaining?: number; usageMode: AiUsageMode }
  | { kind: "response"; payload: Record<string, unknown> };

function quotaRequestError(kind: string): AiQuotaRequestError {
  if (kind === "in-flight") return new AiQuotaRequestError(409, "IN_FLIGHT", "This AI practice request is still in progress.");
  if (kind === "conflict") return new AiQuotaRequestError(409, "REQUEST_CONFLICT", "Request ID conflict.");
  if (kind === "timeout") return new AiQuotaRequestError(504, "TIMEOUT", "AI 响应超时，本次结果已丢弃，请稍后使用新请求重试。");
  if (kind === "released" || kind === "expired") return new AiQuotaRequestError(409, kind === "expired" ? "EXPIRED" : "ATTEMPT_FAILED", "This attempt has ended. Start a new request to retry.");
  if (kind === "invalid-snapshot") return new AiQuotaRequestError(500, "RESULT_UNAVAILABLE", "The saved AI practice result is unavailable.");
  return new AiQuotaRequestError(503, "QUOTA_UNAVAILABLE", "AI quota is temporarily unavailable.");
}

async function createAiQuestions(userId: string, contentId: string, sectionId: string, text: string, requestId: string, providerConfig: AiProviderConfig, usageMode: AiUsageMode): Promise<AiQuestionResult> {
  const requestType = "QUIZ_JSON";
  const promptVersion = "reading-practice-json-v2";
  const inputHash = createHash("sha256").update(`${providerConfig.provider}|${providerConfig.model}|${promptVersion}|${requestType}|${text.toLowerCase()}`).digest("hex");
  const targetScope = JSON.stringify([contentId, sectionId]);
  const binding = {
    userId,
    requestId,
    requestType: "QUIZ" as const,
    inputHash: buildReservationInputHash({
      cacheInputHash: inputHash,
      requestType,
      outputLanguage: "zh-CN",
      provider: providerConfig.provider,
      model: providerConfig.model,
      promptVersion,
      targetScope,
    }),
    targetScope,
    quotaDay: getQuotaDay(),
    quotaMode: usageMode === "byok" ? "BYOK_UNMETERED" as const : "METERED" as const,
  };

  const existing = await checkExistingAiAttempt(binding);
  if (existing?.kind === "succeeded") return { kind: "response", payload: existing.payload };
  if (existing && existing.kind !== "resume-dispatch") throw quotaRequestError(existing.kind);

  if (!existing) {
    const cached = await prisma.aiResultCache.findUnique({ where: { userId_inputHash_requestType: { userId, inputHash, requestType } } });
    if (cached) {
      let questions: StoredQuestion[] | null = null;
      try {
        questions = parseAiQuestions(cached.output);
      } catch {
        // Invalid cached content is ignored and may be regenerated below.
      }
      if (questions) {
        const remaining = usageMode === "byok" ? undefined : (await getAiQuotaStatus(userId)).remaining;
        try {
          await prisma.$transaction([
            prisma.aiResultCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } }),
            prisma.aiUsageLog.create({ data: { userId, requestType, provider: cached.provider, cached: true } }),
          ]);
        } catch (error) {
          throw mapAiQuotaStorageError(error);
        }
        return { kind: "cached", questions, remaining, usageMode };
      }
    }
  }

  if (!providerConfig.configured) throw new Error("AI_NOT_CONFIGURED");
  try {
    if (usageMode !== "byok") getAiDailyLimit();
  } catch {
    throw new Error("AI_QUOTA_CONFIGURATION");
  }
  const reservation = existing?.kind === "resume-dispatch" ? { kind: "reserved" as const } : await reserveAiAttempt(binding);
  if (reservation.kind === "daily-limit") throw new Error("AI_LIMIT");
  if (reservation.kind === "attempt-limit") throw new Error("AI_ATTEMPT_LIMIT");
  if (reservation.kind === "succeeded") return { kind: "response", payload: reservation.payload };
  if (reservation.kind !== "reserved") throw quotaRequestError(reservation.kind);

  try {
    const dispatch = await startAiProviderDispatch(binding);
    if (dispatch.kind === "succeeded") return { kind: "response", payload: dispatch.payload };
    if (dispatch.kind !== "started") throw quotaRequestError(dispatch.kind);

    const result = await callAiProvider({ requestType: "QUIZ_JSON", text, context: "生成适合中文母语 B1-B2 学习者的本节理解练习。" }, providerConfig, dispatch.providerDeadlineAt);
    if (!result) throw new AiProviderError("PROVIDER_ERROR");
    let questions: StoredQuestion[];
    try {
      questions = parseAiQuestions(result.output);
    } catch {
      throw new AiProviderError("INVALID_FORMAT");
    }

    const publicQuestions = questions.map(publicQuestion);
    const attemptId = randomUUID();
    const completedAt = new Date().toISOString();
    const completed = await completeAiAttempt({
      binding,
      payload: { attemptId, mode: "AI", requestedMode: "AI", degraded: false, cached: false, questions: publicQuestions },
      provider: result.provider,
      model: result.model || null,
      cache: { inputHash, requestType, output: result.output, provider: result.provider, model: result.model || null },
      usageLogRequestType: requestType,
      learningEvents: [
        { userId, contentId, sectionId, eventType: "AI_QUIZ", payload: JSON.stringify({ provider: result.provider }) },
        { id: attemptId, userId, contentId, sectionId, eventType: "AI_PRACTICE_GENERATED", payload: JSON.stringify({ questions, createdAt: completedAt }) },
      ],
    });
    if (completed.kind === "succeeded") return { kind: "response", payload: completed.payload };
    throw quotaRequestError(completed.kind);
  } catch (error) {
    if (error instanceof AiQuotaRequestError || error instanceof AiQuotaError) throw error;
    const releaseReason = error instanceof AiProviderError ? error.code : "PROVIDER_ERROR";
    try {
      await releaseAiAttempt(binding, releaseReason);
    } catch (releaseError) {
      throw mapAiQuotaStorageError(releaseError);
    }
    throw error;
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sectionId } = await params;
  const body = await req.json().catch(() => ({})) as { mode?: unknown; requestId?: unknown };
  const requestedMode = body.mode === "AI" ? "AI" : "BASIC";
  const resolvedProvider = requestedMode === "AI" ? await resolveAiProviderConfig(userId) : null;
  if (requestedMode === "AI" && resolvedProvider?.usageMode !== "byok" && !isAiQuotaEnabled()) {
    const failure = getAiQuotaFailureResponse("QUOTA_NOT_ACTIVE");
    return NextResponse.json(failure.body, { status: failure.status });
  }
  if (requestedMode === "AI" && !isValidRequestId(body.requestId)) {
    return NextResponse.json({ error: "A valid requestId is required for AI practice" }, { status: 400 });
  }
  let contentAccessible: boolean;
  try {
    contentAccessible = Boolean(await getAccessibleContent(id, userId));
  } catch (error) {
    if (requestedMode !== "AI") throw error;
    const failure = getAiQuotaFailureFromError(error) ?? getAiQuotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE");
    return NextResponse.json(failure.body, { status: failure.status });
  }
  if (!contentAccessible) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  let section: { plainText: string; segments: Array<{ text: string; wordCount: number }> } | null;
  try {
    section = await prisma.contentSection.findFirst({ where: { id: sectionId, contentId: id }, include: { segments: { orderBy: { orderIndex: "asc" } } } });
  } catch (error) {
    if (requestedMode !== "AI") throw error;
    const failure = getAiQuotaFailureFromError(error) ?? getAiQuotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE");
    return NextResponse.json(failure.body, { status: failure.status });
  }
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  let questions: StoredQuestion[] = [];
  let actualMode: "BASIC" | "AI" = "BASIC";
  let degraded = false;
  let message: string | undefined;
  let remaining: number | undefined;
  let cached = false;
  let aiUsageMode: AiUsageMode | undefined;
  if (requestedMode === "AI") {
    try {
      const aiResult = await createAiQuestions(userId, id, sectionId, section.plainText.slice(0, 8000), body.requestId as string, resolvedProvider!.config, resolvedProvider!.usageMode);
      if (aiResult.kind === "response") return NextResponse.json(aiResult.payload);
      questions = aiResult.questions;
      remaining = aiResult.remaining;
      cached = true;
      aiUsageMode = aiResult.usageMode;
      actualMode = "AI";
    } catch (error) {
      const quotaFailure = getAiQuotaFailureFromError(error);
      if (quotaFailure) return NextResponse.json(quotaFailure.body, { status: quotaFailure.status });
      if (error instanceof AiQuotaRequestError) {
        return NextResponse.json({ error: error.message, failureCode: error.code, retryable: false, quotaConsumed: false }, { status: error.status });
      }
      if (!(error instanceof AiProviderError) && !(error instanceof Error && ["AI_NOT_CONFIGURED", "AI_QUOTA_CONFIGURATION", "AI_LIMIT", "AI_ATTEMPT_LIMIT"].includes(error.message))) {
        const failure = getAiQuotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE");
        return NextResponse.json(failure.body, { status: failure.status });
      }
      degraded = true;
      const reason = error instanceof Error ? error.message : "";
      message = getAiPracticeFallbackMessage(reason);
    }
  }
  if (actualMode === "BASIC") questions = await createBasicQuestions(userId, id, sectionId, section);
  if (!questions.length) return NextResponse.json({ error: "本节可生成练习的英文内容不足" }, { status: 422 });

  const eventType = actualMode === "AI" ? "AI_PRACTICE_GENERATED" : "BASIC_PRACTICE_GENERATED";
  let event: Awaited<ReturnType<typeof prisma.learningEvent.create>>;
  try {
    const createdEvent = await readingWrite(userId, async (tx) => {
      if (!await validReadingSource(tx, userId, id, sectionId)) return null;
      return tx.learningEvent.create({ data: { userId, contentId: id, sectionId, eventType, payload: JSON.stringify({ questions, createdAt: new Date().toISOString() }) } });
    });
    if (!createdEvent) return NextResponse.json({ error: "Practice source is stale" }, { status: 409 });
    event = createdEvent;
  } catch (error) {
    if (requestedMode !== "AI") throw error;
    const failure = getAiQuotaFailureFromError(error) ?? getAiQuotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE");
    return NextResponse.json(failure.body, { status: failure.status });
  }
  return NextResponse.json({
    attemptId: event.id,
    mode: actualMode,
    requestedMode,
    degraded,
    message,
    remaining,
    cached,
    usageMode: aiUsageMode,
    questions: questions.map(publicQuestion),
  });
}

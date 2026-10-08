import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AiDictionaryCandidate, AiProviderError, AiProviderErrorCode, callAiProvider, resolveAiProviderConfig } from "@/lib/ai-provider";
import { AI_GRAMMAR_CONTRACT_VERSION, parseGrammarOutput } from "@/lib/ai-grammar-contract";
import { checkExistingAiAttempt, completeAiAttempt, getAiQuotaStatus, releaseAiAttempt, reserveAiAttempt, startAiProviderDispatch } from "@/lib/ai-quota";
import { buildReservationInputHash, canonicalQuotaRequestType, getAiDailyLimit, getQuotaDay, isAiQuotaEnabled, isValidRequestId } from "@/lib/ai-quota-contract";
import { AiQuotaErrorCode, getAiQuotaFailureFromError, getAiQuotaFailureResponse } from "@/lib/ai-quota-errors";

const allowedTypes = new Set(["EXPLAIN", "CONTEXT", "GRAMMAR", "QUIZ", "QUIZ_JSON", "PLAN"]);
const promptVersion = (requestType: string) => requestType === "EXPLAIN"
  ? "reading-coach-v4"
  : requestType === "CONTEXT"
    ? "context-senses-v3"
    : requestType === "GRAMMAR"
      ? AI_GRAMMAR_CONTRACT_VERSION
      : requestType === "QUIZ_JSON"
        ? "reading-practice-json-v2"
        : "v1";
function normalizeCandidates(value: unknown): AiDictionaryCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 16).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.slice(0, 32) : "";
    const definition = typeof candidate.definition === "string" ? candidate.definition.trim().slice(0, 800) : "";
    if (!id || !definition) return [];
    return [{
      id,
      definition,
      partOfSpeech: typeof candidate.partOfSpeech === "string" ? candidate.partOfSpeech.slice(0, 80) : null,
      example: typeof candidate.example === "string" ? candidate.example.slice(0, 800) : null,
    }];
  });
}

function parseContextMeaning(output: string, candidates: AiDictionaryCandidate[]) {
  if (!candidates.length) return null;
  try {
    const json = JSON.parse(output.replace(/^```json\s*|\s*```$/g, "").trim()) as Record<string, unknown>;
    const validIds = new Set(candidates.map((candidate) => candidate.id));
    const selectedSenseIds = Array.isArray(json.selectedSenseIds)
      ? json.selectedSenseIds.filter((id): id is string => typeof id === "string" && validIds.has(id)).slice(0, 2)
      : [];
    const meaning = typeof json.meaning === "string" ? json.meaning.trim().slice(0, 800) : "";
    const rationale = typeof json.rationale === "string" ? json.rationale.trim().slice(0, 800) : "";
    if (!selectedSenseIds.length || !meaning) return null;
    return { selectedSenseIds, meaning, rationale, uncertain: json.uncertain === true };
  } catch {
    return null;
  }
}

function cleanPlainText(value: string, limit: number) {
  return value
    .replace(/^```(?:json|markdown)?\s*|\s*```$/gi, "")
    .replace(/\*\*/g, "")
    .replace(/__([^_]+)__/g, "$1")
    .trim()
    .slice(0, limit);
}

function parseReadingExplanation(output: string) {
  try {
    const json = JSON.parse(output.replace(/^```json\s*|\s*```$/gi, "").trim()) as Record<string, unknown>;
    const summary = typeof json.summary === "string" ? cleanPlainText(json.summary, 1_200) : "";
    if (!summary) return null;
    const nuance = typeof json.nuance === "string" ? cleanPlainText(json.nuance, 800) : "";
    const paraphrase = typeof json.paraphrase === "string" ? cleanPlainText(json.paraphrase, 800) : "";
    return { summary, nuance: nuance || null, paraphrase: paraphrase || null };
  } catch {
    return null;
  }
}

function isValidStructuredOutput(value: string) {
  try {
    const parsed = JSON.parse(value.replace(/^```json\s*|\s*```$/gi, "").trim()) as unknown;
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  } catch {
    return false;
  }
}

function aiFailureMessage(code: AiProviderErrorCode | "NOT_CONFIGURED", language: "zh-CN" | "en") {
  const zh: Record<AiProviderErrorCode | "NOT_CONFIGURED", string> = {
    NOT_CONFIGURED: "AI 尚未在服务器中配置，请先在设置页完成配置。",
    TIMEOUT: "AI 已配置，但本次响应超时。请稍后手动重试。",
    NETWORK: "AI 已配置，但本次网络连接失败。请稍后手动重试。",
    INVALID_KEY: "AI Key 无效或没有访问权限，请检查服务器配置。",
    INVALID_MODEL: "AI 模型名或接口地址不正确，请检查服务器配置。",
    BALANCE_OR_RATE_LIMIT: "AI 余额不足或请求过于频繁，请稍后再试。",
    EMPTY_RESPONSE: "AI 本次没有返回有效内容，请手动重试。",
    TRUNCATED: "AI 返回内容被截断，请稍后手动重试。",
    INVALID_FORMAT: "AI 返回格式无效，本次未保存结果或扣除额度。",
    PROVIDER_ERROR: "AI 服务本次响应异常，请稍后手动重试。",
  };
  const en: Record<AiProviderErrorCode | "NOT_CONFIGURED", string> = {
    NOT_CONFIGURED: "AI is not configured on the server yet. Complete setup in Settings first.",
    TIMEOUT: "AI is configured, but this request timed out. Retry manually later.",
    NETWORK: "AI is configured, but the network request failed. Retry manually later.",
    INVALID_KEY: "The AI key is invalid or lacks access. Check the server configuration.",
    INVALID_MODEL: "The AI model or API address is invalid. Check the server configuration.",
    BALANCE_OR_RATE_LIMIT: "The AI account has insufficient balance or is rate-limited. Try again later.",
    EMPTY_RESPONSE: "AI returned no usable content. Retry manually.",
    TRUNCATED: "AI returned a truncated response. Retry manually later.",
    INVALID_FORMAT: "AI returned an invalid format; no result was saved or credit used.",
    PROVIDER_ERROR: "The AI service returned an error. Retry manually later.",
  };
  return (language === "en" ? en : zh)[code];
}

function quotaOutcomeResponse(kind: string, language: "zh-CN" | "en", remaining = 0) {
  if (kind === "conflict") {
    return NextResponse.json({ error: "Request ID conflict", failureCode: "REQUEST_CONFLICT", quotaConsumed: false }, { status: 409 });
  }
  if (kind === "in-flight" || kind === "test-in-flight") {
    return NextResponse.json({ error: language === "en" ? "This request is still in progress." : "这次请求仍在处理中。", failureCode: "IN_FLIGHT", retryable: true, quotaConsumed: false, remaining }, { status: 409 });
  }
  if (kind === "daily-limit") {
    return NextResponse.json({ error: "今日 AI 额度已用完，免费词典、阅读标记和笔记仍可继续使用。", failureCode: "DAILY_LIMIT", retryable: false, quotaConsumed: false, remaining: 0 }, { status: 429 });
  }
  if (kind === "attempt-limit") {
    return NextResponse.json({ error: language === "en" ? "Too many recent AI attempts. Try again later." : "近期 AI 请求次数过多，请稍后再试。", failureCode: "ATTEMPT_LIMIT", retryable: false, quotaConsumed: false, remaining }, { status: 429 });
  }
  if (kind === "invalid-snapshot") {
    return NextResponse.json({ error: language === "en" ? "The saved AI result is unavailable." : "已保存的 AI 结果暂不可用。", failureCode: "RESULT_UNAVAILABLE", retryable: false, quotaConsumed: false }, { status: 500 });
  }
  if (kind === "timeout") {
    return NextResponse.json({ error: aiFailureMessage("TIMEOUT", language), contextMeaning: null, explanationLanguage: language, cached: false, degraded: true, configured: true, failureCode: "TIMEOUT", retryable: true, quotaConsumed: false, remaining }, { status: 504 });
  }
  if (kind === "released" || kind === "expired") {
    return NextResponse.json({ error: language === "en" ? "This attempt has ended. Start a new request to retry." : "本次请求已结束；如需重试，请重新发起请求。", failureCode: kind === "expired" ? "EXPIRED" : "ATTEMPT_FAILED", retryable: false, quotaConsumed: false, remaining }, { status: 409 });
  }
  if (kind === "reserved") {
    return null;
  }
  return NextResponse.json({ error: language === "en" ? "AI quota is temporarily unavailable." : "AI 额度暂时不可用。", failureCode: "QUOTA_UNAVAILABLE", retryable: false, quotaConsumed: false }, { status: 503 });
}

function quotaFailureResponse(code: AiQuotaErrorCode, language: "zh-CN" | "en" = "zh-CN") {
  const failure = getAiQuotaFailureResponse(code, language);
  return NextResponse.json(failure.body, { status: failure.status });
}

function quotaFailureFromError(error: unknown, language: "zh-CN" | "en" = "zh-CN") {
  const failure = getAiQuotaFailureFromError(error, language) ?? getAiQuotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE", language);
  return NextResponse.json(failure.body, { status: failure.status });
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { config, usageMode } = await resolveAiProviderConfig(userId);
  if (usageMode === "byok") return NextResponse.json({ active: true, configured: true, provider: config.provider, model: config.model, usageMode });
  if (!isAiQuotaEnabled()) return quotaFailureResponse("QUOTA_NOT_ACTIVE");
  try {
    const status = await getAiQuotaStatus(userId);
    return NextResponse.json({ ...status, configured: config.configured, provider: config.provider, model: config.model || null, usageMode });
  } catch (error) {
    return quotaFailureFromError(error);
  }
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const resolvedProvider = await resolveAiProviderConfig(userId);
  const { config, usageMode } = resolvedProvider;
  if (usageMode !== "byok" && !isAiQuotaEnabled()) return quotaFailureResponse("QUOTA_NOT_ACTIVE");
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid AI request" }, { status: 400 });
  const requestId = body.requestId;
  const requestType = String(body.requestType || "EXPLAIN").toUpperCase();
  const text = String(body.text || "").trim().slice(0, 8_000);
  const context = String(body.context || "").trim().slice(0, 8_000);
  const candidates = normalizeCandidates(body.candidates);
  if (!allowedTypes.has(requestType) || !text || !isValidRequestId(requestId)) {
    return NextResponse.json({ error: "Invalid AI request" }, { status: 400 });
  }
  const quotaRequestType = canonicalQuotaRequestType(requestType);
  if (!quotaRequestType) return NextResponse.json({ error: "Invalid AI request" }, { status: 400 });
  if (requestType === "CONTEXT" && !candidates.length) return NextResponse.json({ error: "No reliable dictionary candidates are available" }, { status: 400 });

  let profile: { aiExplanationLanguage: string | null } | null;
  try {
    profile = await prisma.userProfile.findUnique({ where: { userId }, select: { aiExplanationLanguage: true } });
  } catch (error) {
    return quotaFailureFromError(error);
  }
  const explanationLanguage: "zh-CN" | "en" = profile?.aiExplanationLanguage === "en" ? "en" : "zh-CN";
  const currentRemaining = async () => usageMode === "byok" ? 0 : (await getAiQuotaStatus(userId)).remaining;
  const candidateKey = candidates.map((candidate) => `${candidate.id}|${candidate.partOfSpeech || ""}|${candidate.definition}|${candidate.example || ""}`).join("\n");
  const inputHash = createHash("sha256").update(`${config.provider}|${config.model}|${promptVersion(requestType)}|${requestType}|${explanationLanguage}|${text.toLowerCase()}|${context.toLowerCase()}|${candidateKey.toLowerCase()}`).digest("hex");
  const contentId = typeof body.contentId === "string" ? body.contentId.trim().slice(0, 80) || null : null;
  const sectionId = typeof body.sectionId === "string" ? body.sectionId.trim().slice(0, 80) || null : null;
  const targetScope = contentId || sectionId ? JSON.stringify([contentId, sectionId]) : null;
  const binding = {
    userId,
    requestId,
    requestType: quotaRequestType,
    inputHash: buildReservationInputHash({
      cacheInputHash: inputHash,
      requestType,
      outputLanguage: explanationLanguage,
      provider: config.provider,
      model: config.model,
      promptVersion: promptVersion(requestType),
      targetScope,
    }),
    targetScope,
    quotaDay: getQuotaDay(),
    quotaMode: usageMode === "byok" ? "BYOK_UNMETERED" as const : "METERED" as const,
  };

  try {
    const existing = await checkExistingAiAttempt(binding);
    if (existing) {
      if (existing.kind === "succeeded") return NextResponse.json(existing.payload);
      if (existing.kind !== "resume-dispatch") {
        const remaining = await currentRemaining();
        return quotaOutcomeResponse(existing.kind, explanationLanguage, remaining) ?? NextResponse.json({ error: "AI quota is temporarily unavailable" }, { status: 503 });
      }
    }

    if (!existing) {
      const cached = await prisma.aiResultCache.findUnique({ where: { userId_inputHash_requestType: { userId, inputHash, requestType } } });
      const cachedContextMeaning = cached && requestType === "CONTEXT" ? parseContextMeaning(cached.output, candidates) : null;
      const cachedExplanation = cached && requestType === "EXPLAIN" ? parseReadingExplanation(cached.output) : null;
      const cachedGrammar = cached && requestType === "GRAMMAR" ? parseGrammarOutput(cached.output) : null;
      const cachedNeedsValidation = ["EXPLAIN", "CONTEXT", "GRAMMAR", "QUIZ_JSON"].includes(requestType);
      const cachedIsUsable = Boolean(cached && (!cachedNeedsValidation || requestType === "EXPLAIN" && cachedExplanation || requestType === "CONTEXT" && cachedContextMeaning || requestType === "GRAMMAR" && cachedGrammar || requestType === "QUIZ_JSON" && isValidStructuredOutput(cached.output)));
      if (cached && cachedIsUsable) {
        const remaining = await currentRemaining();
        await prisma.$transaction([
          prisma.aiResultCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } }),
          prisma.aiUsageLog.create({ data: { userId, requestType, provider: cached.provider, cached: true } }),
        ]);
        return NextResponse.json({
          output: cached.output,
          contextMeaning: cachedContextMeaning,
          explanation: cachedExplanation,
          grammar: cachedGrammar,
          explanationLanguage,
          provider: cached.provider,
          cached: true,
          ...(usageMode === "byok" ? { usageMode } : { usageMode, remaining }),
        });
      }
    }

    if (!config.configured) {
      if (existing?.kind === "resume-dispatch") await releaseAiAttempt(binding, "PROVIDER_ERROR");
      const remaining = await currentRemaining();
      return NextResponse.json({ error: aiFailureMessage("NOT_CONFIGURED", explanationLanguage), contextMeaning: null, explanationLanguage, cached: false, degraded: true, configured: false, failureCode: "NOT_CONFIGURED", retryable: false, quotaConsumed: false, usageMode, ...(usageMode === "byok" ? {} : { remaining }) }, { status: 503 });
    }

    try {
      if (usageMode !== "byok") getAiDailyLimit();
    } catch {
      if (existing?.kind === "resume-dispatch") await releaseAiAttempt(binding, "PROVIDER_ERROR");
      return NextResponse.json({ error: "AI_DAILY_LIMIT is invalid", failureCode: "QUOTA_CONFIGURATION", quotaConsumed: false }, { status: 503 });
    }

    const reservation = existing?.kind === "resume-dispatch" ? { kind: "reserved" as const } : await reserveAiAttempt(binding);
    if (reservation.kind === "succeeded") return NextResponse.json(reservation.payload);
    if (reservation.kind !== "reserved") {
      const remaining = await currentRemaining();
      return quotaOutcomeResponse(reservation.kind, explanationLanguage, remaining) ?? NextResponse.json({ error: "AI quota is temporarily unavailable" }, { status: 503 });
    }

    const dispatch = await startAiProviderDispatch(binding);
    if (dispatch.kind === "succeeded") return NextResponse.json(dispatch.payload);
    if (dispatch.kind !== "started") {
      const remaining = await currentRemaining();
      return quotaOutcomeResponse(dispatch.kind, explanationLanguage, remaining) ?? NextResponse.json({ error: "AI quota is temporarily unavailable" }, { status: 503 });
    }

    const request = { requestType: requestType as "EXPLAIN" | "CONTEXT" | "GRAMMAR" | "QUIZ" | "QUIZ_JSON" | "PLAN", text, context, candidates, explanationLanguage, ...(requestType === "EXPLAIN" ? { explanationScope: "FULL_SELECTION" as const } : {}) };
    const providerResult = await callAiProvider(request, config, dispatch.providerDeadlineAt);
    if (!providerResult) throw new AiProviderError("PROVIDER_ERROR");
    const contextMeaning = requestType === "CONTEXT" ? parseContextMeaning(providerResult.output, candidates) : null;
    const explanation = requestType === "EXPLAIN" ? parseReadingExplanation(providerResult.output) : null;
    const grammar = requestType === "GRAMMAR" ? parseGrammarOutput(providerResult.output) : null;
    if (requestType === "CONTEXT" && !contextMeaning || requestType === "EXPLAIN" && !explanation || requestType === "GRAMMAR" && !grammar || requestType === "QUIZ_JSON" && !isValidStructuredOutput(providerResult.output)) throw new AiProviderError("INVALID_FORMAT");

    const completed = await completeAiAttempt({
      binding,
      payload: {
        ...providerResult,
        contextMeaning,
        explanation,
        grammar,
        explanationLanguage,
        cached: false,
        configured: true,
        degraded: false,
        quotaConsumed: true,
      },
      provider: providerResult.provider,
      model: providerResult.model || null,
      cache: { inputHash, requestType, output: providerResult.output, provider: providerResult.provider, model: providerResult.model || null },
      usageLogRequestType: requestType,
      learningEvents: [{
        userId,
        contentId,
        sectionId,
        eventType: `AI_${requestType}`,
        payload: JSON.stringify({ provider: providerResult.provider }),
      }],
    });
    if (completed.kind === "succeeded") return NextResponse.json(completed.payload);
    const remaining = await currentRemaining();
    return quotaOutcomeResponse(completed.kind, explanationLanguage, remaining) ?? NextResponse.json({ error: "AI quota is temporarily unavailable" }, { status: 503 });
  } catch (error) {
    const quotaFailure = getAiQuotaFailureFromError(error, explanationLanguage);
    if (quotaFailure) return NextResponse.json(quotaFailure.body, { status: quotaFailure.status });
    if (!(error instanceof AiProviderError)) return quotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE", explanationLanguage);

    console.error("AI provider request failed:", error.code);
    const failureCode: AiProviderErrorCode = error.code;
    try {
      await releaseAiAttempt(binding, failureCode);
    } catch (releaseError) {
      return quotaFailureFromError(releaseError, explanationLanguage);
    }
    const retryable = failureCode === "TIMEOUT" || failureCode === "NETWORK" || failureCode === "EMPTY_RESPONSE" || failureCode === "TRUNCATED" || failureCode === "INVALID_FORMAT" || failureCode === "PROVIDER_ERROR";
    let remaining = 0;
    try {
      remaining = await currentRemaining();
    } catch (statusError) {
      return quotaFailureFromError(statusError, explanationLanguage);
    }
    return NextResponse.json({ error: aiFailureMessage(failureCode, explanationLanguage), contextMeaning: null, explanationLanguage, cached: false, degraded: true, configured: true, failureCode, retryable, quotaConsumed: false, remaining }, { status: failureCode === "TIMEOUT" ? 504 : 200 });
  }
}

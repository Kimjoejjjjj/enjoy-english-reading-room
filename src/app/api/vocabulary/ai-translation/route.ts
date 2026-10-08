import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AiProviderError, callAiProvider, resolveAiProviderConfig } from "@/lib/ai-provider";
import { checkExistingAiAttempt, completeAiAttempt, releaseAiAttempt, reserveAiAttempt, startAiProviderDispatch } from "@/lib/ai-quota";
import { buildReservationInputHash, getQuotaDay, isValidRequestId } from "@/lib/ai-quota-contract";
import { DICTIONARY_TRANSLATION_PROMPT_VERSION, dictionaryTranslationCacheHash, dictionaryTranslationInput, parseDictionaryAiTranslations, type DictionaryAiDefinition } from "@/lib/dictionary-ai";

export const runtime = "nodejs";

function normalizeDefinitions(value: unknown): DictionaryAiDefinition[] {
  if (!Array.isArray(value)) return [];
  const definitions: DictionaryAiDefinition[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 80) : "";
    const definition = typeof candidate.definition === "string" ? candidate.definition.trim().slice(0, 1_000) : "";
    const partOfSpeech = typeof candidate.partOfSpeech === "string" ? candidate.partOfSpeech.trim().slice(0, 80) || null : null;
    if (!id || !definition || seen.has(id)) continue;
    seen.add(id);
    definitions.push({ id, definition, partOfSpeech });
  }
  return definitions;
}

function failure(error: AiProviderError) {
  const messages: Record<AiProviderError["code"], string> = {
    INVALID_KEY: "DeepSeek Key 已失效，请前往设置更换。",
    INVALID_MODEL: "当前 DeepSeek 模型不可用。",
    BALANCE_OR_RATE_LIMIT: "DeepSeek 余额不足或请求频率受限。",
    TIMEOUT: "中文翻译请求超时，请重试。",
    NETWORK: "暂时无法连接 DeepSeek。",
    EMPTY_RESPONSE: "DeepSeek 没有返回可用翻译。",
    TRUNCATED: "DeepSeek 返回内容不完整，请重试。",
    INVALID_FORMAT: "DeepSeek 返回的翻译格式无效，请重试。",
    PROVIDER_ERROR: "DeepSeek 翻译暂时不可用。",
  };
  return NextResponse.json({ error: messages[error.code], code: error.code, retryable: ["TIMEOUT", "NETWORK", "EMPTY_RESPONSE", "TRUNCATED", "INVALID_FORMAT", "PROVIDER_ERROR"].includes(error.code) }, { status: error.code === "TIMEOUT" ? 504 : 502 });
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const requestId = body?.requestId;
  const lemma = typeof body?.lemma === "string" ? body.lemma.toLowerCase().replace(/[^a-z'-]/g, "").slice(0, 80) : "";
  const definitions = normalizeDefinitions(body?.definitions);
  const cacheOnly = body?.cacheOnly === true;
  if (!lemma || !definitions.length || !isValidRequestId(requestId)) return NextResponse.json({ error: "Invalid dictionary translation request" }, { status: 400 });

  const { config, usageMode } = await resolveAiProviderConfig(userId);
  const inputHash = dictionaryTranslationCacheHash(lemma, definitions, config.model);
  const cached = await prisma.aiResultCache.findUnique({ where: { userId_inputHash_requestType: { userId, inputHash, requestType: "DICTIONARY_TRANSLATION" } } });
  const cachedTranslations = cached ? parseDictionaryAiTranslations(cached.output, definitions) : null;
  if (cached && cachedTranslations) {
    await prisma.aiResultCache.update({ where: { id: cached.id }, data: { hitCount: { increment: 1 } } });
    return NextResponse.json({ translations: cachedTranslations, provider: cached.provider, model: cached.model, cached: true, usageMode: usageMode === "byok" ? "byok" : "unconfigured" });
  }
  if (cacheOnly) return NextResponse.json({ translations: [], cached: false, notFound: true }, { status: 404 });
  if (usageMode !== "byok") return NextResponse.json({ error: "请先在设置中配置自己的 DeepSeek API Key。", code: "BYOK_REQUIRED" }, { status: 409 });

  const binding = {
    userId,
    requestId,
    requestType: "DICTIONARY_TRANSLATION" as const,
    inputHash: buildReservationInputHash({ cacheInputHash: inputHash, requestType: "DICTIONARY_TRANSLATION", outputLanguage: "zh-CN", provider: config.provider, model: config.model, promptVersion: DICTIONARY_TRANSLATION_PROMPT_VERSION, targetScope: null }),
    targetScope: null,
    quotaDay: getQuotaDay(),
    quotaMode: "BYOK_UNMETERED" as const,
  };

  try {
    const existing = await checkExistingAiAttempt(binding);
    if (existing?.kind === "succeeded") return NextResponse.json(existing.payload);
    if (existing && existing.kind !== "resume-dispatch") return NextResponse.json({ error: existing.kind === "in-flight" ? "翻译正在生成，请稍候。" : "本次翻译请求已结束，请重新发起。", code: existing.kind.toUpperCase() }, { status: existing.kind === "in-flight" ? 409 : 400 });
    const reserved = existing?.kind === "resume-dispatch" ? { kind: "reserved" as const } : await reserveAiAttempt(binding);
    if (reserved.kind === "succeeded") return NextResponse.json(reserved.payload);
    if (reserved.kind !== "reserved") return NextResponse.json({ error: "无法开始翻译请求。", code: reserved.kind.toUpperCase() }, { status: 409 });
    const dispatch = await startAiProviderDispatch(binding);
    if (dispatch.kind === "succeeded") return NextResponse.json(dispatch.payload);
    if (dispatch.kind !== "started") return NextResponse.json({ error: "无法开始翻译请求。", code: dispatch.kind.toUpperCase() }, { status: 409 });

    const result = await callAiProvider({ requestType: "DICTIONARY_TRANSLATION", text: dictionaryTranslationInput(lemma, definitions) }, config, dispatch.providerDeadlineAt);
    if (!result) throw new AiProviderError("PROVIDER_ERROR");
    const translations = parseDictionaryAiTranslations(result.output, definitions);
    if (!translations) throw new AiProviderError("INVALID_FORMAT");
    const completed = await completeAiAttempt({
      binding,
      payload: { translations, provider: result.provider, model: result.model || config.model, cached: false },
      provider: result.provider,
      model: result.model || config.model,
      cache: { inputHash, requestType: "DICTIONARY_TRANSLATION", output: result.output, provider: result.provider, model: result.model || null },
      usageLogRequestType: "DICTIONARY_TRANSLATION",
    });
    if (completed.kind === "succeeded") return NextResponse.json(completed.payload);
    return NextResponse.json({ error: "翻译结果未能安全保存，请重试。", code: completed.kind.toUpperCase() }, { status: 409 });
  } catch (error) {
    const reason = error instanceof AiProviderError ? error.code : "PROVIDER_ERROR";
    await releaseAiAttempt(binding, reason).catch(() => undefined);
    return failure(error instanceof AiProviderError ? error : new AiProviderError("PROVIDER_ERROR"));
  }
}

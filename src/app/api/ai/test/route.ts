import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { AiProviderError, callAiProvider, resolveAiProviderConfig } from "@/lib/ai-provider";
import { checkExistingAiAttempt, completeAiAttempt, getAiQuotaStatus, releaseAiAttempt, reserveAiAttempt, startAiProviderDispatch } from "@/lib/ai-quota";
import { buildReservationInputHash, getQuotaDay, isAiQuotaEnabled, isValidRequestId } from "@/lib/ai-quota-contract";
import { AiQuotaErrorCode, getAiQuotaFailureFromError, getAiQuotaFailureResponse } from "@/lib/ai-quota-errors";

function quotaFailureResponse(code: AiQuotaErrorCode) {
  const failure = getAiQuotaFailureResponse(code);
  return NextResponse.json(failure.body, { status: failure.status });
}

function quotaFailureFromError(error: unknown) {
  const failure = getAiQuotaFailureFromError(error) ?? getAiQuotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE");
  return NextResponse.json(failure.body, { status: failure.status });
}

function failureResponse(kind: string, remaining = 0) {
  if (kind === "conflict") return NextResponse.json({ error: "Request ID conflict", code: "REQUEST_CONFLICT" }, { status: 409 });
  if (kind === "in-flight" || kind === "test-in-flight") return NextResponse.json({ error: "A connection test is already in progress.", code: "IN_FLIGHT", remaining }, { status: 409 });
  if (kind === "attempt-limit") return NextResponse.json({ error: "Too many recent connection tests. Try again later.", code: "ATTEMPT_LIMIT", remaining }, { status: 429 });
  if (kind === "timeout") return NextResponse.json({ error: "DeepSeek 连接超时，请稍后重试并检查网络。", code: "TIMEOUT", remaining }, { status: 502 });
  if (kind === "released" || kind === "expired") return NextResponse.json({ error: "This test attempt has ended. Start a new test to retry.", code: kind === "expired" ? "EXPIRED" : "ATTEMPT_FAILED", remaining }, { status: 409 });
  if (kind === "invalid-snapshot") return NextResponse.json({ error: "The saved test result is unavailable.", code: "RESULT_UNAVAILABLE" }, { status: 500 });
  return null;
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { config, usageMode } = await resolveAiProviderConfig(userId);
  if (usageMode !== "byok" && !isAiQuotaEnabled()) return quotaFailureResponse("QUOTA_NOT_ACTIVE");
  const body = await req.json().catch(() => null) as { requestId?: unknown } | null;
  if (!body || !isValidRequestId(body.requestId)) return NextResponse.json({ error: "A valid requestId is required" }, { status: 400 });

  const requestId = body.requestId;
  const currentRemaining = async () => usageMode === "byok" ? 0 : (await getAiQuotaStatus(userId)).remaining;
  const inputHash = buildReservationInputHash({
    cacheInputHash: createHash("sha256").update("TEST|connection test").digest("hex"),
    requestType: "TEST",
    outputLanguage: "",
    provider: config.provider,
    model: config.model,
    promptVersion: "ai-connection-test-v1",
    targetScope: null,
  });
  const binding = { userId, requestId, requestType: "TEST" as const, inputHash, targetScope: null, quotaDay: getQuotaDay(), quotaMode: usageMode === "byok" ? "BYOK_UNMETERED" as const : "METERED" as const };

  try {
    const existing = await checkExistingAiAttempt(binding);
    if (existing?.kind === "succeeded") return NextResponse.json(existing.payload);
    if (existing && existing.kind !== "resume-dispatch") {
      const remaining = await currentRemaining();
      return failureResponse(existing.kind, remaining) ?? NextResponse.json({ error: "AI attempt is unavailable" }, { status: 503 });
    }

    if (!config.configured) {
      if (existing?.kind === "resume-dispatch") await releaseAiAttempt(binding, "PROVIDER_ERROR");
      const remaining = await currentRemaining();
      return NextResponse.json({ error: "AI 尚未在服务器中配置，请先在 .env.local 设置 API Key 和模型。", code: "NOT_CONFIGURED", remaining }, { status: 503 });
    }

    const reservation = existing?.kind === "resume-dispatch" ? { kind: "reserved" as const } : await reserveAiAttempt(binding);
    if (reservation.kind === "succeeded") return NextResponse.json(reservation.payload);
    if (reservation.kind !== "reserved") {
      const remaining = await currentRemaining();
      return failureResponse(reservation.kind, remaining) ?? NextResponse.json({ error: "AI attempt is unavailable" }, { status: 503 });
    }

    const dispatch = await startAiProviderDispatch(binding);
    if (dispatch.kind === "succeeded") return NextResponse.json(dispatch.payload);
    if (dispatch.kind !== "started") {
      const remaining = await currentRemaining();
      return failureResponse(dispatch.kind, remaining) ?? NextResponse.json({ error: "AI attempt is unavailable" }, { status: 503 });
    }

    const startedAt = Date.now();
    const result = await callAiProvider({ requestType: "TEST", text: "connection test" }, config, dispatch.providerDeadlineAt);
    if (!result) throw new AiProviderError("PROVIDER_ERROR");
    const completed = await completeAiAttempt({
      binding,
      payload: {
        configured: true,
        connected: true,
        provider: result.provider,
        model: result.model || config.model,
        latencyMs: Date.now() - startedAt,
      },
      provider: result.provider,
      model: result.model || config.model,
    });
    if (completed.kind === "succeeded") return NextResponse.json(completed.payload);
    const remaining = await currentRemaining();
    return failureResponse(completed.kind, remaining) ?? NextResponse.json({ error: "AI attempt is unavailable" }, { status: 503 });
  } catch (error) {
    const quotaFailure = getAiQuotaFailureFromError(error);
    if (quotaFailure) return NextResponse.json(quotaFailure.body, { status: quotaFailure.status });
    if (!(error instanceof AiProviderError)) return quotaFailureResponse("QUOTA_STORAGE_UNAVAILABLE");

    console.error("AI connection test provider failed:", error.code);
    const code = error.code;
    try {
      await releaseAiAttempt(binding, code);
    } catch (releaseError) {
      return quotaFailureFromError(releaseError);
    }
    const messages: Record<string, string> = {
      INVALID_KEY: "DeepSeek Key 无效或没有访问权限，请检查服务器配置后重试。",
      INVALID_MODEL: "模型名或 API 地址不正确，请检查服务器配置。",
      BALANCE_OR_RATE_LIMIT: "DeepSeek 账户余额不足、请求过快或服务额度受限。",
      TIMEOUT: "DeepSeek 连接超时，请稍后重试并检查网络。",
      NETWORK: "服务器无法连接 DeepSeek，请检查网络和 API 地址。",
      EMPTY_RESPONSE: "DeepSeek 已连接，但没有返回可用内容。",
      TRUNCATED: "DeepSeek 响应不完整，请稍后重试。",
      INVALID_FORMAT: "DeepSeek 返回格式无效，请稍后重试。",
      PROVIDER_ERROR: "DeepSeek 服务暂时返回错误，请稍后重试。",
    };
    let remaining = 0;
    try {
      remaining = await currentRemaining();
    } catch (statusError) {
      return quotaFailureFromError(statusError);
    }
    return NextResponse.json({ error: messages[code] || messages.PROVIDER_ERROR, code, provider: config.provider, model: config.model, remaining }, { status: 502 });
  }
}

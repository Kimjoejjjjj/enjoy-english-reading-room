export type AiQuotaErrorCode =
  | "QUOTA_NOT_ACTIVE"
  | "QUOTA_NOT_READY"
  | "QUOTA_STORAGE_UNAVAILABLE";

export class AiQuotaError extends Error {
  readonly code: AiQuotaErrorCode;

  constructor(code: AiQuotaErrorCode) {
    super(code);
    this.name = "AiQuotaError";
    this.code = code;
  }
}

export function assertAiQuotaEnabled(raw = process.env.AI_QUOTA_ENABLED): void {
  if (raw !== "true") throw new AiQuotaError("QUOTA_NOT_ACTIVE");
}

export function mapAiQuotaStorageError(error: unknown): AiQuotaError {
  if (error instanceof AiQuotaError) return error;
  if (error instanceof Error && error.name === "AiQuotaCompletionRejected") {
    throw error;
  }
  const value = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown; meta?: unknown }
    : {};
  let metadata = "";
  try {
    metadata = JSON.stringify(value.meta) ?? "";
  } catch {
    metadata = "";
  }
  const details = String(value.message ?? "") + " " + metadata;
  if (value.code === "P2021" || value.code === "P2022" || /no such table|no such column|table .* does not exist/i.test(details)) {
    return new AiQuotaError("QUOTA_NOT_READY");
  }
  return new AiQuotaError("QUOTA_STORAGE_UNAVAILABLE");
}

const messages: Record<AiQuotaErrorCode, { zh: string; en: string }> = {
  QUOTA_NOT_ACTIVE: { zh: "AI 暂不可用。", en: "AI is temporarily unavailable." },
  QUOTA_NOT_READY: { zh: "AI 额度服务尚未就绪，请稍后重试。", en: "The AI quota service is not ready yet. Try again later." },
  QUOTA_STORAGE_UNAVAILABLE: { zh: "AI 额度暂时不可用，请稍后重试。", en: "AI quota is temporarily unavailable. Try again later." },
};

export interface AiQuotaFailureResponse {
  status: 503;
  body: {
    error: string;
    failureCode: AiQuotaErrorCode;
    quotaConsumed: false;
    retryable: false;
  };
}

export function getAiQuotaFailureResponse(code: AiQuotaErrorCode, language: "zh-CN" | "en" = "zh-CN"): AiQuotaFailureResponse {
  const message = messages[code][language === "en" ? "en" : "zh"];
  return {
    status: 503,
    body: { error: message, failureCode: code, quotaConsumed: false, retryable: false },
  };
}

export function getAiQuotaFailureFromError(error: unknown, language: "zh-CN" | "en" = "zh-CN"): AiQuotaFailureResponse | null {
  return error instanceof AiQuotaError ? getAiQuotaFailureResponse(error.code, language) : null;
}

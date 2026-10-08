import { createHash } from "node:crypto";

export const AI_PROVIDER_TIMEOUT_MS = 20_000;
export const AI_RESERVATION_TTL_MS = 60_000;
export const AI_ATTEMPT_WINDOW_SECONDS = 60;
export const AI_ATTEMPT_LIMIT_PER_USER_AND_TYPE = 3;
export const AI_RESULT_SCHEMA_VERSION = "ai-result-v1";
export const AI_RESULT_PAYLOAD_MAX_BYTES = 32_768;
export const AI_DAILY_QUOTA_REQUEST_TYPES = ["EXPLAIN", "CONTEXT", "GRAMMAR", "QUIZ", "PLAN", "DICTIONARY_TRANSLATION"] as const;

export type AiQuotaMode = "METERED" | "BYOK_UNMETERED";

export type AiDailyQuotaRequestType = typeof AI_DAILY_QUOTA_REQUEST_TYPES[number];
export type AiQuotaRequestType = AiDailyQuotaRequestType | "TEST";

export interface AiQuotaBinding {
  userId: string;
  requestId: string;
  requestType: AiQuotaRequestType;
  inputHash: string;
  targetScope: string | null;
  quotaDay: string;
  quotaMode?: AiQuotaMode;
}

export interface ExistingAiReservation {
  userId: string;
  requestType: string;
  inputHash: string;
  targetScope: string | null;
  quotaDay: string;
  quotaMode?: string;
  status: string;
  expiresAt: Date;
  resultPayload: string | null;
  resultSchemaVersion: string | null;
  resultFingerprint: string | null;
  dispatchStartedAt: Date | null;
  providerDeadlineAt: Date | null;
  releaseReason: string | null;
}
export type ExistingReservationResolution =
  | { kind: "conflict" }
  | { kind: "resume-dispatch" }
  | { kind: "in-flight" }
  | { kind: "succeeded"; payload: Record<string, unknown> }
  | { kind: "released" }
  | { kind: "timeout" }
  | { kind: "expired" }
  | { kind: "invalid-snapshot" }
  | null;
const quotaDayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getQuotaDay(now = new Date()): string {
  const parts = Object.fromEntries(quotaDayFormatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localMidnightUtc(year: number, month: number, day: number): Date {
  const utcMidnight = Date.UTC(year, month - 1, day);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMidnight)).map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(utcMidnight - (localAsUtc - utcMidnight));
}

export function getQuotaDayRange(quotaDay: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(quotaDay);
  if (!match) throw new Error("Invalid quota day");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new Error("Invalid quota day");
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: localMidnightUtc(year, month, day),
    end: localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

export function getAiDailyLimit(raw = process.env.AI_DAILY_LIMIT): number {
  if (raw === undefined || raw.trim() === "") return 20;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("AI_DAILY_LIMIT_INVALID");
  return value;
}

export function isAiQuotaEnabledValue(raw: string | undefined): boolean {
  return raw === "true";
}

export function isAiQuotaEnabled(): boolean {
  return isAiQuotaEnabledValue(process.env.AI_QUOTA_ENABLED);
}

export function shouldBlockAiPractice(requestedMode: unknown, quotaEnabled: boolean): boolean {
  return requestedMode === "AI" && !quotaEnabled;
}

export interface AiQuotaStatusProjectionInput {
  quotaDay: string;
  limit: number;
  existingSuccessCount: number | null;
  optionASuccessCount: number;
  effectiveReservedCount: number;
}

export function projectAiQuotaStatus(input: AiQuotaStatusProjectionInput) {
  const successCount = input.existingSuccessCount ?? input.optionASuccessCount;
  const reservedCount = input.existingSuccessCount === null ? 0 : input.effectiveReservedCount;
  return {
    quotaDay: input.quotaDay,
    used: successCount,
    successCount,
    reservedCount,
    limit: input.limit,
    remaining: remainingAiQuota(successCount, reservedCount, input.limit),
  };
}

export function isAiProviderTimeoutFailure(error: unknown, deadlineSignalAborted = false): boolean {
  if (deadlineSignalAborted) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown };
  return value.name === "TimeoutError"
    || value.name === "AbortError"
    || value.code === "ETIMEDOUT"
    || value.code === "UND_ERR_CONNECT_TIMEOUT";
}

export function canonicalQuotaRequestType(requestType: string): AiQuotaRequestType | null {
  if (requestType === "QUIZ_JSON") return "QUIZ";
  if (requestType === "TEST") return "TEST";
  return AI_DAILY_QUOTA_REQUEST_TYPES.includes(requestType as AiDailyQuotaRequestType)
    ? requestType as AiDailyQuotaRequestType
    : null;
}
export function isLearnerQuotaRequest(requestType: string): boolean {
  const canonical = canonicalQuotaRequestType(requestType);
  return canonical !== null && canonical !== "TEST";
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function buildReservationInputHash(input: {
  cacheInputHash: string;
  requestType: string;
  outputLanguage: string;
  provider: string;
  model: string;
  promptVersion: string;
  targetScope: string | null;
}): string {
  const binding = [
    "ai-quota-binding-v1",
    input.cacheInputHash,
    canonicalQuotaRequestType(input.requestType) ?? input.requestType,
    input.outputLanguage,
    input.provider,
    input.model,
    input.promptVersion,
    input.targetScope,
  ];
  return createHash("sha256").update(JSON.stringify(binding)).digest("hex");
}

export function createResultSnapshot(payload: Record<string, unknown>, schemaVersion = AI_RESULT_SCHEMA_VERSION) {
  const resultPayload = JSON.stringify(payload);
  if (Buffer.byteLength(resultPayload, "utf8") > AI_RESULT_PAYLOAD_MAX_BYTES) throw new Error("AI_RESULT_PAYLOAD_TOO_LARGE");
  return {
    resultPayload,
    resultSchemaVersion: schemaVersion,
    resultFingerprint: createHash("sha256").update(`${schemaVersion}\n${resultPayload}`).digest("hex"),
  };
}

export function readResultSnapshot(input: {
  resultPayload: string | null;
  resultSchemaVersion: string | null;
  resultFingerprint: string | null;
}, expectedSchemaVersion = AI_RESULT_SCHEMA_VERSION): Record<string, unknown> | null {
  if (!input.resultPayload || input.resultSchemaVersion !== expectedSchemaVersion || !input.resultFingerprint) return null;
  if (Buffer.byteLength(input.resultPayload, "utf8") > AI_RESULT_PAYLOAD_MAX_BYTES) return null;
  const expectedFingerprint = createHash("sha256").update(`${input.resultSchemaVersion}\n${input.resultPayload}`).digest("hex");
  if (expectedFingerprint !== input.resultFingerprint) return null;
  try {
    const value = JSON.parse(input.resultPayload) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function resolveExistingReservation(
  reservation: ExistingAiReservation,
  binding: AiQuotaBinding,
  now: Date,
  schemaVersion = AI_RESULT_SCHEMA_VERSION,
): ExistingReservationResolution {
  if (reservation.userId !== binding.userId
    || reservation.requestType !== binding.requestType
    || reservation.inputHash !== binding.inputHash
    || reservation.targetScope !== binding.targetScope
    || reservation.quotaDay !== binding.quotaDay
    || (reservation.quotaMode || "METERED") !== (binding.quotaMode || "METERED")) return { kind: "conflict" };

  if (reservation.status === "RESERVED") {
    if (reservation.providerDeadlineAt && reservation.providerDeadlineAt.getTime() <= now.getTime()) return { kind: "timeout" };
    if (reservation.expiresAt.getTime() <= now.getTime()) return { kind: "expired" };
    return reservation.dispatchStartedAt ? { kind: "in-flight" } : { kind: "resume-dispatch" };
  }
  if (reservation.status === "SUCCEEDED") {
    const payload = readResultSnapshot(reservation, schemaVersion);
    return payload ? { kind: "succeeded", payload } : { kind: "invalid-snapshot" };
  }
  if (reservation.status === "RELEASED") return reservation.releaseReason === "TIMEOUT" ? { kind: "timeout" } : { kind: "released" };
  if (reservation.status === "EXPIRED") return { kind: "expired" };
  return { kind: "invalid-snapshot" };
}

export function canReserveLearnerQuota(successCount: number, reservedCount: number, dailyLimit: number): boolean {
  return Number.isSafeInteger(successCount)
    && Number.isSafeInteger(reservedCount)
    && Number.isSafeInteger(dailyLimit)
    && successCount >= 0
    && reservedCount >= 0
    && dailyLimit > 0
    && successCount + reservedCount < dailyLimit;
}

export function remainingAiQuota(successCount: number, reservedCount: number, dailyLimit: number): number {
  if (!Number.isSafeInteger(successCount) || !Number.isSafeInteger(reservedCount) || successCount < 0 || reservedCount < 0) return 0;
  return Math.max(0, dailyLimit - successCount - reservedCount);
}

export function canStartProviderDispatch(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() >= now.getTime() + AI_PROVIDER_TIMEOUT_MS;
}

export function canCompleteProviderAttempt(providerDeadlineAt: Date | null, expiresAt: Date, now: Date): boolean {
  return Boolean(providerDeadlineAt)
    && (providerDeadlineAt as Date).getTime() > now.getTime()
    && expiresAt.getTime() > now.getTime();
}

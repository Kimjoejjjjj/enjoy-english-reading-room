import { validReadingSource } from "@/lib/reading-write";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AiQuotaError, assertAiQuotaEnabled, mapAiQuotaStorageError } from "@/lib/ai-quota-errors";
import {
  AI_ATTEMPT_LIMIT_PER_USER_AND_TYPE,
  AI_ATTEMPT_WINDOW_SECONDS,
  AI_DAILY_QUOTA_REQUEST_TYPES,
  AI_PROVIDER_TIMEOUT_MS,
  AI_RESERVATION_TTL_MS,
  AI_RESULT_SCHEMA_VERSION,
  AiQuotaBinding,
  ExistingReservationResolution,
  canCompleteProviderAttempt,
  canReserveLearnerQuota,
  canStartProviderDispatch,
  createResultSnapshot,
  getAiDailyLimit,
  getQuotaDay,
  getQuotaDayRange,
  isLearnerQuotaRequest,
  remainingAiQuota,
  projectAiQuotaStatus,
  resolveExistingReservation,
} from "@/lib/ai-quota-contract";

export type AiQuotaReleaseReason =
  | "PROVIDER_ERROR"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_KEY"
  | "INVALID_MODEL"
  | "BALANCE_OR_RATE_LIMIT"
  | "EMPTY_RESPONSE"
  | "TRUNCATED"
  | "INVALID_FORMAT"
  | "DISPATCH_WINDOW_ELAPSED";

export type AiQuotaOutcome =
  | { kind: "reserved" }
  | { kind: "started"; providerDeadlineAt: Date }
  | { kind: "succeeded"; payload: Record<string, unknown> }
  | { kind: "in-flight" }
  | { kind: "daily-limit" }
  | { kind: "attempt-limit" }
  | { kind: "test-in-flight" }
  | { kind: "released" }
  | { kind: "timeout" }
  | { kind: "expired" }
  | { kind: "conflict" }
  | { kind: "invalid-snapshot" };

export interface AiQuotaStatus {
  active: true;
  quotaDay: string;
  used: number;
  successCount: number;
  reservedCount: number;
  limit: number;
  remaining: number;
}

class AiQuotaCompletionRejected extends Error {}
const MAX_QUOTA_TRANSACTION_ATTEMPTS = 4;

function isRetryableQuotaTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown; meta?: unknown; cause?: unknown };
  if (value.code === "P2034" || value.code === "P1008") return true;
  const details = [value.message, value.meta, value.cause]
    .map((part) => {
      if (typeof part === "string") return part;
      if (part instanceof Error) return `${part.name} ${part.message}`;
      try {
        return JSON.stringify(part) ?? "";
      } catch {
        return "";
      }
    })
    .join(" ");
  return /SQLITE_BUSY|database is locked|write conflict|deadlock/i.test(details);
}

async function runQuotaTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof AiQuotaError || error instanceof AiQuotaCompletionRejected) throw error;
      if (attempt < MAX_QUOTA_TRANSACTION_ATTEMPTS && isRetryableQuotaTransactionError(error)) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 10));
        continue;
      }
      throw mapAiQuotaStorageError(error);
    }
  }
}

export interface AiQuotaCacheWrite {
  inputHash: string;
  requestType: string;
  output: string;
  provider: string;
  model: string | null;
}

export interface CompleteAiAttemptOptions {
  binding: AiQuotaBinding;
  responseSchemaVersion?: string;
  payload: Record<string, unknown>;
  provider: string;
  model: string | null;
  cache?: AiQuotaCacheWrite;
  usageLogRequestType?: string;
  learningEvents?: Prisma.LearningEventUncheckedCreateInput[];
  now?: Date;
}

function resolveToOutcome(resolution: ExistingReservationResolution): AiQuotaOutcome | null {
  if (!resolution) return null;
  switch (resolution.kind) {
    case "resume-dispatch": return { kind: "reserved" };
    case "in-flight": return { kind: "in-flight" };
    case "succeeded": return { kind: "succeeded", payload: resolution.payload };
    case "released": return { kind: "released" };
    case "timeout": return { kind: "timeout" };
    case "expired": return { kind: "expired" };
    case "conflict": return { kind: "conflict" };
    case "invalid-snapshot": return { kind: "invalid-snapshot" };
  }
}

function bindingResolution(reservation: {
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
}, binding: AiQuotaBinding, now: Date, schemaVersion?: string) {
  return resolveExistingReservation(reservation, binding, now, schemaVersion);
}

async function getOptionASuccessCount(tx: Prisma.TransactionClient, userId: string, quotaDay: string) {
  const range = getQuotaDayRange(quotaDay);
  return tx.aiUsageLog.count({
    where: {
      userId,
      cached: false,
      requestType: { in: [...AI_DAILY_QUOTA_REQUEST_TYPES, "QUIZ_JSON"] },
      quotaMode: "METERED",
      createdAt: { gte: range.start, lt: range.end },
    },
  });
}

async function getOrInitializeDailyQuota(tx: Prisma.TransactionClient, userId: string, quotaDay: string) {
  const existing = await tx.aiDailyQuota.findUnique({ where: { userId_quotaDay: { userId, quotaDay } } });
  if (existing) return existing;
  const successCount = await getOptionASuccessCount(tx, userId, quotaDay);

  // Option A: seed this actual Shanghai day from its eligible successful-use logs.
  return tx.aiDailyQuota.upsert({
    where: { userId_quotaDay: { userId, quotaDay } },
    create: { userId, quotaDay, successCount, reservedCount: 0 },
    update: {},
  });
}
async function decrementReservedCount(tx: Prisma.TransactionClient, userId: string, quotaDay: string, now: Date) {
  const changed = await tx.$executeRaw`
    UPDATE "AiDailyQuota"
    SET "reservedCount" = "reservedCount" - 1, "updatedAt" = ${now}
    WHERE "userId" = ${userId}
      AND "quotaDay" = ${quotaDay}
      AND "successCount" >= 0
      AND "reservedCount" > 0
  `;
  if (changed !== 1) throw new Error("AI_QUOTA_COUNTER_INVARIANT");
}

async function transitionDueReservations(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const expired = await tx.aiQuotaReservation.findMany({
    where: { userId, status: "RESERVED", expiresAt: { lte: now }, OR: [{ providerDeadlineAt: null }, { providerDeadlineAt: { gt: now } }] },
    select: { id: true, requestType: true, quotaDay: true, quotaMode: true, expiresAt: true },
  });
  for (const reservation of expired) {
    const changed = await tx.aiQuotaReservation.updateMany({
      where: { id: reservation.id, status: "RESERVED", expiresAt: { lte: now }, OR: [{ providerDeadlineAt: null }, { providerDeadlineAt: { gt: now } }] },
      data: { status: "EXPIRED", expiredAt: now },
    });
    if (changed.count === 1 && reservation.quotaMode === "METERED" && isLearnerQuotaRequest(reservation.requestType)) {
      await decrementReservedCount(tx, userId, reservation.quotaDay, now);
    }
  }

  const timedOut = await tx.aiQuotaReservation.findMany({
    where: { userId, status: "RESERVED", providerDeadlineAt: { lte: now } },
    select: { id: true, requestType: true, quotaDay: true, quotaMode: true, providerDeadlineAt: true },
  });
  for (const reservation of timedOut) {
    const changed = await tx.aiQuotaReservation.updateMany({
      where: {
        id: reservation.id,
        status: "RESERVED",

        providerDeadlineAt: { lte: now },
      },
      data: { status: "RELEASED", releasedAt: now, releaseReason: "TIMEOUT" },
    });
    if (changed.count === 1 && reservation.quotaMode === "METERED" && isLearnerQuotaRequest(reservation.requestType)) {
      await decrementReservedCount(tx, userId, reservation.quotaDay, now);
    }
  }
}

export async function getAiQuotaStatus(userId: string, fixedNow?: Date): Promise<AiQuotaStatus> {
  assertAiQuotaEnabled();
  const limit = getAiDailyLimit();
  const now = fixedNow ?? new Date();
  const quotaDay = getQuotaDay(now);
  const range = getQuotaDayRange(quotaDay);
  try {
    return await prisma.$transaction(async (tx) => {
      const quota = await tx.aiDailyQuota.findUnique({ where: { userId_quotaDay: { userId, quotaDay } } });
      const [optionASuccessCount, effectiveReservedCount] = await Promise.all([
        quota ? Promise.resolve(quota.successCount) : tx.aiUsageLog.count({
          where: {
            userId,
            cached: false,
            requestType: { in: [...AI_DAILY_QUOTA_REQUEST_TYPES, "QUIZ_JSON"] },
            createdAt: { gte: range.start, lt: range.end },
          },
        }),
        quota ? tx.aiQuotaReservation.count({
          where: {
            userId,
            quotaDay,
            status: "RESERVED",
            requestType: { in: [...AI_DAILY_QUOTA_REQUEST_TYPES, "QUIZ_JSON"] },
            expiresAt: { gt: now },
            OR: [{ providerDeadlineAt: null }, { providerDeadlineAt: { gt: now } }],
          },
        }) : Promise.resolve(0),
      ]);
      return { active: true, ...projectAiQuotaStatus({
        quotaDay,
        limit,
        existingSuccessCount: quota?.successCount ?? null,
        optionASuccessCount,
        effectiveReservedCount,
      }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    throw mapAiQuotaStorageError(error);
  }
}

export async function checkExistingAiAttempt(
  binding: AiQuotaBinding,
  responseSchemaVersion = AI_RESULT_SCHEMA_VERSION,
  fixedNow?: Date,
): Promise<ExistingReservationResolution> {
  return runQuotaTransaction(async (tx) => {
    const now = fixedNow ?? new Date();
    await transitionDueReservations(tx, binding.userId, now);
    const reservation = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
    return reservation ? bindingResolution(reservation, binding, now, responseSchemaVersion) : null;
  });
}

export async function reserveAiAttempt(binding: AiQuotaBinding, fixedNow?: Date): Promise<AiQuotaOutcome> {
  try {
    return await runQuotaTransaction(async (tx): Promise<AiQuotaOutcome> => {
      const now = fixedNow ?? new Date();
      const attemptWindowStart = new Date(now.getTime() - AI_ATTEMPT_WINDOW_SECONDS * 1_000);
      await transitionDueReservations(tx, binding.userId, now);
      const existing = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
      if (existing) return resolveToOutcome(bindingResolution(existing, binding, now)) ?? { kind: "conflict" };

      const quotaMode = binding.quotaMode || "METERED";
      const dailyLimit = isLearnerQuotaRequest(binding.requestType) && quotaMode === "METERED" ? getAiDailyLimit() : 0;
      if (quotaMode === "METERED") {
        const attempts = await tx.aiQuotaReservation.count({
          where: { userId: binding.userId, requestType: binding.requestType, createdAt: { gte: attemptWindowStart } },
        });
        if (attempts >= AI_ATTEMPT_LIMIT_PER_USER_AND_TYPE) return { kind: "attempt-limit" };
      }

      if (binding.requestType === "TEST") {
        await getOrInitializeDailyQuota(tx, binding.userId, binding.quotaDay);
        const activeTests = await tx.aiQuotaReservation.count({
          where: { userId: binding.userId, requestType: "TEST", status: "RESERVED" },
        });
        if (activeTests > 0) return { kind: "test-in-flight" };
      } else if (quotaMode === "METERED") {
        const existingQuota = await tx.aiDailyQuota.findUnique({ where: { userId_quotaDay: { userId: binding.userId, quotaDay: binding.quotaDay } } });
        const successCount = existingQuota?.successCount ?? await getOptionASuccessCount(tx, binding.userId, binding.quotaDay);
        const reservedCount = existingQuota?.reservedCount ?? 0;
        if (!canReserveLearnerQuota(successCount, reservedCount, dailyLimit)) return { kind: "daily-limit" };

        const quota = existingQuota ?? await getOrInitializeDailyQuota(tx, binding.userId, binding.quotaDay);
        if (!canReserveLearnerQuota(quota.successCount, quota.reservedCount, dailyLimit)) return { kind: "daily-limit" };
        const changed = await tx.$executeRaw`
          UPDATE "AiDailyQuota"
          SET "reservedCount" = "reservedCount" + 1, "updatedAt" = ${now}
          WHERE "userId" = ${binding.userId}
            AND "quotaDay" = ${binding.quotaDay}
            AND "successCount" >= 0
            AND "reservedCount" >= 0
            AND "successCount" + "reservedCount" < ${dailyLimit}
        `;
        if (changed !== 1) return { kind: "daily-limit" };
      } else await getOrInitializeDailyQuota(tx, binding.userId, binding.quotaDay);
      const reservedAt = fixedNow ?? new Date();
      await tx.aiQuotaReservation.create({
        data: {
          ...binding,
          quotaMode,
          status: "RESERVED",
          createdAt: reservedAt,
          expiresAt: new Date(reservedAt.getTime() + AI_RESERVATION_TTL_MS),
        },
      });
      return { kind: "reserved" };
    });
  } catch (error) {
    if (error instanceof AiQuotaError) throw error;
    // A concurrent requestId insert may win after this transaction's first read.
    const existing = await checkExistingAiAttempt(binding, AI_RESULT_SCHEMA_VERSION, fixedNow);
    if (existing) return resolveToOutcome(existing) ?? { kind: "conflict" };
    throw error;
  }
}

export async function startAiProviderDispatch(binding: AiQuotaBinding, fixedNow?: Date): Promise<AiQuotaOutcome> {
  return runQuotaTransaction(async (tx): Promise<AiQuotaOutcome> => {
    const transactionNow = fixedNow ?? new Date();
    await transitionDueReservations(tx, binding.userId, transactionNow);
    const reservation = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
    if (!reservation) return { kind: "conflict" };
    const resolution = bindingResolution(reservation, binding, transactionNow);
    if (!resolution) return { kind: "conflict" };
    if (resolution.kind !== "resume-dispatch") return resolveToOutcome(resolution) ?? { kind: "conflict" };

    const dispatchStartedAt = fixedNow ?? new Date();
    const providerDeadlineAt = new Date(dispatchStartedAt.getTime() + AI_PROVIDER_TIMEOUT_MS);
    if (!canStartProviderDispatch(reservation.expiresAt, dispatchStartedAt)) {
      if (reservation.expiresAt.getTime() <= dispatchStartedAt.getTime()) {
        await transitionDueReservations(tx, binding.userId, dispatchStartedAt);
        return { kind: "expired" };
      }
      const changed = await tx.aiQuotaReservation.updateMany({
        where: {
          id: reservation.id,
          userId: binding.userId,
          status: "RESERVED",
          dispatchStartedAt: null,
          expiresAt: { gt: dispatchStartedAt },
        },
        data: { status: "RELEASED", releasedAt: dispatchStartedAt, releaseReason: "DISPATCH_WINDOW_ELAPSED" },
      });
      if (changed.count === 1 && reservation.quotaMode === "METERED" && isLearnerQuotaRequest(reservation.requestType)) {
        await decrementReservedCount(tx, reservation.userId, reservation.quotaDay, dispatchStartedAt);
      }
      return { kind: "released" };
    }

    const changed = await tx.aiQuotaReservation.updateMany({
      where: {
        id: reservation.id,
        userId: binding.userId,
        status: "RESERVED",
        dispatchStartedAt: null,
        expiresAt: { gte: providerDeadlineAt },
      },
      data: { dispatchStartedAt, providerDeadlineAt },
    });
    if (changed.count === 1) return { kind: "started", providerDeadlineAt };

    const latest = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
    return latest ? resolveToOutcome(bindingResolution(latest, binding, dispatchStartedAt)) ?? { kind: "conflict" } : { kind: "conflict" };
  });
}

export async function releaseAiAttempt(
  binding: AiQuotaBinding,
  reason: AiQuotaReleaseReason,
  fixedNow?: Date,
): Promise<AiQuotaOutcome> {
  return runQuotaTransaction(async (tx): Promise<AiQuotaOutcome> => {
    const now = fixedNow ?? new Date();
    await transitionDueReservations(tx, binding.userId, now);
    const reservation = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
    if (!reservation) return { kind: "conflict" };
    const resolution = bindingResolution(reservation, binding, now);
    if (!resolution) return { kind: "conflict" };
    if (resolution.kind !== "resume-dispatch" && resolution.kind !== "in-flight") {
      return resolveToOutcome(resolution) ?? { kind: "conflict" };
    }

    const releaseAt = fixedNow ?? new Date();
    if (reservation.expiresAt.getTime() <= releaseAt.getTime()
      || reservation.providerDeadlineAt && reservation.providerDeadlineAt.getTime() <= releaseAt.getTime()) {
      await transitionDueReservations(tx, binding.userId, releaseAt);
      const latest = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
      return latest ? resolveToOutcome(bindingResolution(latest, binding, releaseAt)) ?? { kind: "conflict" } : { kind: "conflict" };
    }

    const changed = await tx.aiQuotaReservation.updateMany({
      where: {
        id: reservation.id,
        userId: binding.userId,
        quotaDay: binding.quotaDay,
        status: "RESERVED",
        expiresAt: { gt: releaseAt },
        OR: [{ providerDeadlineAt: null }, { providerDeadlineAt: { gt: releaseAt } }],
      },
      data: { status: "RELEASED", releasedAt: releaseAt, releaseReason: reason },
    });
    if (changed.count === 1) {
      if (reservation.quotaMode === "METERED" && isLearnerQuotaRequest(reservation.requestType)) {
        await decrementReservedCount(tx, reservation.userId, reservation.quotaDay, releaseAt);
      }
      return { kind: "released" };
    }

    await transitionDueReservations(tx, binding.userId, releaseAt);
    const latest = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
    return latest ? resolveToOutcome(bindingResolution(latest, binding, releaseAt)) ?? { kind: "conflict" } : { kind: "conflict" };
  });
}

export async function completeAiAttempt(options: CompleteAiAttemptOptions): Promise<AiQuotaOutcome> {
  const { binding } = options;
  const responseSchemaVersion = options.responseSchemaVersion ?? AI_RESULT_SCHEMA_VERSION;
  try {
    return await runQuotaTransaction(async (tx): Promise<AiQuotaOutcome> => {
      if (options.learningEvents?.length) {
        await tx.$executeRaw`UPDATE users SET id = id WHERE id = ${binding.userId}`;
        for (const event of options.learningEvents) {
          if (event.userId !== binding.userId || event.contentId && !await validReadingSource(tx, binding.userId, event.contentId, event.sectionId)) throw new Error("READING_SOURCE_STALE");
        }
      }
      const now = options.now ?? new Date();
      const reservation = await tx.aiQuotaReservation.findUnique({ where: { requestId: binding.requestId } });
      if (!reservation) return { kind: "conflict" };
      const resolution = bindingResolution(reservation, binding, now, responseSchemaVersion);
      if (!resolution) return { kind: "conflict" };
      if (resolution.kind === "succeeded") return { kind: "succeeded", payload: resolution.payload };
      if (resolution.kind !== "resume-dispatch" && resolution.kind !== "in-flight") {
        return resolveToOutcome(resolution) ?? { kind: "conflict" };
      }
      if (!reservation.dispatchStartedAt) return { kind: "conflict" };
      if (!canCompleteProviderAttempt(reservation.providerDeadlineAt, reservation.expiresAt, now)) {
        return reservation.expiresAt.getTime() <= now.getTime() ? { kind: "expired" } : { kind: "released" };
      }

      let limit = 0;
      try {
        limit = getAiDailyLimit();
      } catch {
        // A reservation already admitted under the server limit may still finish.
      }

      let resultCacheId: string | null = null;
      if (options.cache && isLearnerQuotaRequest(reservation.requestType)) {
        const cache = await tx.aiResultCache.upsert({
          where: {
            userId_inputHash_requestType: {
              userId: binding.userId,
              inputHash: options.cache.inputHash,
              requestType: options.cache.requestType,
            },
          },
          create: {
            userId: binding.userId,
            inputHash: options.cache.inputHash,
            requestType: options.cache.requestType,
            output: options.cache.output,
            provider: options.cache.provider,
            model: options.cache.model,
          },
          update: {
            output: options.cache.output,
            provider: options.cache.provider,
            model: options.cache.model,
          },
          select: { id: true },
        });
        resultCacheId = cache.id;
      }

      if (reservation.quotaMode === "METERED" && isLearnerQuotaRequest(reservation.requestType)) {
        const changed = await tx.$executeRaw`
          UPDATE "AiDailyQuota"
          SET "reservedCount" = "reservedCount" - 1,
              "successCount" = "successCount" + 1,
              "updatedAt" = ${now}
          WHERE "userId" = ${reservation.userId}
            AND "quotaDay" = ${reservation.quotaDay}
            AND "successCount" >= 0
            AND "reservedCount" > 0
        `;
        if (changed !== 1) throw new Error("AI_QUOTA_COUNTER_INVARIANT");
      }

      if (options.usageLogRequestType && isLearnerQuotaRequest(reservation.requestType)) {
        await tx.aiUsageLog.create({
          data: {
            userId: binding.userId,
            requestType: options.usageLogRequestType,
            provider: options.provider,
            quotaMode: reservation.quotaMode,
            cached: false,
          },
        });
      }
      for (const event of options.learningEvents ?? []) await tx.learningEvent.create({ data: event });

      const quota = await tx.aiDailyQuota.findUnique({
        where: { userId_quotaDay: { userId: binding.userId, quotaDay: binding.quotaDay } },
        select: { successCount: true, reservedCount: true },
      });
      if (!quota) throw new Error("AI_QUOTA_COUNTER_MISSING");
      const payload = reservation.quotaMode === "BYOK_UNMETERED"
        ? { ...options.payload, usageMode: "byok" }
        : { ...options.payload, usageMode: "site_quota", remaining: remainingAiQuota(quota.successCount, quota.reservedCount, limit) };
      const snapshot = createResultSnapshot(payload, responseSchemaVersion);
      const completedAt = options.now ?? new Date();
      const changed = await tx.aiQuotaReservation.updateMany({
        where: {
          id: reservation.id,
          requestId: binding.requestId,
          userId: binding.userId,
          quotaDay: binding.quotaDay,
          status: "RESERVED",
          dispatchStartedAt: { not: null },
          providerDeadlineAt: { gt: completedAt },
          expiresAt: { gt: completedAt },
          resultPayload: null,
        },
        data: {
          status: "SUCCEEDED",
          resultPayload: snapshot.resultPayload,
          resultSchemaVersion: snapshot.resultSchemaVersion,
          resultFingerprint: snapshot.resultFingerprint,
          resultCacheId,
          completedAt,
          completedProvider: options.provider,
          completedModel: options.model,
        },
      });
      if (changed.count !== 1) throw new AiQuotaCompletionRejected();
      return { kind: "succeeded", payload };
    });
  } catch (error) {
    if (error instanceof AiQuotaCompletionRejected) return { kind: "released" };
    throw error;
  }
}

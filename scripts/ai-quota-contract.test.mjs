import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AI_ATTEMPT_LIMIT_PER_USER_AND_TYPE,
  AI_ATTEMPT_WINDOW_SECONDS,
  AI_PROVIDER_TIMEOUT_MS,
  AI_RESERVATION_TTL_MS,
  buildReservationInputHash,
  canCompleteProviderAttempt,
  canReserveLearnerQuota,
  canStartProviderDispatch,
  canonicalQuotaRequestType,
  createResultSnapshot,
  getAiDailyLimit,
  getQuotaDay,
  getQuotaDayRange,
  isAiProviderTimeoutFailure,
  isAiQuotaEnabledValue,
  isLearnerQuotaRequest,
  isValidRequestId,
  readResultSnapshot,
  remainingAiQuota,
  projectAiQuotaStatus,
  shouldBlockAiPractice,
  resolveExistingReservation,
} from "../src/lib/ai-quota-contract.ts";
import { getAiPracticeFallbackMessage } from "../src/lib/ai-practice-failure.ts";
import { AiQuotaError, assertAiQuotaEnabled, getAiQuotaFailureFromError, mapAiQuotaStorageError } from "../src/lib/ai-quota-errors.ts";

const now = new Date("2026-09-26T10:00:00.000Z");
const binding = {
  userId: "user-1",
  requestId: "4e3f5a80-8f4b-4fa3-8f6a-c5ec65b44abc",
  requestType: "EXPLAIN",
  inputHash: "input-hash",
  targetScope: '["content-1","section-1"]',
  quotaDay: "2026-09-26",
};
const reservation = (changes = {}) => ({
  ...binding,
  status: "RESERVED",
  expiresAt: new Date(now.getTime() + AI_RESERVATION_TTL_MS),
  resultPayload: null,
  resultSchemaVersion: null,
  resultFingerprint: null,
  dispatchStartedAt: null,
  providerDeadlineAt: null,
  releaseReason: null,
  ...changes,
});

test("quota activation is opt-in and only the exact true string enables it", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", " true "]) assert.equal(isAiQuotaEnabledValue(value), false);
  assert.equal(isAiQuotaEnabledValue("true"), true);
  assert.throws(() => assertAiQuotaEnabled(""), (error) => error instanceof AiQuotaError && error.code === "QUOTA_NOT_ACTIVE");

  const quotaService = readFileSync(new URL("../src/lib/ai-quota.ts", import.meta.url), "utf8");
  const statusStart = quotaService.indexOf("export async function getAiQuotaStatus");
  const statusEnd = quotaService.indexOf("export async function checkExistingAiAttempt", statusStart);
  assert.match(quotaService.slice(statusStart, statusEnd), /assertAiQuotaEnabled\(\)/);
  assert.doesNotMatch(quotaService.slice(0, statusStart), /assertAiQuotaEnabled\(\)/);
});

test("missing quota tables map to a non-leaking readiness 503", () => {
  const error = Object.assign(new Error("secret SQL and path details"), { code: "P2021" });
  const mapped = mapAiQuotaStorageError(error);
  const failure = getAiQuotaFailureFromError(mapped);
  assert.equal(failure?.status, 503);
  assert.equal(failure?.body.failureCode, "QUOTA_NOT_READY");
  assert.equal(failure?.body.error.includes("secret"), false);
  assert.equal(mapAiQuotaStorageError(new Error("database is locked")).code, "QUOTA_STORAGE_UNAVAILABLE");
});

test("read-only quota status projects Option A baseline and only live reservations", () => {
  assert.deepEqual(projectAiQuotaStatus({
    quotaDay: "2026-09-26",
    limit: 20,
    existingSuccessCount: null,
    optionASuccessCount: 4,
    effectiveReservedCount: 7,
  }), { quotaDay: "2026-09-26", used: 4, successCount: 4, reservedCount: 0, limit: 20, remaining: 16 });
  assert.deepEqual(projectAiQuotaStatus({
    quotaDay: "2026-09-26",
    limit: 20,
    existingSuccessCount: 17,
    optionASuccessCount: 0,
    effectiveReservedCount: 2,
  }), { quotaDay: "2026-09-26", used: 17, successCount: 17, reservedCount: 2, limit: 20, remaining: 1 });
});

test("site requests keep quota guards while BYOK may continue without site quota", () => {
  const explain = readFileSync(new URL("../src/app/api/ai/explain/route.ts", import.meta.url), "utf8");
  const explainPost = explain.slice(explain.indexOf("export async function POST"));
  const explainGate = explainPost.indexOf('if (usageMode !== "byok" && !isAiQuotaEnabled())');
  assert.ok(explainGate >= 0);
  for (const operation of ["checkExistingAiAttempt(", "aiResultCache.findUnique", "callAiProvider(", "aiUsageLog.create"]) {
    assert.ok(explainPost.indexOf(operation) > explainGate, operation + " must follow the disabled gate");
  }

  const testRoute = readFileSync(new URL("../src/app/api/ai/test/route.ts", import.meta.url), "utf8");
  const testPost = testRoute.slice(testRoute.indexOf("export async function POST"));
  assert.ok(testPost.indexOf('if (usageMode !== "byok" && !isAiQuotaEnabled())') < testPost.indexOf("checkExistingAiAttempt("));
  assert.ok(testPost.indexOf('if (usageMode !== "byok" && !isAiQuotaEnabled())') < testPost.indexOf("callAiProvider("));

  const practice = readFileSync(new URL("../src/app/api/books/[id]/sections/[sectionId]/practice/route.ts", import.meta.url), "utf8");
  const practicePost = practice.slice(practice.indexOf("export async function POST"));
  const gate = practicePost.indexOf('resolvedProvider?.usageMode !== "byok" && !isAiQuotaEnabled()');
  assert.ok(gate >= 0 && gate < practicePost.indexOf("getAccessibleContent("));
  assert.equal(shouldBlockAiPractice("AI", false), true);
  assert.equal(shouldBlockAiPractice("BASIC", false), false);
});

test("quota GET is read-only and learner rows initialize only after admission checks", () => {
  const source = readFileSync(new URL("../src/lib/ai-quota.ts", import.meta.url), "utf8");
  const getStart = source.indexOf("export async function getAiQuotaStatus");
  const getEnd = source.indexOf("export async function checkExistingAiAttempt", getStart);
  const getStatus = source.slice(getStart, getEnd);
  assert.match(getStatus, /aiDailyQuota\.findUnique/);
  assert.match(getStatus, /aiUsageLog\.count/);
  assert.match(getStatus, /aiQuotaReservation\.count/);
  assert.match(getStatus, /\$transaction\(async \(tx\) => \{/);
  assert.match(getStatus, /tx\.aiDailyQuota\.findUnique[\s\S]*tx\.aiUsageLog\.count[\s\S]*tx\.aiQuotaReservation\.count/);
  assert.match(getStatus, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.doesNotMatch(getStatus, /upsert|\.create\(|\.update\(|deleteMany|transitionDueReservations/);
  const reserveStart = source.indexOf("export async function reserveAiAttempt");
  const reserveEnd = source.indexOf("export async function startAiProviderDispatch", reserveStart);
  const reserve = source.slice(reserveStart, reserveEnd);
  assert.ok(reserve.indexOf("if (attempts >= AI_ATTEMPT_LIMIT_PER_USER_AND_TYPE)") < reserve.indexOf('if (binding.requestType === "TEST")'));
  const testBranchStart = reserve.indexOf('if (binding.requestType === "TEST")');
  const learnerBranchStart = reserve.indexOf('} else if (quotaMode === "METERED")', testBranchStart);
  const learnerBranch = reserve.slice(learnerBranchStart);
  assert.ok(learnerBranch.indexOf("canReserveLearnerQuota(successCount, reservedCount, dailyLimit)") < learnerBranch.indexOf("getOrInitializeDailyQuota(tx, binding.userId, binding.quotaDay)"));
  assert.match(reserve.slice(testBranchStart, learnerBranchStart), /getOrInitializeDailyQuota\(tx, binding\.userId, binding\.quotaDay\)/);
  assert.match(learnerBranch, /reservedCount/);
  assert.match(reserve, /if \(quotaMode === "METERED"\)[\s\S]*AI_ATTEMPT_LIMIT_PER_USER_AND_TYPE/);
  assert.match(reserve, /quotaMode === "BYOK_UNMETERED"|quotaMode === "METERED"/);
  assert.equal(isLearnerQuotaRequest("TEST"), false);
});

test("request replay also binds the quota mode", () => {
  const successful = createResultSnapshot({ output: "first result" });
  const byokBinding = { ...binding, quotaMode: "BYOK_UNMETERED" };
  const row = reservation({ status: "SUCCEEDED", quotaMode: "BYOK_UNMETERED", ...successful });
  assert.deepEqual(resolveExistingReservation(row, byokBinding, now), { kind: "succeeded", payload: { output: "first result" } });
  assert.deepEqual(resolveExistingReservation(row, binding, now), { kind: "conflict" });
});
test("quota day and preview range use the Asia/Shanghai calendar boundary", () => {
  assert.equal(getQuotaDay(new Date("2026-09-25T15:59:59.999Z")), "2026-09-25");
  assert.equal(getQuotaDay(new Date("2026-09-25T16:00:00.000Z")), "2026-09-26");
  const range = getQuotaDayRange("2026-09-26");
  assert.equal(range.start.toISOString(), "2026-09-25T16:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-09-26T16:00:00.000Z");
});

test("daily limit reads the server setting and rejects invalid values", () => {
  assert.equal(getAiDailyLimit("7"), 7);
  assert.equal(getAiDailyLimit(""), 20);
  assert.throws(() => getAiDailyLimit("0"), /AI_DAILY_LIMIT_INVALID/);
  assert.throws(() => getAiDailyLimit("many"), /AI_DAILY_LIMIT_INVALID/);
});

test("provider response-body aborts at its deadline are classified as TIMEOUT", () => {
  assert.equal(isAiProviderTimeoutFailure(new SyntaxError("stream aborted"), true), true);
  assert.equal(isAiProviderTimeoutFailure(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
  assert.equal(isAiProviderTimeoutFailure(new SyntaxError("invalid JSON")), false);
  const providerSource = readFileSync(new URL("../src/lib/ai-provider.ts", import.meta.url), "utf8");
  assert.match(providerSource, /signal:\s*timeoutSignal,/);
  assert.match(providerSource, /data = await response\.json\(\)[\s\S]*?catch \(error\) \{[\s\S]*?isAiProviderTimeoutFailure\(error, timeoutSignal\.aborted\)/);
  assert.match(providerSource, /requestType === "TEST"[\s\S]*requestBody\.thinking = \{ type: "disabled" \}/);
});

test("Explain timeout failures return HTTP 504 from quota and provider paths", () => {
  const source = readFileSync(new URL("../src/app/api/ai/explain/route.ts", import.meta.url), "utf8");
  assert.match(source, /kind === "timeout"[\s\S]*?failureCode: "TIMEOUT"[\s\S]*?\{ status: 504 \}/);
  assert.match(source, /failureCode === "TIMEOUT" \? 504 : 200/);
});
test("practice reports quota configuration and timeout causes accurately", () => {
  assert.match(getAiPracticeFallbackMessage("AI_QUOTA_CONFIGURATION"), /AI_DAILY_LIMIT.*配置无效/);
  assert.match(getAiPracticeFallbackMessage("TIMEOUT"), /响应超时/);
  assert.match(getAiPracticeFallbackMessage("INVALID_FORMAT"), /题目格式不稳定/);

  const route = readFileSync(new URL("../src/app/api/books/[id]/sections/[sectionId]/practice/route.ts", import.meta.url), "utf8");
  const start = route.indexOf("async function createAiQuestions");
  const end = route.indexOf("export async function POST", start);
  const flow = route.slice(start, end);
  const configCheck = flow.indexOf("getAiDailyLimit();");
  assert.ok(configCheck >= 0);
  assert.ok(flow.indexOf("reserveAiAttempt(binding)") > configCheck);
  assert.ok(flow.indexOf("callAiProvider(") > configCheck);
});

test("QUIZ_JSON maps to the QUIZ quota class while TEST stays outside learner quota", () => {
  assert.equal(canonicalQuotaRequestType("QUIZ_JSON"), "QUIZ");
  assert.equal(canonicalQuotaRequestType("TEST"), "TEST");
  assert.equal(isLearnerQuotaRequest("QUIZ_JSON"), true);
  assert.equal(isLearnerQuotaRequest("TEST"), false);
});

test("request ids are UUIDs and binding hashes cover scope and provider contract", () => {
  assert.equal(isValidRequestId(binding.requestId), true);
  assert.equal(isValidRequestId("not-a-uuid"), false);
  const base = { cacheInputHash: "cache", requestType: "QUIZ_JSON", outputLanguage: "zh-CN", provider: "p", model: "m", promptVersion: "v2", targetScope: "book/section" };
  const digest = buildReservationInputHash(base);
  assert.equal(digest, buildReservationInputHash({ ...base, requestType: "QUIZ" }));
  assert.notEqual(digest, buildReservationInputHash({ ...base, model: "other" }));
  assert.notEqual(digest, buildReservationInputHash({ ...base, targetScope: "other" }));
});

test("success replay trusts the immutable payload snapshot and detects corruption", () => {
  const snapshot = createResultSnapshot({ output: "saved response", remaining: 3 });
  assert.deepEqual(readResultSnapshot(snapshot), { output: "saved response", remaining: 3 });
  assert.equal(readResultSnapshot({ ...snapshot, resultPayload: '{"output":"changed"}' }), null);
  assert.equal(readResultSnapshot(snapshot, "other-version"), null);
  assert.equal(readResultSnapshot({ ...snapshot, resultFingerprint: "bad" }), null);
});

test("requestId replay binds every identity field before returning the saved result", () => {
  const successful = createResultSnapshot({ output: "first result" });
  const row = reservation({ status: "SUCCEEDED", ...successful });
  assert.deepEqual(resolveExistingReservation(row, binding, now), { kind: "succeeded", payload: { output: "first result" } });
  assert.deepEqual(resolveExistingReservation(row, { ...binding, targetScope: null }, now), { kind: "conflict" });
  assert.deepEqual(resolveExistingReservation(row, { ...binding, userId: "other-user" }, now), { kind: "conflict" });
});

test("only live pending reservations may resume or report in-flight", () => {
  assert.deepEqual(resolveExistingReservation(reservation(), binding, now), { kind: "resume-dispatch" });
  assert.deepEqual(resolveExistingReservation(reservation({ dispatchStartedAt: new Date(now.getTime() - 1) }), binding, now), { kind: "in-flight" });
  assert.deepEqual(resolveExistingReservation(reservation({ expiresAt: now }), binding, now), { kind: "expired" });
  assert.deepEqual(resolveExistingReservation(reservation({ providerDeadlineAt: now }), binding, now), { kind: "timeout" });
  assert.deepEqual(resolveExistingReservation(reservation({ expiresAt: now, providerDeadlineAt: now }), binding, now), { kind: "timeout" });
  assert.deepEqual(resolveExistingReservation(reservation({ status: "RELEASED", releaseReason: "TIMEOUT" }), binding, now), { kind: "timeout" });
  assert.deepEqual(resolveExistingReservation(reservation({ status: "RELEASED" }), binding, now), { kind: "released" });
});

test("quota admission enforces the final slot and non-negative counters", () => {
  assert.equal(canReserveLearnerQuota(18, 1, 20), true);
  assert.equal(canReserveLearnerQuota(19, 1, 20), false);
  assert.equal(canReserveLearnerQuota(-1, 0, 20), false);
  assert.equal(canReserveLearnerQuota(0, -1, 20), false);
  assert.equal(remainingAiQuota(18, 1, 20), 1);
  assert.equal(remainingAiQuota(-1, 0, 20), 0);
});

test("rolling limit and provider timeout/TTL fences are fixed", () => {
  assert.equal(AI_ATTEMPT_WINDOW_SECONDS, 60);
  assert.equal(AI_ATTEMPT_LIMIT_PER_USER_AND_TYPE, 3);
  assert.equal(AI_PROVIDER_TIMEOUT_MS, 20_000);
  assert.equal(AI_RESERVATION_TTL_MS, 60_000);
  assert.equal(canStartProviderDispatch(new Date(now.getTime() + 20_000), now), true);
  assert.equal(canStartProviderDispatch(new Date(now.getTime() + 19_999), now), false);
  assert.equal(canCompleteProviderAttempt(new Date(now.getTime() + 1), new Date(now.getTime() + 5), now), true);
  assert.equal(canCompleteProviderAttempt(now, new Date(now.getTime() + 5), now), false);
  assert.equal(canCompleteProviderAttempt(new Date(now.getTime() + 5), now, now), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countShanghaiReadingDays, formatReadingMinutes, getShanghaiDateKey, getShanghaiMonthBounds, MAX_DELTA_SECONDS, isReadingLedgerEnabled, nextLeaseExpiry, READING_HEARTBEAT_SECONDS, READING_LEASE_TTL_SECONDS, validateLiveDelta } from "../src/lib/reading-ledger-contract.ts";

const now = new Date("2026-09-30T00:00:00.000Z");
const lease = { userId: "u1", sessionId: "s1", ownerToken: "owner-1", fencingVersion: 3, leaseExpiresAt: new Date(now.getTime() + 30_000) };
const delta = { deltaId: "4e3f5a80-8f4b-4fa3-8f6a-c5ec65b44abc", userId: "u1", sessionId: "s1", contentId: "c1", sectionId: "p1", ownerToken: "owner-1", fencingVersion: 3, seconds: 15 };

test("accepts only an active current lease owner and bounded integer seconds", () => {
  assert.equal(validateLiveDelta(delta, lease, now), null);
  for (const seconds of [0, -1, 1.5, MAX_DELTA_SECONDS + 1]) assert.equal(validateLiveDelta({ ...delta, seconds }, lease, now), "INVALID_SECONDS");
  assert.equal(validateLiveDelta({ ...delta, ownerToken: "stale" }, lease, now), "STALE_OWNER");
  assert.equal(validateLiveDelta({ ...delta, fencingVersion: 2 }, lease, now), "STALE_OWNER");
  assert.equal(validateLiveDelta(delta, { ...lease, leaseExpiresAt: now }, now), "LEASE_EXPIRED");
});

test("server lease timing keeps heartbeat inside the expiry window", () => {
  assert.ok(READING_HEARTBEAT_SECONDS < READING_LEASE_TTL_SECONDS);
  assert.equal(nextLeaseExpiry(now).getTime(), now.getTime() + READING_LEASE_TTL_SECONDS * 1_000);
});

test("Shanghai month bounds and day keys stay correct across UTC boundaries", () => {
  const october = getShanghaiMonthBounds(new Date("2026-10-01T00:30:00+08:00"));
  assert.equal(october.start.toISOString(), "2026-09-30T16:00:00.000Z");
  assert.equal(october.end.toISOString(), "2026-10-31T16:00:00.000Z");
  assert.equal(getShanghaiDateKey(new Date("2026-09-30T15:59:59.999Z")), "2026-09-30");
  assert.equal(getShanghaiDateKey(new Date("2026-09-30T16:00:00.000Z")), "2026-10-01");
  assert.equal(countShanghaiReadingDays([
    { at: new Date("2026-09-30T16:00:00.000Z"), seconds: 20 },
    { at: new Date("2026-10-01T15:59:59.999Z"), seconds: 40 },
    { at: new Date("2026-10-01T16:00:00.000Z"), seconds: 60 },
  ]), 2);
  assert.equal(countShanghaiReadingDays([
    { at: new Date("2026-09-30T16:00:00.000Z"), seconds: 59 },
  ]), 0);
});

test("monthly reading minutes use compact localized display text", () => {
  assert.equal(formatReadingMinutes(0, "zh-CN"), "0 分钟");
  assert.equal(formatReadingMinutes(48, "zh-CN"), "48 分钟");
  assert.equal(formatReadingMinutes(720, "zh-CN"), "12 小时");
  assert.equal(formatReadingMinutes(756, "zh-CN"), "12 小时 36 分");
  assert.equal(formatReadingMinutes(756, "en"), "12h 36m");
});

test("activation is fail-closed and legacy seconds stop only when the ledger is enabled", () => {
  assert.equal(isReadingLedgerEnabled(undefined), false);
  assert.equal(isReadingLedgerEnabled("TRUE"), false);
  assert.equal(isReadingLedgerEnabled("true"), true);
  for (const file of [
    "../src/app/api/books/[id]/progress/route.ts",
    "../src/app/api/books/[id]/sections/[sectionId]/study/route.ts",
    "../src/app/api/books/[id]/sections/[sectionId]/complete/route.ts",
  ]) assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /isReadingLedgerEnabled\(\) \? 0 :/);
});

test("FocusTimer persists session-scoped retry IDs and exposes explicit takeover", () => {
  const source = readFileSync(new URL("../src/components/reader/FocusTimer.tsx", import.meta.url), "utf8");
  assert.match(source, /enjoy-reading-ledger:v2:\$\{identity\.userId\}:\$\{value\.id\}/);
  assert.match(source, /deltaId: crypto\.randomUUID\(\)/);
  assert.match(source, /action: takeover \? "TAKEOVER" : existing \? "RESUME" : "ACQUIRE"/);
  assert.match(source, /reader\.takeOverTiming/);
});

export const READING_HEARTBEAT_SECONDS = 15;
export const READING_LEASE_TTL_SECONDS = 45;
export const MAX_DELTA_SECONDS = 60;

export function isReadingLedgerEnabled(raw = process.env.READING_LEDGER_ENABLED): boolean {
  return raw === "true";
}

export interface ReadingLeaseBinding {
  userId: string;
  sessionId: string;
  ownerToken: string;
  fencingVersion: number;
  leaseExpiresAt: Date;
}

export interface ReadingDeltaInput {
  deltaId: string;
  userId: string;
  sessionId: string;
  contentId: string;
  sectionId: string;
  ownerToken: string;
  fencingVersion: number;
  seconds: number;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateLiveDelta(input: ReadingDeltaInput, lease: ReadingLeaseBinding, now = new Date()): string | null {
  if (!isUuid(input.deltaId)) return "INVALID_DELTA_ID";
  if (!Number.isInteger(input.seconds) || input.seconds < 1 || input.seconds > MAX_DELTA_SECONDS) return "INVALID_SECONDS";
  if (input.userId !== lease.userId || input.sessionId !== lease.sessionId) return "BINDING_MISMATCH";
  if (input.ownerToken !== lease.ownerToken || input.fencingVersion !== lease.fencingVersion) return "STALE_OWNER";
  if (lease.leaseExpiresAt.getTime() <= now.getTime()) return "LEASE_EXPIRED";
  return null;
}

export function nextLeaseExpiry(now = new Date()): Date {
  return new Date(now.getTime() + READING_LEASE_TTL_SECONDS * 1_000);
}

export function getShanghaiDayBounds(now = new Date()): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  const startMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 8 * 60 * 60 * 1_000;
  return { start: new Date(startMs), end: new Date(startMs + 86_400_000) };
}

export function getShanghaiMonthBounds(now = new Date()): { start: Date; end: Date } {
  const offsetMs = 8 * 60 * 60 * 1_000;
  const shifted = new Date(now.getTime() + offsetMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1) - offsetMs),
    end: new Date(Date.UTC(year, month + 1, 1) - offsetMs),
  };
}

export function getShanghaiDateKey(value: Date): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export function countShanghaiReadingDays(values: Array<{ at: Date; seconds: number }>): number {
  const secondsByDay = new Map<string, number>();
  for (const value of values) {
    if (!Number.isFinite(value.seconds) || value.seconds <= 0) continue;
    const day = getShanghaiDateKey(value.at);
    secondsByDay.set(day, (secondsByDay.get(day) || 0) + value.seconds);
  }
  return [...secondsByDay.values()].filter((seconds) => seconds >= 60).length;
}

export function formatReadingMinutes(minutes: number, locale: "zh-CN" | "en"): string {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (locale === "en") {
    if (!hours) return `${remainder}m`;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  if (!hours) return `${remainder} 分钟`;
  return remainder ? `${hours} 小时 ${remainder} 分` : `${hours} 小时`;
}

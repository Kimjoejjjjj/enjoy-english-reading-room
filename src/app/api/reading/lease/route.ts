import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { validReadingSource, readingWrite } from "@/lib/reading-write";
import { isReadingLedgerEnabled, nextLeaseExpiry, READING_HEARTBEAT_SECONDS } from "@/lib/reading-ledger-contract";

type LeaseAction = "ACQUIRE" | "TAKEOVER" | "HEARTBEAT" | "RESUME";

export async function POST(req: NextRequest) {
  if (!isReadingLedgerEnabled()) return NextResponse.json({ error: "Reading ledger is not enabled", code: "LEDGER_DISABLED" }, { status: 503 });
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { sessionId?: unknown; action?: unknown; ownerToken?: unknown; fencingVersion?: unknown } | null;
  const action = body?.action as LeaseAction;
  if (!body || typeof body.sessionId !== "string" || !["ACQUIRE", "TAKEOVER", "HEARTBEAT", "RESUME"].includes(action)) {
    return NextResponse.json({ error: "Invalid lease request" }, { status: 400 });
  }
  const result = await readingWrite(userId, async (tx) => {
    const now = new Date();
    const session = await tx.readingSession.findFirst({ where: { id: body.sessionId as string, userId, status: "OPEN" }, select: { id: true, contentId: true, currentSectionId: true } });
    if (!session || !await validReadingSource(tx, userId, session.contentId, session.currentSectionId)) return { kind: "missing" as const };
    const existing = await tx.readingLease.findUnique({ where: { userId } });
    if (action === "HEARTBEAT" || action === "RESUME") {
      if (typeof body.ownerToken !== "string" || !Number.isInteger(body.fencingVersion)) return { kind: "invalid" as const };
      const updated = await tx.readingLease.updateMany({
        where: { userId, sessionId: session.id, ownerToken: body.ownerToken, fencingVersion: body.fencingVersion as number, ...(action === "HEARTBEAT" ? { leaseExpiresAt: { gt: now } } : {}) },
        data: { leaseExpiresAt: nextLeaseExpiry(now) },
      });
      if (updated.count !== 1) return { kind: "stale" as const };
      return { kind: "ok" as const, lease: await tx.readingLease.findUniqueOrThrow({ where: { userId } }) };
    }
    if (action === "ACQUIRE" && existing && existing.sessionId === session.id) {
      return { kind: "ok" as const, lease: existing };
    }
    if (action === "ACQUIRE" && existing) {
      return { kind: "occupied" as const, leaseExpiresAt: existing.leaseExpiresAt };
    }
    const ownerToken = randomUUID();
    const lease = existing
      ? await tx.readingLease.update({ where: { userId }, data: { sessionId: session.id, ownerToken, fencingVersion: { increment: 1 }, leaseExpiresAt: nextLeaseExpiry(now), heartbeatIntervalSeconds: READING_HEARTBEAT_SECONDS } })
      : await tx.readingLease.create({ data: { userId, sessionId: session.id, ownerToken, fencingVersion: 1, leaseExpiresAt: nextLeaseExpiry(now), heartbeatIntervalSeconds: READING_HEARTBEAT_SECONDS } });
    return { kind: "ok" as const, lease };
  });
  if (result.kind === "missing") return NextResponse.json({ error: "Reading session not found" }, { status: 404 });
  if (result.kind === "invalid") return NextResponse.json({ error: "Invalid heartbeat" }, { status: 400 });
  if (result.kind === "stale") return NextResponse.json({ error: "Reading lease is stale" }, { status: 409 });
  if (result.kind === "occupied") return NextResponse.json({ error: "Reading time is active in another tab", leaseExpiresAt: result.leaseExpiresAt }, { status: 409 });
  return NextResponse.json({ ...result.lease, serverNow: new Date().toISOString() });
}

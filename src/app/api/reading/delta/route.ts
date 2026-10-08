import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { isReadingLedgerEnabled, validateLiveDelta } from "@/lib/reading-ledger-contract";

interface DeltaBody {
  deltaId?: unknown;
  sessionId?: unknown;
  contentId?: unknown;
  sectionId?: unknown;
  ownerToken?: unknown;
  fencingVersion?: unknown;
  seconds?: unknown;
}

export async function POST(req: NextRequest) {
  if (!isReadingLedgerEnabled()) return NextResponse.json({ error: "Reading ledger is not enabled", code: "LEDGER_DISABLED" }, { status: 503 });
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as DeltaBody | null;
  if (!body || ![body.deltaId, body.sessionId, body.contentId, body.sectionId, body.ownerToken].every((value) => typeof value === "string") || !Number.isInteger(body.fencingVersion) || !Number.isInteger(body.seconds)) {
    return NextResponse.json({ error: "Invalid reading delta" }, { status: 400 });
  }
  const input = {
    deltaId: body.deltaId as string,
    userId,
    sessionId: body.sessionId as string,
    contentId: body.contentId as string,
    sectionId: body.sectionId as string,
    ownerToken: body.ownerToken as string,
    fencingVersion: body.fencingVersion as number,
    seconds: body.seconds as number,
  };
  const result = await readingWrite(userId, async (tx) => {
    const now = new Date();
    const replay = await tx.readingTimeDelta.findUnique({ where: { deltaId: input.deltaId } });
    if (replay) {
      const matches = replay.userId === userId && replay.sessionId === input.sessionId && replay.contentId === input.contentId && replay.sectionId === input.sectionId && replay.ownerToken === input.ownerToken && replay.fencingVersion === input.fencingVersion && replay.seconds === input.seconds && replay.kind === "LIVE";
      return matches ? { kind: "replay" as const, delta: replay } : { kind: "conflict" as const };
    }
    const session = await tx.readingSession.findFirst({ where: { id: input.sessionId, userId, contentId: input.contentId, status: "OPEN" }, select: { id: true } });
    const section = await tx.contentSection.findFirst({ where: { id: input.sectionId, contentId: input.contentId }, select: { id: true } });
    const lease = await tx.readingLease.findUnique({ where: { userId } });
    if (!session || !section || !lease || !await validReadingSource(tx, userId, input.contentId, input.sectionId)) return { kind: "conflict" as const };
    const validation = validateLiveDelta(input, lease, now);
    if (validation) return { kind: "invalid" as const, validation };
    const delta = await tx.readingTimeDelta.create({ data: { ...input, kind: "LIVE", acceptedAt: now } });
    await tx.sectionProgress.upsert({
      where: { userId_sectionId: { userId, sectionId: input.sectionId } },
      create: { userId, contentId: input.contentId, sectionId: input.sectionId, status: "READING", secondsSpent: 0, lastStudiedAt: now },
      update: { lastStudiedAt: now },
    });
    return { kind: "created" as const, delta };
  });
  if (result.kind === "conflict") return NextResponse.json({ error: "Reading delta conflicts with its original binding" }, { status: 409 });
  if (result.kind === "invalid") return NextResponse.json({ error: "Reading delta rejected", code: result.validation }, { status: 409 });
  return NextResponse.json({ ...result.delta, replayed: result.kind === "replay" }, { status: result.kind === "created" ? 201 : 200 });
}

// Read-only reconciliation; never accepts seconds or reveals another account's IDs.
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ids = req.nextUrl.searchParams.getAll("deltaId");
  if (ids.length > 100) return NextResponse.json({ error: "Too many IDs" }, { status: 400 });
  const rows = await prisma.readingTimeDelta.findMany({ where: { userId, deltaId: { in: ids }, kind: "LIVE" }, select: { deltaId: true } });
  return NextResponse.json({ accepted: rows.map((row) => row.deltaId) });
}

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { isReadingLedgerEnabled, isUuid } from "@/lib/reading-ledger-contract";

export async function POST(req: NextRequest) {
  if (!isReadingLedgerEnabled()) return NextResponse.json({ error: "Reading ledger is not enabled", code: "LEDGER_DISABLED" }, { status: 503 });
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { contentId?: unknown; sectionId?: unknown; sessionId?: unknown } | null;
  if (!body || typeof body.contentId !== "string" || typeof body.sectionId !== "string") {
    return NextResponse.json({ error: "contentId and sectionId are required" }, { status: 400 });
  }
  const session = await readingWrite(userId, async (tx) => {
    const content = await tx.content.findUnique({ where: { id: body.contentId as string }, select: { id: true, userId: true } });
    if (!content || content.userId && content.userId !== userId) return null;
    const section = await tx.contentSection.findFirst({ where: { id: body.sectionId as string, contentId: content.id }, select: { id: true } });
    if (!section) return null;
    if (typeof body.sessionId === "string") {
      const existing = await tx.readingSession.findUnique({ where: { id: body.sessionId } });
      if (existing) return existing.userId === userId && existing.contentId === content.id && existing.status === "OPEN" ? tx.readingSession.update({ where: { id: existing.id }, data: { currentSectionId: section.id } }) : null;
      if (!isUuid(body.sessionId)) return null;
      return tx.readingSession.create({ data: { id: body.sessionId, userId, contentId: content.id, currentSectionId: section.id } });
    }
    return tx.readingSession.create({ data: { userId, contentId: content.id, currentSectionId: section.id } });
  });
  if (!session) return NextResponse.json({ error: "Book section not found" }, { status: 404 });
  return NextResponse.json(session, { status: typeof body.sessionId === "string" ? 200 : 201 });
}

export async function PATCH(req: NextRequest) {
  if (!isReadingLedgerEnabled()) return NextResponse.json({ error: "Reading ledger is not enabled", code: "LEDGER_DISABLED" }, { status: 503 });
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { sessionId?: unknown; closeRequestId?: unknown } | null;
  if (!body || typeof body.sessionId !== "string" || !isUuid(body.closeRequestId)) return NextResponse.json({ error: "Invalid close request" }, { status: 400 });
  const result = await readingWrite(userId, async (tx) => {
    const replay = await tx.readingSession.findUnique({ where: { closeRequestId: body.closeRequestId as string } });
    if (replay) return replay.userId === userId && replay.id === body.sessionId && replay.summaryJson ? { kind: "ok" as const, summaryJson: replay.summaryJson, replayed: true } : { kind: "conflict" as const };
    const session = await tx.readingSession.findFirst({ where: { id: body.sessionId as string, userId, status: "OPEN" }, include: { content: { select: { title: true } }, currentSection: { select: { title: true, chapterTitle: true } } } });
    if (!session || !await validReadingSource(tx, userId, session.contentId, session.currentSectionId)) return { kind: "missing" as const };
    const [duration, events] = await Promise.all([
      tx.readingTimeDelta.aggregate({ where: { userId, sessionId: session.id, kind: "LIVE" }, _sum: { seconds: true } }),
      tx.learningEvent.groupBy({ by: ["eventType"], where: { userId, sessionId: session.id, eventType: { in: ["LOOKUP_SUCCEEDED", "VOCABULARY_SAVED", "HIGHLIGHT_CREATED"] } }, _count: true }),
    ]);
    const count = (eventType: string) => events.find((item) => item.eventType === eventType)?._count || 0;
    const summary = { sessionId: session.id, contentId: session.contentId, sectionId: session.currentSectionId, bookTitle: session.content.title, sectionTitle: session.currentSection?.title || null, chapterTitle: session.currentSection?.chapterTitle || null, durationSeconds: duration._sum.seconds || 0, lookupCount: count("LOOKUP_SUCCEEDED"), savedVocabularyCount: count("VOCABULARY_SAVED"), highlightCount: count("HIGHLIGHT_CREATED") };
    const summaryJson = JSON.stringify(summary);
    await tx.readingSession.update({ where: { id: session.id }, data: { status: "CLOSED", closedAt: new Date(), closeRequestId: body.closeRequestId as string, summaryJson } });
    await tx.readingLease.deleteMany({ where: { sessionId: session.id } });
    return { kind: "ok" as const, summaryJson, replayed: false };
  });
  if (result.kind === "conflict") return NextResponse.json({ error: "Close request conflicts with its original binding" }, { status: 409 });
  if (result.kind === "missing") return NextResponse.json({ error: "Reading session not found" }, { status: 404 });
  return NextResponse.json({ summary: JSON.parse(result.summaryJson), replayed: result.replayed });
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ userId, ledgerEnabled: isReadingLedgerEnabled() });
}

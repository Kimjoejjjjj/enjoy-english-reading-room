import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { readingEventBindingHash } from "@/lib/reading-event-contract";
import { isUuid } from "@/lib/reading-ledger-contract";
import { isReadingLedgerEnabled } from "@/lib/reading-ledger-contract";

type Context = { params: Promise<{ id: string; sectionId: string }> };

async function getSection(id: string, sectionId: string) {
  return prisma.contentSection.findFirst({ where: { id: sectionId, contentId: id }, select: { id: true } });
}

export async function GET(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sectionId } = await params;
  if (!(await getAccessibleContent(id, userId)) || !(await getSection(id, sectionId))) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  const progress = await prisma.sectionProgress.findUnique({ where: { userId_sectionId: { userId, sectionId } } });
  return NextResponse.json(progress || {
    contentId: id,
    sectionId,
    status: "NOT_STARTED",
    secondsSpent: 0,
    lookupCount: 0,
    savedWordCount: 0,
    highlightCount: 0,
    lastQuizScore: null,
    bestQuizScore: null,
    completedAt: null,
  });
}

export async function PUT(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sectionId } = await params;
  if (!(await getAccessibleContent(id, userId)) || !(await getSection(id, sectionId))) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const secondsSpent = isReadingLedgerEnabled() ? 0 : Math.max(0, Math.min(600, Math.floor(Number(body.secondsSpent) || 0)));

  const requestId = !isReadingLedgerEnabled() && isUuid(body.requestId) ? body.requestId : null;
  const bindingHash = readingEventBindingHash({ userId, contentId: id, sectionId, secondsSpent: String(secondsSpent) });
  const progress = await readingWrite(userId, async (tx) => {
    if (!await validReadingSource(tx, userId, id, sectionId)) return null;
    if (requestId) {
      const accepted = await tx.learningEvent.findUnique({ where: { requestId } });
      if (accepted) {
        if (accepted.userId !== userId || accepted.bindingHash !== bindingHash || accepted.operationType !== "LEGACY_TIME") return null;
        return tx.sectionProgress.findUnique({ where: { userId_sectionId: { userId, sectionId } } });
      }
    }
    const existing = await tx.sectionProgress.findUnique({ where: { userId_sectionId: { userId, sectionId } } });
    const updated = await tx.sectionProgress.upsert({
      where: { userId_sectionId: { userId, sectionId } },
      create: { userId, contentId: id, sectionId, status: "READING", secondsSpent, lastStudiedAt: new Date() },
      update: { secondsSpent: { increment: secondsSpent }, status: existing?.status === "COMPLETED" ? "COMPLETED" : "READING", lastStudiedAt: new Date() },
    });
    if (!existing) await tx.learningEvent.create({ data: { userId, contentId: id, sectionId, eventType: "SECTION_STARTED" } });
    if (secondsSpent > 0) await tx.learningEvent.create({ data: { userId, contentId: id, sectionId, eventType: "STUDY_TIME", payload: JSON.stringify({ secondsSpent }), ...(requestId ? { requestId, bindingHash, operationType: "LEGACY_TIME" } : {}) } });
    return updated;
  });
  if (!progress) return NextResponse.json({ error: "Reading source is stale" }, { status: 409 });
  return NextResponse.json(progress);
}

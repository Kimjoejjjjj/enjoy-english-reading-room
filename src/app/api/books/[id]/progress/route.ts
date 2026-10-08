import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { isReadingLedgerEnabled } from "@/lib/reading-ledger-contract";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await getAccessibleContent(id, userId))) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const progress = await prisma.readingProgress.findUnique({ where: { userId_contentId: { userId, contentId: id } } });
  return NextResponse.json(progress);
}

export async function PUT(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await getAccessibleContent(id, userId))) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const body = await req.json();
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : null;
  if (sectionId) {
    const section = await prisma.contentSection.findFirst({ where: { id: sectionId, contentId: id }, select: { id: true } });
    if (!section) return NextResponse.json({ error: "Section not found" }, { status: 400 });
  }
  const restarting = body.restart === true;
  const completionPercent = restarting ? 0 : Math.max(0, Math.min(100, Number(body.completionPercent) || 0));
  const secondsSpent = isReadingLedgerEnabled() ? 0 : Math.max(0, Math.min(3600, Number(body.secondsSpent) || 0));
  const status = restarting || completionPercent < 100 ? "READING" : "COMPLETED";

  const progress = await readingWrite(userId, async (tx) => {
    if (!await validReadingSource(tx, userId, id, sectionId)) return null;
  const progress = await tx.readingProgress.upsert({
    where: { userId_contentId: { userId, contentId: id } },
    create: { userId, contentId: id, sectionId, position: restarting ? null : body.position || null, completionPercent, secondsSpent, status },
    update: { sectionId, position: restarting ? null : body.position || null, completionPercent, secondsSpent: restarting ? 0 : { increment: secondsSpent }, status, lastReadAt: new Date() },
  });
  await tx.learningEvent.create({
    data: { userId, contentId: id, sectionId, eventType: restarting ? "READING_RESTARTED" : "READ_PROGRESS", payload: JSON.stringify({ completionPercent, secondsSpent }) },
  });
    return progress;
  });
  if (!progress) return NextResponse.json({ error: "Reading source is stale" }, { status: 409 });
  return NextResponse.json(progress);
}

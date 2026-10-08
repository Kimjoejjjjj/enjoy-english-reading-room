import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await prisma.userVocabulary.findMany({
    where: { userId, nextReview: { lte: new Date() } },
    orderBy: [{ mastery: "asc" }, { nextReview: "asc" }],
    take: 30,
    include: { entry: true, occurrences: { orderBy: { createdAt: "desc" }, take: 1, include: { content: { select: { title: true } } } } },
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const item = await prisma.userVocabulary.findUnique({ where: { id: body.id } });
  if (!item || item.userId !== userId) return NextResponse.json({ error: "Word not found" }, { status: 404 });

  const qualityMap: Record<string, number> = { AGAIN: 1, HARD: 3, GOOD: 4, EASY: 5 };
  const quality = qualityMap[body.rating] ?? 0;
  if (!quality) return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
  let easeFactor = item.easeFactor;
  let intervalDays = item.intervalDays;
  let status = item.status;
  let errorCount = item.errorCount;

  if (quality < 3) {
    intervalDays = 1;
    errorCount += 1;
    status = "LEARNING";
  } else {
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    intervalDays = item.reviewCount === 0 ? 1 : item.reviewCount === 1 ? 3 : Math.max(1, Math.round(Math.max(1, intervalDays) * easeFactor));
    status = item.reviewCount >= 4 && quality >= 4 ? "MASTERED" : "REVIEW";
  }
  const nextReview = new Date(Date.now() + intervalDays * 86_400_000);
  const mastery = Math.max(0, Math.min(100, item.mastery + (quality < 3 ? -12 : quality === 3 ? 8 : quality === 4 ? 15 : 22)));
  const updated = await prisma.userVocabulary.update({
    where: { id: item.id },
    data: { easeFactor, intervalDays, nextReview, mastery, status, errorCount, reviewCount: { increment: 1 }, lastReviewedAt: new Date() },
    include: { entry: true },
  });
  await prisma.learningEvent.create({ data: { userId, userVocabularyId: item.id, eventType: "REVIEW_COMPLETED", payload: JSON.stringify({ rating: body.rating, intervalDays, mastery }) } });
  return NextResponse.json(updated);
}

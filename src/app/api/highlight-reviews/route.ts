import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isHighlightReviewEnabled } from "@/lib/highlight-review-contract";
import { hasHighlightReviewColumns, legacyHighlightLabelSelect, legacyHighlightReviewWhere } from "@/lib/highlight-label-schema";
import { isReviewRating, scheduleReview } from "@/lib/spaced-repetition";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const highlightReviewSchemaReady = await hasHighlightReviewColumns();

  const items = await prisma.highlight.findMany({
    where: {
      userId,
      ...(highlightReviewSchemaReady
        ? { label: { is: { slotKey: { not: null }, reviewEnabled: true } } }
        : legacyHighlightReviewWhere),
      OR: [{ nextReview: null }, { nextReview: { lte: new Date() } }],
    },
    orderBy: [{ nextReview: "asc" }, { createdAt: "asc" }],
    take: 30,
    include: {
      label: { select: legacyHighlightLabelSelect },
      content: { select: { id: true, title: true } },
      section: { select: { id: true, title: true } },
    },
  });
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || !isReviewRating(body.rating)) {
    return NextResponse.json({ error: "Invalid review" }, { status: 400 });
  }

  const highlightReviewSchemaReady = await hasHighlightReviewColumns();
  const item = highlightReviewSchemaReady
    ? await prisma.highlight.findFirst({
        where: { id: body.id, userId },
        include: { label: { select: { slotKey: true, reviewEnabled: true } } },
      })
    : await prisma.highlight.findFirst({ where: { id: body.id, userId } });
  if (!item) return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
  const reviewEnabled = highlightReviewSchemaReady && "label" in item
    ? isHighlightReviewEnabled(item.label as { slotKey: string | null; reviewEnabled: boolean | null } | null)
    : ["RED", "YELLOW"].includes(item.color);
  if (!reviewEnabled) return NextResponse.json({ error: "Highlight is not enabled for review" }, { status: 409 });

  const schedule = scheduleReview({
    rating: body.rating,
    easeFactor: item.easeFactor,
    intervalDays: item.intervalDays,
    reviewCount: item.reviewCount,
  });

  const legacyColor = highlightReviewSchemaReady
    ? undefined
    : body.rating === "EASY" ? "GREEN" : body.rating === "AGAIN" ? "RED" : item.color === "GREEN" ? "YELLOW" : item.color;
  const updated = await prisma.highlight.update({
    where: { id: item.id },
    data: {
      easeFactor: schedule.easeFactor,
      intervalDays: schedule.intervalDays,
      nextReview: schedule.nextReview,
      reviewCount: { increment: 1 },
      lastRating: body.rating,
      lastReviewedAt: new Date(),
      ...(legacyColor ? { color: legacyColor } : {}),
    },
    include: {
      label: { select: legacyHighlightLabelSelect },
      content: { select: { id: true, title: true } },
      section: { select: { id: true, title: true } },
    },
  });

  await prisma.learningEvent.create({
    data: {
      userId,
      contentId: item.contentId,
      sectionId: item.sectionId,
      eventType: "HIGHLIGHT_REVIEW_COMPLETED",
      payload: JSON.stringify({ rating: body.rating, intervalDays: schedule.intervalDays, ...(legacyColor ? { color: legacyColor } : {}) }),
    },
  });
  return NextResponse.json(updated);
}

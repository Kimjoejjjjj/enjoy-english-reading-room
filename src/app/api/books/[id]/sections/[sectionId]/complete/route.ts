import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { getAccessibleContent } from "@/lib/content-access";
import { isReadingLedgerEnabled } from "@/lib/reading-ledger-contract";

type Context = { params: Promise<{ id: string; sectionId: string }> };

export async function POST(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sectionId } = await params;
  if (!(await getAccessibleContent(id, userId))) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const section = await prisma.contentSection.findFirst({ where: { id: sectionId, contentId: id }, select: { id: true, orderIndex: true, title: true } });
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const finalSeconds = isReadingLedgerEnabled() ? 0 : Math.max(0, Math.min(600, Math.floor(Number(body.secondsSpent) || 0)));

  const result = await readingWrite(userId, async (tx) => {
    if (!await validReadingSource(tx, userId, id, sectionId)) return null;
    const section = await tx.contentSection.findFirstOrThrow({ where: { id: sectionId, contentId: id }, select: { orderIndex: true, title: true } });
  const [existing, lookupCount, savedWordCount, highlights, totalSections] = await Promise.all([
    tx.sectionProgress.findUnique({ where: { userId_sectionId: { userId, sectionId } } }),
    tx.learningEvent.count({ where: { userId, contentId: id, sectionId, eventType: { in: ["WORD_LOOKUP", "LOOKUP_SUCCEEDED"] } } }),
    tx.vocabularyOccurrence.count({ where: { contentId: id, sectionId, userVocabulary: { userId } } }),
    tx.highlight.findMany({ where: { userId, contentId: id, sectionId }, select: { color: true } }),
    tx.contentSection.count({ where: { contentId: id } }),
  ]);
  const highlightSummary = highlights.reduce((result, item) => {
    result[item.color] = (result[item.color] || 0) + 1;
    return result;
  }, {} as Record<string, number>);

    const firstCompletion = existing?.status !== "COMPLETED";
    const progress = await tx.sectionProgress.upsert({
      where: { userId_sectionId: { userId, sectionId } },
      create: {
        userId, contentId: id, sectionId, status: "COMPLETED", secondsSpent: finalSeconds,
        lookupCount, savedWordCount, highlightCount: highlights.length, completedAt: new Date(), lastStudiedAt: new Date(),
      },
      update: {
        status: "COMPLETED",
        ...(firstCompletion && finalSeconds ? { secondsSpent: { increment: finalSeconds } } : {}),
        lookupCount, savedWordCount, highlightCount: highlights.length,
        completedAt: existing?.completedAt || new Date(), lastStudiedAt: new Date(),
      },
    });
    if (firstCompletion) {
      await tx.learningEvent.create({
        data: { userId, contentId: id, sectionId, eventType: "SECTION_COMPLETED", payload: JSON.stringify({ secondsSpent: progress.secondsSpent, lookupCount, savedWordCount, highlightSummary }) },
      });
    }

    const completedSections = await tx.sectionProgress.count({ where: { userId, contentId: id, status: "COMPLETED" } });
    const completionPercent = Math.min(100, totalSections ? (completedSections / totalSections) * 100 : 0);
    const nextSection = await tx.contentSection.findFirst({ where: { contentId: id, orderIndex: { gt: section.orderIndex } }, orderBy: { orderIndex: "asc" }, select: { id: true, title: true } });
    await tx.readingProgress.upsert({
      where: { userId_contentId: { userId, contentId: id } },
      create: { userId, contentId: id, sectionId: nextSection?.id || sectionId, completionPercent, secondsSpent: 0, status: completionPercent >= 100 ? "COMPLETED" : "READING" },
      update: { sectionId: nextSection?.id || sectionId, completionPercent, status: completionPercent >= 100 ? "COMPLETED" : "READING", lastReadAt: new Date() },
    });
    return { progress, firstCompletion, completedSections, completionPercent, nextSection, lookupCount, savedWordCount, highlights, highlightSummary, title: section.title };
  });

  if (!result) return NextResponse.json({ error: "Reading source is stale" }, { status: 409 });
  const { lookupCount, savedWordCount, highlights, highlightSummary, title, ...completion } = result;
  return NextResponse.json({
    ...completion,
    summary: {
      title,
      secondsSpent: result.progress.secondsSpent,
      lookupCount,
      savedWordCount,
      highlightCount: highlights.length,
      highlights: { RED: highlightSummary.RED || 0, YELLOW: highlightSummary.YELLOW || 0, GREEN: highlightSummary.GREEN || 0 },
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasHighlightReviewColumns, legacyHighlightReviewWhere } from "@/lib/highlight-label-schema";
import { countShanghaiReadingDays, getShanghaiDayBounds, getShanghaiMonthBounds, isReadingLedgerEnabled } from "@/lib/reading-ledger-contract";

function payload<T>(value?: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const highlightReviewSchemaReady = await hasHighlightReviewColumns();

  const [continueReading, dueReviews, dueHighlightReviews, learnedWords, todayEvents, weekCompleted, recentCompleted, sevenDayEvents] = await Promise.all([
    prisma.readingProgress.findFirst({ where: { userId, status: { not: "COMPLETED" } }, orderBy: { lastReadAt: "desc" }, include: { content: true, section: { select: { title: true } } } }),
    prisma.userVocabulary.count({ where: { userId, nextReview: { lte: now } } }),
    prisma.highlight.count({ where: { userId, ...(highlightReviewSchemaReady ? { label: { is: { slotKey: { not: null }, reviewEnabled: true } } } : legacyHighlightReviewWhere), OR: [{ nextReview: null }, { nextReview: { lte: now } }] } }),
    prisma.userVocabulary.count({ where: { userId } }),
    prisma.learningEvent.findMany({ where: { userId, createdAt: { gte: startOfDay } }, select: { eventType: true, payload: true } }),
    prisma.sectionProgress.count({ where: { userId, status: "COMPLETED", completedAt: { gte: sevenDaysAgo } } }),
    prisma.readingProgress.findFirst({ where: { userId, status: "COMPLETED" }, orderBy: { lastReadAt: "desc" }, include: { content: true, section: { select: { title: true } } } }),
    prisma.learningEvent.findMany({ where: { userId, createdAt: { gte: sevenDaysAgo }, eventType: { in: ["WORD_LOOKUP", "VOCABULARY_SAVED", "BASIC_QUIZ_SUBMITTED"] } }, select: { eventType: true, payload: true } }),
  ]);

  const todaySeconds = todayEvents.filter((event) => event.eventType === "STUDY_TIME").reduce((sum, event) => sum + (payload<{ secondsSpent?: number }>(event.payload)?.secondsSpent || 0), 0);
  const ledgerEnabled = isReadingLedgerEnabled();
  const shanghaiDay = getShanghaiDayBounds(now);
  const shanghaiMonth = getShanghaiMonthBounds(now);
  const [ledgerToday, ledgerLifetime, ledgerMonth, ledgerMonthDays] = ledgerEnabled ? await Promise.all([
    prisma.readingTimeDelta.aggregate({ where: { userId, kind: "LIVE", acceptedAt: { gte: shanghaiDay.start, lt: shanghaiDay.end } }, _sum: { seconds: true } }),
    prisma.readingTimeDelta.aggregate({ where: { userId }, _sum: { seconds: true } }),
    prisma.readingTimeDelta.aggregate({ where: { userId, kind: "LIVE", seconds: { gt: 0 }, acceptedAt: { gte: shanghaiMonth.start, lt: shanghaiMonth.end } }, _sum: { seconds: true } }),
    prisma.readingTimeDelta.findMany({ where: { userId, kind: "LIVE", seconds: { gt: 0 }, acceptedAt: { gte: shanghaiMonth.start, lt: shanghaiMonth.end } }, select: { acceptedAt: true, seconds: true } }),
  ]) : [{ _sum: { seconds: null } }, { _sum: { seconds: null } }, { _sum: { seconds: null } }, []];
  const legacyMonthEvents = ledgerEnabled ? [] : await prisma.learningEvent.findMany({
    where: { userId, eventType: "STUDY_TIME", createdAt: { gte: shanghaiMonth.start, lt: shanghaiMonth.end } },
    select: { createdAt: true, payload: true },
  });
  const positiveLegacyMonthEvents = legacyMonthEvents.flatMap((event) => {
    const seconds = payload<{ secondsSpent?: number }>(event.payload)?.secondsSpent || 0;
    return seconds > 0 ? [{ createdAt: event.createdAt, seconds }] : [];
  });
  const effectiveTodaySeconds = ledgerEnabled ? ledgerToday._sum.seconds || 0 : todaySeconds;
  const monthSeconds = ledgerEnabled
    ? ledgerMonth._sum.seconds || 0
    : positiveLegacyMonthEvents.reduce((sum, event) => sum + event.seconds, 0);
  const monthReadingDays = countShanghaiReadingDays(ledgerEnabled
    ? ledgerMonthDays.map((event) => ({ at: event.acceptedAt, seconds: event.seconds }))
    : positiveLegacyMonthEvents.map((event) => ({ at: event.createdAt, seconds: event.seconds })));
  const todayNewWords = todayEvents.filter((event) => event.eventType === "VOCABULARY_SAVED").length;
  const lookups = sevenDayEvents.filter((event) => event.eventType === "WORD_LOOKUP").length;
  const saved = sevenDayEvents.filter((event) => event.eventType === "VOCABULARY_SAVED").length;
  const quizScores = sevenDayEvents.filter((event) => event.eventType === "BASIC_QUIZ_SUBMITTED").map((event) => payload<{ score?: number }>(event.payload)?.score).filter((score): score is number => typeof score === "number");

  return NextResponse.json({
    continueReading: continueReading ? [continueReading] : [],
    dueReviews,
    dueHighlightReviews,
    learnedWords,
    todayMinutes: Math.round(effectiveTodaySeconds / 60),
    lifetimeMinutes: ledgerEnabled ? Math.round((ledgerLifetime._sum.seconds || 0) / 60) : null,
    monthMinutes: Math.round(monthSeconds / 60),
    monthReadingDays,
    todayNewWords,
    weekCompleted,
    recentCompleted,
    lookupSaveRate: lookups ? Math.round((saved / lookups) * 100) : 0,
    quizAccuracy: quizScores.length ? Math.round(quizScores.reduce((sum, score) => sum + score, 0) / quizScores.length) : null,
  });
}

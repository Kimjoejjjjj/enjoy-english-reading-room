import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const planDate = new Date(now); planDate.setHours(0, 0, 0, 0);
  const [wordCount, dueCount, recentProgress, lookupCount, reviewCount] = await Promise.all([
    prisma.userVocabulary.count({ where: { userId } }),
    prisma.userVocabulary.count({ where: { userId, nextReview: { lte: now } } }),
    prisma.readingProgress.findFirst({ where: { userId }, orderBy: { lastReadAt: "desc" }, include: { content: true, section: true } }),
    prisma.learningEvent.count({ where: { userId, eventType: "WORD_LOOKUP", createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } } }),
    prisma.learningEvent.count({ where: { userId, eventType: "REVIEW_COMPLETED", createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } } }),
  ]);
  const readingScore = recentProgress ? Math.min(100, 35 + recentProgress.completionPercent * 0.65) : 20;
  const weakPoints = lookupCount > reviewCount * 2 ? "近期查词较多，建议加强词汇复习。" : "保持阅读与复习的平衡。";
  const profile = await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, level: "B1", vocabularySize: wordCount, readingScore, weakPoints, goals: "通过真实英文材料提升阅读与词汇", dailyMinutes: 30 },
    update: { vocabularySize: wordCount, readingScore, weakPoints },
  });
  const items = [
    recentProgress ? { type: "READ", minutes: 18, title: `继续阅读《${recentProgress.content.title}》`, href: `/dashboard/ebook/read/${recentProgress.contentId}` } : { type: "READ", minutes: 18, title: "选择一本书并完成第一节精读", href: "/dashboard/ebook" },
    { type: "REVIEW", minutes: 8, title: `复习 ${dueCount} 个到期词汇`, href: "/dashboard/review" },
    { type: "REFLECT", minutes: 4, title: "用英文写一句今日阅读总结", href: "/dashboard/coach" },
  ];
  const plan = await prisma.learningPlan.upsert({
    where: { userId_planDate: { userId, planDate } },
    create: { userId, planDate, planJson: JSON.stringify(items), rationale: weakPoints },
    update: { planJson: JSON.stringify(items), rationale: weakPoints },
  });
  return NextResponse.json({ profile, plan: { ...plan, items }, stats: { wordCount, dueCount, lookupCount, reviewCount } });
}

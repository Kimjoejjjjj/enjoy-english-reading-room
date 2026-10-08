import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ id: string; sectionId: string }> };
type StoredQuestion = { id: string; prompt: string; context?: string; options: string[]; correctIndex: number; userVocabularyId?: string; explanation: string };

export async function POST(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sectionId } = await params;
  const body = await req.json();
  const attemptId = typeof body.attemptId === "string" ? body.attemptId : "";
  const answers = Array.isArray(body.answers) ? body.answers.map((answer: unknown) => Number(answer)) : [];
  const event = await prisma.learningEvent.findUnique({ where: { id: attemptId } });
  const validEvent = event && ["BASIC_PRACTICE_GENERATED", "AI_PRACTICE_GENERATED"].includes(event.eventType);
  if (!event || !validEvent || event.userId !== userId || event.contentId !== id || event.sectionId !== sectionId) {
    return NextResponse.json({ error: "Practice attempt not found" }, { status: 404 });
  }
  const payload = JSON.parse(event.payload || "{}") as { questions?: StoredQuestion[] };
  const questions = payload.questions || [];
  if (!questions.length || answers.length !== questions.length) return NextResponse.json({ error: "请完成全部题目" }, { status: 400 });

  const results = questions.map((question, index) => ({
    id: question.id,
    correct: answers[index] === question.correctIndex,
    selectedIndex: answers[index],
    correctIndex: question.correctIndex,
    explanation: question.explanation,
  }));
  const correctCount = results.filter((result) => result.correct).length;
  const score = Math.round((correctCount / questions.length) * 100);
  const wrongVocabularyIds = Array.from(new Set(questions.filter((question, index) => !results[index].correct && question.userVocabularyId).map((question) => question.userVocabularyId as string)));
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);

  const progress = await readingWrite(userId, async (tx) => {
    const fresh = await tx.learningEvent.findUnique({ where: { id: attemptId } });
    if (!fresh || fresh.userId !== userId || fresh.contentId !== id || fresh.sectionId !== sectionId || !await validReadingSource(tx, userId, id, sectionId)) return null;
    for (const vocabularyId of wrongVocabularyIds) {
      const vocabulary = await tx.userVocabulary.findFirst({ where: { id: vocabularyId, userId }, select: { id: true, mastery: true } });
      if (vocabulary) await tx.userVocabulary.update({
        where: { id: vocabulary.id },
        data: { errorCount: { increment: 1 }, status: "LEARNING", nextReview: tomorrow, mastery: Math.max(0, vocabulary.mastery - 8) },
      });
    }
    const existing = await tx.sectionProgress.findUnique({ where: { userId_sectionId: { userId, sectionId } } });
    const updated = await tx.sectionProgress.upsert({
      where: { userId_sectionId: { userId, sectionId } },
      create: { userId, contentId: id, sectionId, status: "READING", lastQuizScore: score, bestQuizScore: score },
      update: { lastQuizScore: score, bestQuizScore: Math.max(existing?.bestQuizScore || 0, score), lastStudiedAt: now },
    });
    await tx.learningEvent.create({
      data: { userId, contentId: id, sectionId, eventType: event.eventType === "AI_PRACTICE_GENERATED" ? "AI_QUIZ_SUBMITTED" : "BASIC_QUIZ_SUBMITTED", payload: JSON.stringify({ attemptId, answers, score, correctCount, total: questions.length, wrongVocabularyIds }) },
    });
    return updated;
  });
  if (!progress) return NextResponse.json({ error: "Practice source is stale" }, { status: 409 });
  return NextResponse.json({ score, correctCount, total: questions.length, results, wrongVocabularyCount: wrongVocabularyIds.length, progress });
}

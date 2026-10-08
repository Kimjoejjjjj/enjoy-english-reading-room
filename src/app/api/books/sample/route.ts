import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { countWords, paginateSectionsForLearning, toSegments } from "@/lib/book-parser";
import { sampleBook } from "@/lib/sample-book";

async function findImported(userId: string) {
  return prisma.content.findFirst({
    where: { userId, source: "SAMPLE", title: sampleBook.title },
    select: { id: true },
  });
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const imported = await findImported(userId);
  return NextResponse.json({
    key: "alice-in-wonderland",
    title: sampleBook.title,
    author: sampleBook.author,
    description: sampleBook.description,
    license: sampleBook.license,
    coverStyle: "alice-lilac",
    imported: Boolean(imported),
    contentId: imported?.id || null,
  });
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.content.findFirst({
    where: { userId, source: "SAMPLE", title: sampleBook.title },
  });
  if (existing) return NextResponse.json(existing);

  const sourceSections = sampleBook.sections.map((section) => ({
    title: section.title,
    kind: "CHAPTER" as const,
    paragraphs: section.paragraphs,
  }));
  const learningSections = paginateSectionsForLearning(sourceSections);
  const wordCount = learningSections.reduce(
    (total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0),
    0,
  );
  const content = await prisma.content.create({
    data: {
      userId,
      title: sampleBook.title,
      author: sampleBook.author,
      description: sampleBook.description,
      license: sampleBook.license,
      format: "TXT",
      source: "SAMPLE",
      status: "READY",
      fileUrl: "sample://alice-in-wonderland",
    parserVersion: 3,
      sourceSectionCount: sourceSections.length,
      sectionCount: learningSections.length,
      wordCount,
      sections: {
        create: learningSections.map((section, orderIndex) => ({
          orderIndex,
          title: section.title,
          chapterTitle: section.chapterTitle || null,
          kind: "CHAPTER",
          plainText: section.paragraphs.join("\n\n"),
          wordCount: section.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0),
          segments: { create: toSegments(section.paragraphs) },
        })),
      },
    },
  });
  return NextResponse.json(content, { status: 201 });
}

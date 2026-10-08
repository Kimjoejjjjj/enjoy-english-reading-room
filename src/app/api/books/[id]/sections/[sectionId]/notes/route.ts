import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { getStableChapterBoundary } from "@/lib/chapter-boundary";

type Context = { params: Promise<{ id: string; sectionId: string }> };

const sectionSelect = {
  id: true,
  orderIndex: true,
  title: true,
  chapterTitle: true,
} as const;

export async function GET(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sectionId } = await params;
  if (!(await getAccessibleContent(id, userId))) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  const currentSection = await prisma.contentSection.findFirst({ where: { id: sectionId, contentId: id }, select: sectionSelect });
  if (!currentSection) return NextResponse.json({ error: "Section not found" }, { status: 404 });

  const scope = req.nextUrl.searchParams.get("scope");
  const allSections = scope === "chapter"
    ? await prisma.contentSection.findMany({
        where: { contentId: id },
        orderBy: { orderIndex: "asc" },
        select: sectionSelect,
      })
    : [currentSection];
  const chapterBoundary = scope === "chapter"
    ? getStableChapterBoundary(allSections, currentSection.id)
    : { key: `section:${currentSection.id}`, pages: [currentSection] };
  const sections = chapterBoundary.pages;
  const sectionIds = sections.map((section) => section.id);

  const [highlights, occurrences] = await Promise.all([
    prisma.highlight.findMany({
      where: { userId, contentId: id, sectionId: { in: sectionIds } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        quote: true,
        color: true,
        note: true,
        locator: true,
        segmentId: true,
        createdAt: true,
        section: { select: sectionSelect },
        label: { select: { id: true, name: true, color: true, archived: true } },
      },
    }),
    prisma.vocabularyOccurrence.findMany({
      where: { contentId: id, sectionId: { in: sectionIds }, userVocabulary: { userId } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        selectedText: true,
        context: true,
        segmentId: true,
        sourceType: true,
        parentLemma: true,
        createdAt: true,
        section: { select: sectionSelect },
        userVocabulary: { select: { id: true, entry: { select: { lemma: true, definition: true } } } },
      },
    }),
  ]);

  const seen = new Set<string>();
  const vocabulary = occurrences.filter((item) => {
    if (seen.has(item.userVocabulary.id)) return false;
    seen.add(item.userVocabulary.id);
    return true;
  });

  return NextResponse.json({ scope: scope === "chapter" ? "chapter" : "section", chapterKey: chapterBoundary.key, currentSection, sections, highlights, vocabulary });
}

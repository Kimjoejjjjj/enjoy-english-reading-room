import { unlink } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { deleteStoredCover } from "@/lib/book-cover";
import { resolveBookSourcePath } from "@/lib/app-storage";

type Context = { params: Promise<{ id: string }> };

interface StoredNavigationEntry {
  title: string;
  kind: "CHAPTER" | "FRONT_MATTER";
  targetOrderIndex: number;
  depth?: number;
  sourcePage?: number;
}

function readNavigation(value?: string | null): StoredNavigationEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as StoredNavigationEntry[];
    return Array.isArray(parsed)
      ? parsed
        .filter((entry) => typeof entry?.title === "string" && (entry.kind === "CHAPTER" || entry.kind === "FRONT_MATTER") && Number.isInteger(entry.targetOrderIndex))
        .map((entry) => ({
          ...entry,
          depth: Math.min(6, Math.max(0, Number.isInteger(entry.depth) ? entry.depth! : 0)),
        }))
      : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const accessible = await getAccessibleContent(id, userId);
  if (!accessible) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  const book = await prisma.content.findUnique({
    where: { id },
    include: {
      sections: { orderBy: { orderIndex: "asc" }, select: { id: true, orderIndex: true, title: true, chapterTitle: true, kind: true, wordCount: true } },
      progresses: { where: { userId }, take: 1 },
    },
  });
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const navigationEntries = readNavigation(book.navigationJson).flatMap((entry) => {
    const target = book.sections.find((section) => section.orderIndex === entry.targetOrderIndex);
    return target ? [{ ...entry, targetSectionId: target.id }] : [];
  });
  return NextResponse.json({ ...book, fileUrl: undefined, fileDownloadUrl: book.source === "UPLOAD" ? `/api/books/${id}/file` : undefined, navigationJson: undefined, navigationEntries });
}

export async function PATCH(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const book = await prisma.content.findUnique({ where: { id } });
  if (!book || book.userId !== userId) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const author = typeof body.author === "string" ? body.author.trim().slice(0, 200) || null : book.author;
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const updated = await prisma.content.update({ where: { id }, data: { title, author } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const book = await prisma.content.findUnique({ where: { id } });
  if (!book || book.userId !== userId) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  await prisma.content.delete({ where: { id } });
  const filePath = await resolveBookSourcePath(book.fileUrl).catch(() => null);
  if (filePath) await unlink(filePath).catch(() => undefined);
  await deleteStoredCover(book.coverUrl);
  return NextResponse.json({ success: true });
}

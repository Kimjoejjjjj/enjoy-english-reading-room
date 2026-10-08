import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const books = await prisma.content.findMany({
    where: { OR: [{ userId }, { userId: null, source: "SAMPLE" }] },
    orderBy: { updatedAt: "desc" },
    include: {
      progresses: { where: { userId }, select: { sectionId: true, completionPercent: true, lastReadAt: true, status: true } },
      sectionProgresses: { where: { userId }, select: { status: true, lastStudiedAt: true } },
      sections: { orderBy: { orderIndex: "asc" }, take: 1, select: { id: true, title: true } },
    },
  });
  return NextResponse.json(books.map((book) => ({
    ...book,
    fileUrl: undefined,
    fileDownloadUrl: book.source === "UPLOAD" ? `/api/books/${book.id}/file` : undefined,
  })));
}

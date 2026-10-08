import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { regenerateBookCover } from "@/lib/book-cover-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const books = await prisma.content.findMany({ where: { userId, coverUrl: null }, orderBy: { createdAt: "asc" }, take: 50 });
  const updated: Array<{ id: string; coverUrl: string }> = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const book of books) {
    try {
      updated.push({ id: book.id, coverUrl: await regenerateBookCover(book) });
    } catch (cause) {
      failed.push({ id: book.id, error: cause instanceof Error ? cause.message : "封面生成失败" });
    }
  }
  return NextResponse.json({ updated, failed });
}

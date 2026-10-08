import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await prisma.userVocabulary.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      entry: true,
      occurrences: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { content: { select: { title: true } }, section: { select: { title: true } } },
      },
    },
  });
  return NextResponse.json(items);
}

export async function DELETE(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const item = await prisma.userVocabulary.findFirst({ where: { id, userId } });
  if (!item) return NextResponse.json({ error: "Word not found" }, { status: 404 });
  await prisma.userVocabulary.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

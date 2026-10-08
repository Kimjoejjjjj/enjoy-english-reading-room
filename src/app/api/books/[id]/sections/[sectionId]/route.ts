import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { legacyHighlightLabelSelect } from "@/lib/highlight-label-schema";

type Context = { params: Promise<{ id: string; sectionId: string }> };

export async function GET(req: NextRequest, { params }: Context) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, sectionId } = await params;
  if (!(await getAccessibleContent(id, userId))) return NextResponse.json({ error: "Book not found" }, { status: 404 });

  const section = await prisma.contentSection.findFirst({
    where: { id: sectionId, contentId: id },
    include: {
      segments: { orderBy: { orderIndex: "asc" } },
      highlights: { where: { userId }, orderBy: { createdAt: "asc" }, include: { label: { select: legacyHighlightLabelSelect } } },
    },
  });
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  return NextResponse.json(section);
}

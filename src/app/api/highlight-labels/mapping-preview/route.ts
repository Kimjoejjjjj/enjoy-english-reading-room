import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildHighlightLabelMappingPreview } from "@/lib/highlight-review-contract";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const preview = await prisma.$transaction(async (tx) => {
    const [labels, groupedHighlights] = await Promise.all([
      tx.highlightLabel.findMany({ where: { userId }, select: { id: true, name: true, color: true, archived: true } }),
      tx.highlight.groupBy({
        by: ["labelId", "color"],
        where: { userId },
        _count: { _all: true },
      }),
    ]);
    return buildHighlightLabelMappingPreview(labels, groupedHighlights.map((item) => ({
      labelId: item.labelId,
      color: item.color,
      count: item._count._all,
    })));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return NextResponse.json(preview);
}
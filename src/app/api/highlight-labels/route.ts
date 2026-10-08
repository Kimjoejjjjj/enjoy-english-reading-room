import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasHighlightReviewColumns, highlightReviewLabelSelect, legacyHighlightLabelSelect } from "@/lib/highlight-label-schema";

const LABEL_COLORS = new Set(["BRICK", "AMBER", "SAGE", "BLUE", "PLUM"]);
const PATCH_FIELDS = new Set(["id", "name", "color", "reviewEnabled"]);

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const highlightReviewSchemaReady = await hasHighlightReviewColumns();
  const labels = await prisma.highlightLabel.findMany({
    where: { userId, archived: false },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: highlightReviewSchemaReady
      ? highlightReviewLabelSelect
      : legacyHighlightLabelSelect,
  });
  return NextResponse.json(labels);
}

export async function POST() {
  return NextResponse.json({ error: "Reading labels are fixed slots and are not created by this endpoint" }, { status: 405 });
}

export async function PATCH(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string" || Object.keys(body).some((key) => !PATCH_FIELDS.has(key))) {
    return NextResponse.json({ error: "Invalid label update" }, { status: 400 });
  }

  const highlightReviewSchemaReady = await hasHighlightReviewColumns();
  const existing = await prisma.highlightLabel.findFirst({
    where: { id: body.id, userId, archived: false },
    select: highlightReviewSchemaReady
      ? highlightReviewLabelSelect
      : legacyHighlightLabelSelect,
  });
  if (!existing) return NextResponse.json({ error: "Label not found" }, { status: 404 });

  const data: { name?: string; color?: string; reviewEnabled?: boolean } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 24) {
      return NextResponse.json({ error: "Label name must be 1–24 characters" }, { status: 400 });
    }
    data.name = body.name.trim();
  }
  if (body.color !== undefined) {
    if (typeof body.color !== "string" || !LABEL_COLORS.has(body.color)) {
      return NextResponse.json({ error: "Invalid label color" }, { status: 400 });
    }
    if (await prisma.highlightLabel.findFirst({ where: { userId, archived: false, id: { not: existing.id }, color: body.color } })) {
      return NextResponse.json({ error: "Each active label must use a different color" }, { status: 409 });
    }
    data.color = body.color;
  }
  if (body.reviewEnabled !== undefined) {
    if (typeof body.reviewEnabled !== "boolean") return NextResponse.json({ error: "Invalid review setting" }, { status: 400 });
    if (!highlightReviewSchemaReady || !("slotKey" in existing) || !existing.slotKey) {
      return NextResponse.json({ error: "Label mapping must be confirmed before changing review eligibility" }, { status: 409 });
    }
    data.reviewEnabled = body.reviewEnabled;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "No label fields to update" }, { status: 400 });

  const updated = highlightReviewSchemaReady
    ? await prisma.highlightLabel.update({ where: { id: existing.id }, data })
    : await prisma.highlightLabel.update({ where: { id: existing.id }, data, select: legacyHighlightLabelSelect });
  return NextResponse.json(updated);
}

export async function DELETE() {
  return NextResponse.json({ error: "Reading labels are fixed slots and cannot be deleted" }, { status: 405 });
}

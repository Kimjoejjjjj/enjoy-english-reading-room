import type { Prisma } from "@prisma/client";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { labelColorToLegacyColor, legacyColorToLabelColor } from "@/lib/highlight-labels";
import { legacyHighlightLabelSelect } from "@/lib/highlight-label-schema";
import { isReadingLedgerEnabled, isUuid } from "@/lib/reading-ledger-contract";
import { parseReadingEventBinding, readingEventBindingHash } from "@/lib/reading-event-contract";

const HIGHLIGHT_COLORS = ["RED", "YELLOW", "GREEN"];

function normalizeColor(value: unknown) {
  return typeof value === "string" && HIGHLIGHT_COLORS.includes(value) ? value : null;
}

function normalizeLocator(value: unknown) {
  if (!value) return null;
  const locator = typeof value === "string" ? value : JSON.stringify(value);
  return locator.slice(0, 10000);
}

async function getOwnedLabel(labelId: unknown, userId: string, client: Prisma.TransactionClient = prisma) {
  if (typeof labelId !== "string" || !labelId) return null;
  return client.highlightLabel.findFirst({ where: { id: labelId, userId, archived: false } });
}

async function getLabelForLegacyColor(color: string | null, userId: string, client: Prisma.TransactionClient = prisma) {
  if (!color) return null;
  return client.highlightLabel.findFirst({ where: { userId, color: legacyColorToLabelColor(color), archived: false }, orderBy: { sortOrder: "asc" } });
}

async function validHighlightRanges(tx: Prisma.TransactionClient, contentId: string, sectionId: string | null, locator: string | null) {
  if (!locator) return true;
  try {
    const value = JSON.parse(locator) as { version?: number; ranges?: Array<{ segmentId: string; start: number; end: number }> };
    if (value.version !== 1 || !Array.isArray(value.ranges) || !value.ranges.length) return false;
    for (const range of value.ranges) {
      const segment = await tx.contentSegment.findFirst({ where: { id: range.segmentId, sectionId: sectionId || undefined, section: { contentId } }, select: { text: true } });
      if (!segment || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > segment.text.length) return false;
    }
    return true;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const contentId = req.nextUrl.searchParams.get("contentId");
  if (contentId && !(await getAccessibleContent(contentId, userId))) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const sectionId = req.nextUrl.searchParams.get("sectionId");
  const highlights = await prisma.highlight.findMany({
    where: { userId, ...(contentId ? { contentId } : {}), ...(sectionId ? { sectionId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      label: { select: legacyHighlightLabelSelect },
      content: { select: { id: true, title: true } },
      section: { select: { id: true, title: true } },
    },
  });
  return NextResponse.json(highlights);
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  return readingWrite(userId, async (tx) => {
    if (!body.contentId || !body.quote || !await validReadingSource(tx, userId, body.contentId, body.sectionId, body.segmentId)) {
      return NextResponse.json({ error: "Invalid highlight" }, { status: 400 });
    }

    const requestedColor = normalizeColor(body.color);
    const label = body.labelId ? await getOwnedLabel(body.labelId, userId, tx) : await getLabelForLegacyColor(requestedColor, userId, tx);
    if (body.labelId && !label) return NextResponse.json({ error: "Invalid highlight label" }, { status: 400 });
    const color = label ? labelColorToLegacyColor(label.color) : requestedColor || "YELLOW";
    const locator = normalizeLocator(body.locator);
    const ledgerEnabled = isReadingLedgerEnabled();
    const eventBinding = parseReadingEventBinding(body);
    const bindingHash = readingEventBindingHash({ operationType: "CREATE_HIGHLIGHT", userId, sessionId: eventBinding.sessionId, contentId: body.contentId, sectionId: body.sectionId || null, segmentId: body.segmentId || null, quote: String(body.quote).slice(0, 2000), locator });
    if (ledgerEnabled && (!body.sectionId || !isUuid(eventBinding.requestId) || typeof eventBinding.sessionId !== "string")) {
      return NextResponse.json({ error: "Reading session binding is required" }, { status: 409 });
    }
    if (ledgerEnabled) {
      const replay = await tx.learningEvent.findUnique({ where: { requestId: eventBinding.requestId! } });
      if (replay) {
        if (replay.userId !== userId || replay.operationType !== "CREATE_HIGHLIGHT" || replay.bindingHash !== bindingHash || !replay.resultEntityId) {
          return NextResponse.json({ error: "Request conflicts with its original binding" }, { status: 409 });
        }
        const replayedHighlight = await tx.highlight.findFirst({ where: { id: replay.resultEntityId, userId }, include: { label: { select: legacyHighlightLabelSelect } } });
        return replayedHighlight ? NextResponse.json(replayedHighlight) : NextResponse.json({ error: "Original highlight is unavailable" }, { status: 409 });
      }
    }
    if (ledgerEnabled && !await tx.readingSession.findFirst({ where: { id: eventBinding.sessionId!, userId, contentId: body.contentId, currentSectionId: body.sectionId, status: "OPEN" }, select: { id: true } })) return NextResponse.json({ error: "Reading session is stale" }, { status: 409 });
    if (!await validHighlightRanges(tx, body.contentId, body.sectionId, locator)) return NextResponse.json({ error: "Highlight source is stale" }, { status: 409 });
    const existing = locator ? await tx.highlight.findFirst({
      where: {
        userId,
        contentId: body.contentId,
        sectionId: body.sectionId || null,
        locator,
      },
    }) : null;

    if (existing) {
      const highlight = await tx.highlight.update({
        where: { id: existing.id },
        data: { color, labelId: label?.id || existing.labelId },
        include: { label: { select: legacyHighlightLabelSelect } },
      });
      await tx.learningEvent.create({ data: { userId, contentId: highlight.contentId, sectionId: highlight.sectionId, eventType: "HIGHLIGHT_UPDATED", payload: JSON.stringify({ color }) } });
      return NextResponse.json(highlight);
    }

      const created = await tx.highlight.create({
        data: {
          userId,
          contentId: body.contentId,
          sectionId: body.sectionId || null,
          segmentId: body.segmentId || null,
          quote: String(body.quote).slice(0, 2000),
          color,
          note: body.note ? String(body.note).slice(0, 1000) : null,
          locator,
          labelId: label?.id || null,
        },
        include: { label: { select: legacyHighlightLabelSelect } },
      });
      await tx.learningEvent.create({ data: { userId, contentId: body.contentId, sectionId: body.sectionId || null, eventType: "HIGHLIGHT_CREATED", payload: JSON.stringify({ color: created.color }), ...(ledgerEnabled ? { requestId: eventBinding.requestId, sessionId: eventBinding.sessionId, operationType: "CREATE_HIGHLIGHT", bindingHash, resultEntityId: created.id } : {}) } });
    return NextResponse.json(created, { status: 201 });
  });
}

export async function PATCH(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  return readingWrite(userId, async (tx) => {
    const color = normalizeColor(body.color);
    const hasNote = Object.prototype.hasOwnProperty.call(body, "note");
    const hasLabel = Object.prototype.hasOwnProperty.call(body, "labelId");
    if (!body.id || (!color && !hasNote && !hasLabel)) return NextResponse.json({ error: "Invalid highlight update" }, { status: 400 });

    const existing = await tx.highlight.findUnique({ where: { id: body.id } });
    if (!existing || existing.userId !== userId) return NextResponse.json({ error: "Highlight not found" }, { status: 404 });

    if (!await validReadingSource(tx, userId, existing.contentId, existing.sectionId, existing.segmentId)) return NextResponse.json({ error: "Highlight source is stale" }, { status: 409 });
    const label = hasLabel && body.labelId ? await getOwnedLabel(body.labelId, userId, tx) : !hasLabel ? await getLabelForLegacyColor(color, userId, tx) : null;
    if (hasLabel && body.labelId && !label) return NextResponse.json({ error: "Invalid highlight label" }, { status: 400 });

    const note = hasNote ? String(body.note || "").trim().slice(0, 1000) || null : undefined;
    const highlight = await tx.highlight.update({
      where: { id: existing.id },
      data: {
        ...(label ? { color: labelColorToLegacyColor(label.color) } : color ? { color } : {}),
        ...(hasNote ? { note } : {}),
        ...(hasLabel || label ? { labelId: label?.id || null } : {}),
      },
      include: { label: { select: legacyHighlightLabelSelect } },
    });
    await tx.learningEvent.create({
      data: { userId, contentId: highlight.contentId, sectionId: highlight.sectionId, eventType: "HIGHLIGHT_UPDATED", payload: JSON.stringify({ color: color || undefined, noteChanged: hasNote }) },
    });
    return NextResponse.json(highlight);
  });
}

export async function DELETE(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  return readingWrite(userId, async (tx) => {
    const existing = id ? await tx.highlight.findUnique({ where: { id } }) : null;
    if (!existing || existing.userId !== userId) return NextResponse.json({ error: "Highlight not found" }, { status: 404 });
    if (!await validReadingSource(tx, userId, existing.contentId, existing.sectionId, existing.segmentId)) return NextResponse.json({ error: "Highlight source is stale" }, { status: 409 });
    await tx.highlight.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  });
}

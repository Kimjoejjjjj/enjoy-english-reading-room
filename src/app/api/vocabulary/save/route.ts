import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { getAccessibleContent } from "@/lib/content-access";
import { classifyVocabularySelection } from "@/lib/vocabulary-selection";
import { isReadingLedgerEnabled, isUuid } from "@/lib/reading-ledger-contract";
import { parseReadingEventBinding, readingEventBindingHash } from "@/lib/reading-event-contract";

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const entrySelection = classifyVocabularySelection(String(body.word || ""));
  const occurrenceSelection = classifyVocabularySelection(String(body.selectedText || body.word || ""));
  if (!entrySelection || !occurrenceSelection || entrySelection.normalized.length > 160) return NextResponse.json({ error: "Invalid vocabulary selection" }, { status: 400 });
  const lemma = entrySelection.normalized;
  if (body.contentId && !(await getAccessibleContent(body.contentId, userId))) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  const sourceType = body.sourceType === "DICTIONARY_DEFINITION" ? "DICTIONARY_DEFINITION" : "BOOK_TEXT";
  const parentLemma = sourceType === "DICTIONARY_DEFINITION"
    ? String(body.parentLemma || "").toLowerCase().replace(/[^a-z'-]/g, "").slice(0, 80) || null
    : null;
  const ledgerEnabled = isReadingLedgerEnabled();
  const eventBinding = parseReadingEventBinding(body);
  const bindingHash = readingEventBindingHash({ operationType: "SAVE_VOCABULARY", userId, sessionId: eventBinding.sessionId, contentId: body.contentId || null, sectionId: body.sectionId || null, lemma, selectedText: occurrenceSelection.selectedText, sourceType });
  if (ledgerEnabled && (!body.contentId || !body.sectionId || !isUuid(eventBinding.requestId) || typeof eventBinding.sessionId !== "string")) {
    return NextResponse.json({ error: "Reading session binding is required" }, { status: 409 });
  }

  const result = await readingWrite(userId, async (tx) => {
    if (body.contentId) {
      if (!await validReadingSource(tx, userId, body.contentId, body.sectionId, sourceType === "BOOK_TEXT" ? body.segmentId : null)) return null;
      const content = await tx.content.findUnique({ where: { id: body.contentId }, select: { id: true, userId: true } });
      if (!content || content.userId && content.userId !== userId) return null;
      if (body.sectionId) {
        const section = await tx.contentSection.findFirst({ where: { id: body.sectionId, contentId: body.contentId }, select: { id: true } });
        if (!section) return null;
      }
      if (sourceType === "BOOK_TEXT" && body.segmentId) {
        const segment = await tx.contentSegment.findFirst({ where: { id: body.segmentId, sectionId: body.sectionId, section: { contentId: body.contentId } }, select: { id: true } });
        if (!segment) return null;
      }
      if (ledgerEnabled) {
        const replay = await tx.learningEvent.findUnique({ where: { requestId: eventBinding.requestId! } });
        if (replay) {
          if (replay.userId !== userId || replay.operationType !== "SAVE_VOCABULARY" || replay.bindingHash !== bindingHash || !replay.resultEntityId) return { kind: "conflict" as const };
          const saved = await tx.userVocabulary.findUnique({ where: { id: replay.resultEntityId }, include: { entry: true, occurrences: true } });
          return saved ? { kind: "ok" as const, value: saved, replayed: true } : { kind: "conflict" as const };
        }
        const session = await tx.readingSession.findFirst({ where: { id: eventBinding.sessionId!, userId, contentId: body.contentId, currentSectionId: body.sectionId, status: "OPEN" }, select: { id: true } });
        if (!session) return { kind: "stale" as const };
      }
    }
    const entry = await tx.vocabularyEntry.upsert({
      where: { lemma_language: { lemma, language: "en" } },
      create: { lemma, entryType: entrySelection.entryType, definition: body.definition || null, phonetic: body.phonetic || null, audioUrl: body.audioUrl || null },
      update: { entryType: entrySelection.entryType, definition: body.definition || undefined, phonetic: body.phonetic || undefined, audioUrl: body.audioUrl || undefined },
    });
    const userVocabulary = await tx.userVocabulary.upsert({
      where: { userId_entryId: { userId, entryId: entry.id } },
      create: { userId, entryId: entry.id, meaning: body.definition || null, translation: body.translation || null, nextReview: new Date() },
      update: { meaning: body.definition || undefined, translation: body.translation || undefined },
    });
    if (body.contentId) {
      await tx.vocabularyOccurrence.create({
        data: {
          userVocabularyId: userVocabulary.id,
          contentId: body.contentId,
          sectionId: body.sectionId || null,
          segmentId: sourceType === "BOOK_TEXT" ? body.segmentId || null : null,
          selectedText: occurrenceSelection.selectedText,
          context: body.context || null,
          locator: body.locator || null,
          sourceType,
          parentLemma,
        },
      });
    }
    await tx.learningEvent.create({
      data: {
        userId,
        contentId: body.contentId || null,
        sectionId: body.sectionId || null,
        userVocabularyId: userVocabulary.id,
        eventType: "VOCABULARY_SAVED",
        payload: JSON.stringify({ lemma, selectedText: occurrenceSelection.selectedText, entryType: entrySelection.entryType, sourceType, parentLemma }),
        ...(ledgerEnabled ? { requestId: eventBinding.requestId, sessionId: eventBinding.sessionId, operationType: "SAVE_VOCABULARY", bindingHash, resultEntityId: userVocabulary.id } : {}),
      },
    });
    const saved = await tx.userVocabulary.findUnique({ where: { id: userVocabulary.id }, include: { entry: true, occurrences: true } });
    return { kind: "ok" as const, value: saved, replayed: false };
  });
  if (!result || result.kind === "stale") return NextResponse.json({ error: "Vocabulary source is stale or unavailable" }, { status: 409 });
  if (result.kind === "conflict") return NextResponse.json({ error: "Request conflicts with its original binding" }, { status: 409 });
  return NextResponse.json(result.value, { status: result.replayed ? 200 : 201 });
}

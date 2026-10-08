import type { Prisma } from "@prisma/client";
import { readingWrite, validReadingSource } from "@/lib/reading-write";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccessibleContent } from "@/lib/content-access";
import { isReadingLedgerEnabled, isUuid } from "@/lib/reading-ledger-contract";
import { parseReadingEventBinding, readingEventBindingHash } from "@/lib/reading-event-contract";
import { classifyVocabularySelection } from "@/lib/vocabulary-selection";
import {
  DICTIONARY_CACHE_VERSION,
  classifyDictionaryHttpStatus,
  parseCachedMeanings,
  parseFreeDictionaryApi,
  resolveDictionaryAttempts,
  type DictionaryCachePayload,
  type DictionaryForm,
  type DictionaryInflection,
  type DictionaryInflectionRelation,
} from "@/lib/dictionary-contract";
import { normalizeChineseTranslations } from "@/lib/dictionary-chinese";
import { lookupOpenEnglishWordNet, resolveOpenEnglishWordNetForm } from "@/lib/open-english-wordnet";

export const runtime = "nodejs";

function relationFromTags(tags: string[]): DictionaryInflectionRelation | null {
  const value = tags.join(" ").toLowerCase();
  if (value.includes("plural")) return "plural";
  if (value.includes("third-person") || value.includes("third person")) return "thirdPersonSingular";
  if (value.includes("present participle") || value.includes("gerund")) return "presentParticiple";
  if (value.includes("past participle")) return "pastParticiple";
  if (value.includes("past")) return "past";
  if (value.includes("comparative")) return "comparative";
  if (value.includes("superlative")) return "superlative";
  return null;
}

function refineInflection(inflection: DictionaryInflection | null, forms: DictionaryForm[]) {
  if (!inflection?.baseLemma) return inflection;
  const matchingForm = forms.find((form) => form.word === inflection.selectedLemma);
  const relation = matchingForm ? relationFromTags(matchingForm.tags) : null;
  return relation ? { ...inflection, relation } : inflection;
}

async function lookup(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const selected = classifyVocabularySelection(String(body.word || ""));
  if (!selected || selected.normalized.length > 160) return NextResponse.json({ error: "Invalid vocabulary selection" }, { status: 400 });
  const requestedLemma = selected.normalized;
  const requestedLocal = selected.entryType === "WORD" ? await lookupOpenEnglishWordNet(requestedLemma).catch(() => null) : null;
  const formCandidates = selected.entryType === "WORD" ? await resolveOpenEnglishWordNetForm(requestedLemma).catch(() => []) : [];
  const requestedBaseLemma = typeof body.baseLemma === "string" ? body.baseLemma.toLowerCase().replace(/[^a-z'-]/g, "").slice(0, 80) : "";
  const chosenCandidate = requestedBaseLemma
    ? formCandidates.find((candidate) => candidate.lemma === requestedBaseLemma)
    : formCandidates.length === 1 ? formCandidates[0] : null;
  if (requestedBaseLemma && !chosenCandidate) return NextResponse.json({ error: "Invalid inflection candidate" }, { status: 400 });
  const lookupLemma = chosenCandidate?.lemma || requestedLemma;
  const inflection: DictionaryInflection | null = formCandidates.length ? {
    selectedLemma: requestedLemma,
    baseLemma: chosenCandidate?.lemma || null,
    relation: chosenCandidate?.relation || null,
    ambiguous: !chosenCandidate && formCandidates.length > 1,
    candidates: formCandidates,
  } : null;
  const formMeanings = lookupLemma !== requestedLemma ? requestedLocal?.meanings || [] : [];

  const contentId = typeof body.contentId === "string" ? body.contentId : null;
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : null;
  if (contentId && !(await getAccessibleContent(contentId, userId))) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const ledgerEnabled = isReadingLedgerEnabled();
  const eventBinding = parseReadingEventBinding(body);
  const bindingHash = readingEventBindingHash({ operationType: "LOOKUP", userId, sessionId: eventBinding.sessionId, contentId, sectionId, requestedLemma, lemma: lookupLemma });
  if (ledgerEnabled) {
    if (!contentId || !sectionId || !isUuid(eventBinding.requestId) || typeof eventBinding.sessionId !== "string") {
      return NextResponse.json({ error: "Reading session binding is required" }, { status: 409 });
    }
    const session = await prisma.readingSession.findFirst({ where: { id: eventBinding.sessionId, userId, contentId, currentSectionId: sectionId, status: "OPEN" }, select: { id: true } });
    if (!session) return NextResponse.json({ error: "Reading session is stale or unavailable" }, { status: 409 });
    const replay = await prisma.learningEvent.findUnique({ where: { requestId: eventBinding.requestId } });
    if (replay && (replay.userId !== userId || replay.operationType !== "LOOKUP" || replay.bindingHash !== bindingHash)) {
      return NextResponse.json({ error: "Request conflicts with its original binding" }, { status: 409 });
    }
  }
  const logLookup = async (tx: Prisma.TransactionClient, succeeded: boolean) => {
    if (contentId && !await validReadingSource(tx, userId, contentId, sectionId)) throw new Error("READING_SOURCE_STALE");
    if (ledgerEnabled && !await tx.readingSession.findFirst({ where: { id: eventBinding.sessionId!, userId, contentId: contentId!, currentSectionId: sectionId!, status: "OPEN" }, select: { id: true } })) throw new Error("READING_SOURCE_STALE");
    if (!ledgerEnabled) {
      await tx.learningEvent.create({ data: { userId, contentId, sectionId, eventType: "WORD_LOOKUP", payload: JSON.stringify({ requestedLemma, lemma: lookupLemma }) } });
      return;
    }
    if (!succeeded) return;
    const replay = await tx.learningEvent.findUnique({ where: { requestId: eventBinding.requestId! } });
    if (replay) return;
    await tx.learningEvent.create({ data: { userId, contentId, sectionId, eventType: "LOOKUP_SUCCEEDED", payload: JSON.stringify({ requestedLemma, lemma: lookupLemma }), requestId: eventBinding.requestId, sessionId: eventBinding.sessionId, operationType: "LOOKUP", bindingHash } });
  };

  const cached = await prisma.vocabularyEntry.findUnique({ where: { lemma_language: { lemma: lookupLemma, language: "en" } } });
  const cachedPayload = parseCachedMeanings(cached?.meaningsJson || null);
  if (cached?.definition && cachedPayload) {
    await readingWrite(userId, (tx) => logLookup(tx, true));
    return NextResponse.json({
      ...cached,
      requestedLemma,
      lemma: lookupLemma,
      meanings: cachedPayload.meanings,
      formMeanings,
      translations: cachedPayload.translations,
      forms: cachedPayload.forms,
      inflection: refineInflection(inflection, cachedPayload.forms),
      source: {
        provider: cached.dictionaryProvider || "Free dictionary",
        url: cached.dictionarySourceUrl,
        licenseName: cached.dictionaryLicenseName,
        licenseUrl: cached.dictionaryLicenseUrl,
      },
      sources: cachedPayload.sources,
      cached: true,
    });
  }

  const localAttempt = await (lookupLemma === requestedLemma ? Promise.resolve(requestedLocal) : lookupOpenEnglishWordNet(lookupLemma))
    .then((result) => ({ responded: Boolean(result), result }))
    .catch((error) => {
      console.error("Open English WordNet lookup failed:", error);
      return { responded: false, result: null };
    });
  const wiktionaryUrl = `https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(lookupLemma)}?translations=true`;
  const wiktionaryAttempt = await (async () => {
    try {
      const response = await fetch(wiktionaryUrl, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return classifyDictionaryHttpStatus(response.status);
      const result = parseFreeDictionaryApi(await response.json(), lookupLemma);
      if (result) result.translations = normalizeChineseTranslations(result.translations);
      return { responded: true, result };
    } catch (error) {
      console.warn("Dictionary provider failed:", wiktionaryUrl, error);
      return { responded: false, result: null };
    }
  })();
  const result = resolveDictionaryAttempts(lookupLemma, [localAttempt, wiktionaryAttempt]);
  const decoratedResult = {
    ...result,
    requestedLemma,
    lemma: lookupLemma,
    formMeanings,
    inflection: refineInflection(inflection, result.forms || []),
  };
  result.translationUnavailable = Boolean(localAttempt.result && !wiktionaryAttempt.result && !wiktionaryAttempt.responded);
  if (result.source && result.meanings.length) {
    if (result.translationUnavailable) {
      await readingWrite(userId, (tx) => logLookup(tx, true));
      return NextResponse.json({ ...decoratedResult, translationUnavailable: true, cached: false });
    }
    const source = result.source;
    const meaningsJson = JSON.stringify({ version: DICTIONARY_CACHE_VERSION, meanings: result.meanings, translations: result.translations, sources: result.sources, forms: result.forms || [] } satisfies DictionaryCachePayload);
    const entry = await readingWrite(userId, async (tx) => {
      await logLookup(tx, true);
      return tx.vocabularyEntry.upsert({
        where: { lemma_language: { lemma: result.lemma, language: "en" } },
        create: {
          lemma: result.lemma,
          entryType: selected.entryType,
          phonetic: result.phonetic,
          audioUrl: result.audioUrl,
          definition: result.definition,
          meaningsJson,
          dictionaryProvider: source.provider,
          dictionarySourceUrl: source.url,
          dictionaryLicenseName: source.licenseName,
          dictionaryLicenseUrl: source.licenseUrl,
        },
        update: {
          entryType: selected.entryType,
          phonetic: result.phonetic,
          audioUrl: result.audioUrl,
          definition: result.definition,
          meaningsJson,
          dictionaryProvider: source.provider,
          dictionarySourceUrl: source.url,
          dictionaryLicenseName: source.licenseName,
          dictionaryLicenseUrl: source.licenseUrl,
        },
      });
    });
    return NextResponse.json({ ...entry, ...decoratedResult, cached: false });
  }
  await readingWrite(userId, (tx) => logLookup(tx, false));
  return NextResponse.json({ ...decoratedResult, cached: false });
}

export async function POST(req: NextRequest) {
  try { return await lookup(req); }
  catch (error) {
    if (error instanceof Error && error.message === "READING_SOURCE_STALE") return NextResponse.json({ error: "Reading source is stale" }, { status: 409 });
    throw error;
  }
}

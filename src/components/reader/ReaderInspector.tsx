"use client";

import { getReadingBinding } from "@/lib/reading-client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, BookMarked, ChevronDown, ChevronRight, Highlighter, Loader2, Plus, RotateCcw, Trash2, Volume2, X } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { getPrimaryChineseWords, normalizeAudioUrl, type DictionaryInflection, type DictionaryInflectionCandidate, type DictionaryInflectionRelation, type DictionaryLookupResult, type DictionaryMeaning, type DictionarySource, type DictionaryTranslation } from "@/lib/dictionary-contract";
import { DICTIONARY_CARD_OVERFLOW_MODE_EVENT, focusExpandedDictionaryCard, MAX_DICTIONARY_CARDS, readDictionaryCardOverflowMode, removeExpandedDictionaryCard, toggleExpandedDictionaryCard, writeDictionaryCardOverflowMode, type DictionaryCardOverflowMode } from "@/lib/dictionary-card-preference";
import { DICTIONARY_DISPLAY_MODE_EVENT, readDictionaryDisplayMode, type DictionaryDisplayMode } from "@/lib/dictionary-display-preference";
import { labelButtonClasses, labelColorToLegacyColor, legacyColorToLabelColor, normalizeLabelColor } from "@/lib/highlight-labels";
import { formatGrammarExplanation, type GrammarExplanation } from "@/lib/ai-grammar-contract";
import { getHighlightNavigationTarget, getVocabularyNavigationTarget, ReaderNavigationTarget, shouldApplySectionNotesRequest } from "@/lib/reader-navigation";
import { classifyVocabularySelection, normalizeNestedDictionaryWord, type VocabularyEntryType } from "@/lib/vocabulary-selection";
import type { DictionaryAiTranslation } from "@/lib/dictionary-ai";

export interface SelectionRange {
  segmentId: string;
  start: number;
  end: number;
}

export interface ReaderSelection {
  word: string | null;
  quote: string;
  context: string;
  segmentId?: string;
  ranges?: SelectionRange[];
  highlightId?: string;
  highlightColor?: string;
  highlightNote?: string;
  highlightLabelId?: string | null;
}

interface Props {
  selection: ReaderSelection | null;
  contentId: string;
  sectionId: string;
  sectionText: string;
  onHighlightSaved: () => void | Promise<void>;
  onHighlightDeleted?: () => void;
  onClearSelection?: () => void;
  onNavigateToRecord?: (target: ReaderNavigationTarget) => void;
  navigationMessage?: string | null;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

type DictionaryResult = Pick<DictionaryLookupResult, "requestedLemma" | "lemma" | "definition" | "phonetic" | "audioUrl" | "meanings" | "formMeanings" | "translations" | "inflection" | "source" | "sources" | "translationUnavailable" | "unavailable" | "notFound"> & { error?: string };
interface ContextMeaning { selectedSenseIds: string[]; meaning: string; rationale: string; uncertain: boolean }
interface AiExplanation {
  summary: string;
  nuance: string | null;
  paraphrase: string | null;
}
type LookupSource = "BOOK_TEXT" | "DICTIONARY_DEFINITION";

interface LookupRequest {
  requestId: string;
  word: string;
  selectedText: string;
  entryType: VocabularyEntryType;
  context: string;
  sourceType: LookupSource;
  parentLemma?: string;
  baseLemma?: string;
  segmentId?: string;
}

interface LookupCard extends LookupRequest {
  id: string;
  loading: boolean;
  definition?: string | null;
  lemma?: string;
  phonetic?: string | null;
  audioUrl?: string | null;
  meanings?: DictionaryMeaning[];
  formMeanings?: DictionaryMeaning[];
  translations?: DictionaryTranslation[];
  aiTranslations?: DictionaryAiTranslation[];
  aiTranslationLoading?: boolean;
  aiTranslationError?: string | null;
  source?: DictionarySource | null;
  sources?: DictionarySource[];
  translationUnavailable?: boolean;
  inflection?: DictionaryInflection | null;
  unavailable?: boolean;
  notFound?: boolean;
  error?: string | null;
  contextAi?: {
    loading: boolean;
    meaning?: ContextMeaning | null;
    output?: string | null;
    status?: string | null;
    retryable?: boolean;
  };
}

interface SectionNoteHighlight {
  id: string;
  quote: string;
  color: string;
  note?: string | null;
  segmentId?: string | null;
  label?: ReadingLabel | null;
  section?: SectionNotePage | null;
}

interface SectionNotePage {
  id: string;
  orderIndex: number;
  title: string;
  chapterTitle?: string | null;
}

interface SectionNoteVocabulary {
  id: string;
  selectedText: string;
  context?: string | null;
  segmentId?: string | null;
  sourceType: string;
  parentLemma?: string | null;
  userVocabulary: { id: string; entry: { lemma: string; definition?: string | null } };
  section?: SectionNotePage | null;
}

interface SectionNotesData {
  scope?: "section" | "chapter";
  chapterKey?: string;
  currentSection?: SectionNotePage;
  sections?: SectionNotePage[];
  highlights: SectionNoteHighlight[];
  vocabulary: SectionNoteVocabulary[];
}

const inflectionRelationText = (relation: DictionaryInflectionRelation | null, label: (zh: string, en: string) => string) => ({
  plural: label("复数", "plural"),
  thirdPersonSingular: label("第三人称单数", "third-person singular"),
  past: label("过去式", "past tense"),
  pastParticiple: label("过去分词", "past participle"),
  presentParticiple: label("现在分词", "present participle"),
  comparative: label("比较级", "comparative"),
  superlative: label("最高级", "superlative"),
  inflected: label("词形变化", "inflected form"),
})[relation || "inflected"];
const dictionaryText = (card: Pick<LookupCard, "definition" | "meanings">) => {
  if (card.meanings?.length) return card.meanings.flatMap((meaning) => meaning.definitions.map((definition) => `${meaning.partOfSpeech || ""} ${definition.definition}`.trim())).join("\n");
  return card.definition || "";
};

const dictionaryCandidates = (card: Pick<LookupCard, "definition" | "meanings">) => {
  const structured = card.meanings?.flatMap((meaning) => meaning.definitions.map((definition) => ({
    id: definition.id,
    partOfSpeech: meaning.partOfSpeech,
    definition: definition.definition,
    example: definition.example,
  }))) || [];
  if (structured.length) return structured;
  return card.definition ? [{ id: "fallback-d1", partOfSpeech: null, definition: card.definition, example: null }] : [];
};

const sliceDictionaryMeanings = (meanings: DictionaryMeaning[] | undefined, offset: number, limit: number) => {
  const sliced: DictionaryMeaning[] = [];
  let skipped = 0;
  let taken = 0;
  for (const meaning of meanings || []) {
    const definitions = [];
    for (const definition of meaning.definitions) {
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      if (taken >= limit) break;
      definitions.push(definition);
      taken += 1;
    }
    if (definitions.length) sliced.push({ ...meaning, definitions });
    if (taken >= limit) break;
  }
  return sliced;
};

const dictionaryAiDefinitionRows = (meanings: DictionaryMeaning[] | undefined) => (meanings || []).flatMap((meaning) => meaning.definitions.map((definition) => ({ id: definition.id, partOfSpeech: meaning.partOfSpeech, definition: definition.definition }))).slice(0, 4);

const cleanAiText = (value: string) => {
  const plainText = value
    .replace(/\`\`\`(?:json|markdown)?/gi, "")
    .replace(/\`\`\`/g, "")
    .replace(/\*\*/g, "")
    .replace(/__([^_]+)__/g, "$1")
    .trim();
  try {
    const parsed = JSON.parse(plainText) as Record<string, unknown>;
    const fields = [parsed.summary, parsed.nuance, parsed.paraphrase].filter((field): field is string => typeof field === "string" && Boolean(field.trim()));
    return fields.length ? fields.join("\n\n") : plainText;
  } catch {
    return plainText;
  }
};

const formatExplanation = (explanation: AiExplanation, label: (zh: string, en: string) => string) =>
  [explanation.summary, explanation.nuance, explanation.paraphrase ? `${label("换句话说", "In other words")}: ${explanation.paraphrase}` : null].filter(Boolean).join("\n\n");

interface ReadingLabel { id: string; name: string; color: string; archived: boolean; slotKey?: string | null; reviewEnabled?: boolean | null }

const fallbackLabelsLegacy = [
  { id: "legacy-red", name: "红色标记", color: "BRICK", archived: false },
  { id: "legacy-yellow", name: "黄色标记", color: "AMBER", archived: false },
  { id: "legacy-green", name: "绿色标记", color: "SAGE", archived: false },
];

const fallbackLabels: ReadingLabel[] = fallbackLabelsLegacy.map((item, index) => ({
  ...item,
  id: ["legacy-gold", "legacy-blue", "legacy-important"][index],
  name: ["\u91d1\u53e5", "\u4e0d\u61c2", "\u91cd\u8981"][index],
  color: ["AMBER", "BLUE", "SAGE"][index],
}));
const labelColorNames: Record<string, [string, string]> = {
  BRICK: ["\u73ca\u745a\u7ea2", "Coral"],
  AMBER: ["\u7425\u73c0\u9ec4", "Amber"],
  SAGE: ["\u58a8\u7eff", "Ink green"],
  BLUE: ["\u84dd\u8272", "Blue"],
  PLUM: ["\u7d2b\u8272", "Plum"],
};

function currentReadingSessionId(contentId: string): string | null {
  return getReadingBinding(contentId)?.sessionId || null;
}

async function lookupDictionary(request: Pick<LookupRequest, "requestId" | "word" | "baseLemma">, contentId: string, sectionId: string, locale: "zh-CN" | "en"): Promise<DictionaryResult> {
  const response = await fetch("/api/vocabulary/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word: request.word, baseLemma: request.baseLemma, contentId, sectionId, requestId: request.requestId, sessionId: currentReadingSessionId(contentId) }),
  });
  const data = await response.json().catch(() => null) as DictionaryResult | null;
  if (!response.ok || !data) throw new Error(locale === "zh-CN" ? "查词暂时失败，请重试" : "Dictionary lookup failed. Please try again.");
  return data;
}

export default function ReaderInspector({ selection, contentId, sectionId, sectionText, onHighlightSaved, onHighlightDeleted, onClearSelection, onNavigateToRecord, navigationMessage, mobileOpen = false, onMobileClose }: Props) {
  const { locale, t } = useLocale();
  const label = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [cards, setCards] = useState<LookupCard[]>([]);
  const [pendingLookup, setPendingLookup] = useState<LookupRequest | null>(null);
  const [activeCardIds, setActiveCardIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dictionaryDisplayMode, setDictionaryDisplayMode] = useState<DictionaryDisplayMode>("bilingual");
  const [dictionaryCardOverflowMode, setDictionaryCardOverflowMode] = useState<DictionaryCardOverflowMode>("ask");
  const [dictionaryTranslationMode, setDictionaryTranslationMode] = useState<"manual" | "auto">("manual");
  const [byokConfigured, setByokConfigured] = useState(false);
  const [navigationWarning, setNavigationWarning] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [deletedHighlight, setDeletedHighlight] = useState<ReaderSelection | null>(null);
  const [aiOutput, setAiOutput] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiRetryType, setAiRetryType] = useState<"EXPLAIN" | "GRAMMAR" | null>(null);
  const [aiRemaining, setAiRemaining] = useState<number | null>(null);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [labels, setLabels] = useState<ReadingLabel[]>([]);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelName, setEditingLabelName] = useState("");
  const [editingLabelColor, setEditingLabelColor] = useState("AMBER");
  const [editingLabelReviewEnabled, setEditingLabelReviewEnabled] = useState(false);
  const [labelSaving, setLabelSaving] = useState(false);



  const [sectionNotes, setSectionNotes] = useState<SectionNotesData>({ highlights: [], vocabulary: [] });
  const [notesLoading, setNotesLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"notes" | "lookup">("notes");
  const handledSelectionRef = useRef<ReaderSelection | null>(null);
  const selectionAiRequestIdRef = useRef(0);
  const aiRequestInFlightRef = useRef(false);
  const undoTimer = useRef<number | null>(null);
  const notesRequestIdRef = useRef(0);
  const notesRequestKeyRef = useRef<string | null>(null);
  const notesMountedRef = useRef(true);
  const vocabularyRequestIdsRef = useRef(new Map<string, string>());
  const highlightRequestIdsRef = useRef(new Map<string, string>());
  const activeLabels = labels.filter((item) => !item.archived);
  const displayLabels = activeLabels.length ? activeLabels : fallbackLabels;
  const navigateToRecord = (target: ReaderNavigationTarget | null) => {
    setActiveTab("lookup");
    if (!target) {
      setNavigationWarning(label("原文位置不可用", "Original location unavailable"));
      return;
    }
    setNavigationWarning(null);
    onClearSelection?.();
    onNavigateToRecord?.(target);
  };

  const sectionHighlightGroups = Array.from(sectionNotes.highlights.reduce((groups, item) => {
    const color = normalizeLabelColor(item.label?.color || legacyColorToLabelColor(item.color));
    const key = item.label?.id || `legacy-${item.color}`;
    const name = item.label?.name || (item.color === "RED"
      ? label("红色标记", "Red mark")
      : item.color === "GREEN"
        ? label("绿色标记", "Green mark")
        : label("黄色标记", "Yellow mark"));
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, name, color, items: [item] });
    return groups;
  }, new Map<string, { key: string; name: string; color: ReturnType<typeof normalizeLabelColor>; items: SectionNoteHighlight[] }>()).values());

  const beginLabelEdit = (item: ReadingLabel) => {
    setEditingLabelId(item.id);
    setEditingLabelName(item.name);
    setEditingLabelColor(normalizeLabelColor(item.color));
    setEditingLabelReviewEnabled(item.reviewEnabled === true);
  };

  const saveLabel = async () => {
    if (!editingLabelId || !editingLabelName.trim()) return;
    setLabelSaving(true);
    const currentLabel = labels.find((item) => item.id === editingLabelId);
    const response = await fetch("/api/highlight-labels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingLabelId, name: editingLabelName.trim(), color: editingLabelColor, ...(currentLabel?.slotKey ? { reviewEnabled: editingLabelReviewEnabled } : {}) }) });
    if (response.ok) {
      const updated = await response.json() as ReadingLabel;
      setLabels((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingLabelId(null);
      await loadSectionNotes();
    } else {
      setMessage(label("颜色已被其他标记使用，请选择另一种颜色", "That color is already used by another label."));
    }
    setLabelSaving(false);
  };

  const loadSectionNotes = useCallback(async () => {
    const requestId = ++notesRequestIdRef.current;
    const requestKey = `${contentId}:${sectionId}`;
    notesRequestKeyRef.current = requestKey;
    setNotesLoading(true);
    try {
      const response = await fetch(`/api/books/${contentId}/sections/${sectionId}/notes?scope=chapter`);
      if (!response.ok) throw new Error("Section notes request failed");
      const data = await response.json() as SectionNotesData;
      if (shouldApplySectionNotesRequest(requestId, notesRequestIdRef.current, requestKey, notesRequestKeyRef.current, notesMountedRef.current)) {
        setSectionNotes(data);
      }
    } catch {
      if (shouldApplySectionNotesRequest(requestId, notesRequestIdRef.current, requestKey, notesRequestKeyRef.current, notesMountedRef.current)) {
        setSectionNotes({ highlights: [], vocabulary: [] });
      }
    } finally {
      if (shouldApplySectionNotesRequest(requestId, notesRequestIdRef.current, requestKey, notesRequestKeyRef.current, notesMountedRef.current)) {
        setNotesLoading(false);
      }
    }
  }, [contentId, sectionId]);

  const loadDictionaryAiTranslation = useCallback(async (cardId: string, lemma: string, meanings: DictionaryMeaning[], generate: boolean) => {
    const localized = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
    const definitions = dictionaryAiDefinitionRows(meanings);
    if (!definitions.length) return;
    const request = async (cacheOnly: boolean) => fetch("/api/vocabulary/ai-translation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), lemma, definitions, cacheOnly }),
    });
    try {
      const cachedResponse = await request(true);
      if (cachedResponse.ok) {
        const cached = await cachedResponse.json() as { translations?: DictionaryAiTranslation[] };
        setCards((current) => current.map((item) => item.id === cardId ? { ...item, aiTranslations: cached.translations || [], aiTranslationError: null } : item));
        return;
      }
      if (!generate) return;
      setCards((current) => current.map((item) => item.id === cardId ? { ...item, aiTranslationLoading: true, aiTranslationError: null } : item));
      const response = await request(false);
      const data = await response.json().catch(() => null) as { translations?: DictionaryAiTranslation[]; error?: string; code?: string } | null;
      if (!response.ok || !data) throw new Error(data?.code === "BYOK_REQUIRED" ? localized("请先在设置中配置自己的 DeepSeek Key。", "Configure your own DeepSeek key in Settings first.") : data?.error || localized("暂时无法生成中文翻译。", "Chinese translation is temporarily unavailable."));
      setCards((current) => current.map((item) => item.id === cardId ? { ...item, aiTranslations: data.translations || [], aiTranslationLoading: false, aiTranslationError: null } : item));
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : localized("暂时无法生成中文翻译。", "Chinese translation is temporarily unavailable.");
      setCards((current) => current.map((item) => item.id === cardId ? { ...item, aiTranslationLoading: false, aiTranslationError: error } : item));
    }
  }, [locale]);

  const loadCard = useCallback(async (card: LookupCard) => {
    try {
      const result = await lookupDictionary(card, contentId, sectionId, locale);
      setCards((current) => current.map((item) => item.id === card.id ? {
        ...item,
        loading: false,
        lemma: result.lemma || item.word,
        definition: result.definition || null,
        phonetic: result.phonetic || null,
        audioUrl: result.audioUrl || null,
        meanings: result.meanings || [],
        formMeanings: result.formMeanings || [],
        translations: result.translations || [],
        source: result.source || null,
        sources: result.sources || [],
        translationUnavailable: result.translationUnavailable,
        inflection: result.inflection || null,
        unavailable: result.unavailable,
        notFound: result.notFound,
        error: result.error || null,
      } : item));
      if (result.definition && result.meanings?.length) void loadDictionaryAiTranslation(card.id, result.lemma || card.word, result.meanings, dictionaryTranslationMode === "auto" && getPrimaryChineseWords(result.translations || []).length === 0);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : (locale === "zh-CN" ? "查词失败" : "Dictionary lookup failed");
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, loading: false, error } : item));
    }
  }, [contentId, dictionaryTranslationMode, loadDictionaryAiTranslation, locale, sectionId]);

  const addLookupCard = useCallback((request: LookupRequest, removedCardId?: string) => {
    const card: LookupCard = { ...request, id: crypto.randomUUID(), loading: true };
    setCards((current) => [...current.filter((item) => item.id !== removedCardId), card].slice(-MAX_DICTIONARY_CARDS));
    setActiveCardIds((current) => focusExpandedDictionaryCard(
      removedCardId ? removeExpandedDictionaryCard(current, removedCardId) : current,
      card.id,
    ));
    void loadCard(card);
    requestAnimationFrame(() => document.getElementById(`dictionary-card-${card.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [loadCard]);

  const retryCard = (card: LookupCard) => {
    const retrying = { ...card, loading: true, definition: null, phonetic: null, audioUrl: null, meanings: [], formMeanings: [], translations: [], aiTranslations: [], aiTranslationLoading: false, aiTranslationError: null, source: null, sources: [], translationUnavailable: undefined, inflection: null, error: null, unavailable: undefined, notFound: undefined, contextAi: undefined };
    setCards((current) => current.map((item) => item.id === card.id ? retrying : item));
    void loadCard(retrying);
  };

  const chooseInflectionCandidate = (card: LookupCard, candidate: DictionaryInflectionCandidate) => {
    const resolving: LookupCard = {
      ...card,
      requestId: crypto.randomUUID(),
      baseLemma: candidate.lemma,
      loading: true,
      lemma: undefined,
      definition: null,
      phonetic: null,
      audioUrl: null,
      meanings: [],
      formMeanings: [],
      translations: [],
      aiTranslations: [],
      aiTranslationLoading: false,
      aiTranslationError: null,
      source: null,
      sources: [],
      translationUnavailable: undefined,
      inflection: null,
      error: null,
      unavailable: undefined,
      notFound: undefined,
      contextAi: undefined,
    };
    vocabularyRequestIdsRef.current.delete(card.id);
    setCards((current) => current.map((item) => item.id === card.id ? resolving : item));
    void loadCard(resolving);
  };

  const focusCard = useCallback((id: string) => {
    setActiveCardIds((current) => focusExpandedDictionaryCard(current, id));
    requestAnimationFrame(() => document.getElementById(`dictionary-card-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, []);

  const requestLookup = useCallback((request: LookupRequest) => {
    const existing = cards.find((item) => item.word === request.word);
    if (existing) return focusCard(existing.id);
    if (cards.length >= MAX_DICTIONARY_CARDS) {
      if (dictionaryCardOverflowMode === "replace-oldest") return addLookupCard(request, cards[0]?.id);
      return setPendingLookup(request);
    }
    addLookupCard(request);
  }, [addLookupCard, cards, dictionaryCardOverflowMode, focusCard]);

  useEffect(() => {
    if (!selection || handledSelectionRef.current === selection) return;
    handledSelectionRef.current = selection;
    setPendingLookup(null);
    setActiveTab("lookup");
    selectionAiRequestIdRef.current += 1;
    setAiLoading(false);
    setAiOutput(null);
    setAiStatus(null);
    setMessage(null);
    setAiRetryType(null);
    setNote(selection.highlightNote || "");
    if (!selection.word) return;
    const selected = classifyVocabularySelection(selection.quote || selection.word);
    if (selected) requestLookup({ requestId: crypto.randomUUID(), word: selected.normalized, selectedText: selected.selectedText, entryType: selected.entryType, context: selection.context, sourceType: "BOOK_TEXT", segmentId: selection.segmentId });
  }, [requestLookup, selection]);

  useEffect(() => {
    setCards([]);
    setPendingLookup(null);
    setActiveCardIds([]);
    handledSelectionRef.current = null;
    selectionAiRequestIdRef.current += 1;
    setAiLoading(false);
    setAiOutput(null);
    setAiStatus(null);
    setAiRetryType(null);
  }, [contentId]);

  useEffect(() => {
    const validIds = new Set(cards.map((card) => card.id));
    setActiveCardIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [cards]);

  useEffect(() => { void loadSectionNotes(); }, [loadSectionNotes]);

  useEffect(() => {
    notesMountedRef.current = true;
    return () => {
      notesMountedRef.current = false;
      notesRequestIdRef.current += 1;
      notesRequestKeyRef.current = null;
    };
  }, []);

  useEffect(() => {
    void fetch("/api/user/ai-preferences").then((response) => response.ok ? response.json() : null).then((data) => setDictionaryTranslationMode(data?.dictionaryTranslationMode === "auto" ? "auto" : "manual")).catch(() => undefined);
    void fetch("/api/user/ai-credential").then((response) => response.ok ? response.json() : null).then((data) => setByokConfigured(data?.configured === true && data?.encryptionConfigured === true)).catch(() => setByokConfigured(false));
  }, []);

  useEffect(() => { fetch("/api/highlight-labels").then((response) => response.ok ? response.json() : []).then((data: ReadingLabel[]) => setLabels(data)).catch(() => undefined); }, []);

  useEffect(() => {
    const sync = () => setDictionaryDisplayMode(readDictionaryDisplayMode());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(DICTIONARY_DISPLAY_MODE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(DICTIONARY_DISPLAY_MODE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    const sync = () => setDictionaryCardOverflowMode(readDictionaryCardOverflowMode());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(DICTIONARY_CARD_OVERFLOW_MODE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(DICTIONARY_CARD_OVERFLOW_MODE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen]);

  useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);

  useEffect(() => {
    fetch("/api/ai/explain")
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (response.ok && typeof data?.remaining === "number") setAiRemaining(data.remaining);
        else if (typeof data?.failureCode === "string" && data.failureCode.startsWith("QUOTA_")) {
          setAiStatus(locale === "zh-CN" ? "AI 暂不可用" : "AI is temporarily unavailable");
        }
      })
      .catch(() => setAiStatus(locale === "zh-CN" ? "AI 暂不可用" : "AI is temporarily unavailable"));
  }, [contentId, locale]);

  const requestNestedLookup = (card: LookupCard) => {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed) return;
    const selectedText = selected.toString().trim().slice(0, 120);
    const word = normalizeNestedDictionaryWord(selectedText);
    selected.removeAllRanges();
    if (word) requestLookup({ requestId: crypto.randomUUID(), word, selectedText, entryType: "WORD", context: dictionaryText(card) || card.context, sourceType: "DICTIONARY_DEFINITION", parentLemma: card.lemma || card.word });
  };

  const audioCache = useRef(new Map<string, HTMLAudioElement>());
  const playPronunciation = async (card: LookupCard) => {
    const audioUrl = normalizeAudioUrl(card.audioUrl);
    if (audioUrl) {
      const cached = audioCache.current.get(audioUrl) || new Audio(audioUrl);
      audioCache.current.set(audioUrl, cached);
      cached.preload = "auto";
      if (cached.readyState >= 3) {
        try { window.speechSynthesis.cancel(); cached.currentTime = 0; await cached.play(); return; } catch { /* use speech fallback */ }
      }
      try {
        await Promise.race([new Promise<void>((resolve, reject) => { cached.addEventListener("canplaythrough", () => resolve(), { once: true }); cached.addEventListener("error", () => reject(new Error("audio")), { once: true }); }), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 250))]);
        window.speechSynthesis.cancel(); cached.currentTime = 0; await cached.play();
        return;
      } catch {
        // Remote recordings are optional; fall back to the browser voice below.
      }
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(card.word);
      utterance.lang = "en-US";
      utterance.rate = 0.82;
      window.speechSynthesis.speak(utterance);
      return;
    }

    setMessage(label("当前浏览器无法播放发音", "Pronunciation is unavailable in this browser."));
  };

  const saveWord = async (card: LookupCard) => {
    const requestId = vocabularyRequestIdsRef.current.get(card.id) || crypto.randomUUID();
    vocabularyRequestIdsRef.current.set(card.id, requestId);
    const response = await fetch("/api/vocabulary/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: card.lemma || card.word,
        selectedText: card.selectedText,
        entryType: card.entryType,
        context: card.context,
        contentId,
        sectionId,
        segmentId: card.sourceType === "BOOK_TEXT" ? card.segmentId : null,
        definition: card.definition || null,
        phonetic: card.phonetic || null,
        audioUrl: card.audioUrl || null,
        translation: getPrimaryChineseWords(card.translations || []).join("、") || card.aiTranslations?.map((item) => item.translation).join("；") || null,
        sourceType: card.sourceType,
        parentLemma: card.parentLemma || null,
        requestId,
        sessionId: currentReadingSessionId(contentId),
      }),
    });
    const savedLemma = card.lemma || card.word;
    setMessage(response.ok ? label(`“${savedLemma}”已加入生词复习`, `“${savedLemma}” was added to review`) : label("保存失败", "Could not save"));
    if (response.ok) {
      vocabularyRequestIdsRef.current.delete(card.id);
      await loadSectionNotes();
    }
  };

  const saveHighlight = async (labelItem: ReadingLabel) => {
    if (!selection) return;
    setSavingHighlight(true);
    const updating = Boolean(selection.highlightId);
    const highlightRequestKey = `${contentId}:${sectionId}:${selection.segmentId || ""}:${selection.quote}:${JSON.stringify(selection.ranges || [])}`;
    const requestId = highlightRequestIdsRef.current.get(highlightRequestKey) || crypto.randomUUID();
    if (!updating) highlightRequestIdsRef.current.set(highlightRequestKey, requestId);
    const response = await fetch("/api/highlights", {
      method: updating ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updating ? { id: selection.highlightId, color: labelColorToLegacyColor(labelItem.color), labelId: labelItem.id.startsWith("legacy-") ? null : labelItem.id, note } : {
        contentId,
        sectionId,
        segmentId: selection.segmentId,
        quote: selection.quote,
        color: labelColorToLegacyColor(labelItem.color),
        labelId: labelItem.id.startsWith("legacy-") ? null : labelItem.id,
        note,
        locator: JSON.stringify({ version: 1, ranges: selection.ranges }),
        requestId,
        sessionId: currentReadingSessionId(contentId),
      }),
    });
    setSavingHighlight(false);
    setMessage(response.ok ? (updating ? label("高亮已更新", "Highlight updated") : label("高亮已保存", "Highlight saved")) : label("高亮保存失败", "Could not save highlight"));
    if (response.ok) {
      if (!updating) highlightRequestIdsRef.current.delete(highlightRequestKey);
      await Promise.all([onHighlightSaved(), loadSectionNotes()]);
      onClearSelection?.();
    }
  };

  const saveNote = async () => {
    if (!selection?.highlightId) return;
    setSavingHighlight(true);
    const response = await fetch("/api/highlights", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selection.highlightId, note }),
    });
    setSavingHighlight(false);
    setMessage(response.ok ? label("备注已保存", "Note saved") : label("备注保存失败", "Could not save note"));
    if (response.ok) {
      await Promise.all([onHighlightSaved(), loadSectionNotes()]);
      onClearSelection?.();
    }
  };

  const deleteHighlight = async () => {
    if (!selection?.highlightId) return;
    const snapshot = selection;
    setSavingHighlight(true);
    const response = await fetch(`/api/highlights?id=${encodeURIComponent(selection.highlightId)}`, { method: "DELETE" });
    setSavingHighlight(false);
    setMessage(response.ok ? label("高亮已删除", "Highlight deleted") : label("删除失败", "Could not delete highlight"));
    if (response.ok) {
      setNote("");
      onHighlightDeleted?.();
      await Promise.all([onHighlightSaved(), loadSectionNotes()]);
      onClearSelection?.();
      setDeletedHighlight(snapshot);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setDeletedHighlight(null), 7000);
    }
  };

  const undoDelete = async () => {
    if (!deletedHighlight) return;
    const snapshot = deletedHighlight;
    setSavingHighlight(true);
    const response = await fetch("/api/highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contentId,
        sectionId,
        segmentId: snapshot.segmentId,
        quote: snapshot.quote,
        color: snapshot.highlightColor || "YELLOW",
        note: snapshot.highlightNote || null,
        locator: snapshot.ranges?.length ? JSON.stringify({ version: 1, ranges: snapshot.ranges }) : null,
      }),
    });
    setSavingHighlight(false);
    setMessage(response.ok ? label("已撤销删除", "Deletion undone") : label("撤销失败，请重新添加高亮", "Undo failed. Please add the highlight again."));
    if (response.ok) {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      setDeletedHighlight(null);
      await Promise.all([onHighlightSaved(), loadSectionNotes()]);
    }
  };

  const askAi = async (requestType: "EXPLAIN" | "CONTEXT" | "GRAMMAR", targetText = selection?.quote, targetContext = selection?.context, candidates: ReturnType<typeof dictionaryCandidates> = [], cardId?: string) => {
    if (!targetText || aiRequestInFlightRef.current) return;
    aiRequestInFlightRef.current = true;
    setAiBusy(true);
    const cardContextRequest = requestType === "CONTEXT" && Boolean(cardId);
    const selectionAiRequestId = cardContextRequest ? null : ++selectionAiRequestIdRef.current;
    if (cardContextRequest) {
      setCards((current) => current.map((item) => item.id === cardId ? { ...item, contextAi: { loading: true, meaning: null, output: null, status: null, retryable: false } } : item));
    } else {
      setAiLoading(true);
      setAiOutput(null);
      setAiStatus(null);
      setAiRetryType(null);
    }
    try {
      const response = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), requestType, text: targetText, context: targetContext || sectionText.slice(0, 1200), candidates, contentId, sectionId }),
      });
      const data = await response.json() as { output?: string; error?: string; remaining?: number; cached?: boolean; degraded?: boolean; configured?: boolean; failureCode?: string; retryable?: boolean; quotaConsumed?: boolean; contextMeaning?: ContextMeaning | null; explanation?: AiExplanation | null; grammar?: GrammarExplanation | null };
      const failed = !response.ok || data.degraded === true || Boolean(data.failureCode);
      const quotaUnavailable = Boolean(data.failureCode?.startsWith("QUOTA_"));
      const status = quotaUnavailable
        ? label("AI 暂不可用", "AI is temporarily unavailable")
        : data.cached
          ? label("已命中缓存，本次不消耗额度", "Loaded from cache; no AI credit used")
          : failed
            ? (data.quotaConsumed === false ? label("本次未消耗站内 AI 额度", "No in-app AI credit was used") : label("AI 请求失败", "AI request failed"))
            : label("已使用 1 次 AI 额度", "Used 1 AI credit");
      if (typeof data.remaining === "number") setAiRemaining(data.remaining);
      if (cardContextRequest) {
        const contextual = data.contextMeaning;
        setCards((current) => current.map((item) => item.id === cardId ? {
          ...item,
          contextAi: {
            loading: false,
            meaning: contextual || null,
            output: contextual ? null : (quotaUnavailable ? label("AI 暂不可用", "AI is temporarily unavailable") : data.error || label("暂时无法可靠判断这个词在本句中的含义，请重试。", "The contextual sense could not be confirmed. Please retry.")),
            status,
            retryable: Boolean(data.retryable),
          },
        } : item));
      } else if (selectionAiRequestId === selectionAiRequestIdRef.current) {
        const fallbackOutput = quotaUnavailable
          ? label("AI 暂不可用", "AI is temporarily unavailable")
          : requestType === "GRAMMAR"
            ? data.error || label("暂时无法生成语法分析", "Grammar analysis is unavailable right now.")
            : data.output || data.error || label("暂时无法生成解释", "An explanation is not available right now.");
        const grammarOutput = data.grammar ? formatGrammarExplanation(data.grammar, locale, label("原文依据", "Evidence")) : null;
        const renderedOutput = requestType === "GRAMMAR"
          ? grammarOutput || fallbackOutput
          : requestType === "EXPLAIN" && data.explanation
            ? formatExplanation(data.explanation, label)
            : fallbackOutput;
        setAiOutput(cleanAiText(renderedOutput));        setAiStatus(status);
        setAiRetryType(data.retryable && (requestType === "EXPLAIN" || requestType === "GRAMMAR") ? requestType : null);
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : label("AI 请求失败，请重试。", "The AI request failed. Please retry.");
      if (cardContextRequest) {
        setCards((current) => current.map((item) => item.id === cardId ? { ...item, contextAi: { loading: false, meaning: null, output: cleanAiText(error), status: label("本次未消耗站内 AI 额度", "No in-app AI credit was used"), retryable: true } } : item));
      } else if (selectionAiRequestId === selectionAiRequestIdRef.current) {
        setAiOutput(cleanAiText(error));
        setAiStatus(label("本次未消耗站内 AI 额度", "No in-app AI credit was used"));
        setAiRetryType(requestType === "EXPLAIN" || requestType === "GRAMMAR" ? requestType : null);
      }
    } finally {
      if (!cardContextRequest && selectionAiRequestId === selectionAiRequestIdRef.current) setAiLoading(false);
      aiRequestInFlightRef.current = false;
      setAiBusy(false);
    }
  };

  return (
    <aside className={`${mobileOpen ? "flex" : "hidden"} fixed bottom-0 right-0 top-16 z-40 w-full shrink-0 flex-col border-l border-[var(--shelf-line)] bg-[#f0eadf] lg:static lg:flex lg:h-full lg:w-[390px]`}>
      <div className="border-b border-[var(--shelf-line)] bg-[#f7f2e8] p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold">{selection && <button type="button" onClick={() => { setActiveTab("notes"); onClearSelection?.(); }} className="rounded-full p-1.5 text-[var(--ink-soft)] hover:bg-muted" aria-label={label("返回本章记录", "Back to chapter notes")}><ArrowLeft size={15} /></button>}<BookMarked size={17} className="shrink-0 text-[var(--green)]" /> <span className="truncate">{t("reader.notes")}</span></div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{label("已保留", "Saved")} {cards.length}/{MAX_DICTIONARY_CARDS}</span>
            {cards.length > 0 && <button onClick={() => { setCards([]); setPendingLookup(null); setActiveCardIds([]); }} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title={label("清空词典卡", "Clear dictionary cards")}><Trash2 size={14} /></button>}
            <button onClick={onMobileClose} className="rounded p-1 text-muted-foreground hover:bg-muted lg:hidden" aria-label={label("关闭阅读助手", "Close margin notes")}><X size={16} /></button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{label("最多保留 15 张词卡，可同时展开 5 张。", "Keep up to 15 dictionary cards, with up to 5 expanded.")}{aiRemaining !== null && ` · AI ${aiRemaining}`}</p>
        <div role="tablist" aria-label={label("阅读助手", "Reading assistant")} className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-[var(--shelf-line)]/35 p-1">
          <button type="button" role="tab" aria-selected={activeTab === "notes"} onClick={() => setActiveTab("notes")} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${activeTab === "notes" ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:bg-white/60"}`}>{label("本章记录", "Chapter notes")}</button>
          <button type="button" role="tab" aria-selected={activeTab === "lookup"} onClick={() => setActiveTab("lookup")} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${activeTab === "lookup" ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:bg-white/60"}`}>{label("查词与标记", "Lookup & mark")}</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "notes" || !selection ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--shelf-line)] bg-white/35 p-4">
              <div className="flex items-center justify-between"><h3 className="font-display text-lg font-semibold">{label("本章记录", "Chapter notes")}</h3><span className="text-xs text-[var(--ink-soft)]">{sectionNotes.highlights.length + sectionNotes.vocabulary.length}</span></div>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{label("当前章的高亮和生词会随分页累计；点击记录可返回原文。", "Highlights and vocabulary accumulate across this chapter; open a record to return to its source.")}</p>
              {(navigationMessage || navigationWarning) && <p role="status" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{navigationMessage || navigationWarning}</p>}
              <details className="mt-3 rounded-lg border border-[var(--shelf-line)] bg-white/35 px-3 py-2"><summary className="cursor-pointer text-xs font-medium">{label("管理三个标记", "Manage three labels")}</summary><div className="mt-2 space-y-2">{displayLabels.map((item) => editingLabelId === item.id ? <div key={item.id} className="space-y-2 rounded-lg bg-background p-2"><input value={editingLabelName} onChange={(event) => setEditingLabelName(event.target.value.slice(0, 24))} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs" /><div className="flex gap-2"><select value={editingLabelColor} onChange={(event) => setEditingLabelColor(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs">{Object.keys(labelColorNames).map((color) => <option key={color} value={color} disabled={activeLabels.some((other) => other.id !== item.id && other.color === color)}>{labelColorNames[color][0]} / {labelColorNames[color][1]}</option>)}</select>{item.slotKey && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editingLabelReviewEnabled} onChange={(event) => setEditingLabelReviewEnabled(event.target.checked)} /><span>{label("加入高亮复习", "Include in highlight review")}</span></label>}<button type="button" disabled={labelSaving} onClick={() => void saveLabel()} className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground">{label("保存", "Save")}</button><button type="button" disabled={labelSaving} onClick={() => setEditingLabelId(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs">{label("取消", "Cancel")}</button></div></div> : <button type="button" key={item.id} onClick={() => beginLabelEdit(item)} className={"flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs " + labelButtonClasses[normalizeLabelColor(item.color)]}><span>{item.name}</span><span>{label("编辑", "Edit")}</span></button>)}</div></details>
            </div>
            {notesLoading ? <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--ink-soft)]"><Loader2 className="animate-spin" size={15} />{label("正在整理本章记录…", "Loading chapter notes…")}</div> : (
              <>
                {sectionHighlightGroups.map((group) => {
                  if (!group.items.length) return null;
                  return <details key={group.key} open={group.items.length <= 2 ? true : undefined} className="overflow-hidden rounded-xl border border-[var(--shelf-line)] bg-white/45"><summary className={`flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold ${labelButtonClasses[group.color]}`}><span className="flex items-center gap-2"><Highlighter size={14} />{group.name}</span><span>{group.items.length}</span></summary><div className="divide-y divide-[var(--shelf-line)]">{group.items.slice(0, 12).map((item) => <button type="button" key={item.id} onClick={() => navigateToRecord(getHighlightNavigationTarget(item))} className="block w-full px-4 py-3 text-left hover:bg-white/70"><span className="line-clamp-2 text-sm leading-5">{item.quote}</span>{item.section && <span className="mt-1 block text-[10px] text-[var(--ink-soft)]">{item.section.title} · {label(`第 ${item.section.orderIndex + 1} 页`, `Page ${item.section.orderIndex + 1}`)}</span>}{item.note && <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--ink-soft)]">{item.note}</span>}</button>)}</div></details>;
                })}
                {sectionNotes.vocabulary.length > 0 && <details open={sectionNotes.vocabulary.length <= 2 ? true : undefined} className="overflow-hidden rounded-xl border border-[var(--shelf-line)] bg-white/45"><summary className="flex cursor-pointer list-none items-center justify-between bg-[var(--green)]/10 px-4 py-3 text-sm font-semibold text-[var(--green)]"><span>{label("本章生词", "Chapter vocabulary")}</span><span>{sectionNotes.vocabulary.length}</span></summary><div className="divide-y divide-[var(--shelf-line)]">{sectionNotes.vocabulary.slice(0, 20).map((item) => <button type="button" key={item.id} onClick={() => navigateToRecord(getVocabularyNavigationTarget(item))} className="block w-full px-4 py-3 text-left hover:bg-white/70"><span className="font-semibold capitalize">{item.userVocabulary.entry.lemma}</span>{item.section && <span className="mt-1 block text-[10px] text-[var(--ink-soft)]">{item.section.title} · {label(`第 ${item.section.orderIndex + 1} 页`, `Page ${item.section.orderIndex + 1}`)}</span>}{item.userVocabulary.entry.definition && <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--ink-soft)]">{item.userVocabulary.entry.definition}</span>}{item.sourceType === "DICTIONARY_DEFINITION" && <span className="mt-1 block text-[10px] text-[var(--brass)]">{label(`在“${item.parentLemma}”的释义中发现`, `Found in the definition of “${item.parentLemma}”`)}</span>}</button>)}</div></details>}
                {!sectionNotes.highlights.length && !sectionNotes.vocabulary.length && <div className="rounded-xl border border-dashed border-[var(--shelf-line)] bg-white/35 p-6 text-center text-sm text-[var(--ink-soft)]">{label("本章还没有记录。选择正文中的单词、句子或段落开始。", "No notes in this chapter yet. Select a word, sentence, or passage to begin.")}</div>}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {(!selection.word || selection.highlightId) && <div className="rounded-xl border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">{label("当前选中内容", "Current selection")}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selection.quote}</p>
              {selection.context !== selection.quote && <details className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer select-none font-medium">{label("查看所在段落", "View source paragraph")}</summary><p className="mt-2 whitespace-pre-wrap leading-5">{selection.context}</p></details>}
              {!selection.word && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-700">{label("句子或段落用于高亮和精读分析；只有单独选择一个英文单词时才打开词典。", "Use sentences and passages for highlighting or close reading. The dictionary opens only when you select one English word.")}</p>}
              <div className="mt-3 grid grid-cols-3 gap-2">
                {displayLabels.map((option) => <button disabled={savingHighlight} key={option.id} onClick={() => saveHighlight(option)} className={`rounded-lg px-2 py-2 text-[11px] font-medium ${labelButtonClasses[normalizeLabelColor(option.color)]} ${selection.highlightLabelId === option.id ? "ring-2 ring-offset-1 ring-slate-500" : ""}`}><Highlighter className="mx-auto mb-1" size={14} />{option.name}</button>)}
              </div>
              {selection.highlightId && (
                <div className="mt-3 space-y-2 rounded-lg bg-muted/50 p-3">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="highlight-note">{label("高亮备注", "Highlight note")}</label>
                  <textarea id="highlight-note" value={note} onChange={(event) => setNote(event.target.value.slice(0, 1000))} rows={3} placeholder={label("记录为什么这句话值得复习……", "Note why this passage is worth revisiting…")} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-primary" />
                  <div className="flex justify-between gap-2"><button disabled={savingHighlight} onClick={deleteHighlight} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"><Trash2 size={13} />{label("删除高亮", "Delete highlight")}</button><button disabled={savingHighlight} onClick={saveNote} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">{label("保存备注", "Save note")}</button></div>
                </div>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2"><button disabled={aiBusy} onClick={() => askAi("EXPLAIN")} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{label("AI 上下文解释", "AI context")}</button><button disabled={aiBusy} onClick={() => askAi("GRAMMAR")} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">{label("语法分析", "Grammar")}</button></div>
              {aiLoading && <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={15} /> {label("AI 正在准备…", "AI is preparing…")}</div>}
              {aiOutput && <div className="mt-4 whitespace-pre-wrap rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-950">{aiOutput}</div>}
              {aiStatus && <p className="mt-2 text-center text-[11px] text-muted-foreground">{aiStatus}</p>}
              {aiRetryType && <button type="button" disabled={aiBusy} onClick={() => askAi(aiRetryType)} className="mx-auto mt-2 block rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 disabled:opacity-50">{label("手动重试", "Retry manually")}</button>}
            </div>}
            {selection.word && !selection.highlightId && selection.context !== selection.quote && <details className="rounded-xl border border-[var(--shelf-line)] bg-white/35 px-3 py-2 text-xs text-[var(--ink-soft)]"><summary className="cursor-pointer font-medium">{label("查看单词所在段落", "View source paragraph")}</summary><p className="mt-2 whitespace-pre-wrap leading-5">{selection.context}</p></details>}

            <div className="space-y-2">
              {cards.map((card, index) => {
                const expanded = activeCardIds.includes(card.id);
                const primaryTranslations = (card.translations || []).filter((translation) => !translation.secondary).slice(0, 4);
                const secondaryTranslations = (card.translations || []).filter((translation) => translation.secondary);
                const primaryMeanings = sliceDictionaryMeanings(card.meanings, 0, 4);
                const additionalMeanings = sliceDictionaryMeanings(card.meanings, 4, Number.POSITIVE_INFINITY);
                return (
                  <article id={`dictionary-card-${card.id}`} key={card.id} className={`rounded-xl border bg-background transition ${expanded ? "border-primary ring-2 ring-primary/10" : "border-border"}`}>
                    <div className="flex items-center gap-2 p-3">
                      <button onClick={() => setActiveCardIds((current) => toggleExpandedDictionaryCard(current, card.id))} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{index + 1}</span>
                        <span className="truncate text-base font-bold capitalize">{card.word}</span>
                        {card.inflection?.baseLemma && <span className="shrink-0 text-[10px] font-medium text-[var(--brass)]">→ {card.inflection.baseLemma}</span>}
                        {!expanded && card.definition && <span className="ml-auto max-w-36 truncate text-xs font-normal text-muted-foreground">{card.definition}</span>}
                      </button>
                      <button onClick={() => { setCards((current) => current.filter((item) => item.id !== card.id)); setActiveCardIds((current) => removeExpandedDictionaryCard(current, card.id)); setPendingLookup(null); }} className="rounded p-1.5 text-muted-foreground hover:bg-muted" title={label("关闭", "Close")}><X size={14} /></button>
                    </div>
                    {expanded && (
                      <div className="border-t border-border px-4 pb-4 pt-3">
                        <div className="flex items-center justify-between">{card.phonetic ? <p className="text-xs text-muted-foreground">{card.phonetic}</p> : <span />}{!card.loading && <button type="button" onClick={() => void playPronunciation(card)} className="rounded p-1.5 text-primary hover:bg-primary/10" title={label("播放发音", "Play pronunciation")} aria-label={label(`播放 ${card.word} 的发音`, `Play the pronunciation of ${card.word}`)}><Volume2 size={15} /></button>}</div>
                        {card.inflection?.baseLemma && <div className="mt-3 rounded-lg border border-[var(--shelf-line)] bg-[var(--green)]/5 px-3 py-2 text-xs"><span className="font-semibold capitalize">{card.word}</span><span className="text-[var(--ink-soft)]"> · {label(`${card.inflection.baseLemma} 的${inflectionRelationText(card.inflection.relation, label)}`, `${inflectionRelationText(card.inflection.relation, label)} of ${card.inflection.baseLemma}`)}</span></div>}
                        {card.inflection?.ambiguous && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">{label("检测到多个可能原形，请选择：", "Several base forms are possible. Choose one:")}</p><div className="mt-2 flex flex-wrap gap-2">{card.inflection.candidates.map((candidate) => <button type="button" key={`${candidate.lemma}-${candidate.partOfSpeech || "any"}`} onClick={() => chooseInflectionCandidate(card, candidate)} className="rounded-full border border-amber-300 bg-white px-3 py-1 font-semibold hover:bg-amber-100">{candidate.lemma}<span className="ml-1 font-normal text-amber-700">· {inflectionRelationText(candidate.relation, label)}</span></button>)}</div></div>}
                        {dictionaryDisplayMode === "bilingual" && !card.loading && card.definition && (primaryTranslations.length ? <div className="mt-3 rounded-lg border border-[var(--shelf-line)] bg-white/35 p-3"><p className="text-[11px] font-semibold tracking-wide text-[var(--brass)]">{label("常用中文对应词（Wiktionary）", "Common Chinese equivalents (Wiktionary)")}</p><div className="mt-2 space-y-2">{primaryTranslations.map((translation, translationIndex) => <div key={`${translation.partOfSpeech || "meaning"}-${translation.definition || ""}-${translationIndex}`}><p className="text-sm leading-6"><span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--brass)]">{translation.partOfSpeech || label("词义", "Meaning")}</span>{translation.words.join("、")}</p>{translation.definition && <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-soft)]">{translation.definition}</p>}</div>)}</div></div> : !card.translationUnavailable && <div className="mt-3 rounded-lg border border-[var(--shelf-line)] bg-white/25 p-3 text-xs text-[var(--ink-soft)]">{secondaryTranslations.length ? label("常见义项暂无可靠中文对应词；专业或罕见对应词已收起。", "No reliable Chinese equivalent is available for the common senses; specialized or rare equivalents are collapsed below.") : label("暂无中文对应词，英文释义仍可使用。", "No Chinese equivalent is available; the English definitions remain available.")}</div>)}
                        {dictionaryDisplayMode === "bilingual" && secondaryTranslations.length > 0 && <details className="mt-2 rounded-lg border border-[var(--shelf-line)] bg-white/20 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-[var(--ink-soft)]">{label("查看专业、古旧或罕见对应词", "Show specialized, dated, or rare equivalents")}</summary><div className="mt-2 space-y-2">{secondaryTranslations.map((translation, translationIndex) => <div key={`secondary-${translation.partOfSpeech || "meaning"}-${translation.definition || ""}-${translationIndex}`}><p className="text-sm"><span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--brass)]">{translation.partOfSpeech || label("词义", "Meaning")}</span>{translation.words.join("、")}</p>{translation.definition && <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-soft)]">{translation.definition}</p>}</div>)}</div></details>}
                        {dictionaryDisplayMode === "bilingual" && card.translationUnavailable && <p className="mt-2 text-[11px] text-amber-700">{label("中文对应词暂时无法连接，英文释义仍可使用。", "Chinese equivalents are temporarily unavailable; the English definitions remain available.")}</p>}
                        {dictionaryDisplayMode === "bilingual" && !!card.aiTranslations?.length && <div className="mt-3 rounded-lg border border-blue-200/70 bg-blue-50/55 p-3"><p className="text-[11px] font-semibold tracking-wide text-blue-800">{label("中文释义 · DeepSeek AI 翻译", "Chinese definitions · DeepSeek AI translation")}</p><div className="mt-2 space-y-2">{card.aiTranslations.map((translation, translationIndex) => <p key={translation.definitionId} className="text-sm leading-6"><span className="mr-2 text-[10px] font-semibold text-blue-700">{translationIndex + 1}.</span>{translation.translation}</p>)}</div><p className="mt-2 text-[10px] leading-4 text-blue-700/75">{label("机器翻译仅供辅助理解，请同时参考英文原文。", "Machine translation is for reading assistance; keep the English definition as the source.")}</p></div>}
                        {dictionaryDisplayMode === "bilingual" && !card.aiTranslations?.length && card.definition && <div className="mt-3"><button type="button" disabled={card.aiTranslationLoading} onClick={() => byokConfigured ? void loadDictionaryAiTranslation(card.id, card.lemma || card.word, card.meanings || [], true) : window.location.assign("/dashboard/settings")} className="w-full rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60">{card.aiTranslationLoading ? label("正在生成中文翻译…", "Generating Chinese translation…") : byokConfigured ? label("使用我的 DeepSeek Key 生成中文翻译", "Translate with my DeepSeek key") : label("前往设置配置 DeepSeek Key", "Configure a DeepSeek key in Settings")}</button>{card.aiTranslationError && <p className="mt-2 text-xs leading-5 text-red-700">{card.aiTranslationError}</p>}</div>}
                        {card.loading ? <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={15} /> {label("正在查词…", "Looking up…")}</div> : card.definition ? <div onMouseUp={() => requestNestedLookup(card)} className="mt-3 cursor-text select-text rounded-lg bg-muted/60 p-3 text-sm leading-6" title={label("选择释义中的英文单词继续查询", "Select a word in this definition to look it up")}>{card.meanings?.length ? <><div className="space-y-3">{primaryMeanings.map((meaning, meaningIndex) => <div key={`${meaning.partOfSpeech || "meaning"}-${meaningIndex}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brass)]">{meaning.partOfSpeech || label("词义", "Meaning")}</p><ol className="mt-1 list-decimal space-y-1 pl-5">{meaning.definitions.map((definition) => <li key={definition.id}><span>{definition.definition}</span>{definition.example && <span className="mt-1 block text-xs italic text-muted-foreground">{definition.example}</span>}</li>)}</ol></div>)}</div>{additionalMeanings.length > 0 && <details className="mt-3 border-t border-[var(--shelf-line)] pt-2"><summary className="cursor-pointer text-xs font-semibold text-[var(--ink-soft)]">{label("查看完整释义", "Show all definitions")}</summary><div className="mt-3 space-y-3">{additionalMeanings.map((meaning, meaningIndex) => <div key={`additional-${meaning.partOfSpeech || "meaning"}-${meaningIndex}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brass)]">{meaning.partOfSpeech || label("词义", "Meaning")}</p><ol className="mt-1 list-decimal space-y-1 pl-5">{meaning.definitions.map((definition) => <li key={`additional-${definition.id}`}><span>{definition.definition}</span>{definition.example && <span className="mt-1 block text-xs italic text-muted-foreground">{definition.example}</span>}</li>)}</ol></div>)}</div></details>}</> : card.definition}</div> : <div className="mt-3 rounded-lg bg-muted/60 p-3"><p className="text-sm text-muted-foreground">{card.error || (card.unavailable ? label("词典服务暂时无法连接，请稍后重试", "Dictionary services are temporarily unavailable. Try again later.") : label("免费词典没有收录这个词", "This word was not found in the free dictionaries."))}</p><button type="button" onClick={() => retryCard(card)} className="mt-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">{label("重试", "Try again")}</button></div>}
                        {!!card.formMeanings?.length && <details className="mt-3 rounded-lg border border-[var(--shelf-line)] bg-white/25 p-3"><summary className="cursor-pointer text-xs font-semibold">{label("该词形自身含义", "Meanings of this form")}</summary><div className="mt-3 space-y-3 text-sm leading-6">{card.formMeanings.map((meaning, meaningIndex) => <div key={`form-${meaning.partOfSpeech || "meaning"}-${meaningIndex}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brass)]">{meaning.partOfSpeech || label("词义", "Meaning")}</p><ol className="mt-1 list-decimal space-y-1 pl-5">{meaning.definitions.map((definition) => <li key={`form-${definition.id}`}>{definition.definition}{definition.example && <span className="mt-1 block text-xs italic text-muted-foreground">{definition.example}</span>}</li>)}</ol></div>)}</div></details>}
                        {!!card.sources?.length && <div className="mt-2 space-y-1 text-[11px] text-muted-foreground"><span>{label("释义来源", "Sources")}:</span>{card.sources.map((item, index) => <p key={`${item.provider}-${item.version || ""}-${index}`}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="underline decoration-[var(--brass)] underline-offset-2 hover:text-[var(--ink)]">{item.provider}{item.version ? ` ${item.version}` : ""}</a> : `${item.provider}${item.version ? ` ${item.version}` : ""}`}{item.licenseName && <> · {item.licenseUrl ? <a href={item.licenseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{item.licenseName}</a> : item.licenseName}</>}</p>)}</div>}
                        {card.sourceType === "DICTIONARY_DEFINITION" && <p className="mt-2 text-[11px] text-muted-foreground">{label(`在“${card.parentLemma}”的释义中发现`, `Found in the definition of “${card.parentLemma}”`)}</p>}
                        <div className="mt-3 grid grid-cols-2 gap-2"><button disabled={card.loading || aiBusy || card.contextAi?.loading || !dictionaryCandidates(card).length} onClick={() => askAi("CONTEXT", card.word, card.context, dictionaryCandidates(card), card.id)} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-medium text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{label("本文含义", "In this sentence")}</button><button disabled={card.loading} onClick={() => saveWord(card)} className="flex items-center justify-center gap-1 rounded-lg border border-primary/25 bg-primary/5 px-2 py-2 text-xs font-medium text-primary disabled:opacity-50"><Plus size={14} /> {label("加入生词本", "Save word")}</button></div>
                        {card.contextAi?.loading && <div className="mt-3 flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-950"><Loader2 className="animate-spin" size={15} />{label("正在理解这句话…", "Reading this sentence…")}</div>}
                        {card.contextAi?.meaning && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-950">{label("本文含义", "Meaning in this sentence")}: {card.contextAi.meaning.meaning}{card.contextAi.meaning.rationale ? "\n\n" + label("判断依据", "Why") + ": " + card.contextAi.meaning.rationale : ""}{card.contextAi.meaning.uncertain ? "\n\n" + label("这句话可能对应两个接近义项。", "This sentence may match two close senses.") : ""}</div>}
                        {card.contextAi?.output && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-blue-50 p-3 text-sm leading-6 text-blue-950">{card.contextAi.output}</div>}
                        {card.contextAi?.status && <p className="mt-2 text-center text-[11px] text-muted-foreground">{card.contextAi.status}</p>}
                        {card.contextAi?.retryable && <button type="button" disabled={aiBusy} onClick={() => askAi("CONTEXT", card.word, card.context, dictionaryCandidates(card), card.id)} className="mx-auto mt-2 block rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 disabled:opacity-50">{label("手动重试", "Retry manually")}</button>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {pendingLookup && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{label(`最多保留 ${MAX_DICTIONARY_CARDS} 张词卡。继续查询“${pendingLookup.word}”将移除最早的“${cards[0]?.word}”；确认后，以后达到上限将自动移除最早词卡。`, `You can keep ${MAX_DICTIONARY_CARDS} dictionary cards. Looking up “${pendingLookup.word}” will remove the oldest card, “${cards[0]?.word}”. After you confirm, the oldest card will be removed automatically whenever the limit is reached.`)}</p><div className="mt-3 flex flex-wrap justify-end gap-2"><button onClick={() => setPendingLookup(null)} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs">{label("取消", "Cancel")}</button><button onClick={() => { writeDictionaryCardOverflowMode("replace-oldest"); setDictionaryCardOverflowMode("replace-oldest"); addLookupCard(pendingLookup, cards.length >= MAX_DICTIONARY_CARDS ? cards[0]?.id : undefined); setPendingLookup(null); }} className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white">{label("确认并继续", "Confirm and continue")}</button></div></div>}
          </div>
        )}

        {message && <div className="mt-4 flex items-center justify-center gap-3 rounded-lg bg-green-50 p-2 text-center text-xs text-green-700"><span>{message}</span>{deletedHighlight && <button disabled={savingHighlight} onClick={undoDelete} className="inline-flex items-center gap-1 font-semibold text-amber-700 disabled:opacity-50"><RotateCcw size={13} />{label("撤销", "Undo")}</button>}</div>}
      </div>
    </aside>
  );
}

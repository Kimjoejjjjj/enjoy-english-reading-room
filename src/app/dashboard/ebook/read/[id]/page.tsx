"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BookMarked, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Loader2, Menu, X } from "lucide-react";
import ReaderInspector, { ReaderSelection, SelectionRange } from "@/components/reader/ReaderInspector";
import { createPendingReaderNavigation, isCurrentSectionLoad, isValidReaderRange, PendingReaderNavigation, ReaderNavigationTarget, resolveReaderRanges, resolveSectionLoadFailure, shouldClearSectionTransition, shouldCommitSectionTransition, shouldConsumeReaderNavigation } from "@/lib/reader-navigation";
import { FocusTimer } from "@/components/reader/FocusTimer";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { classifyVocabularySelection } from "@/lib/vocabulary-selection";
import { inlineHighlightClasses, legacyColorToLabelColor, normalizeLabelColor } from "@/lib/highlight-labels";

interface SectionSummary { id: string; orderIndex: number; title: string; chapterTitle?: string | null; kind: string; wordCount: number }
interface NavigationEntry { title: string; kind: "CHAPTER" | "FRONT_MATTER"; targetOrderIndex: number; targetSectionId: string; depth?: number }
interface BookData { id: string; title: string; author?: string | null; format: string; sections: SectionSummary[]; navigationEntries?: NavigationEntry[]; progresses: Array<{ sectionId?: string | null; completionPercent: number }> }
interface Segment { id: string; text: string; orderIndex: number }
interface HighlightLabelSummary { id: string; name: string; color: string; archived: boolean }
interface Highlight { id: string; segmentId?: string | null; quote: string; color: string; labelId?: string | null; label?: HighlightLabelSummary | null; note?: string | null; locator?: string | null }
interface SectionData extends SectionSummary { plainText: string; segments: Segment[]; highlights: Highlight[] }
interface RenderRange extends SelectionRange { highlightId: string; color: string }

function vocabularySelection(value: string) {
  return classifyVocabularySelection(value)?.normalized ?? null;
}

function rangesMatch(left: SelectionRange[], right: SelectionRange[]) {
  return left.length === right.length && left.every((item, index) => item.segmentId === right[index]?.segmentId && item.start === right[index]?.start && item.end === right[index]?.end);
}

function findReaderElement(attribute: "data-highlight-id" | "data-segment-id", value: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-highlight-id], [data-segment-id]")).find((element) => element.getAttribute(attribute) === value) || null;
}

function focusReaderElement(element: HTMLElement) {
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.animate(
    [{ backgroundColor: "rgba(173,137,82,0.28)" }, { backgroundColor: "transparent" }],
    { duration: 1400, easing: "ease-out" },
  );
}

function resolveHighlightRanges(section: SectionData, highlight: Highlight, fallbackLocator?: string | null) {
  return resolveReaderRanges(section.segments, highlight, fallbackLocator);
}

function offsetWithin(element: HTMLElement, container: Node, offset: number) {
  const probe = document.createRange();
  probe.selectNodeContents(element);
  probe.setEnd(container, offset);
  return probe.toString().length;
}

function renderHighlightedText(text: string, segmentId: string, ranges: RenderRange[], onHighlightClick: (highlightId: string) => void, editTitle: string) {
  const safeRanges = ranges.filter((item) => isValidReaderRange(item, [{ id: segmentId, text }]));
  if (!safeRanges.length) return text;
  const boundaries = Array.from(new Set([0, text.length, ...safeRanges.flatMap((item) => [item.start, item.end])])).sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const value = text.slice(start, end);
    const active = [...safeRanges].reverse().find((item) => item.start <= start && item.end >= end);
    if (!active) return <span key={`${start}-${end}`}>{value}</span>;
    const color = normalizeLabelColor(active.color);
    const openIfUnselected = () => {
      const selected = window.getSelection();
      if (selected && !selected.isCollapsed && selected.toString().trim()) return;
      onHighlightClick(active.highlightId);
    };
    return <mark key={`${start}-${end}`} data-highlight-id={active.highlightId} role="button" tabIndex={0} onClick={openIfUnselected} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openIfUnselected(); } }} className={`cursor-pointer ${inlineHighlightClasses[color]}`} title={editTitle}>{value}</mark>;
  });
}

export default function BookReaderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale, t } = useLocale();
  const label = useCallback((zh: string, en: string) => locale === "zh-CN" ? zh : en, [locale]);
  const [book, setBook] = useState<BookData | null>(null);
  const [section, setSection] = useState<SectionData | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [bookFinished, setBookFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(true);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [readySectionId, setReadySectionId] = useState<string | null>(null);
  const pendingHighlightId = useRef<string | null>(null);
  const [navigationMessage, setNavigationMessage] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingReaderNavigation | null>(null);
  const navigationRequestIdRef = useRef(0);
  const sectionLoadRequestIdRef = useRef(0);
  const sectionTransitionRequestIdRef = useRef(0);
  const sectionTransitionTargetRef = useRef<{ requestId: number; sectionId: string } | null>(null);

  useEffect(() => {
    fetch(`/api/books/${id}`)
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(locale === "zh-CN" ? (data.error || "无法加载书籍") : "Unable to load book"); return data; })
      .then((data: BookData) => {
        const params = new URLSearchParams(window.location.search);
        const requestedSectionId = params.get("sectionId");
        const restarting = params.get("restart") === "1";
        pendingHighlightId.current = params.get("highlightId");
        const targetSectionId = restarting
          ? data.sections[0]?.id || null
          : requestedSectionId && data.sections.some((item) => item.id === requestedSectionId)
            ? requestedSectionId
            : data.progresses[0]?.sectionId || data.sections[0]?.id || null;
        setBook(data);
        setSectionId(targetSectionId);
        if (targetSectionId) {
          void fetch(`/api/books/${id}/progress`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sectionId: targetSectionId,
              completionPercent: restarting ? 0 : data.progresses[0]?.completionPercent || 0,
              secondsSpent: 0,
              restart: restarting,
            }),
          }).then((response) => {
            if (!response.ok || !restarting) return;
            params.delete("restart");
            const query = params.toString();
            window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
          });
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : (locale === "zh-CN" ? "无法加载书籍" : "Unable to load book")))
      .finally(() => setLoading(false));
  }, [id, locale]);

  const loadSection = useCallback(async () => {
    if (!sectionId) return;
    const requestedSectionId = sectionId;
    const requestId = ++sectionLoadRequestIdRef.current;
    try {
      const sectionResponse = await fetch(`/api/books/${id}/sections/${requestedSectionId}`);
      if (!sectionResponse.ok) throw new Error("Section request failed");
      const data = await sectionResponse.json() as SectionData;
      if (!isCurrentSectionLoad(requestId, requestedSectionId, sectionLoadRequestIdRef.current, sectionId)) return;
      setSection(data);
      document.querySelector("main")?.scrollTo({ top: 0 });
      if (sectionTransitionTargetRef.current?.sectionId === requestedSectionId) sectionTransitionTargetRef.current = null;
      setNavigationMessage(null);
    } catch {
      const transitionTargetSectionId = sectionTransitionTargetRef.current?.sectionId || null;
      const failure = resolveSectionLoadFailure(requestId, requestedSectionId, sectionLoadRequestIdRef.current, sectionId, null, transitionTargetSectionId);
      if (!failure.handled) return;
      setSection(null);
      setPendingNavigation((current) => {
        const resolution = resolveSectionLoadFailure(requestId, requestedSectionId, sectionLoadRequestIdRef.current, sectionId, current?.target.sectionId || null, sectionTransitionTargetRef.current?.sectionId || null);
        return resolution.clearPending ? null : current;
      });
      if (failure.clearTransition) sectionTransitionTargetRef.current = null;
      setNavigationMessage(label("原文位置不可用", "Original location unavailable"));
    }
  }, [id, label, sectionId]);

  useEffect(() => { void loadSection(); }, [loadSection]);

  useEffect(() => {
    if (section?.id) void fetch(`/api/books/${id}/sections/${section.id}/study`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secondsSpent: 0 }) });
  }, [id, section?.id]);

  const changeSection = (nextId: string) => {
    if (nextId === sectionId && !sectionTransitionTargetRef.current) return;
    const transitionRequestId = ++sectionTransitionRequestIdRef.current;
    navigationRequestIdRef.current += 1;
    sectionTransitionTargetRef.current = { requestId: transitionRequestId, sectionId: nextId };
    setPendingNavigation(null);
    setNavigationMessage(null);
    void Promise.resolve().then(() => {
      if (!shouldCommitSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current)) return;
      setSelection(null);
      setSection(null);
      setSectionId(nextId);
    }).catch(() => {
      if (!shouldCommitSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current)) return;
      sectionTransitionTargetRef.current = null;
      setPendingNavigation(null);
      setNavigationMessage(label("原文位置不可用", "Original location unavailable"));
    }).finally(() => {
      if (shouldClearSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current, sectionTransitionTargetRef.current?.requestId ?? null)) {
        sectionTransitionTargetRef.current = null;
      }
    });
  };

  const completeAndMove = async () => {
    const completedSectionId = sectionId;
    if (!completedSectionId) return;
    const transitionRequestId = ++sectionTransitionRequestIdRef.current;
    navigationRequestIdRef.current += 1;
    setPendingNavigation(null);
    setNavigationMessage(null);
    try {
      if (!shouldCommitSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current)) return;
      const response = await fetch(`/api/books/${id}/sections/${completedSectionId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secondsSpent: 0 }) });
      const data = await response.json() as { nextSection?: { id?: string | null } | null };
      if (!shouldCommitSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current)) return;
      if (!response.ok) {
        setNavigationMessage(label("无法完成本页", "Unable to complete this page"));
        return;
      }
      if (data.nextSection?.id) {
        const nextSectionId = data.nextSection.id;
        sectionTransitionTargetRef.current = { requestId: transitionRequestId, sectionId: nextSectionId };
        setSelection(null);
        setSection(null);
          setSectionId(nextSectionId);
      } else {
        setBookFinished(true);
      }
    } catch {
      if (!shouldCommitSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current)) return;
      setNavigationMessage(label("无法完成本页", "Unable to complete this page"));
    } finally {
      if (shouldClearSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current, sectionTransitionTargetRef.current?.requestId ?? null)) {
        sectionTransitionTargetRef.current = null;
      }
    }
  };

  const openHighlight = useCallback((highlightId: string) => {
    if (!section) return;
    const highlight = section.highlights.find((item) => item.id === highlightId);
    if (!highlight) return;
    const ranges = resolveHighlightRanges(section, highlight);
    if (!ranges.length) {
      setNavigationMessage(label("原文位置不可用", "Original location unavailable"));
      return;
    }
    const contexts = ranges
      .map((range) => section.segments.find((item) => item.id === range.segmentId)?.text)
      .filter((value): value is string => Boolean(value));
    const context = Array.from(new Set(contexts)).join("\n\n") || highlight.quote;
    setSelection({
      word: vocabularySelection(highlight.quote),
      quote: highlight.quote,
      context,
      segmentId: highlight.segmentId || ranges[0]?.segmentId,
      ranges,
      highlightId: highlight.id,
      highlightColor: highlight.color,
      highlightNote: highlight.note || "",
      highlightLabelId: highlight.labelId || null,
    });
    setInspectorOpen(true);
    window.getSelection()?.removeAllRanges();
  }, [label, section]);

  const navigateToRecord = useCallback((target: ReaderNavigationTarget) => {
    if (!book?.sections.some((item) => item.id === target.sectionId)) {
      setNavigationMessage(label("原文位置不可用", "Original location unavailable"));
      return;
    }
    setNavigationMessage(null);
    const requestId = ++navigationRequestIdRef.current;
    setPendingNavigation(createPendingReaderNavigation(requestId, target));
    const sectionChangeInFlight = sectionTransitionTargetRef.current !== null;
    const transitionRequestId = ++sectionTransitionRequestIdRef.current;
    if (target.sectionId === sectionId && !sectionChangeInFlight) {
      sectionTransitionTargetRef.current = null;
      return;
    }
    sectionTransitionTargetRef.current = { requestId: transitionRequestId, sectionId: target.sectionId };
    void Promise.resolve().then(() => {
      if (requestId !== navigationRequestIdRef.current
        || !shouldCommitSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current)) return;
      setSelection(null);
      setSection(null);
      setSectionId(target.sectionId);
    }).catch(() => {
      if (requestId !== navigationRequestIdRef.current
        || !shouldCommitSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current)) return;
      sectionTransitionTargetRef.current = null;
      setPendingNavigation(null);
      setNavigationMessage(label("原文位置不可用", "Original location unavailable"));
    }).finally(() => {
      if (requestId === navigationRequestIdRef.current
        && shouldClearSectionTransition(transitionRequestId, sectionTransitionRequestIdRef.current, sectionTransitionTargetRef.current?.requestId ?? null)) {
        sectionTransitionTargetRef.current = null;
      }
    });
  }, [book, label, sectionId]);

  useEffect(() => {
    const highlightId = pendingHighlightId.current;
    if (!highlightId || !section) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingHighlightId.current !== highlightId) return;
      pendingHighlightId.current = null;
      const marker = findReaderElement("data-highlight-id", highlightId);
      if (!marker) {
        setNavigationMessage(label("原文位置不可用", "Original location unavailable"));
        return;
      }
      focusReaderElement(marker);
      marker.click();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [label, section]);

  useEffect(() => {
    if (!section || !shouldConsumeReaderNavigation(pendingNavigation, section.id)) return;
    const request = pendingNavigation;
    const frame = window.requestAnimationFrame(() => {
      if (!section || !shouldConsumeReaderNavigation(request, section.id)) return;
      const target = request.target;
      let located = false;
      if (target.highlightId) {
        const highlight = section.highlights.find((item) => item.id === target.highlightId);
        if (highlight) {
          const marker = findReaderElement("data-highlight-id", target.highlightId);
          if (marker) {
            focusReaderElement(marker);
            marker.click();
            located = true;
          } else {
            const ranges = resolveHighlightRanges(section, highlight, target.locator);
            const segmentId = ranges[0]?.segmentId || highlight.segmentId || target.segmentId;
            const element = segmentId ? findReaderElement("data-segment-id", segmentId) : null;
            if (element && ranges.length) {
              focusReaderElement(element);
              openHighlight(highlight.id);
              located = true;
            }
          }
        }
      } else if (target.segmentId) {
        const element = findReaderElement("data-segment-id", target.segmentId);
        if (element) {
          setInspectorOpen(false);
          focusReaderElement(element);
          located = true;
        }
      }
      setPendingNavigation((current) => current?.requestId === request.requestId ? null : current);
      setNavigationMessage(located ? null : label("原文位置不可用", "Original location unavailable"));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [label, openHighlight, pendingNavigation, section]);

  const handleSelection = () => {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || selected.rangeCount === 0) return;
    const quote = selected.toString().trim().slice(0, 2000);
    if (!quote) return;
    const range = selected.getRangeAt(0);
    const anchor = selected.anchorNode instanceof Element ? selected.anchorNode : selected.anchorNode?.parentElement;
    const article = anchor?.closest("article");
    if (!article) return;
    const ranges: SelectionRange[] = [];
    const contexts: string[] = [];
    article.querySelectorAll<HTMLElement>("[data-segment-id]").forEach((element) => {
      try {
        if (!range.intersectsNode(element)) return;
        const segmentId = element.dataset.segmentId;
        const text = element.textContent || "";
        if (!segmentId || !text) return;
        const start = element.contains(range.startContainer) ? offsetWithin(element, range.startContainer, range.startOffset) : 0;
        const end = element.contains(range.endContainer) ? offsetWithin(element, range.endContainer, range.endOffset) : text.length;
        if (end > start) { ranges.push({ segmentId, start, end }); contexts.push(text.trim()); }
      } catch { /* Ignore nodes outside this range. */ }
    });
    if (!ranges.length) return;
    const existing = section?.highlights.find((highlight) => rangesMatch(resolveHighlightRanges(section, highlight), ranges));
    setSelection({ word: vocabularySelection(quote), quote, context: contexts.join("\n\n") || quote, segmentId: ranges[0].segmentId, ranges, highlightId: existing?.id, highlightColor: existing?.color, highlightNote: existing?.note || "", highlightLabelId: existing?.labelId || null });
  };

  if (loading) return <div className="flex h-[70vh] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (error || !book) return <div className="rounded-xl bg-red-50 p-6 text-red-700">{error || label("书籍不存在", "Book not found")}</div>;

  const currentIndex = book.sections.findIndex((item) => item.id === sectionId);
  const previous = currentIndex > 0 ? book.sections[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < book.sections.length - 1 ? book.sections[currentIndex + 1] : null;
  type TocEntry = { title: string; kind: "CHAPTER" | "FRONT_MATTER"; sections: SectionSummary[]; depth: number; navigationOnly?: boolean };
  type TocNode = { entry: TocEntry; children: TocNode[]; key: string };
  const tocEntries: TocEntry[] = [];
  if (book.navigationEntries?.length) {
    let previousDepth = 0;
    for (const [entryIndex, item] of book.navigationEntries.entries()) {
      const start = book.sections.findIndex((sectionItem) => sectionItem.id === item.targetSectionId);
      if (start < 0) continue;
      const requestedDepth = Math.max(0, item.depth || 0);
      const depth = entryIndex === 0 ? 0 : Math.min(requestedDepth, previousDepth + 1);
      previousDepth = depth;
      const nextEntry = book.navigationEntries[entryIndex + 1];
      const hasChild = Boolean(nextEntry && (nextEntry.depth || 0) > depth);
      const nextStart = book.navigationEntries.slice(entryIndex + 1)
        .map((entry) => book.sections.findIndex((sectionItem) => sectionItem.id === entry.targetSectionId))
        .find((index) => index > start) ?? book.sections.length;
      tocEntries.push({
        title: item.title,
        kind: item.kind,
        depth,
        sections: hasChild ? [] : book.sections.slice(start, nextStart),
        navigationOnly: hasChild || nextEntry?.targetSectionId === item.targetSectionId,
      });
    }
  } else {
    for (const item of book.sections) {
      if (!item.chapterTitle) continue;
      const kind = item.kind === "FRONT_MATTER" ? "FRONT_MATTER" as const : "CHAPTER" as const;
      const previousEntry = tocEntries[tocEntries.length - 1];
      if (previousEntry?.title === item.chapterTitle && previousEntry.kind === kind) previousEntry.sections.push(item);
      else tocEntries.push({ title: item.chapterTitle, kind, sections: [item], depth: 0 });
    }
  }
  const tocRoots: TocNode[] = [];
  const tocStack: TocNode[] = [];
  for (const [entryIndex, entry] of tocEntries.entries()) {
    const availableDepth = Math.min(entry.depth, tocStack.length);
    const normalizedEntry = availableDepth === entry.depth ? entry : { ...entry, depth: availableDepth };
    const node: TocNode = { entry: normalizedEntry, children: [], key: `toc:${entryIndex}:${entry.title}` };
    if (availableDepth > 0) tocStack[availableDepth - 1].children.push(node);
    else tocRoots.push(node);
    tocStack[availableDepth] = node;
    tocStack.length = availableDepth + 1;
  }
  const currentTocEntry = [...tocEntries].reverse().find((entry) => entry.sections.some((item) => item.id === sectionId));
  const currentChapterPage = currentTocEntry
    ? currentTocEntry.sections.findIndex((item) => item.id === sectionId) + 1
    : 0;
  const positionText = currentTocEntry
    ? `${currentTocEntry.title} · ${currentChapterPage}/${currentTocEntry.sections.length}`
    : `${currentIndex + 1} / ${book.sections.length}`;
  const sectionHeading = currentTocEntry?.title || `Part ${currentIndex + 1}`;
  const renderTocItems = (closeAfterSelection = false) => {
    const renderPart = (item: SectionSummary) => <button key={item.id} onClick={() => { void changeSection(item.id); if (closeAfterSelection) setMobileTocOpen(false); }} className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${item.id === sectionId ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><span className="line-clamp-2">Part {item.orderIndex + 1}</span><span className={`mt-1 block text-[11px] ${item.id === sectionId ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{item.wordCount} words</span></button>;
    if (!tocRoots.length) return book.sections.map(renderPart);
    const firstReadableSection = (node: TocNode): SectionSummary | null => node.entry.sections[0] || node.children.map(firstReadableSection).find((item): item is SectionSummary => Boolean(item)) || null;
    const nodeIsActive = (node: TocNode): boolean => node.entry.sections.some((item) => item.id === sectionId) || node.children.some(nodeIsActive);
    const openNode = (node: TocNode) => {
      const target = firstReadableSection(node);
      if (!target) return;
      void changeSection(target.id);
      if (closeAfterSelection) setMobileTocOpen(false);
    };
    const toggleNode = (key: string) => setExpandedChapters((current) => {
      const nextState = new Set(current);
      if (nextState.has(key)) nextState.delete(key);
      else nextState.add(key);
      return nextState;
    });
    const renderNode = (node: TocNode): React.ReactNode => {
      const active = nodeIsActive(node);
      const expandable = node.children.length > 0 || node.entry.sections.length > 0;
      const expanded = active || expandedChapters.has(node.key);
      return <div key={node.key} className="mb-1.5"><div className={`flex items-center rounded-lg ${active ? "bg-white/55 text-primary" : "text-[var(--ink-soft)] hover:bg-white/45"}`}>{expandable ? <button type="button" onClick={() => toggleNode(node.key)} className="shrink-0 p-2" aria-label={expanded ? label("折叠目录", "Collapse contents") : label("展开目录", "Expand contents")} aria-expanded={expanded}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="w-8" />}<button type="button" onClick={() => openNode(node)} className="min-w-0 flex-1 py-2 pr-3 text-left font-display text-sm font-semibold"><span className="line-clamp-2">{node.entry.title}</span></button></div>{expanded && node.children.length > 0 && <div className="ml-4 mt-1 border-l border-[var(--shelf-line)] pl-2">{node.children.map(renderNode)}</div>}{expanded && node.children.length === 0 && node.entry.sections.length > 0 && <div className="ml-5 mt-1 border-l border-[var(--shelf-line)] pl-2">{node.entry.sections.map((item, pageIndex) => <button key={item.id} type="button" onClick={() => { void changeSection(item.id); if (closeAfterSelection) setMobileTocOpen(false); }} className={`mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs ${item.id === sectionId ? "bg-primary text-primary-foreground" : "hover:bg-white/45"}`}><span>{pageIndex + 1} / {node.entry.sections.length}</span><span className={item.id === sectionId ? "text-primary-foreground/70" : "text-muted-foreground"}>{item.wordCount} words</span></button>)}</div>}</div>;
    };
    const frontMatterRoots = tocRoots.filter((node) => node.entry.kind === "FRONT_MATTER");
    const readingRoots = tocRoots.filter((node) => node.entry.kind !== "FRONT_MATTER");
    const bookInfoKey = "book-information";
    const bookInfoActive = frontMatterRoots.some(nodeIsActive);
    const bookInfoExpanded = bookInfoActive || expandedChapters.has(bookInfoKey);
    return <>{frontMatterRoots.length > 0 && <div className="mb-3"><button type="button" onClick={() => toggleNode(bookInfoKey)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-display text-sm font-semibold text-[var(--ink-soft)] hover:bg-white/45" aria-expanded={bookInfoExpanded}>{bookInfoExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>{label("书籍信息", "Book information")}</span></button>{bookInfoExpanded && <div className="ml-3 border-l border-[var(--shelf-line)] pl-2">{frontMatterRoots.map(renderNode)}</div>}</div>}{readingRoots.map(renderNode)}</>;
  };

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-[var(--paper)] text-[var(--ink)]">
      <header className="relative flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--shelf-line)] bg-[rgba(251,248,240,0.96)] px-3 backdrop-blur sm:px-5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3"><button onClick={() => window.dispatchEvent(new Event("enjoy-reader-exit"))} className="rounded-full p-2 hover:bg-white"><ChevronLeft size={18} /></button><button onClick={() => { if (window.matchMedia("(min-width: 768px)").matches) setTocOpen((value) => !value); else setMobileTocOpen((value) => !value); }} className="rounded-full p-2 hover:bg-white" aria-label={t("reader.toc")}><Menu size={18} /></button><div className="hidden min-w-0 sm:block"><h1 className="max-w-xs truncate font-display text-sm font-semibold">{book.title}</h1><p className="text-[10px] uppercase tracking-wider text-[var(--ink-soft)]">{book.author || book.format}</p></div></div>
        <FocusTimer contentId={book.id} sectionId={section?.id || null} onSessionReady={setReadySectionId} />
        <div className="flex min-w-0 items-center gap-2 text-xs text-[var(--ink-soft)]"><button onClick={() => router.push(`/dashboard/ebook/highlights/${book.id}`)} className="hidden items-center gap-1 rounded-full border border-[var(--shelf-line)] px-3 py-1.5 hover:bg-white md:inline-flex"><BookMarked size={14} />{t("reader.highlights")}</button><button onClick={() => setInspectorOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-[var(--shelf-line)] px-2.5 py-1.5 hover:bg-white lg:hidden"><BookMarked size={14} /><span className="hidden sm:inline">{t("reader.notes")}</span></button><span className="max-w-44 truncate text-right sm:max-w-64">{positionText}</span></div>
      </header>

      <div className="flex min-h-0 flex-1">
        {mobileTocOpen && (
          <>
            <button type="button" onClick={() => setMobileTocOpen(false)} className="fixed inset-x-0 bottom-0 top-16 z-40 bg-black/30 md:hidden" aria-label={label("关闭目录", "Close contents")} />
            <nav className="fixed bottom-0 left-0 top-16 z-50 w-[min(85vw,20rem)] overflow-y-auto border-r border-[var(--shelf-line)] bg-[#ede6da] p-3 shadow-2xl md:hidden" aria-label={t("reader.toc")}>
              <div className="mb-2 flex items-center justify-between px-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("reader.toc")}</p><button type="button" onClick={() => setMobileTocOpen(false)} className="rounded-full p-2 hover:bg-white" aria-label={label("关闭目录", "Close contents")}><X size={16} /></button></div>
              {renderTocItems(true)}
            </nav>
          </>
        )}
        {tocOpen && <nav className="hidden w-64 shrink-0 overflow-y-auto border-r border-[var(--shelf-line)] bg-[#ede6da] p-3 md:block" aria-label={t("reader.toc")}><p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("reader.toc")}</p>{renderTocItems()}</nav>}

        <main className="min-w-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6 sm:py-8 lg:px-10">
          {section ? <article onMouseUp={handleSelection} className="paper-grain mx-auto max-w-3xl rounded-[1.5rem] border border-[var(--shelf-line)] bg-[#fffdf8] px-6 py-9 shadow-[0_18px_55px_rgba(72,49,34,0.10)] sm:px-10 lg:px-14 lg:py-12">
            <div className="mb-8 flex items-center gap-3 border-b border-border pb-5"><BookOpen className="text-primary" size={20} /><div><h2 className="text-2xl font-bold text-slate-900">{sectionHeading}</h2><p className="mt-1 text-xs text-muted-foreground">{currentTocEntry ? `${label("本章", "Chapter page")} ${currentChapterPage}/${currentTocEntry.sections.length} · ` : ""}{section.wordCount} words · {label("选择文字即可阅读", "Select text to read closely")}</p></div></div>
            <div className="space-y-5 font-reading text-[18px] leading-8 text-[#2c302b] sm:text-[19px] sm:leading-9">
              {section.segments.map((segment) => {
                const parsed = section.highlights.map((highlight) => ({ highlight, ranges: resolveHighlightRanges(section, highlight) }));
                const inlineRanges = parsed.flatMap(({ highlight, ranges }) => {
                  const displayColor = highlight.label?.color || legacyColorToLabelColor(highlight.color);
                  return ranges.filter((item) => item.segmentId === segment.id).map((item) => ({ ...item, highlightId: highlight.id, color: displayColor }));
                });
                return <p key={segment.id} data-segment-id={segment.id} className="rounded-r-md px-2 py-1">{renderHighlightedText(segment.text, segment.id, inlineRanges, openHighlight, label("点击编辑或删除高亮", "Edit or delete highlight"))}</p>;
              })}
            </div>
            <div className="mt-10 grid grid-cols-2 items-center gap-3 border-t border-border pt-5 sm:grid-cols-3">
              <button disabled={!previous} onClick={() => previous && changeSection(previous.id)} className="inline-flex items-center justify-self-start gap-2 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-30"><ChevronLeft size={16} />{label("上一页", "Previous")}</button>
              <button disabled={!next && bookFinished} onClick={() => void completeAndMove()} className="col-span-1 inline-flex items-center justify-self-end gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-30">{next ? label("下一页", "Next") : label("读完本书", "Finish book")}<ChevronRight size={16} /></button>
            </div>
          </article> : navigationMessage
            ? <div role="status" className="flex h-full items-center justify-center p-8 text-center text-sm text-amber-800">{navigationMessage}</div>
            : <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin" /></div>}
        </main>

        {section && readySectionId === section.id && <ReaderInspector selection={selection} contentId={book.id} sectionId={section.id} sectionText={section.plainText} onHighlightSaved={loadSection} onHighlightDeleted={() => setSelection(null)} onClearSelection={() => setSelection(null)} onNavigateToRecord={navigateToRecord} navigationMessage={navigationMessage} mobileOpen={inspectorOpen} onMobileClose={() => setInspectorOpen(false)} />}
      </div>

      {bookFinished && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"><div className="w-full max-w-sm rounded-2xl bg-[#fffdf8] p-6 text-center shadow-2xl"><h2 className="font-display text-2xl font-semibold">{label("你读完了这本书", "You finished this book")}</h2><p className="mt-2 text-sm text-[var(--ink-soft)]">{label("今天的阅读就停在这里，也可以继续回到书中。", "A quiet finish for today, or continue reading whenever you like.")}</p><button onClick={() => window.dispatchEvent(new Event("enjoy-reader-exit"))} className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{label("返回书架", "Back to shelf")}</button><button onClick={() => setBookFinished(false)} className="mt-3 block w-full py-2 text-xs text-muted-foreground">{label("继续阅读", "Keep reading")}</button></div></div>}
    </div>
  );
}

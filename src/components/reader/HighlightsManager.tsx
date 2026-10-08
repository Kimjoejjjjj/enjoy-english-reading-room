"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@base-ui/react/select";
import { ArrowLeft, Check, ChevronDown, ExternalLink, Highlighter, Loader2, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { blockHighlightClasses, labelButtonClasses, legacyColorToLabelColor, normalizeLabelColor } from "@/lib/highlight-labels";
import { restoreDeletedHighlight } from "@/lib/highlight-undo";

interface BookData { id: string; title: string; author?: string | null }
interface BookFilterOption { value: string; label: string }
interface ReadingLabel { id: string; name: string; color: string; archived: boolean; slotKey?: string | null; reviewEnabled?: boolean | null }
interface HighlightItem {
  id: string;
  contentId: string;
  sectionId?: string | null;
  segmentId?: string | null;
  quote: string;
  color: string;
  labelId?: string | null;
  label?: ReadingLabel | null;
  note?: string | null;
  locator?: string | null;
  nextReview?: string;
  createdAt: string;
  updatedAt: string;
  content?: { id: string; title: string };
  section?: { id: string; title: string } | null;
}

const fallbackLabels: ReadingLabel[] = [
  { id: "legacy-gold", name: "金句", color: "AMBER", archived: false },
  { id: "legacy-blue", name: "不懂", color: "BLUE", archived: false },
  { id: "legacy-important", name: "重要", color: "SAGE", archived: false },
];

function labelForHighlight(highlight: HighlightItem, labels: ReadingLabel[]) {
  if (highlight.label && !highlight.label.archived) return highlight.label;
  const color = normalizeLabelColor(legacyColorToLabelColor(highlight.color));
  return labels.find((item) => !item.archived && normalizeLabelColor(item.color) === color) || fallbackLabels.find((item) => item.color === color) || fallbackLabels[0];
}

async function readJsonResponse(response: Response, fallbackMessage: string) {
  const text = await response.text();
  if (!text) throw new Error(fallbackMessage);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(fallbackMessage);
  }
}

function responseError(value: unknown) {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : null;
}

function BookFilterSelect({ value, options, onValueChange, zh }: { value: string; options: BookFilterOption[]; onValueChange: (value: string) => void; zh: boolean }) {
  const currentLabel = options.find((option) => option.value === value)?.label || options[0]?.label || "";

  return (
    <Select.Root<string> value={value} onValueChange={(nextValue) => { if (nextValue) onValueChange(nextValue); }}>
      <Select.Trigger aria-label={zh ? "按书籍筛选" : "Filter by book"} title={currentLabel} className="flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--shelf-line)] bg-[#fffdf8]/75 px-4 text-left text-sm outline-none transition hover:bg-[#fffdf8] focus-visible:border-[var(--green)] focus-visible:ring-2 focus-visible:ring-[var(--green)]/10 data-[popup-open]:border-[var(--green)] data-[popup-open]:ring-2 data-[popup-open]:ring-[var(--green)]/10">
        <Select.Value className="min-w-0 flex-1 truncate">{currentLabel}</Select.Value>
        <Select.Icon className="shrink-0 text-[var(--ink-soft)] transition-transform data-[popup-open]:rotate-180"><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} align="start" alignItemWithTrigger={false} className="z-50 w-[var(--anchor-width)]">
          <Select.Popup className="max-h-[min(18rem,var(--available-height))] overflow-hidden rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8] p-1.5 text-sm text-[var(--ink)] shadow-[0_18px_45px_rgba(72,49,34,0.18)] outline-none">
            <Select.List className="max-h-[17rem] overflow-y-auto overscroll-contain py-0.5">
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className="flex cursor-default items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition data-[highlighted]:bg-[var(--green)]/10 data-[selected]:font-semibold data-[selected]:text-[var(--green)]">
                  <Select.ItemText className="min-w-0 flex-1 truncate">{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--green)] text-white"><Check size={12} strokeWidth={2.5} /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export default function HighlightsManager({ contentId }: { contentId?: string }) {
  const { locale } = useLocale();
  const zh = locale === "zh-CN";
  const router = useRouter();
  const [book, setBook] = useState<BookData | null>(null);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [labels, setLabels] = useState<ReadingLabel[]>(fallbackLabels);
  const [filter, setFilter] = useState("ALL");
  const [bookFilter, setBookFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<HighlightItem | null>(null);
  const undoTimer = useRef<number | null>(null);
  const pendingDelete = useRef<HighlightItem | null>(null);

  const activeLabels = useMemo(() => {
    const current = labels.filter((item) => !item.archived);
    return current.length ? current : fallbackLabels;
  }, [labels]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const labelResponse = await fetch("/api/highlight-labels");
      const labelData = await labelResponse.json().catch(() => []);
      const requests = [fetch(contentId ? `/api/highlights?contentId=${encodeURIComponent(contentId)}` : "/api/highlights")];
      if (contentId) requests.push(fetch(`/api/books/${contentId}`));
      const responses = await Promise.all(requests);
      const fallbackMessage = zh ? "服务暂时无法响应，请稍后重试" : "The service is temporarily unavailable. Please try again.";
      const values = await Promise.all(responses.map((response) => readJsonResponse(response, fallbackMessage)));
      if (!responses[0].ok) throw new Error(zh ? (responseError(values[0]) || "无法加载高亮") : "Unable to load highlights");
      if (contentId && !responses[1].ok) throw new Error(zh ? (responseError(values[1]) || "无法加载书籍") : "Unable to load book");
      if (!Array.isArray(values[0])) throw new Error(fallbackMessage);
      setLabels(labelResponse.ok && Array.isArray(labelData) ? labelData : fallbackLabels);
      const pendingId = pendingDelete.current?.id;
      setHighlights((values[0] as HighlightItem[]).filter((item) => item.id !== pendingId));
      setBook(contentId ? values[1] as BookData : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? "无法加载高亮" : "Unable to load highlights"));
    } finally {
      setLoading(false);
    }
  }, [contentId, zh]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => () => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    const item = pendingDelete.current;
    pendingDelete.current = null;
    if (item) void fetch(`/api/highlights?id=${encodeURIComponent(item.id)}`, { method: "DELETE", keepalive: true });
  }, []);

  const books = useMemo(() => Array.from(new Map(highlights.filter((item) => item.content).map((item) => [item.contentId, item.content!])).values()), [highlights]);
  const bookFilterOptions = useMemo<BookFilterOption[]>(() => [
    { value: "ALL", label: zh ? "全部书籍" : "All books" },
    ...books.map((item) => ({ value: item.id, label: item.title })),
  ], [books, zh]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return highlights.filter((highlight) => {
      const label = labelForHighlight(highlight, activeLabels);
      if (filter !== "ALL" && label.id !== filter) return false;
      if (bookFilter !== "ALL" && highlight.contentId !== bookFilter) return false;
      if (!normalized) return true;
      return `${highlight.quote} ${highlight.note || ""} ${highlight.section?.title || ""} ${highlight.content?.title || book?.title || ""} ${label.name}`.toLowerCase().includes(normalized);
    });
  }, [activeLabels, book?.title, bookFilter, filter, highlights, query]);

  const patchHighlight = async (id: string, data: { labelId?: string; note?: string | null }) => {
    setSavingId(id); setError(null);
    const response = await fetch("/api/highlights", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...data }) });
    const result = await response.json(); setSavingId(null);
    if (!response.ok) return setError(zh ? (result.error || "高亮更新失败") : "Unable to update highlight");
    setHighlights((current) => current.map((item) => item.id === id ? { ...item, ...result } : item));
  };

  const persistHighlightDelete = async (item: HighlightItem) => {
    const response = await fetch(`/api/highlights?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (response.ok) return;
    setHighlights((current) => restoreDeletedHighlight(current, item));
    setError(zh ? ((await response.json().catch(() => null))?.error || "删除失败，高亮已恢复") : "Unable to delete highlight. The highlight was restored.");
  };

  const deleteHighlight = (item: HighlightItem) => {
    setError(null);
    const previousPending = pendingDelete.current;
    if (previousPending) {
      pendingDelete.current = null;
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      void persistHighlightDelete(previousPending);
    }

    setHighlights((current) => current.filter((highlight) => highlight.id !== item.id));
    setDeleted(item);
    pendingDelete.current = item;
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      if (pendingDelete.current?.id !== item.id) return;
      pendingDelete.current = null;
      setDeleted(null);
      void persistHighlightDelete(item);
    }, 7000);
  };

  const undoDelete = () => {
    if (!deleted) return;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
    pendingDelete.current = null;
    setHighlights((current) => restoreDeletedHighlight(current, deleted));
    setDeleted(null);
    setError(null);
  };

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin" /></div>;
  if (error && contentId && !book) return <div className="rounded-xl bg-red-50 p-6 text-red-700">{error}</div>;

  return <div className="mx-auto max-w-5xl">
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {contentId && <button onClick={() => router.push("/dashboard/ebook")} className="mt-1 rounded-lg border border-border p-2 hover:bg-muted" aria-label={zh ? "返回书库" : "Back to shelves"}><ArrowLeft size={18} /></button>}
        <div><p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--brass)]">MARGIN NOTES</p><h1 className="mt-2 font-display text-4xl font-semibold">{contentId ? book?.title : (zh ? "全部高亮笔记" : "All highlights")}</h1><p className="mt-2 text-sm text-[var(--ink-soft)]">{contentId ? `${book?.author || "Unknown author"} · ` : (zh ? "集中整理所有书籍中的" : "Across your shelves · ")}{highlights.length} {zh ? "条高亮" : "highlights"}</p></div>
      </div>
      {contentId && <Link href={`/dashboard/ebook/read/${contentId}`} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{zh ? "继续阅读" : "Continue reading"} <ExternalLink size={15} /></Link>}
    </header>

    <div className="mb-6 rounded-2xl border border-[var(--shelf-line)] bg-white/40 p-4 shadow-sm"><div className="flex flex-col gap-3">
      <div className={`grid gap-3 ${!contentId && books.length > 1 ? "md:grid-cols-[minmax(0,1fr)_minmax(13rem,17rem)]" : "grid-cols-1"}`}>
        <div className="flex h-11 min-w-0 items-center rounded-xl border border-[var(--shelf-line)] bg-[#fffdf8]/75 px-3 transition focus-within:border-[var(--green)] focus-within:ring-2 focus-within:ring-[var(--green)]/10"><Search size={16} className="shrink-0 text-[var(--ink-soft)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索高亮原文、备注、书名或章节" : "Search passages, notes, books, or sections"} className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-[var(--ink-soft)]/70" /></div>
        {!contentId && books.length > 1 && <BookFilterSelect value={bookFilter} options={bookFilterOptions} onValueChange={setBookFilter} zh={zh} />}
      </div>
      <div className="flex flex-wrap gap-2"><button onClick={() => setFilter("ALL")} className={`rounded-lg border px-3 py-2 text-xs font-medium ${filter === "ALL" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}>{zh ? "全部" : "All"} {highlights.length}</button>{activeLabels.map((item) => { const color = normalizeLabelColor(item.color); return <button key={item.id} onClick={() => setFilter(item.id)} className={`rounded-lg border px-3 py-2 text-xs font-medium ${filter === item.id ? labelButtonClasses[color] : "border-border hover:bg-muted"}`}>{item.name} {highlights.filter((highlight) => labelForHighlight(highlight, activeLabels).id === item.id).length}</button>; })}</div>
    </div></div>

    {error && <div className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center"><Highlighter className="mx-auto text-muted-foreground" size={36} /><p className="mt-3 font-medium">{highlights.length ? (zh ? "没有符合条件的高亮" : "No highlights match these filters") : (zh ? "还没有高亮" : "No highlights yet")}</p><p className="mt-1 text-sm text-muted-foreground">{zh ? "阅读时选择句子或段落并标记阅读标签，之后可以在这里整理和复习。" : "Select a sentence or passage while reading, then organize it with your reading labels."}</p></div> : <div className="space-y-4">{filtered.map((highlight) => {
      const readingLabel = labelForHighlight(highlight, activeLabels);
      const color = normalizeLabelColor(readingLabel.color);
      return <article key={highlight.id} className={`rounded-2xl border border-l-4 bg-card p-5 shadow-sm ${blockHighlightClasses[color]}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">{highlight.content?.title || book?.title}{(highlight.section?.title) ? ` · ${highlight.section.title}` : ""}</p><p className="mt-3 whitespace-pre-wrap font-serif text-lg leading-8 text-slate-800">{highlight.quote}</p></div><span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${labelButtonClasses[color]}`}>{readingLabel.name}</span></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]"><textarea value={highlight.note || ""} onChange={(event) => setHighlights((current) => current.map((item) => item.id === highlight.id ? { ...item, note: event.target.value.slice(0, 1000) } : item))} rows={2} placeholder={zh ? "给这条高亮添加学习备注……" : "Add a learning note…"} className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary" /><button disabled={savingId === highlight.id} onClick={() => patchHighlight(highlight.id, { note: highlight.note || null })} className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">{savingId === highlight.id ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}{zh ? "保存备注" : "Save note"}</button></div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><div className="flex flex-wrap gap-2">{activeLabels.map((option) => { const optionColor = normalizeLabelColor(option.color); return <button key={option.id} disabled={savingId === highlight.id} onClick={() => patchHighlight(highlight.id, { labelId: option.id })} className={`rounded-lg border px-2.5 py-1.5 text-xs ${readingLabel.id === option.id ? labelButtonClasses[optionColor] : "border-border bg-background hover:bg-muted"}`}>{option.name}</button>; })}</div><div className="flex items-center gap-2"><button disabled={savingId === highlight.id} onClick={() => deleteHighlight(highlight)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={14} />{zh ? "删除" : "Delete"}</button>{highlight.sectionId && <Link href={`/dashboard/ebook/read/${highlight.contentId}?sectionId=${encodeURIComponent(highlight.sectionId)}&highlightId=${encodeURIComponent(highlight.id)}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted">{zh ? "跳回原文" : "Return to passage"} <ExternalLink size={13} /></Link>}</div></div>
      </article>;
    })}</div>}
    {deleted && <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl"><span>{zh ? "高亮已删除" : "Highlight deleted"}</span><button disabled={savingId !== null} onClick={undoDelete} className="inline-flex items-center gap-1.5 font-semibold text-yellow-300 disabled:opacity-50"><RotateCcw size={14} />{zh ? "撤销" : "Undo"}</button></div>}
  </div>;
}

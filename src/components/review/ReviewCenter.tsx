"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { BookOpenCheck, ExternalLink, Highlighter, Loader2, RotateCcw } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { labelButtonClasses, legacyColorToLabelColor, normalizeLabelColor } from "@/lib/highlight-labels";

interface WordReview {
  id: string;
  translation?: string | null;
  mastery: number;
  status: string;
  entry: { lemma: string; phonetic?: string | null; definition?: string | null };
  occurrences: Array<{ context?: string | null; content: { title: string } }>;
}

type WordFilter = "ALL" | "WORD" | "PHRASE";

interface ReadingLabel { id: string; name: string; color: string; archived: boolean; slotKey?: string | null; reviewEnabled?: boolean | null }
interface HighlightReview {
  id: string;
  contentId: string;
  sectionId?: string | null;
  quote: string;
  note?: string | null;
  color: string;
  label?: ReadingLabel | null;
  content: { id: string; title: string };
  section?: { id: string; title: string } | null;
}

type QueueType = "WORDS" | "HIGHLIGHTS";
const ratings = [
  { value: "AGAIN", zh: "忘记", en: "Again", style: "bg-red-100 text-red-700" },
  { value: "HARD", zh: "困难", en: "Hard", style: "bg-orange-100 text-orange-700" },
  { value: "GOOD", zh: "一般", en: "Good", style: "bg-blue-100 text-blue-700" },
  { value: "EASY", zh: "掌握", en: "Easy", style: "bg-green-100 text-green-700" },
] as const;

function highlightLabel(item: HighlightReview) {
  if (item.label && !item.label.archived) return item.label;
  return { id: `legacy-${item.color}`, name: item.color === "RED" ? "重点解决" : item.color === "GREEN" ? "已经掌握" : "需要复习", color: legacyColorToLabelColor(item.color), archived: false };
}

export default function ReviewCenter() {
  const { locale } = useLocale();
  const zh = locale === "zh-CN";
  const [words, setWords] = useState<WordReview[]>([]);
  const [highlights, setHighlights] = useState<HighlightReview[]>([]);
  const [queue, setQueue] = useState<QueueType>("WORDS");
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wordFilter, setWordFilter] = useState<WordFilter>("ALL");
  const filteredWords = useMemo(() => words.filter((item) => wordFilter === "ALL" || (item.entry.lemma.includes(" ") ? "PHRASE" : "WORD") === wordFilter), [wordFilter, words]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wordResponse, highlightResponse] = await Promise.all([fetch("/api/reviews"), fetch("/api/highlight-reviews")]);
      const [wordData, highlightData] = await Promise.all([wordResponse.json(), highlightResponse.json()]);
      if (!wordResponse.ok || !highlightResponse.ok) throw new Error(wordData.error || highlightData.error || (zh ? "无法加载今日复习" : "Unable to load today's review"));
      setWords(wordData);
      setHighlights(highlightData);
      setQueue(wordData.length ? "WORDS" : "HIGHLIGHTS");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? "无法加载今日复习" : "Unable to load today's review"));
    } finally {
      setLoading(false);
      setRevealed(false);
    }
  }, [zh]);

  useEffect(() => { void load(); }, [load]);

  const effectiveQueue = useMemo<QueueType>(() => (
    queue === "WORDS" && !filteredWords.length && highlights.length
      ? "HIGHLIGHTS"
      : queue === "HIGHLIGHTS" && !highlights.length && filteredWords.length
        ? "WORDS"
        : queue
  ), [filteredWords.length, highlights.length, queue]);
  const currentWord = effectiveQueue === "WORDS" ? filteredWords[0] : undefined;
  const currentHighlight = effectiveQueue === "HIGHLIGHTS" ? highlights[0] : undefined;
  const total = filteredWords.length + highlights.length;

  const submit = async (rating: string) => {
    const item = currentWord || currentHighlight;
    if (!item || submitting) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch(currentWord ? "/api/reviews" : "/api/highlight-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, rating }),
    });
    const result = await response.json().catch(() => null);
    setSubmitting(false);
    if (!response.ok) return setError(result?.error || (zh ? "复习提交失败" : "Unable to submit review"));
    if (currentWord) setWords((items) => items.filter((item) => item.id !== currentWord.id));
    else setHighlights((items) => items.slice(1));
    setRevealed(false);
  };

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-[var(--green)]" /></div>;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-8 border-b border-[var(--shelf-line)] pb-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--brass)]">SPACED REVIEW</p>
        <h1 className="mt-3 font-display text-4xl font-semibold">{zh ? "今日复习" : "Today's review"}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{zh ? "重新翻开值得记住的单词和句子，让它们慢慢成为自己的语言。" : "Return to words and sentences worth keeping until they become part of your own English."}</p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <button type="button" onClick={() => { setQueue("WORDS"); setRevealed(false); }} className={`rounded-2xl border p-4 text-left transition ${effectiveQueue === "WORDS" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/40"}`}><p className="text-xs opacity-70">{zh ? "到期词汇" : "Due words"}</p><p className="mt-1 font-display text-3xl font-semibold">{words.length}</p></button>
        <button type="button" onClick={() => { setQueue("HIGHLIGHTS"); setRevealed(false); }} className={`rounded-2xl border p-4 text-left transition ${effectiveQueue === "HIGHLIGHTS" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/40"}`}><p className="text-xs opacity-70">{zh ? "到期高亮" : "Due highlights"}</p><p className="mt-1 font-display text-3xl font-semibold">{highlights.length}</p></button>
      </div>
      {effectiveQueue === "WORDS" && <div className="mb-5 flex gap-2" aria-label={zh ? "复习词汇类型" : "Review vocabulary type"}>{(["ALL", "WORD", "PHRASE"] as const).map((value) => <button key={value} type="button" onClick={() => { setWordFilter(value); setRevealed(false); }} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${wordFilter === value ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/40"}`}>{value === "ALL" ? (zh ? "全部" : "All") : value === "WORD" ? (zh ? "单词" : "Words") : (zh ? "词组" : "Phrases")}</button>)}</div>}

      {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {!total ? (
        <div className="rounded-[1.75rem] border border-[var(--shelf-line)] bg-white/40 py-20 text-center">
          <BookOpenCheck className="mx-auto text-[var(--green)]" size={44} />
          <h2 className="mt-4 font-display text-2xl font-semibold">{zh ? "今天的复习完成了" : "Today's review is complete"}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--ink-soft)]">{zh ? "继续阅读、保存生词或添加阅读标记，阅览室会安排下一次重逢。" : "Keep reading, saving words, and marking passages. The reading room will schedule the next return."}</p>
        </div>
      ) : currentWord ? (
        <div>
          <ReviewMeta total={total} right={`${zh ? "掌握度" : "Mastery"} ${Math.round(currentWord.mastery)}%`} />
          <div className="min-h-80 rounded-[1.75rem] border border-[var(--shelf-line)] bg-[#fffdf8]/75 p-8 text-center shadow-sm">
            <h2 className="font-display text-5xl font-semibold capitalize">{currentWord.entry.lemma}</h2>
            {currentWord.entry.phonetic && <p className="mt-2 text-[var(--ink-soft)]">{currentWord.entry.phonetic}</p>}
            {revealed ? <div className="mt-8 space-y-4">{currentWord.translation && <div className="rounded-xl bg-[var(--muted)] p-4"><p className="text-xs font-semibold text-[var(--ink-soft)]">{zh ? "中文对应词" : "Chinese equivalents"}</p><p className="mt-2 text-lg leading-8">{currentWord.translation}</p></div>}<p className="text-lg leading-8">{currentWord.entry.definition || (zh ? "暂无英文释义" : "No English definition available")}</p>{currentWord.occurrences[0]?.context && <blockquote className="rounded-xl bg-[var(--muted)] p-4 text-left font-reading text-sm italic leading-6">{currentWord.occurrences[0].context}<footer className="mt-2 text-xs not-italic text-[var(--ink-soft)]">— {currentWord.occurrences[0].content.title}</footer></blockquote>}</div> : <RevealButton label={zh ? "显示答案" : "Reveal answer"} onClick={() => setRevealed(true)} />}
          </div>
          {revealed && <RatingButtons disabled={submitting} zh={zh} onSubmit={submit} />}
        </div>
      ) : currentHighlight ? (
        <div>
          {(() => { const itemLabel = highlightLabel(currentHighlight); const color = normalizeLabelColor(itemLabel.color); return <><ReviewMeta total={total} right={<span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${labelButtonClasses[color]}`}>{itemLabel.name}</span>} />
          <div className={`min-h-80 rounded-[1.75rem] border border-[var(--shelf-line)] bg-[#fffdf8]/75 p-8 shadow-sm ${labelButtonClasses[color]}`}>
            <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]"><Highlighter size={16} /><span>{currentHighlight.content.title}{currentHighlight.section?.title ? ` · ${currentHighlight.section.title}` : ""}</span></div>
            <blockquote className="mt-6 whitespace-pre-wrap font-reading text-xl leading-9 text-[#2c302b]">{currentHighlight.quote}</blockquote>
            {revealed ? <div className="mt-7 rounded-xl bg-[var(--muted)] p-5"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">{zh ? "你的笔记" : "Your note"}</p><p className="mt-2 whitespace-pre-wrap leading-7">{currentHighlight.note || (zh ? "这条高亮没有笔记，请根据自己的理解判断是否已经掌握。" : "This highlight has no note. Judge it from your own understanding.")}</p>{currentHighlight.sectionId && <Link href={`/dashboard/ebook/read/${currentHighlight.contentId}?sectionId=${encodeURIComponent(currentHighlight.sectionId)}&highlightId=${encodeURIComponent(currentHighlight.id)}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--green)]">{zh ? "返回原文" : "Return to passage"}<ExternalLink size={14} /></Link>}</div> : <RevealButton label={zh ? "查看笔记并自评" : "Reveal note and rate"} onClick={() => setRevealed(true)} />}
          </div>
          {revealed && <RatingButtons disabled={submitting} zh={zh} onSubmit={submit} />}</>; })()}
        </div>
      ) : null}
    </div>
  );
}

function ReviewMeta({ total, right }: { total: number; right: ReactNode }) {
  return <div className="mb-4 flex justify-between text-sm text-[var(--ink-soft)]"><span>{total} remaining</span><span>{right}</span></div>;
}

function RevealButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="mt-14 inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-semibold text-[var(--paper)] hover:bg-[var(--green)]"><RotateCcw size={16} />{label}</button>;
}

function RatingButtons({ disabled, zh, onSubmit }: { disabled: boolean; zh: boolean; onSubmit: (rating: string) => void }) {
  return <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{ratings.map((rating) => <button key={rating.value} disabled={disabled} onClick={() => onSubmit(rating.value)} className={`rounded-xl px-3 py-3 text-sm font-semibold disabled:opacity-50 ${rating.style}`}>{zh ? rating.zh : rating.en}</button>)}</div>;
}

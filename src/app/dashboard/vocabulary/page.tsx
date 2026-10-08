"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Repeat2, Trash2 } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";

interface SavedWord {
  id: string;
  meaning?: string | null;
  translation?: string | null;
  status: string;
  mastery: number;
  nextReview: string;
  entry: { lemma: string; entryType?: "WORD" | "PHRASE" | null; phonetic?: string | null; definition?: string | null; dictionaryProvider?: string | null; dictionarySourceUrl?: string | null; dictionaryLicenseName?: string | null; dictionaryLicenseUrl?: string | null };
  occurrences: Array<{
    context?: string | null;
    sourceType: string;
    parentLemma?: string | null;
    content: { title: string };
    section?: { title: string } | null;
  }>;
}
type EntryFilter = "ALL" | "WORD" | "PHRASE";

export default function VocabularyPage() {
  const { locale } = useLocale();
  const zh = locale === "zh-CN";
  const [items, setItems] = useState<SavedWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EntryFilter>("ALL");
  const visibleItems = useMemo(() => items.filter((item) => filter === "ALL" || (item.entry.entryType || (item.entry.lemma.includes(" ") ? "PHRASE" : "WORD")) === filter), [filter, items]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/vocabulary/saved");
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(data)) throw new Error(zh ? "生词本暂时无法加载，请稍后重试" : "Unable to load vocabulary. Please try again.");
      setItems(data as SavedWord[]);
    } catch {
      setError(zh ? "生词本暂时无法加载，请稍后重试" : "Unable to load vocabulary. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const remove = async (id: string) => {
    const response = await fetch(`/api/vocabulary/saved?id=${id}`, { method: "DELETE" });
    if (response.ok) setItems((current) => current.filter((item) => item.id !== id));
  };

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-7 flex items-end justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--brass)]">VOCABULARY LEDGER</p><h1 className="mt-2 font-display text-4xl font-semibold">{zh ? "我的生词本" : "My vocabulary"}</h1><p className="mt-2 text-sm text-[var(--ink-soft)]">{zh ? "每个单词都保留它在书中或词典释义里的来源，并进入间隔复习。" : "Every word keeps the passage where you found it and returns through spaced review."}</p></div>
        <Link href="/dashboard/review" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"><Repeat2 size={16} />{zh ? "开始今日复习" : "Start today's review"}</Link>
      </div>

      {error && <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" onClick={() => void loadItems()} className="ml-2 underline">{zh ? "重试" : "Retry"}</button></div>}
      <div className="mb-4 flex gap-2" aria-label={zh ? "词汇类型" : "Vocabulary type"}>{(["ALL", "WORD", "PHRASE"] as const).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${filter === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>{value === "ALL" ? (zh ? "全部" : "All") : value === "WORD" ? (zh ? "单词" : "Words") : (zh ? "词组" : "Phrases")}</button>)}</div>
      {!error && !items.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center"><BookOpen className="mx-auto mb-3 text-muted-foreground" /><p className="font-medium">{zh ? "生词本还是空的" : "Your vocabulary ledger is empty"}</p><p className="mt-1 text-sm text-muted-foreground">{zh ? "阅读时选中英文单词，再点击“加入生词本”。" : "Select a word while reading, then add it to your vocabulary."}</p><Link href="/dashboard/ebook" className="mt-5 inline-block text-sm font-medium text-primary">{zh ? "去书架开始阅读 →" : "Choose a book →"}</Link></div>
      ) : !error && !visibleItems.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">{zh ? "此分类暂时没有词条" : "No entries in this category yet"}</div>
      ) : !error ? (
        <div className="grid gap-4 md:grid-cols-2">
          {visibleItems.map((item) => {
            const occurrence = item.occurrences[0];
            const sourceLabel = occurrence?.sourceType === "DICTIONARY_DEFINITION" && occurrence.parentLemma
              ? `${zh ? "在" : "Found in the definition of"} “${occurrence.parentLemma}”${zh ? " 的释义中发现" : ""}`
              : occurrence ? `${occurrence.content.title}${occurrence.section ? ` · ${occurrence.section.title}` : ""}` : (zh ? "手动收录" : "Added manually");
            return (
              <article key={item.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold capitalize">{item.entry.lemma}</h2>{item.entry.phonetic && <p className="text-xs text-muted-foreground">{item.entry.phonetic}</p>}</div><button onClick={() => remove(item.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600" title="删除"><Trash2 size={15} /></button></div>
                {item.translation && <div className="mt-3 rounded-lg bg-muted/50 p-3"><p className="text-[11px] font-semibold text-muted-foreground">{zh ? "中文对应词" : "Chinese equivalents"}</p><p className="mt-1 text-sm leading-6">{item.translation}</p></div>}
                <p className="mt-3 text-sm leading-6">{item.meaning || item.entry.definition || (zh ? "暂无英文释义" : "No English definition available")}</p>
                {occurrence?.context && <blockquote className="mt-3 border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">{occurrence.context}</blockquote>}
                {item.entry.dictionaryProvider && <p className="mt-3 text-[11px] text-muted-foreground">{zh ? "词典来源" : "Dictionary source"}: {item.entry.dictionarySourceUrl ? <a href={item.entry.dictionarySourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{item.entry.dictionaryProvider}</a> : item.entry.dictionaryProvider}{item.entry.dictionaryLicenseName && <> · {item.entry.dictionaryLicenseUrl ? <a href={item.entry.dictionaryLicenseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">{item.entry.dictionaryLicenseName}</a> : item.entry.dictionaryLicenseName}</>}</p>}
                <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span className="truncate">{sourceLabel}</span><span className="shrink-0">{Math.round(item.mastery)}% · {item.status}</span></div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

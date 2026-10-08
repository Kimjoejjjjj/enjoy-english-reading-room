"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpenText, Clock3, LibraryBig, Loader2, Plus, Upload } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { BookCover } from "@/components/reader/BookCover";
import BookImportModal from "@/components/reader/BookImportModal";
import { ReadingGoalDialog } from "@/components/reader/ReadingGoalDialog";
import { formatReadingMinutes } from "@/lib/reading-ledger-contract";

interface ContentSummary {
  id: string;
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  format: string;
}

interface ReadingItem {
  id: string;
  contentId: string;
  completionPercent: number;
  lastReadAt: string;
  status: string;
  content: ContentSummary;
  section?: { title: string } | null;
}

interface DashboardData {
  continueReading: ReadingItem[];
  recentCompleted: ReadingItem | null;
  monthMinutes: number;
  monthReadingDays: number;
}

interface BookItem extends ContentSummary {
  createdAt: string;
  progresses: Array<{ completionPercent: number; lastReadAt: string; status: string }>;
}

interface GoalBook {
  id: string;
  title: string;
  restart?: boolean;
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string) {
  const text = await response.text();
  if (!text) throw new Error(fallbackMessage);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

export default function ReadingRoomHome() {
  const { locale, t } = useLocale();
  const label = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [data, setData] = useState<DashboardData | null>(null);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [goalBook, setGoalBook] = useState<GoalBook | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHome = useCallback(async () => {
    setError(null);
    const [dashboardResponse, booksResponse] = await Promise.all([fetch("/api/dashboard"), fetch("/api/books")]);
    const fallbackMessage = t("common.error");
    const [dashboardValue, booksValue] = await Promise.all([
      readJsonResponse<DashboardData & { error?: string }>(dashboardResponse, fallbackMessage),
      readJsonResponse<BookItem[] & { error?: string }>(booksResponse, fallbackMessage),
    ]);
    if (!dashboardResponse.ok || !booksResponse.ok) throw new Error(dashboardValue.error || booksValue.error || fallbackMessage);
    setData(dashboardValue);
    setBooks(booksValue);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    // The async loader updates state only after its requests resolve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHome().catch((cause) => {
      setError(cause instanceof Error ? cause.message : t("common.error"));
      setLoading(false);
    });
  }, [loadHome, t]);

  if (loading) return <div className="flex min-h-[65vh] items-center justify-center gap-3 text-[var(--ink-soft)]"><Loader2 className="animate-spin" /><span>{t("common.loading")}</span></div>;
  if (error || !data) return <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">{error || t("common.error")}</div>;

  const current = data.continueReading[0] || null;
  const completed = current ? null : data.recentCompleted;
  const unread = !current && !completed ? books.find((book) => book.progresses.length === 0) || null : null;
  const featured = current?.content || completed?.content || unread;
  const progress = current?.completionPercent ?? completed?.completionPercent ?? 0;
  const state = current ? "CONTINUE" : completed ? "COMPLETED" : unread ? "UNREAD" : "EMPTY";
  const lastRead = current?.lastReadAt || completed?.lastReadAt;
  const lastReadLabel = lastRead ? new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(lastRead)) : null;

  if (state === "EMPTY") {
    return (
      <div className="flex min-h-[68vh] items-center justify-center pb-10">
        <section className="paper-grain w-full max-w-4xl rounded-[2rem] border border-[var(--shelf-line)] bg-[#fffdf8] px-6 py-14 text-center shadow-[0_24px_80px_rgba(77,54,38,0.12)] sm:px-12 sm:py-20">
          <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[var(--green)]/10 text-[var(--green)]"><BookOpenText size={36} strokeWidth={1.4} /></span>
          <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--brass)]">WELCOME TO THE READING ROOM</p>
          <h1 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">{label("欢迎来到你的英文阅读室", "Welcome to your English reading room")}</h1>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-[var(--ink-soft)]">{label("导入第一本真正想读的英文书，从查词、高亮和页边笔记开始安静地精读。", "Import the first English book you genuinely want to read, then begin with words, highlights, and margin notes.")}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--walnut)]">EPUB · PDF · TXT</p>
          <button type="button" onClick={() => setImportOpen(true)} className="mx-auto mt-9 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--ink)] px-7 text-sm font-semibold text-[var(--paper)] hover:bg-[var(--green)]"><Upload size={17} />{label("导入第一本书", "Import your first book")}</button>
        </section>
        <BookImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={loadHome} />
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-10">
      <header className="grid gap-7 border-b border-[var(--shelf-line)] pb-7 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:items-stretch">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-[var(--brass)]">YOUR READING TABLE</p>
          <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">{state === "CONTINUE" ? label("接着读下去", "Keep reading") : state === "COMPLETED" ? label("最近完成", "Recently completed") : label("第一本书已经准备好了", "Your first book is ready")}</h1>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:h-full">
          <section className="flex min-w-0 flex-col justify-between rounded-[1.35rem] border border-[var(--shelf-line)] bg-[#eee7da]/70 px-4 py-3 shadow-[0_10px_28px_rgba(77,54,38,0.055)] sm:px-5">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--ink-soft)]">{label("本月阅读总时长", "Reading time this month")}</p>
            <p className="mt-1 break-words font-display text-xl font-semibold leading-tight text-[var(--ink)] sm:text-2xl">{formatReadingMinutes(data.monthMinutes, locale)}</p>
          </section>
          <section className="flex min-w-0 flex-col justify-between rounded-[1.35rem] border border-[var(--shelf-line)] bg-[#eee7da]/70 px-4 py-3 shadow-[0_10px_28px_rgba(77,54,38,0.055)] sm:px-5">
            <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--ink-soft)]">{label("阅读天数", "Reading days")}</p>
            <p className="mt-1 font-display text-xl font-semibold leading-tight text-[var(--ink)] sm:text-2xl">{label(`${data.monthReadingDays} 天`, `${data.monthReadingDays} days`)}</p>
          </section>
        </div>
      </header>

      {featured && (
        <section className="relative overflow-hidden rounded-[2rem] border border-[var(--shelf-line)] bg-[#ebe3d5] p-6 shadow-[0_24px_70px_rgba(77,54,38,0.10)] sm:p-10 lg:p-14">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.72),transparent_26rem)]" />
          <div className="relative grid items-center gap-9 md:grid-cols-[220px_1fr] lg:gap-14">
            <BookCover title={featured.title} author={featured.author} coverUrl={featured.coverUrl} priority className="book-cover-depth mx-auto w-44 md:w-full" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--brass)]">{state === "CONTINUE" ? label("继续阅读", "CONTINUE READING") : state === "COMPLETED" ? label("最近完成", "RECENTLY COMPLETED") : label("尚未开始", "READY TO BEGIN")}</p>
              <h2 className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">{featured.title}</h2>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{featured.author || featured.format}</p>
              {(current?.section?.title || completed?.section?.title) && <p className="mt-5 flex items-center gap-2 text-sm font-medium"><BookOpenText size={16} className="text-[var(--green)]" />{current?.section?.title || completed?.section?.title}</p>}
              {lastReadLabel && <p className="mt-2 flex items-center gap-2 text-xs text-[var(--ink-soft)]"><Clock3 size={14} />{label("上次阅读日期", "Last read date")} · {lastReadLabel}</p>}
              <div className="mt-6 max-w-xl"><div className="h-1.5 overflow-hidden rounded-full bg-white/60"><div className="h-full rounded-full bg-[var(--green)]" style={{ width: `${Math.max(state === "UNREAD" ? 0 : 3, progress)}%` }} /></div><p className="mt-2 text-xs text-[var(--ink-soft)]">{Math.round(progress)}%</p></div>
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" onClick={() => setGoalBook({ id: featured.id, title: featured.title, restart: state === "COMPLETED" })} className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--ink)] px-6 text-sm font-semibold text-[var(--paper)] hover:bg-[var(--green)]"><BookOpenText size={16} />{state === "CONTINUE" ? label("继续阅读", "Continue reading") : state === "COMPLETED" ? label("重新阅读", "Read again") : label("开始阅读", "Start reading")}<ArrowRight size={15} /></button>
                <Link href="/dashboard/ebook" className="inline-flex h-11 items-center gap-2 rounded-full border border-[var(--shelf-line)] bg-white/45 px-5 text-sm font-semibold hover:bg-white"><LibraryBig size={16} />{label("前往书架", "Go to shelves")}</Link>
                <button type="button" onClick={() => setImportOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[var(--green)] hover:bg-white/45"><Plus size={16} />{label("导入", "Import")}</button>
              </div>
            </div>
          </div>
        </section>
      )}

      <BookImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={loadHome} />
      <ReadingGoalDialog bookId={goalBook?.id || null} bookTitle={goalBook?.title} restart={goalBook?.restart} onClose={() => setGoalBook(null)} />
    </div>
  );
}

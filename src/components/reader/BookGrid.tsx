"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { BookOpenText, Camera, Ellipsis, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { BookCover } from "@/components/reader/BookCover";
import { useLocale } from "@/components/i18n/LocaleProvider";

export interface GridBook {
  id: string;
  title: string;
  author?: string | null;
  format: string;
  source: string;
  coverUrl?: string | null;
  parserVersion?: number;
  progresses: Array<{ completionPercent: number; lastReadAt: string; sectionId?: string | null }>;
  createdAt: string;
}

export interface BookReparseWarning {
  bookId: string;
  message: string;
  canConfirm: boolean;
  contentFingerprint: string;
  protectedFingerprint: string;
  batchId: string;
  records: { progressCount: number; sectionProgressCount: number; highlightCount: number; occurrenceCount: number; eventCount: number; sessionCount: number; deltaCount: number };
  preview?: {
    oldPartCount: number;
    newPartCount: number;
    chapterCount: number;
    frontMatterCount: number;
    filteredTechnicalCount: number;
    outlineEntryCount: number;
    filteredTocPageCount: number;
    suspectedScannedPageCount: number;
    suspectedLayoutIssueCount: number;
    unmatchedHighlightCount: number;
    unmatchedOccurrenceCount: number;
    ambiguousProtectedSectionCount: number;
    activeSessionCount: number;
    oldDirectory?: Array<{ title: string; depth: number; targetOrderIndex?: number }>;
    newDirectory?: Array<{ title: string; depth: number; targetOrderIndex?: number }>;
  };
}

interface BookGridProps {
  books: GridBook[];
  coverUploadingId: string | null;
  reparsingId: string | null;
  reparseWarning: BookReparseWarning | null;
  onRead: (book: GridBook) => void;
  onEdit: (book: GridBook) => void;
  onReplaceCover: (bookId: string, file?: File) => void;
  onReparse: (bookId: string, confirmReset?: boolean) => void;
  onDelete: (bookId: string) => void;
  onDismissReparse: () => void;
}

function requiredParserVersion(book: GridBook) {
  return book.format === "PDF" ? 9 : book.format === "EPUB" ? 7 : 6;
}

export function BookGrid({
  books,
  coverUploadingId,
  reparsingId,
  reparseWarning,
  onRead,
  onEdit,
  onReplaceCover,
  onReparse,
  onDelete,
  onDismissReparse,
}: BookGridProps) {
  const { locale, t } = useLocale();
  const [openMenuBookId, setOpenMenuBookId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuBookId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuBookId(null);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <section aria-label={locale === "zh-CN" ? "书籍列表" : "Book list"}>
      <div className="grid grid-cols-2 items-start gap-x-5 gap-y-12 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {books.map((book) => {
          const progress = book.progresses[0]?.completionPercent || 0;
          const legacy = book.source === "UPLOAD" && (!book.parserVersion || book.parserVersion < requiredParserVersion(book));
          const menuOpen = openMenuBookId === book.id;

          return (
            <Fragment key={book.id}>
              <article className="group relative min-w-0">
                <div className="relative">
                  <button type="button" onClick={() => onRead(book)} className="block w-full text-left" aria-label={`${book.title} · ${progress ? t("shelf.continue") : t("shelf.start")}`}>
                    <BookCover title={book.title} author={book.author} coverUrl={book.coverUrl} aliceStyle={book.source === "SAMPLE"} className="book-cover-depth w-full" />
                  </button>

                  <div ref={menuOpen ? menuRef : undefined} className="absolute right-2 top-2 z-20">
                    <button
                      type="button"
                      onClick={() => setOpenMenuBookId(menuOpen ? null : book.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#fffdf8]/90 text-[var(--ink)] shadow-md backdrop-blur hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]"
                      aria-label={locale === "zh-CN" ? `${book.title}的书籍设置` : `Book settings for ${book.title}`}
                      aria-expanded={menuOpen}
                      aria-controls={`book-menu-${book.id}`}
                    >
                      <Ellipsis size={17} />
                    </button>

                    {menuOpen && (
                      <div id={`book-menu-${book.id}`} className="absolute right-0 top-10 w-52 overflow-hidden rounded-xl border border-[var(--shelf-line)] bg-[#fffdf8] p-1.5 text-xs shadow-2xl">
                        <button type="button" onClick={() => { setOpenMenuBookId(null); onEdit(book); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--muted)]"><Pencil size={14} />{locale === "zh-CN" ? "编辑书籍信息" : "Edit book details"}</button>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-[var(--muted)]">
                          {coverUploadingId === book.id ? <Loader2 className="animate-spin" size={14} /> : <Camera size={14} />}
                          {t("shelf.cover")}
                          <input className="hidden" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={coverUploadingId === book.id} onChange={(event) => { setOpenMenuBookId(null); onReplaceCover(book.id, event.target.files?.[0]); }} />
                        </label>
                        {book.source === "UPLOAD" && <button type="button" disabled={reparsingId === book.id} onClick={() => { setOpenMenuBookId(null); onReparse(book.id); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--muted)] disabled:opacity-50">{reparsingId === book.id ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}{locale === "zh-CN" ? "优化目录与分页" : "Optimize contents and pages"}</button>}
                        <button type="button" onClick={() => { setOpenMenuBookId(null); onDelete(book.id); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-red-700 hover:bg-red-50"><Trash2 size={14} />{t("shelf.delete")}</button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--brass)]">{book.format}</p>
                  <h2 className="mt-1.5 min-h-10 line-clamp-2 text-sm font-semibold leading-5">{book.title}</h2>
                  <p className="mt-1 truncate text-xs text-[var(--ink-soft)]">{book.author || "Unknown author"}</p>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/60" role="progressbar" aria-label={`${book.title} · ${t("shelf.progress")}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div className="h-full rounded-full bg-[var(--green)]" style={{ width: `${progress}%` }} /></div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px] text-[var(--ink-soft)]"><span>{t("shelf.progress")}</span><span>{Math.round(progress)}%</span></div>
                </div>

                <button type="button" onClick={() => onRead(book)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-[var(--paper)] hover:bg-[var(--green)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]"><BookOpenText size={13} />{progress ? t("shelf.continue") : t("shelf.start")}</button>

                {legacy && <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] leading-4 text-amber-800">{locale === "zh-CN" ? "旧版分页可能出现超长学习页，请在书籍设置中重新分页。" : "Legacy pagination may create very long learning pages. Reparse from book settings."}</p>}
              </article>

              {reparseWarning?.bookId === book.id && (
                <div className="col-span-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 shadow-lg sm:col-span-3 md:col-span-4 lg:col-span-5 xl:col-span-6">
                  <p>{reparseWarning.message}</p>
                  {reparseWarning.preview && <div className="mt-3 space-y-1 rounded-lg bg-white/55 p-3">
                    <p className="font-semibold">{locale === "zh-CN" ? "阅读页" : "Reading pages"}: {reparseWarning.preview.oldPartCount} → {reparseWarning.preview.newPartCount}</p>
                    <p>{locale === "zh-CN" ? "识别章节" : "Chapters"}: {reparseWarning.preview.chapterCount} · {locale === "zh-CN" ? "书前内容" : "Front matter"}: {reparseWarning.preview.frontMatterCount}</p>
                    <p>{locale === "zh-CN" ? "过滤技术页" : "Technical pages removed"}: {reparseWarning.preview.filteredTechnicalCount}</p>
                    {book.format === "PDF" && <>
                      <p>{locale === "zh-CN" ? "PDF 书签" : "PDF bookmarks"}: {reparseWarning.preview.outlineEntryCount} · {locale === "zh-CN" ? "过滤目录页" : "TOC pages removed"}: {reparseWarning.preview.filteredTocPageCount}</p>
                      <p>{locale === "zh-CN" ? "疑似扫描页" : "Possible scanned pages"}: {reparseWarning.preview.suspectedScannedPageCount} · {locale === "zh-CN" ? "疑似复杂排版页" : "Possible layout issues"}: {reparseWarning.preview.suspectedLayoutIssueCount}</p>
                    </>}
                    {reparseWarning.preview.oldDirectory?.length && reparseWarning.preview.newDirectory?.length ? <details className="rounded-md border border-amber-200 bg-amber-50/50 p-2"><summary className="cursor-pointer font-semibold">{locale === "zh-CN" ? "对比新旧目录层级" : "Compare directory hierarchy"}</summary><div className="mt-2 grid gap-2 sm:grid-cols-2"><div><p className="font-semibold">{locale === "zh-CN" ? "当前" : "Current"}</p><div className="mt-1 space-y-0.5">{reparseWarning.preview.oldDirectory.slice(0, 16).map((entry, index) => <p key={`old-${index}`} className="line-clamp-1" style={{ paddingLeft: `${Math.min(3, entry.depth) * 12}px` }}>{entry.depth > 0 ? "↳ " : ""}{entry.title}</p>)}</div></div><div><p className="font-semibold">{locale === "zh-CN" ? "优化后" : "Optimized"}</p><div className="mt-1 space-y-0.5">{reparseWarning.preview.newDirectory.slice(0, 16).map((entry, index) => <p key={`new-${index}`} className="line-clamp-1" style={{ paddingLeft: `${Math.min(3, entry.depth) * 12}px` }}>{entry.depth > 0 ? "↳ " : ""}{entry.title}</p>)}</div></div></div></details> : null}
                    {(reparseWarning.preview.unmatchedHighlightCount > 0 || reparseWarning.preview.unmatchedOccurrenceCount > 0) && <p className="font-semibold text-red-700">{locale === "zh-CN" ? "存在无法安全迁移的记录，本次不会覆盖旧书。" : "Some records cannot be migrated safely; the old book will remain unchanged."}</p>}
                  </div>}
                  <p className="mt-2">Highlights: {reparseWarning.records.highlightCount} · Notes/time: {reparseWarning.records.sectionProgressCount} · Vocabulary sources: {reparseWarning.records.occurrenceCount}</p>
                  <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={onDismissReparse} className="rounded border border-amber-300 px-3 py-1.5">{locale === "zh-CN" ? "取消" : "Cancel"}</button><button type="button" disabled={!reparseWarning.canConfirm} onClick={() => onReparse(book.id, true)} className="rounded bg-amber-800 px-3 py-1.5 text-white disabled:cursor-not-allowed disabled:opacity-40">{locale === "zh-CN" ? "确认优化" : "Confirm optimization"}</button></div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}

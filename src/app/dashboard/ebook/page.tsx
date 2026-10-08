"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LibraryBig, Loader2, Plus, Upload, X } from "lucide-react";
import BookImportModal from "@/components/reader/BookImportModal";
import { BookGrid, type BookReparseWarning, type GridBook } from "@/components/reader/BookGrid";
import { ReadingGoalDialog } from "@/components/reader/ReadingGoalDialog";
import { useLocale } from "@/components/i18n/LocaleProvider";

interface BookItem extends GridBook {
  description?: string | null;
  status: string;
  sectionCount: number;
  sourceSectionCount?: number | null;
  wordCount: number;
  sectionProgresses: Array<{ status: string; lastStudiedAt: string }>;
}

interface BackfillResult {
  updated: Array<{ id: string; coverUrl: string }>;
}

type ReparseWarning = BookReparseWarning;

export default function BooksPage() {
  const { locale, t } = useLocale();
  const [books, setBooks] = useState<BookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [goalBook, setGoalBook] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverUploadingId, setCoverUploadingId] = useState<string | null>(null);
  const [reparsingId, setReparsingId] = useState<string | null>(null);
  const [reparseWarning, setReparseWarning] = useState<ReparseWarning | null>(null);
  const [editingBook, setEditingBook] = useState<{ id: string; title: string; author: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const backfillStarted = useRef(false);

  const loadBooks = useCallback(async () => {
    const response = await fetch("/api/books");
    const data = await response.json();
    if (response.ok) setBooks(data);
    else setError(data.error || t("common.error"));
    setLoading(false);
  }, [t]);

  // The async loader updates state only after its request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadBooks(); }, [loadBooks]);

  useEffect(() => {
    if (loading || backfillStarted.current || !books.some((book) => !book.coverUrl && book.source !== "SAMPLE")) return;
    backfillStarted.current = true;
    fetch("/api/books/covers/backfill", { method: "POST" })
      .then(async (response) => response.ok ? response.json() as Promise<BackfillResult> : null)
      .then((result) => {
        if (!result?.updated.length) return;
        const covers = new Map(result.updated.map((item) => [item.id, item.coverUrl]));
        setBooks((current) => current.map((book) => covers.has(book.id) ? { ...book, coverUrl: covers.get(book.id) } : book));
      })
      .catch(() => undefined);
  }, [books, loading]);

  const removeBook = async (id: string) => {
    if (!window.confirm(t("shelf.deleteConfirm"))) return;
    const response = await fetch(`/api/books/${id}`, { method: "DELETE" });
    if (response.ok) void loadBooks();
    else setError(t("common.error"));
  };

  const replaceCover = async (bookId: string, file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError(locale === "zh-CN" ? "自定义封面不能超过 10MB" : "Custom covers must be under 10MB.");
      return;
    }
    setCoverUploadingId(bookId);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/books/${bookId}/cover`, { method: "PUT", body: form });
    const data = await response.json();
    if (response.ok) setBooks((current) => current.map((book) => book.id === bookId ? { ...book, coverUrl: data.coverUrl } : book));
    else setError(data.error || t("common.error"));
    setCoverUploadingId(null);
  };

  const reparseBook = async (bookId: string, confirmReset = false) => {
    setReparsingId(bookId);
    setError(null);
    const response = await fetch(`/api/books/${bookId}/reparse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmReset && reparseWarning?.bookId === bookId ? { confirmReset, batchId: reparseWarning.batchId, contentFingerprint: reparseWarning.contentFingerprint, protectedFingerprint: reparseWarning.protectedFingerprint } : { confirmReset }),
    });
    const data = await response.json();
    if (response.status === 409 && data.requiresConfirmation) {
      setReparseWarning({ bookId, message: data.error, canConfirm: data.canConfirm !== false, records: data.learningRecords, preview: data.preview, contentFingerprint: data.contentFingerprint, protectedFingerprint: data.protectedFingerprint, batchId: crypto.randomUUID() });
    } else if (response.ok) {
      setReparseWarning(null);
      await loadBooks();
    } else {
      setError(data.error || t("common.error"));
    }
    setReparsingId(null);
  };

  const saveBookDetails = async () => {
    if (!editingBook?.title.trim()) return;
    setEditSaving(true);
    setError(null);
    const response = await fetch(`/api/books/${editingBook.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editingBook.title, author: editingBook.author }),
    });
    const data = await response.json();
    setEditSaving(false);
    if (!response.ok) {
      setError(data.error || t("common.error"));
      return;
    }
    setBooks((current) => current.map((book) => book.id === editingBook.id ? { ...book, title: data.title, author: data.author } : book));
    setEditingBook(null);
  };

  const sortedBooks = [...books].sort((left, right) => {
      const leftRead = left.progresses[0]?.lastReadAt ? new Date(left.progresses[0].lastReadAt).getTime() : 0;
      const rightRead = right.progresses[0]?.lastReadAt ? new Date(right.progresses[0].lastReadAt).getTime() : 0;
      return rightRead - leftRead || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });

  return (
    <div className="pb-8">
      <header className="mb-10 flex items-end justify-between gap-6 border-b border-[var(--shelf-line)] pb-8">
        <div>
          <p className="text-[10px] font-bold tracking-[0.32em] text-[var(--brass)]">{t("shelf.eyebrow")}</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-0.025em] sm:text-5xl">{t("shelf.title")}</h1>
        </div>
        <button type="button" onClick={() => setImportOpen(true)} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper)] hover:bg-[var(--green)]"><Plus size={16} />{locale === "zh-CN" ? "导入" : "Import"}</button>
      </header>

      {error && <div className="mb-6 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div>}

      {loading ? (
        <div className="flex min-h-96 items-center justify-center gap-3 text-[var(--ink-soft)]"><Loader2 className="animate-spin" /><span>{t("common.loading")}</span></div>
      ) : sortedBooks.length === 0 ? (
        <button type="button" onClick={() => setImportOpen(true)} className="flex min-h-96 w-full flex-col items-center justify-center rounded-[2rem] border border-dashed border-[var(--shelf-line)] bg-white/30 text-center transition hover:bg-white/45">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--green)]/10 text-[var(--green)]"><LibraryBig size={28} /></span>
          <h2 className="mt-5 font-display text-2xl font-semibold">{t("shelf.emptyTitle")}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-[var(--ink-soft)]">{t("shelf.emptyDescription")}</p>
          <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-[var(--paper)]"><Upload size={15} />{t("shelf.import")}</span>
        </button>
      ) : (
        <BookGrid
          books={sortedBooks}
          coverUploadingId={coverUploadingId}
          reparsingId={reparsingId}
          reparseWarning={reparseWarning}
          onRead={(book) => setGoalBook({ id: book.id, title: book.title })}
          onEdit={(book) => setEditingBook({ id: book.id, title: book.title, author: book.author || "" })}
          onReplaceCover={(bookId, file) => void replaceCover(bookId, file)}
          onReparse={(bookId, confirmReset) => void reparseBook(bookId, confirmReset)}
          onDelete={(bookId) => void removeBook(bookId)}
          onDismissReparse={() => setReparseWarning(null)}
        />
      )}

      <BookImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={loadBooks} />
      <ReadingGoalDialog bookId={goalBook?.id || null} bookTitle={goalBook?.title} onClose={() => setGoalBook(null)} />
      {editingBook && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-book-title">
          <div className="w-full max-w-md rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8] p-6 shadow-2xl">
            <div className="flex items-center justify-between"><h2 id="edit-book-title" className="font-display text-2xl font-semibold">{locale === "zh-CN" ? "编辑书籍信息" : "Edit book details"}</h2><button type="button" onClick={() => setEditingBook(null)} className="rounded-full p-2 hover:bg-muted" aria-label={t("common.close")}><X size={17} /></button></div>
            <div className="mt-6 space-y-4">
              <div><label htmlFor="book-title" className="mb-2 block text-xs font-semibold text-[var(--ink-soft)]">{locale === "zh-CN" ? "书名" : "Title"}</label><input id="book-title" value={editingBook.title} maxLength={200} onChange={(event) => setEditingBook({ ...editingBook, title: event.target.value })} className="h-11 w-full rounded-xl border border-[var(--shelf-line)] bg-white px-3 text-sm outline-none focus:border-[var(--green)]" /></div>
              <div><label htmlFor="book-author" className="mb-2 block text-xs font-semibold text-[var(--ink-soft)]">{locale === "zh-CN" ? "作者" : "Author"}</label><input id="book-author" value={editingBook.author} maxLength={200} onChange={(event) => setEditingBook({ ...editingBook, author: event.target.value })} className="h-11 w-full rounded-xl border border-[var(--shelf-line)] bg-white px-3 text-sm outline-none focus:border-[var(--green)]" /></div>
            </div>
            <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setEditingBook(null)} className="rounded-xl border border-[var(--shelf-line)] px-4 py-2 text-sm">{locale === "zh-CN" ? "取消" : "Cancel"}</button><button type="button" disabled={editSaving || !editingBook.title.trim()} onClick={() => void saveBookDetails()} className="rounded-xl bg-[var(--ink)] px-5 py-2 text-sm font-semibold text-[var(--paper)] disabled:opacity-50">{editSaving ? (locale === "zh-CN" ? "保存中…" : "Saving…") : (locale === "zh-CN" ? "保存" : "Save")}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

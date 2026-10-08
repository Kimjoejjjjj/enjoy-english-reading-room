"use client";

import { DragEvent, useRef, useState } from "react";
import { AlertTriangle, FileText, Loader2, Upload, X } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
}

type UploadPhase = "idle" | "uploading" | "parsing";
interface ParseReport {
  technicalSectionsRemoved: number;
  frontMatterSectionCount: number;
  chapterCount: number;
  outlineEntryCount: number;
  filteredTocPageCount: number;
  suspectedScannedPageCount: number;
  suspectedLayoutIssueCount: number;
}

interface ImportResponse {
  error?: string;
  format?: string;
  parseReport?: ParseReport;
}
interface TextPreview { title: string; author: string | null; wordCount: number; excerpt: string; previewToken: string; expiresAt: number }
const MAX_BOOK_SIZE = 200 * 1024 * 1024;
const LARGE_BOOK_SIZE = 100 * 1024 * 1024;
const allowedExtensions = new Set(["epub", "pdf", "txt"]);

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function BookImportModal({ open, onClose, onImported }: Props) {
  const { locale } = useLocale();
  const label = (zh: string, en: string) => locale === "zh-CN" ? zh : en;
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ParseReport | null>(null);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [textTitle, setTextTitle] = useState("");
  const [textAuthor, setTextAuthor] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [textPreview, setTextPreview] = useState<TextPreview | null>(null);
  const [textBusy, setTextBusy] = useState(false);
  const textImportKeyRef = useRef<string | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const chooseFile = (nextFile?: File | null) => {
    if (!nextFile) return;
    const extension = nextFile.name.split(".").pop()?.toLowerCase() || "";
    if (!allowedExtensions.has(extension)) {
      setError(label("仅支持 EPUB、PDF 和 TXT 文件", "Only EPUB, PDF, and TXT files are supported."));
      return;
    }
    if (nextFile.size <= 0 || nextFile.size > MAX_BOOK_SIZE) {
      setError(label("文件不能超过 200MB", "Files must be no larger than 200MB."));
      return;
    }
    setFile(nextFile);
    setError(null);
    setReport(null);
    setProgress(0);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 1) {
      setError(label("每次只能上传一本书", "Import one book at a time."));
      return;
    }
    chooseFile(event.dataTransfer.files[0]);
  };

  const resetAndClose = () => {
    if (phase === "uploading") xhrRef.current?.abort();
    if (phase === "parsing") return;
    setFile(null);
    setError(null);
    setReport(null);
    setProgress(0);
    setPhase("idle");
    setTextTitle("");
    setTextAuthor("");
    setPastedText("");
    setTextPreview(null);
    setTextBusy(false);
    textImportKeyRef.current = null;
    onClose();
  };

  const previewText = async () => {
    setTextBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/books/import/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: textTitle, author: textAuthor, text: pastedText }) });
      const data = await response.json().catch(() => ({})) as TextPreview & { error?: string };
      if (!response.ok) return setError(data.error || label("预览失败", "Preview failed"));
      setTextPreview(data);
      textImportKeyRef.current = crypto.randomUUID();
    } catch { setError(label("网络请求失败，请重试", "Network request failed. Please retry.")); }
    finally { setTextBusy(false); }
  };

  const confirmText = async () => {
    if (!textPreview) return;
    setTextBusy(true);
    setError(null);
    const idempotencyKey = textImportKeyRef.current || crypto.randomUUID();
    textImportKeyRef.current = idempotencyKey;
    try {
      const response = await fetch("/api/books/import/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "CONFIRM", title: textTitle, author: textAuthor, text: pastedText, previewToken: textPreview.previewToken, idempotencyKey }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) return setError(data.error || label("导入失败", "Import failed"));
      await onImported();
      resetAndClose();
    } catch { setError(label("网络请求失败，请重试", "Network request failed. Please retry.")); }
    finally { setTextBusy(false); }
  };

  const cancelUpload = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setPhase("idle");
    setProgress(0);
    setError(label("上传已取消，可以重新选择或再次上传。", "Upload cancelled. Choose a file or try again."));
  };

  const submit = async () => {
    if (!file || phase !== "idle") return;
    setPhase("uploading");
    setProgress(0);
    setError(null);

    const form = new FormData();
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/books/import");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.upload.onload = () => {
      setProgress(100);
      setPhase("parsing");
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      setPhase("idle");
      setError(label("网络连接中断，上传失败", "The connection was interrupted and the upload failed."));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
    };
    xhr.onload = async () => {
      xhrRef.current = null;
      let data: ImportResponse = {};
      try { data = JSON.parse(xhr.responseText || "{}"); } catch { data = {}; }
      if (xhr.status < 200 || xhr.status >= 300) {
        setPhase("idle");
        setError(locale === "zh-CN" ? (data.error || "导入失败") : "Import failed. The book may be unsupported or damaged.");
        return;
      }
      try {
        await onImported();
        setFile(null);
        setPhase("idle");
        setProgress(0);
        if (data.format === "PDF" && data.parseReport) setReport(data.parseReport);
        else onClose();
      } catch {
        setPhase("idle");
        setError(label("书籍已经导入，但书架刷新失败，请重试", "The book was imported, but the shelf could not refresh. Please try again."));
      }
    };
    xhr.send(form);
  };

  const busy = phase !== "idle" || textBusy;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{label("导入英文书籍", "Import an English book")}</h2>
            <p className="text-sm text-muted-foreground">{label("支持 EPUB、可提取文字的 PDF 和 TXT，最大 200MB。", "EPUB, text-based PDF, and TXT up to 200MB.")}</p>
          </div>
          <button disabled={busy} onClick={resetAndClose} className="rounded-lg p-2 hover:bg-muted disabled:opacity-30" aria-label={label("关闭", "Close")}><X size={18} /></button>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
          <button disabled={busy} onClick={() => { setMode("file"); setError(null); }} className={`rounded-md px-3 py-2 ${mode === "file" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>{label("上传文件", "Upload file")}</button>
          <button disabled={busy} onClick={() => { setMode("text"); setError(null); }} className={`rounded-md px-3 py-2 ${mode === "text" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>{label("粘贴文本", "Paste text")}</button>
        </div>

        {mode === "file" ? <><label
          onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex min-h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${busy ? "cursor-default opacity-80" : "cursor-pointer"} ${dragging ? "border-primary bg-primary/10" : "border-border bg-muted/30 hover:border-primary/50"}`}
        >
          {file ? <FileText className="mb-3 text-primary" size={38} /> : <Upload className="mb-3 text-muted-foreground" size={38} />}
          <span className="font-medium">{file ? file.name : label("拖拽书籍到这里，或点击选择", "Drop a book here, or click to choose")}</span>
          <span className="mt-1 text-xs text-muted-foreground">{file ? `${file.name.split(".").pop()?.toUpperCase()} · ${formatBytes(file.size)}` : "EPUB / PDF / TXT"}</span>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            disabled={busy}
            accept=".epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>

        {file && !busy && (
          <div className="mt-3 flex justify-end gap-3 text-xs">
            <button onClick={() => inputRef.current?.click()} className="text-primary hover:underline">{label("更换文件", "Choose another")}</button>
            <button onClick={() => { setFile(null); setError(null); }} className="text-muted-foreground hover:text-red-600">{label("移除", "Remove")}</button>
          </div>
        )}

        {file && file.size > LARGE_BOOK_SIZE && !busy && (
          <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={16} />{label("这个文件超过 100MB，解析可能需要数分钟，请保持页面打开。", "This file is over 100MB. Parsing may take several minutes; keep this page open.")}</div>
        )}

        {busy && (
          <div className="mt-4 rounded-xl border border-border p-4">
            <div className="mb-2 flex justify-between text-sm"><span>{phase === "uploading" ? label("正在上传", "Uploading") : label("上传完成，正在解析书籍与封面", "Upload complete. Parsing the book and cover")}</span><span>{phase === "uploading" ? `${progress}%` : label("请稍候", "Please wait")}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full bg-primary transition-all ${phase === "parsing" ? "animate-pulse" : ""}`} style={{ width: phase === "parsing" ? "100%" : `${progress}%` }} /></div>
          </div>
        )}

        {error && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {report && (
          <div className="mt-4 rounded-xl border border-[var(--shelf-line)] bg-[var(--muted)]/45 p-4 text-sm">
            <p className="font-semibold">{label("PDF 导入质量报告", "PDF import quality report")}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{label("书签", "Bookmarks")}: {report.outlineEntryCount}</span>
              <span>{label("章节", "Chapters")}: {report.chapterCount}</span>
              <span>{label("过滤目录/技术页", "TOC/technical pages removed")}: {report.filteredTocPageCount}/{report.technicalSectionsRemoved}</span>
              <span>{label("书籍信息页", "Front matter")}: {report.frontMatterSectionCount}</span>
              <span>{label("疑似扫描页", "Possible scanned pages")}: {report.suspectedScannedPageCount}</span>
              <span>{label("疑似复杂排版页", "Possible layout issues")}: {report.suspectedLayoutIssueCount}</span>
            </div>
            {(report.suspectedScannedPageCount > 0 || report.suspectedLayoutIssueCount > 0) && <p className="mt-3 text-xs leading-5 text-amber-800">{label("部分页面可能无法按正确阅读顺序提取。扫描页需要 OCR；多栏、表格、公式和脚注建议进入阅读器后抽查。", "Some pages may not extract in the correct reading order. Scanned pages need OCR; check multi-column pages, tables, formulas, and footnotes in the reader.")}</p>}
          </div>
        )}</> : <div className="space-y-3">
          <input disabled={busy || Boolean(textPreview)} value={textTitle} onChange={(event) => { setTextTitle(event.target.value); setTextPreview(null); }} placeholder={label("书名（必填）", "Title (required)")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <input disabled={busy || Boolean(textPreview)} value={textAuthor} onChange={(event) => { setTextAuthor(event.target.value); setTextPreview(null); }} placeholder={label("作者（可选）", "Author (optional)")} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <textarea disabled={busy || Boolean(textPreview)} value={pastedText} onChange={(event) => { setPastedText(event.target.value); setTextPreview(null); }} placeholder={label("在这里粘贴英文正文，最大 1MB", "Paste English text here, up to 1MB")} rows={10} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6" />
          {textPreview && <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm"><p className="font-semibold">{textPreview.title}</p><p className="mt-1 text-xs text-muted-foreground">{textPreview.author || label("未知作者", "Unknown author")} · {textPreview.wordCount} {label("词", "words")}</p><p className="mt-3 line-clamp-4 text-xs leading-5">{textPreview.excerpt}</p><button disabled={busy} onClick={() => { setTextPreview(null); textImportKeyRef.current = null; }} className="mt-3 text-xs text-primary hover:underline">{label("返回修改", "Edit")}</button></div>}
        </div>}
        <div className="mt-5 flex justify-end gap-3">
          {mode === "text" ? <>
            <button disabled={busy} onClick={resetAndClose} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40">{label("取消", "Cancel")}</button>
            <button disabled={busy || (!textPreview && (!textTitle.trim() || !pastedText.trim()))} onClick={textPreview ? confirmText : previewText} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{textBusy && <Loader2 className="animate-spin" size={15} />}{textPreview ? label("确认导入", "Confirm import") : label("预览", "Preview")}</button>
          </> : report ? (
            <button onClick={resetAndClose} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">{label("完成", "Done")}</button>
          ) : phase === "uploading" ? (
            <button onClick={cancelUpload} className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600">{label("取消上传", "Cancel upload")}</button>
          ) : (
            <button disabled={phase === "parsing"} onClick={resetAndClose} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40">{label("取消", "Cancel")}</button>
          )}
          {mode === "file" && !report && <button
            onClick={submit}
            disabled={!file || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy && <Loader2 className="animate-spin" size={15} />}
            {phase === "uploading" ? label(`上传 ${progress}%`, `Upload ${progress}%`) : phase === "parsing" ? label("正在解析…", "Parsing…") : label("导入并解析", "Import and parse")}
          </button>}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, CheckCircle2, Loader2, RotateCcw, X, XCircle } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";

interface Question { id: string; type: string; prompt: string; context?: string; options: string[] }
interface PracticeData { attemptId: string; mode: "BASIC" | "AI"; requestedMode?: "BASIC" | "AI"; degraded?: boolean; message?: string; cached?: boolean; remaining?: number; questions: Question[] }
interface PracticeResult { score: number; correctCount: number; total: number; wrongVocabularyCount: number; results: Array<{ id: string; correct: boolean; selectedIndex: number; correctIndex: number; explanation: string }> }

interface Props {
  open: boolean;
  contentId: string;
  sectionId: string;
  mode: "BASIC" | "AI";
  onClose: () => void;
}

export default function BasicPractice({ open, contentId, sectionId, mode, onClose }: Props) {
  const { locale } = useLocale();
  const label = useCallback((zh: string, en: string) => locale === "zh-CN" ? zh : en, [locale]);
  const [practice, setPractice] = useState<PracticeData | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiRequestRef = useRef<{ key: string; requestId: string } | null>(null);

  const generate = useCallback(async () => {
    const requestKey = `${contentId}:${sectionId}:${mode}`;
    if (mode === "AI" && aiRequestRef.current?.key === requestKey) return;
    const requestId = mode === "AI" ? crypto.randomUUID() : null;
    if (requestId) aiRequestRef.current = { key: requestKey, requestId };
    setLoading(true);
    setError(null);
    setPractice(null);
    setResult(null);
    setAnswers({});
    try {
      const response = await fetch(`/api/books/${contentId}/sections/${sectionId}/practice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, ...(requestId ? { requestId } : {}) }),
      });
      const data = await response.json();
      if (response.ok) setPractice(data);
      else if (typeof data.failureCode === "string" && data.failureCode.startsWith("QUOTA_")) setError(label("AI 暂不可用", "AI is temporarily unavailable"));
      else setError(data.error || label("暂时无法生成练习", "Could not prepare practice"));
    } catch {
      setError(label("暂时无法生成练习", "Could not prepare practice"));
    } finally {
      if (requestId && aiRequestRef.current?.requestId === requestId) aiRequestRef.current = null;
      setLoading(false);
    }
  }, [contentId, sectionId, mode, label]);

  // Opening the dialog is the trigger for fetching a fresh practice set.
  useEffect(() => { if (open) void generate(); }, [open, generate]);

  const submit = async () => {
    if (!practice || practice.questions.some((question) => answers[question.id] === undefined)) {
      setError(label("请先完成全部题目", "Please answer every question first"));
      return;
    }
    setSubmitting(true);
    setError(null);
    const response = await fetch(`/api/books/${contentId}/sections/${sectionId}/practice/submit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: practice.attemptId, answers: practice.questions.map((question) => answers[question.id]) }),
    });
    const data = await response.json();
    setSubmitting(false);
    if (response.ok) setResult(data); else setError(data.error || label("提交失败", "Could not submit answers"));
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div><div className="flex items-center gap-2 font-bold"><Brain className="text-primary" size={19} />{mode === "AI" ? label("AI 进阶练习", "AI practice") : label("本节基础练习", "Section practice")}</div><p className="mt-1 text-xs text-muted-foreground">{mode === "AI" ? label("AI 练习需由服务器启用；不可用时会明确提示。基础练习始终可单独使用。", "AI practice must be enabled by the server; unavailable requests show a clear message. Core practice remains available.") : label("根据本节原文、生词和高亮生成，不使用 AI 额度。", "Built from this section, saved words, and highlights without using AI credits.")}</p></div>
          <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={label("关闭练习", "Close practice")}><X size={18} /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="animate-spin" size={18} />{label("正在准备练习…", "Preparing practice…")}</div>}
          {error && <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}{practice?.message && <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{practice.message}</div>}{practice?.mode === "AI" && <div className="mb-4 rounded-xl bg-blue-50 p-3 text-xs text-blue-700">{label("AI 练习", "AI practice")}{practice.cached ? label(" · 已命中缓存，不消耗额度", " · cached, no credit used") : ""}{typeof practice.remaining === "number" ? label(` · 剩余 ${practice.remaining} 次`, ` · ${practice.remaining} left`) : ""}</div>}
          {practice && !result && <div className="space-y-6">{practice.questions.map((question, questionIndex) => <section key={question.id} className="rounded-xl border border-border p-4"><p className="text-xs font-semibold text-primary">{label(`第 ${questionIndex + 1} 题`, `Question ${questionIndex + 1}`)}</p><h3 className="mt-1 font-medium">{question.prompt}</h3>{question.context && <p className="mt-3 rounded-lg bg-muted/60 p-3 font-serif text-sm leading-6">{question.context}</p>}<div className="mt-3 grid gap-2">{question.options.map((option, optionIndex) => <button key={`${question.id}-${optionIndex}`} onClick={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${answers[question.id] === optionIndex ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-muted"}`}><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px]">{String.fromCharCode(65 + optionIndex)}</span>{option}</button>)}</div></section>)}</div>}

          {result && practice && <div><div className="rounded-2xl bg-green-50 p-6 text-center"><CheckCircle2 className="mx-auto text-green-600" size={40} /><h2 className="mt-2 text-2xl font-bold">{result.score} {label("分", "points")}</h2><p className="mt-1 text-sm text-green-800">{label(`答对 ${result.correctCount}/${result.total} 题`, `${result.correctCount}/${result.total} correct`)}</p>{result.wrongVocabularyCount > 0 && <p className="mt-2 text-xs text-green-700">{label(`${result.wrongVocabularyCount} 个答错生词已安排在次日复习。`, `${result.wrongVocabularyCount} missed words were scheduled for tomorrow.`)}</p>}</div><div className="mt-5 space-y-3">{practice.questions.map((question, index) => { const item = result.results[index]; return <div key={question.id} className={`rounded-xl border p-4 ${item.correct ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}`}><div className="flex items-center gap-2 text-sm font-medium">{item.correct ? <CheckCircle2 className="text-green-600" size={16} /> : <XCircle className="text-red-600" size={16} />}{label(`第 ${index + 1} 题`, `Question ${index + 1}`)} · {item.correct ? label("正确", "Correct") : label("需要复习", "Review")}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.explanation}</p>{!item.correct && <p className="mt-1 text-xs">{label("正确答案：", "Correct answer: ")}{question.options[item.correctIndex]}</p>}</div>; })}</div></div>}
        </div>

        <footer className="flex items-center justify-between border-t border-border px-6 py-4">
          {result ? <><button onClick={generate} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm"><RotateCcw size={15} />{label("再练一次", "Try again")}</button><button onClick={onClose} className="rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground">{label("完成", "Done")}</button></> : <><span className="text-xs text-muted-foreground">{label("已作答", "Answered")} {Object.keys(answers).length}/{practice?.questions.length || 0}</span><button disabled={!practice || submitting} onClick={submit} className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground disabled:opacity-40">{submitting && <Loader2 className="animate-spin" size={15} />}{label("提交答案", "Submit answers")}</button></>}
        </footer>
      </div>
    </div>
  );
}

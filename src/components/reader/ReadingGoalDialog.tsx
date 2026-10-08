"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpenText, Check, Clock3, X } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { DEFAULT_READING_PREFERENCES } from "@/lib/reading-preferences";
import type { ReadingGoal, ReadingPreferences, ReadingSessionState } from "@/types";
import { cn } from "@/lib/utils";

interface ReadingGoalDialogProps {
  bookId: string | null;
  bookTitle?: string;
  restart?: boolean;
  onClose: () => void;
}

export const defaultReadingGoalKey = "enjoy-default-reading-goal";

export function readingSessionKey(contentId: string) {
  return `enjoy-reading-session:${contentId}`;
}

export function ReadingGoalDialog({ bookId, bookTitle, restart = false, onClose }: ReadingGoalDialogProps) {
  const [goal, setGoal] = useState<ReadingGoal>(25);
  const [preferences, setPreferences] = useState<ReadingPreferences>(DEFAULT_READING_PREFERENCES);
  const router = useRouter();
  const { locale, t } = useLocale();

  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    void fetch("/api/user/reading-preferences")
      .then(async (response) => response.ok ? response.json() as Promise<ReadingPreferences> : Promise.reject(new Error("preferences")))
      .then((data) => {
        if (cancelled) return;
        const next = Array.isArray(data.presets) && data.presets.length === 3 ? data : DEFAULT_READING_PREFERENCES;
        let defaultGoal: ReadingGoal = next.defaultMinutes ?? "OPEN";
        const legacy = window.localStorage.getItem(defaultReadingGoalKey);
        if (next.source === "default") {
          if (legacy === "OPEN") defaultGoal = "OPEN";
          else if (legacy && next.presets.includes(Number(legacy))) defaultGoal = Number(legacy);
        }
        setPreferences(next);
        setGoal(defaultGoal);
      })
      .catch(() => {
        if (cancelled) return;
        setPreferences(DEFAULT_READING_PREFERENCES);
        setGoal(DEFAULT_READING_PREFERENCES.defaultMinutes || 25);
      });
    return () => { cancelled = true; };
  }, [bookId]);

  if (!bookId) return null;

  const startReading = () => {
    const now = Date.now();
    const session: ReadingSessionState = {
      contentId: bookId,
      targetSeconds: goal === "OPEN" ? null : goal * 60,
      idlePauseSeconds: preferences.idlePauseMinutes === null ? null : preferences.idlePauseMinutes * 60,
      elapsedActiveSeconds: 0,
      status: "active",
      startedAt: now,
      lastActivityAt: now,
      updatedAt: now,
    };
    window.localStorage.setItem(readingSessionKey(bookId), JSON.stringify(session));
    router.push(`/dashboard/ebook/read/${bookId}${restart ? "?restart=1" : ""}`);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(31,33,28,0.54)] p-4 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="reading-goal-title">
      <div className="w-full max-w-lg rounded-[1.75rem] border border-[var(--shelf-line)] bg-[#fffdf8] p-6 shadow-[0_30px_90px_rgba(31,33,28,0.28)] sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--green)] text-white"><BookOpenText size={19} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="reading-goal-title" className="font-display text-2xl font-semibold">{t("goal.title")}</h2>
            {bookTitle && <p className="mt-1 truncate text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brass)]">{bookTitle}</p>}
            <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{t("goal.description")}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-[var(--ink-soft)] hover:bg-[var(--muted)]" aria-label={t("common.close")}><X size={17} /></button>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3">
          {[...preferences.presets, "OPEN" as const].map((value) => {
            const selected = goal === value;
            const optionLabel = value === "OPEN" ? t("goal.open") : `${value} ${locale === "zh-CN" ? "分钟" : "min"}`;
            const isDefault = value === "OPEN" ? preferences.defaultMinutes === null : value === preferences.defaultMinutes;
            return (
              <button key={value} type="button" onClick={() => setGoal(value)} className={cn(
                "relative flex min-h-20 flex-col items-center justify-center rounded-2xl border px-3 py-4 text-sm transition",
                selected ? "border-[var(--green)] bg-[var(--green)] text-white shadow-md" : "border-[var(--shelf-line)] bg-[var(--paper)]/60 text-[var(--ink)] hover:-translate-y-0.5 hover:bg-[var(--paper)]",
              )}>
                {selected ? <Check className="mb-1.5" size={17} /> : <Clock3 className="mb-1.5 text-[var(--brass)]" size={17} />}
                <span className="font-semibold">{optionLabel}</span>
                {isDefault && <span className={cn("mt-1 text-[9px] uppercase tracking-wider", selected ? "text-white/70" : "text-[var(--ink-soft)]")}>{t("goal.recommended")}</span>}
              </button>
            );
          })}
        </div>

        <button type="button" onClick={startReading} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--green)]">
          <BookOpenText size={16} />
          {t("goal.start")}
        </button>
        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]">{t("goal.cancel")}</button>
      </div>
    </div>
  );
}

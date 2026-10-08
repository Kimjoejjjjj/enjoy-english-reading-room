"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Pause, Play, X } from "lucide-react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { claimReadingTab, ReadingDeltaQueue, setReadingBinding, type ReadingDelta } from "@/lib/reading-client";
import { readingSessionKey } from "@/components/reader/ReadingGoalDialog";
import type { ReadingSessionState } from "@/types";

interface FocusTimerProps {
  contentId: string;
  sectionId: string | null;
  onSessionReady: (sectionId: string | null) => void;
}

interface LedgerLease {
  sessionId: string;
  ownerToken: string;
  fencingVersion: number;
  heartbeatIntervalSeconds: number;
  leaseExpiresAt: string;
  serverNow: string;
}

interface ReadingReceipt {
  bookTitle: string;
  sectionTitle: string | null;
  chapterTitle: string | null;
  durationSeconds: number;
  lookupCount: number;
  savedVocabularyCount: number;
  highlightCount: number;
}

function loadSession(contentId: string): ReadingSessionState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(readingSessionKey(contentId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Omit<ReadingSessionState, "status"> & { status: "active" | "paused" | "complete" };
    if (value.contentId !== contentId) return null;
    return {
      ...value,
      idlePauseSeconds: typeof value.idlePauseSeconds === "number" ? value.idlePauseSeconds : 600,
      lastActivityAt: typeof value.lastActivityAt === "number" ? value.lastActivityAt : Date.now(),
      status: value.status === "paused" ? "paused" : "active",
    };
  } catch {
    return null;
  }
}

function timeLabel(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function FocusTimer({ contentId, sectionId, onSessionReady }: FocusTimerProps) {
  const [session, setSession] = useState<ReadingSessionState | null>(() => loadSession(contentId));
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [idle, setIdle] = useState(false);
  const lastActivityWrite = useRef(0);
  const queueRef = useRef<ReadingDeltaQueue | null>(null);
  const pending = useRef<ReadingDelta | null>(null);
  const identityRef = useRef<{ userId: string; sessionId: string; key: string } | null>(null);
  const leaseDeadline = useRef(0);
  const activeSection = useRef<string | null>(null);
  const closing = useRef(false);
  const closed = useRef(false);
  const acquiring = useRef<Promise<void> | null>(null);
  const serverReady = useRef(false);
  const sectionSync = useRef<Promise<void>>(Promise.resolve());
  const [unacceptedSeconds, setUnacceptedSeconds] = useState(0);
  const [ledgerLease, setLedgerLease] = useState<LedgerLease | null>(null);
  const ledgerLeaseRef = useRef<LedgerLease | null>(null);
  const [ledgerBlocked, setLedgerBlocked] = useState(false);
  const [ledgerDisabled, setLedgerDisabled] = useState(false);
  const [receipt, setReceipt] = useState<ReadingReceipt | null>(null);
  const [closeError, setCloseError] = useState(false);
  const router = useRouter();
  const { t } = useLocale();

  const remaining = session?.targetSeconds === null || !session
    ? null
    : Math.max(0, session.targetSeconds - session.elapsedActiveSeconds);
  const overtime = session?.targetSeconds === null || !session
    ? null
    : Math.max(0, session.elapsedActiveSeconds - session.targetSeconds);
  const progress = session?.targetSeconds
    ? Math.min(100, (session.elapsedActiveSeconds / session.targetSeconds) * 100)
    : 0;

  const effectivelyPaused = !session || session.status === "paused" || !pageVisible || idle || Boolean(receipt);

  const persistPending = useCallback(() => {
    const identity = identityRef.current;
    if (identity) localStorage.setItem(`${identity.key}:pending`, JSON.stringify(pending.current));
  }, []);

  const materialize = useCallback(() => {
    if (!pending.current || !queueRef.current) return;
    queueRef.current.append(pending.current);
    pending.current = null;
    persistPending();
  }, [persistPending]);

  const flushLedger = useCallback(async () => {
    materialize();
    return queueRef.current?.flush(async (delta) => {
      const response = await fetch(ledgerDisabled ? `/api/books/${contentId}/sections/${delta.sectionId}/study` : "/api/reading/delta", { method: ledgerDisabled ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ledgerDisabled ? { secondsSpent: delta.seconds, requestId: delta.deltaId } : delta), keepalive: true });
      if (response.status === 409) setLedgerBlocked(true);
      return response.ok;
    }) ?? false;
  }, [contentId, ledgerDisabled, materialize]);

  const applyLease = useCallback((lease: LedgerLease, requestedAt: number) => {
    const current = ledgerLeaseRef.current;
    if (closed.current || current && (current.fencingVersion > lease.fencingVersion || current.fencingVersion === lease.fencingVersion && Date.parse(current.leaseExpiresAt) > Date.parse(lease.leaseExpiresAt))) return;
    // A monotonic deadline avoids extending a lease when the local wall clock changes.
    leaseDeadline.current = requestedAt + Math.max(0, Date.parse(lease.leaseExpiresAt) - Date.parse(lease.serverNow));
    ledgerLeaseRef.current = lease;
    setLedgerLease(lease);
    setLedgerBlocked(false);
    const identity = identityRef.current;
    if (identity) sessionStorage.setItem(`${identity.key}:lease`, JSON.stringify(lease));
  }, []);

  const acquireLedger = useCallback(async (takeover = false) => {
    if (!identityRef.current || !activeSection.current || closed.current) return;
    if (acquiring.current) return acquiring.current;
    acquiring.current = (async () => {
      const identity = identityRef.current!;
      const existing = ledgerLeaseRef.current;
      const requestedAt = performance.now();
      const response = await fetch("/api/reading/lease", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: identity.sessionId, action: takeover ? "TAKEOVER" : existing ? "RESUME" : "ACQUIRE", ownerToken: existing?.ownerToken, fencingVersion: existing?.fencingVersion }) });
      if (!response.ok) { if (response.status === 409) setLedgerBlocked(true); return; }
      const lease = await response.json() as LedgerLease;
      // Never rebind an old queue after takeover.
      materialize();
      applyLease(lease, requestedAt);
      if (!closing.current) void flushLedger();
    })().catch(() => {}).finally(() => { acquiring.current = null; });
    return acquiring.current;
  }, [applyLease, flushLedger, materialize]);

  useEffect(() => {
    let disposed = false;
    let tab: Awaited<ReturnType<typeof claimReadingTab>> | null = null;
    let initializing = false;
    const initialize = async () => {
      if (initializing || serverReady.current || disposed) return;
      initializing = true;
      try {
        tab ||= await claimReadingTab(contentId);
        const release = tab.release;
        if (disposed) { release(); return; }
        const response = await fetch("/api/reading/session");
        if (!response.ok) throw new Error("Reading identity unavailable");
        const status = await response.json() as { userId: string; ledgerEnabled: boolean };
        if (disposed) return;
        const storageKey = `enjoy-reading-session:v2:${status.userId}:${contentId}:${tab.id}`;
        const restoredId = sessionStorage.getItem(storageKey);
        const sessionId = restoredId || crypto.randomUUID();
        sessionStorage.setItem(storageKey, sessionId);
        identityRef.current = { userId: status.userId, sessionId, key: `enjoy-reading-ledger:v2:${status.userId}:${sessionId}` };
        const timerKey = `${identityRef.current.key}:timer`;
        let restoredTimer: ReadingSessionState | null = null;
        try { restoredTimer = JSON.parse(sessionStorage.getItem(timerKey) || "null") as ReadingSessionState | null; } catch { /* No cross-account fallback. */ }
        setSession((current) => restoredId && restoredTimer?.contentId === contentId ? restoredTimer : current ? { ...current, elapsedActiveSeconds: 0 } : current);
        // Chapter synchronization below creates or restores the server session.
        serverReady.current = true;
        setLedgerDisabled(!status.ledgerEnabled);
        setLedgerBlocked(status.ledgerEnabled);
        setCloseError(false);
        window.dispatchEvent(new Event("enjoy-reading-initialized"));
      } finally { initializing = false; }
    };
    const retry = () => { void initialize().catch(() => { setCloseError(true); }); };
    retry();
    window.addEventListener("online", retry);
    return () => {
      disposed = true;
      materialize();
      window.removeEventListener("online", retry);
      tab?.release();
      setReadingBinding(contentId, null);
      identityRef.current = null;
      queueRef.current = null;
      ledgerLeaseRef.current = null;
      activeSection.current = null;
      serverReady.current = false;
    };
  }, [contentId, materialize]);

  useEffect(() => {
    let disposed = false;
    const synchronize = async () => {
      materialize();
      onSessionReady(null);
      setReadingBinding(contentId, null);
      activeSection.current = null;
      const identity = identityRef.current;
      if (!sectionId || !identity || !serverReady.current || closed.current) return;
      const response = ledgerDisabled ? Response.json({ id: identity.sessionId }) : await fetch("/api/reading/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentId, sectionId, sessionId: identity.sessionId || undefined }) });
      if (!response.ok) { setCloseError(true); return; }
      const value = await response.json() as { id: string };
      if (disposed) return;
      identity.key = `enjoy-reading-ledger:v2:${identity.userId}:${value.id}`;
      if (!queueRef.current) {
        let items: ReadingDelta[] = [];
        try { items = JSON.parse(localStorage.getItem(identity.key) || "[]") as ReadingDelta[]; } catch { /* Keep unreadable legacy data untouched. */ }
        queueRef.current = new ReadingDeltaQueue(items, (rows) => localStorage.setItem(identity.key, JSON.stringify(rows)));
        try { pending.current = JSON.parse(localStorage.getItem(`${identity.key}:pending`) || "null") as ReadingDelta | null; } catch { pending.current = null; }
        try { ledgerLeaseRef.current = JSON.parse(sessionStorage.getItem(`${identity.key}:lease`) || "null") as LedgerLease | null; } catch { ledgerLeaseRef.current = null; }
        materialize();
      }
      activeSection.current = sectionId;
      setCloseError(false);
      setReadingBinding(contentId, { userId: identity.userId, sessionId: value.id, contentId, sectionId });
      onSessionReady(sectionId);
      if (!ledgerDisabled) await acquireLedger();
    };
    const run = () => {
      sectionSync.current = sectionSync.current.then(async () => { if (!disposed) await synchronize(); }).catch(() => setCloseError(true));
    };
    run();
    window.addEventListener("enjoy-reading-initialized", run);
    window.addEventListener("online", run);
    return () => { disposed = true; materialize(); window.removeEventListener("enjoy-reading-initialized", run); window.removeEventListener("online", run); };
  }, [acquireLedger, contentId, ledgerDisabled, materialize, onSessionReady, sectionId]);

  useEffect(() => {
    const recover = () => { if (!closed.current && !closing.current) void acquireLedger(); };
    window.addEventListener("online", recover);
    const heartbeat = window.setInterval(() => {
      if (closed.current || closing.current || !ledgerLeaseRef.current) return;
      const lease = ledgerLeaseRef.current;
      const requestedAt = performance.now();
      void fetch("/api/reading/lease", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...lease, action: performance.now() >= leaseDeadline.current ? "RESUME" : "HEARTBEAT" }) })
        .then(async (response) => { if (response.ok) applyLease(await response.json() as LedgerLease, requestedAt); else if (response.status === 409) setLedgerBlocked(true); })
        .catch(() => {});
    }, (ledgerLease?.heartbeatIntervalSeconds || 15) * 1000);
    return () => { clearInterval(heartbeat); window.removeEventListener("online", recover); };
  }, [acquireLedger, applyLease, ledgerLease]);

  useEffect(() => {
    if (closed.current) return;
    if (effectivelyPaused) { void flushLedger(); return; }
    const timer = window.setInterval(() => { if (!closing.current && !closed.current) void flushLedger(); }, 15_000);
    const hide = () => { materialize(); void flushLedger(); };
    window.addEventListener("pagehide", hide);
    return () => { clearInterval(timer); window.removeEventListener("pagehide", hide); };
  }, [effectivelyPaused, flushLedger, materialize]);


  useEffect(() => {
    if (!session) return;
    const identity = identityRef.current;
    if (identity) sessionStorage.setItem(`${identity.key}:timer`, JSON.stringify(session));
  }, [contentId, session]);

  const sessionStatus = session?.status;
  const lastActivityAt = session?.lastActivityAt;
  const idlePauseSeconds = session?.idlePauseSeconds;

  useEffect(() => {
    const recordActivity = () => {
      const now = Date.now();
      setIdle(false);
      if (now - lastActivityWrite.current < 1_000) return;
      lastActivityWrite.current = now;
      setSession((current) => current ? { ...current, lastActivityAt: now, updatedAt: now } : current);
    };
    const onVisibility = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible) recordActivity();
    };
    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("touchstart", recordActivity, { passive: true });
    document.addEventListener("scroll", recordActivity, { capture: true, passive: true });
    document.addEventListener("selectionchange", recordActivity);
    document.addEventListener("visibilitychange", onVisibility);
    recordActivity();
    return () => {
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      document.removeEventListener("scroll", recordActivity, true);
      document.removeEventListener("selectionchange", recordActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [contentId]);

  useEffect(() => {
    if (sessionStatus !== "active" || !pageVisible || idlePauseSeconds == null || !lastActivityAt) {
      const reset = window.setTimeout(() => setIdle(false), 0);
      return () => window.clearTimeout(reset);
    }
    const remainingMs = (lastActivityAt + idlePauseSeconds * 1_000) - Date.now();
    const timeout = window.setTimeout(() => setIdle(true), Math.max(0, remainingMs));
    return () => window.clearTimeout(timeout);
  }, [idlePauseSeconds, lastActivityAt, pageVisible, sessionStatus]);

  useEffect(() => {
    if (sessionStatus !== "active" || !pageVisible || idle || receipt) return;
    let lastTick = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick;
      lastTick = now;
      if (elapsed > 2000) return;
      if (closing.current || closed.current || document.visibilityState !== "visible") return;
      const lease = ledgerLeaseRef.current || (ledgerDisabled && identityRef.current ? { sessionId: identityRef.current.sessionId, ownerToken: "legacy", fencingVersion: 0 } : null);
      if (!ledgerDisabled && (!lease || ledgerBlocked || !activeSection.current || performance.now() >= leaseDeadline.current)) return;
      if (lease && activeSection.current) {
        if (!pending.current) pending.current = { deltaId: crypto.randomUUID(), sessionId: lease.sessionId, contentId, sectionId: activeSection.current, ownerToken: lease.ownerToken, fencingVersion: lease.fencingVersion, seconds: 0 };
        pending.current.seconds += 1;
        persistPending();
        if (pending.current.seconds >= 60) materialize();
      }
      setSession((current) => {
        if (!current || current.status !== "active") return current;
        const elapsedActiveSeconds = current.elapsedActiveSeconds + 1;
        return {
          ...current,
          elapsedActiveSeconds,
          status: "active",
          updatedAt: Date.now(),
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [contentId, idle, ledgerBlocked, ledgerDisabled, materialize, pageVisible, persistPending, receipt, sessionStatus]);

  const statusLabel = useMemo(() => {
    if (idle) return t("reader.waitingActivity");
    if (!session || session.targetSeconds === null) return t("reader.openEnded");
    if (overtime !== null && overtime > 0) return `+${timeLabel(overtime)}`;
    return timeLabel(remaining || 0);
  }, [idle, overtime, remaining, session, t]);

  const togglePause = () => {
    setSession((current) => {
      if (!current) return current;
      const now = Date.now();
      const resuming = current.status === "paused";
      if (resuming) setIdle(false);
      return { ...current, status: resuming ? "active" : "paused", lastActivityAt: resuming ? now : current.lastActivityAt, updatedAt: now };
    });
  };

  const exitReading = useCallback(async (allowPartial = false) => {
    if (closing.current || closed.current) return;
    closing.current = true;
    setSession((current) => current ? { ...current, status: "paused" } : current);
    try {
      if (ledgerDisabled) {
        await sectionSync.current;
        if (!await flushLedger()) throw new Error("Legacy time sync unavailable");
        closed.current = true;
        router.push("/dashboard/ebook");
        return;
      }
      await sectionSync.current;
      await acquireLedger();
      const flushed = await flushLedger();
      if (!flushed) {
        const items = queueRef.current?.items || [];
        const accepted: string[] = [];
        for (let index = 0; index < items.length; index += 100) {
          const query = new URLSearchParams();
          items.slice(index, index + 100).forEach((item) => query.append("deltaId", item.deltaId));
          const check = await fetch(`/api/reading/delta?${query}`);
          if (!check.ok) throw new Error("Reconciliation unavailable");
          accepted.push(...((await check.json()) as { accepted: string[] }).accepted);
        }
        queueRef.current?.acknowledge(accepted);
        const unresolved = queueRef.current?.items || [];
        setUnacceptedSeconds(unresolved.reduce((total, item) => total + item.seconds, 0));
        if (unresolved.length && (!allowPartial || !ledgerBlocked)) { setCloseError(true); return; }
        if (unresolved.length) {
          const identity = identityRef.current!;
          localStorage.setItem(`${identity.key}:unresolved`, JSON.stringify(unresolved));
        }
      }
      const identity = identityRef.current;
      if (!identity?.sessionId) throw new Error("Reading session unavailable");
      const key = `${identity.key}:close`;
      const closeRequestId = localStorage.getItem(key) || crypto.randomUUID();
      localStorage.setItem(key, closeRequestId);
      const response = await fetch("/api/reading/session", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: identity.sessionId, closeRequestId }) });
      const data = await response.json().catch(() => null) as { summary?: ReadingReceipt } | null;
      if (!response.ok || !data?.summary) throw new Error("Close not acknowledged");
      closed.current = true;
      serverReady.current = false;
      setReadingBinding(contentId, null);
      onSessionReady(null);
      ledgerLeaseRef.current = null;
      setLedgerLease(null);
      setCloseError(false);
      setReceipt(data.summary);
      sessionStorage.removeItem(`${identity.key}:lease`);
      const tabId = sessionStorage.getItem(`enjoy-reading-tab:v2:${contentId}`);
      sessionStorage.removeItem(`enjoy-reading-session:v2:${identity.userId}:${contentId}:${tabId}`);
    } catch { setCloseError(true); }
    finally { closing.current = false; }
  }, [acquireLedger, contentId, flushLedger, ledgerBlocked, ledgerDisabled, onSessionReady, router]);

  useEffect(() => {
    const handleExit = () => { void exitReading(); };
    window.addEventListener("enjoy-reader-exit", handleExit);
    return () => window.removeEventListener("enjoy-reader-exit", handleExit);
  }, [exitReading]);

  if (!session) return null;

  return (
    <>
      <div className="flex min-w-28 items-center justify-center gap-2 sm:min-w-40">
        {ledgerBlocked && <button type="button" onClick={() => void acquireLedger(true)} className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">{t("reader.takeOverTiming")}</button>}
        <button type="button" onClick={togglePause} className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--shelf-line)] bg-white/45 px-3 text-xs font-semibold text-[var(--ink-soft)] hover:bg-white">
          {session.status === "paused" ? <Play size={13} /> : <Pause size={13} />}
          <span className="hidden sm:inline">{session.status === "paused" ? t("reader.resume") : t("reader.pause")}</span>
        </button>
        <span className={`${idle ? "font-sans text-[10px]" : "font-mono text-xs tabular-nums"} font-semibold ${overtime && overtime > 0 ? "text-[var(--brass)]" : "text-[var(--ink)]"}`}>{statusLabel}</span>
        <button type="button" onClick={() => void exitReading()} className="rounded-full p-1.5 text-[var(--ink-soft)] hover:bg-white" aria-label={t("common.close")}><X size={14} /></button>
      </div>
      {session.targetSeconds !== null && <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--shelf-line)]/45"><div className="h-full bg-[var(--brass)] transition-[width] duration-1000" style={{ width: `${progress}%` }} /></div>}
      {closeError && createPortal(<div className="fixed left-1/2 top-20 z-[80] -translate-x-1/2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">{t("reader.receiptSyncPending")}{unacceptedSeconds > 0 && <p className="mt-2">未入账：{unacceptedSeconds} 秒{ledgerBlocked && <button type="button" onClick={() => void exitReading(true)} className="ml-2 underline">按已同步记录退出</button>}</p>}</div>, document.body)}
      {receipt && createPortal(
        <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/35 p-4 [@media(min-height:640px)]:items-center" role="dialog" aria-modal="true" aria-labelledby="reading-receipt-title">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl bg-[#fffdf8] p-6 text-center shadow-2xl">
            <h2 id="reading-receipt-title" className="font-display text-2xl font-semibold">{t("reader.receiptTitle")}</h2>
            <p className="mt-2 text-sm font-medium">{receipt.bookTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{receipt.chapterTitle || receipt.sectionTitle}</p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <span>{t("reader.receiptTime")}: {Math.round(receipt.durationSeconds / 60)}m</span>
              <span>{t("reader.receiptLookups")}: {receipt.lookupCount}</span>
              <span>{t("reader.receiptWords")}: {receipt.savedVocabularyCount}</span>
              <span>{t("reader.receiptHighlights")}: {receipt.highlightCount}</span>
            </div>
            <button type="button" onClick={() => router.push("/dashboard/ebook")} className="mt-6 rounded-lg bg-primary px-5 py-2 text-sm text-primary-foreground">{t("reader.backToShelf")}</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

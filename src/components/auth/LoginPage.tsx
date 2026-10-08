"use client";

import { useEffect, useState } from "react";
import { ArrowRight, BookOpenText, Languages, Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/components/i18n/LocaleProvider";

function messageFrom(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [step, setStep] = useState<"input" | "verify">("input");
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { login, isLoading, error } = useAuth();
  const { locale, setLocale, t } = useLocale();

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const handleSendCode = async () => {
    setLocalError(null);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLocalError(t("login.invalidEmail"));
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("common.error"));
      setStep("verify");
      setResendSeconds(60);
    } catch (cause) {
      setLocalError(messageFrom(cause, t("common.error")));
    } finally {
      setSending(false);
    }
  };

  const handleLogin = async () => {
    setLocalError(null);
    if (!code || code.length !== 6) {
      setLocalError(t("login.invalidCode"));
      return;
    }
    const success = await login(email, code);
    if (!success) setLocalError(t("login.failed"));
  };

  return (
    <main className="paper-grain relative min-h-svh overflow-hidden text-[var(--ink)]">
      <button type="button" onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")} className="absolute right-5 top-5 z-20 inline-flex items-center gap-2 rounded-full border border-[var(--shelf-line)] bg-white/55 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-white/80" aria-label={t("locale.label")}>
        <Languages size={15} />
        {t("locale.switch")}
      </button>

      <div className="mx-auto grid min-h-svh max-w-[1440px] items-stretch lg:grid-cols-[1.15fr_0.85fr]">
        <section className="relative flex min-h-[52vh] flex-col justify-between overflow-hidden px-6 pb-12 pt-20 sm:px-12 lg:min-h-svh lg:px-16 lg:pb-16 lg:pt-24">
          <div className="absolute -left-28 top-[-8rem] h-96 w-96 rounded-full bg-[var(--brass)]/10 blur-3xl" />
          <div className="relative z-10">
            <div className="mb-14 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--paper)]"><BookOpenText size={20} strokeWidth={1.5} /></span>
              <div>
                <p className="font-display text-xl font-semibold">{t("brand.name")}</p>
                <p className="text-[9px] font-semibold uppercase tracking-[0.32em] text-[var(--walnut)]">{t("brand.room")}</p>
              </div>
            </div>
            <p className="text-xs font-bold uppercase tracking-[0.26em] text-[var(--brass)]">{t("login.eyebrow")}</p>
            <h1 className="mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.12] tracking-[-0.025em] sm:text-5xl lg:text-6xl">{t("login.title")}</h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-[var(--ink-soft)] sm:text-lg">{t("login.description")}</p>
          </div>

          <div className="relative z-10 mt-16">
            <div className="bookstore-shelf flex h-52 items-end gap-3 sm:h-60 sm:gap-5" aria-hidden="true">
              <div className="h-36 w-10 rounded-t-sm bg-[#6f3f31] shadow-lg sm:h-44 sm:w-14" />
              <div className="h-44 w-14 -rotate-2 rounded-t-sm bg-[var(--green)] p-2 text-[8px] uppercase tracking-widest text-[#efe7d7] shadow-xl sm:h-56 sm:w-20 sm:p-3 sm:text-[10px]"><span className="block border-t border-[#efe7d7]/50 pt-2">Collected<br />Essays</span></div>
              <div className="book-cover-depth relative h-48 w-32 overflow-hidden rounded-r-sm bg-[#c6b6cf] p-4 sm:h-60 sm:w-40 sm:p-5">
                <span className="text-[9px] font-semibold uppercase tracking-[0.24em]">Lewis Carroll</span>
                <span className="mt-5 block font-display text-2xl leading-none sm:text-3xl">Alice&apos;s<br />Adventures</span>
                <span className="absolute bottom-5 right-4 text-5xl font-light text-white/55">A</span>
              </div>
              <div className="h-40 w-11 rotate-2 rounded-t-sm bg-[var(--brass)] shadow-lg sm:h-48 sm:w-16" />
              <div className="hidden h-32 w-9 rounded-t-sm bg-[#8d927d] shadow-lg sm:block" />
            </div>
            <blockquote className="mt-6 max-w-xl font-display text-lg italic leading-7 text-[var(--walnut)]">“{t("login.quote")}”</blockquote>
          </div>
        </section>

        <section className="flex items-center justify-center border-t border-[var(--shelf-line)] bg-[rgba(251,248,240,0.72)] px-5 py-14 backdrop-blur-sm lg:border-l lg:border-t-0 lg:px-12">
          <div className="w-full max-w-md rounded-[2rem] border border-[var(--shelf-line)] bg-[#fffdf8]/90 p-7 shadow-[0_28px_70px_rgba(72,49,34,0.14)] sm:p-9">
            <div className="mb-8">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--brass)]">Reader no. 001</p>
              <h2 className="mt-3 font-display text-3xl font-semibold">{t("login.cardTitle")}</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{t("login.cardDescription")}</p>
            </div>

            <div className="space-y-5">
              <div>
                <label htmlFor="email" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">{t("login.email")}</label>
                <div className="flex items-center rounded-xl border border-[var(--shelf-line)] bg-white/60 px-3 focus-within:border-[var(--green)] focus-within:ring-2 focus-within:ring-[var(--green)]/10">
                  <Mail size={16} className="text-[var(--brass)]" />
                  <input id="email" type="email" placeholder={t("login.emailPlaceholder")} value={email} onChange={(event) => setEmail(event.target.value)} disabled={step === "verify"} className="h-12 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none disabled:opacity-60" />
                  {step === "input" && <button type="button" onClick={handleSendCode} disabled={sending} className="shrink-0 text-xs font-semibold text-[var(--green)] disabled:opacity-50">{sending ? t("login.sending") : t("login.sendCode")}</button>}
                </div>
              </div>

              {step === "verify" && (
                <div>
                  <label htmlFor="code" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">{t("login.code")}</label>
                  <input id="code" inputMode="numeric" placeholder={t("login.codePlaceholder")} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} className="h-12 w-full rounded-xl border border-[var(--shelf-line)] bg-white/60 px-4 text-center font-mono text-lg tracking-[0.45em] outline-none focus:border-[var(--green)] focus:ring-2 focus:ring-[var(--green)]/10" />
                  <div className="mt-2 flex items-center justify-between text-xs text-[var(--ink-soft)]"><span>{locale === "zh-CN" ? "验证码 10 分钟内有效" : "The code expires in 10 minutes"}</span><button type="button" disabled={sending || resendSeconds > 0} onClick={handleSendCode} className="font-semibold text-[var(--green)] disabled:opacity-45">{resendSeconds > 0 ? `${resendSeconds}s` : locale === "zh-CN" ? "重新发送" : "Resend"}</button></div>
                  <button type="button" onClick={handleLogin} disabled={isLoading || code.length !== 6} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink)] text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--green)] disabled:opacity-45">
                    {isLoading ? t("login.entering") : t("login.enter")}
                    {!isLoading && <ArrowRight size={16} />}
                  </button>
                </div>
              )}

              {(localError || error) && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{localError || error}</p>}
            </div>

            <div className="mt-8 flex items-center gap-2 border-t border-[var(--shelf-line)]/70 pt-5 text-xs text-[var(--ink-soft)]">
              <ShieldCheck size={14} className="text-[var(--green)]" />
              Your private reading history stays with your account.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

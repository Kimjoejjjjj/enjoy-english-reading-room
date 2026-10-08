"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Check, Clock3, Languages, Loader2, LogOut, RotateCcw, ShieldCheck, User, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { defaultReadingGoalKey } from "@/components/reader/ReadingGoalDialog";
import { DEFAULT_READING_PREFERENCES, normalizeReadingPreferences } from "@/lib/reading-preferences";
import { readDictionaryCardOverflowMode, writeDictionaryCardOverflowMode, type DictionaryCardOverflowMode } from "@/lib/dictionary-card-preference";
import { readDictionaryDisplayMode, writeDictionaryDisplayMode, type DictionaryDisplayMode } from "@/lib/dictionary-display-preference";
import type { ReadingPreferences } from "@/types";

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

interface AiStatus {
  active: boolean;
  configured: boolean;
  limit?: number;
  remaining?: number;
  provider?: string;
  model?: string | null;
  failureCode?: string;
  usageMode?: "byok" | "site_quota" | "unconfigured";
}

interface AiTestResult {
  connected: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  remaining: number;
}

interface AiCredentialStatus {
  configured: boolean;
  encryptionConfigured: boolean;
  provider: string;
  keyLast4: string | null;
  updatedAt: string | null;
}

export default function SettingsPage() {
  const { logout } = useAuth();
  const { locale, setLocale } = useLocale();
  const zh = locale === "zh-CN";
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [interfaceLocale, setInterfaceLocale] = useState<"zh-CN" | "en">(locale);
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(DEFAULT_READING_PREFERENCES);
  const [dictionaryDisplayMode, setDictionaryDisplayMode] = useState<DictionaryDisplayMode>("bilingual");
  const [dictionaryCardOverflowMode, setDictionaryCardOverflowMode] = useState<DictionaryCardOverflowMode>("ask");
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiExplanationLanguage, setAiExplanationLanguage] = useState<"zh-CN" | "en">("zh-CN");
  const [testingAi, setTestingAi] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<AiTestResult | null>(null);
  const [aiTestError, setAiTestError] = useState<string | null>(null);
  const [aiCredential, setAiCredential] = useState<AiCredentialStatus | null>(null);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [savingAiKey, setSavingAiKey] = useState(false);
  const [aiCredentialMessage, setAiCredentialMessage] = useState<string | null>(null);
  const [dictionaryTranslationMode, setDictionaryTranslationMode] = useState<"manual" | "auto">("manual");

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/user");
      if (!response.ok) throw new Error(zh ? "无法加载个人资料" : "Unable to load profile");
      const data = await response.json();
      setProfile(data);
      setDisplayName(data.name || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? "无法加载个人资料" : "Unable to load profile"));
    } finally {
      setLoading(false);
    }
  }, [zh]);

  useEffect(() => {
    void loadProfile();
    setDictionaryDisplayMode(readDictionaryDisplayMode());
    setDictionaryCardOverflowMode(readDictionaryCardOverflowMode());
    void fetch("/api/user/reading-preferences")
      .then((response) => response.ok ? response.json() as Promise<ReadingPreferences> : Promise.reject(new Error("preferences")))
      .then((data) => {
        const legacy = window.localStorage.getItem(defaultReadingGoalKey);
        if (data.source === "default" && legacy === "OPEN") data.defaultMinutes = null;
        else if (data.source === "default" && legacy && data.presets.includes(Number(legacy))) data.defaultMinutes = Number(legacy);
        setReadingPreferences(data);
      })
      .catch(() => setReadingPreferences(DEFAULT_READING_PREFERENCES));
    void fetch("/api/ai/explain")
      .then(async (response) => {
        const data = await response.json().catch(() => null) as Partial<AiStatus> | null;
        if (response.ok && data) setAiStatus({ ...data, active: true, configured: Boolean(data.configured) });
        else if (data?.failureCode?.startsWith("QUOTA_")) setAiStatus({ active: false, configured: false, failureCode: data.failureCode });
      })
      .catch(() => setAiStatus({ active: false, configured: false, failureCode: "QUOTA_STORAGE_UNAVAILABLE" }));
    void fetch("/api/user/ai-preferences")
      .then((response) => response.ok ? response.json() as Promise<{ explanationLanguage?: "zh-CN" | "en"; dictionaryTranslationMode?: "manual" | "auto" }> : Promise.reject(new Error("AI preferences")))
      .then((data) => { setAiExplanationLanguage(data.explanationLanguage === "en" ? "en" : "zh-CN"); setDictionaryTranslationMode(data.dictionaryTranslationMode === "auto" ? "auto" : "manual"); })
      .catch(() => setAiExplanationLanguage("zh-CN"));
    void fetch("/api/user/ai-credential")
      .then((response) => response.ok ? response.json() as Promise<AiCredentialStatus> : Promise.reject(new Error("credential")))
      .then(setAiCredential)
      .catch(() => setAiCredential(null));
  }, [loadProfile]);

  const updateDictionaryDisplayMode = (mode: DictionaryDisplayMode) => {
    setDictionaryDisplayMode(mode);
  };

  const updateDictionaryCardOverflowMode = (mode: DictionaryCardOverflowMode) => {
    setDictionaryCardOverflowMode(mode);
  };

  const saveAiCredential = async () => {
    if (!aiKeyInput.trim()) return;
    const confirmed = window.confirm(zh ? "测试会使用你的 DeepSeek Key 发送一次很短的请求；成功后 Key 将加密保存到账户。是否继续？" : "This sends one short request with your DeepSeek key. If successful, the key is encrypted and saved to your account. Continue?");
    if (!confirmed) return;
    setSavingAiKey(true);
    setAiCredentialMessage(null);
    try {
      const response = await fetch("/api/user/ai-credential", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: aiKeyInput.trim() }) });
      const data = await response.json() as AiCredentialStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || (zh ? "DeepSeek Key 验证失败。" : "DeepSeek key validation failed."));
      setAiCredential(data);
      setAiKeyInput("");
      setAiCredentialMessage(zh ? "连接成功，Key 已加密保存。" : "Connected. The key is encrypted and saved.");
      setAiStatus((current) => ({ active: true, configured: true, provider: "deepseek", model: current?.model, usageMode: "byok" }));
    } catch (cause) {
      setAiCredentialMessage(cause instanceof Error ? cause.message : (zh ? "DeepSeek Key 保存失败。" : "Unable to save the DeepSeek key."));
    } finally {
      setSavingAiKey(false);
    }
  };

  const deleteAiCredential = async () => {
    if (!window.confirm(zh ? "删除后，词典 AI 翻译将停止；已有翻译缓存和学习记录不会删除。是否继续？" : "Deleting the key stops new dictionary AI translations. Existing cached translations and learning records remain. Continue?")) return;
    const response = await fetch("/api/user/ai-credential", { method: "DELETE" });
    if (response.ok) {
      setAiCredential(await response.json());
      setDictionaryTranslationMode("manual");
      await fetch("/api/user/ai-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dictionaryTranslationMode: "manual" }) });
      setAiCredentialMessage(zh ? "DeepSeek Key 已删除。" : "DeepSeek key deleted.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const normalizedReadingPreferences = normalizeReadingPreferences(readingPreferences);
      const [profileResponse, readingResponse, aiPreferencesResponse] = await Promise.all([
        fetch("/api/user", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: displayName }),
        }),
        fetch("/api/user/reading-preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalizedReadingPreferences),
        }),
        fetch("/api/user/ai-preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            explanationLanguage: aiExplanationLanguage,
            dictionaryTranslationMode,
          }),
        }),
      ]);
      const [profileData, readingData, aiPreferencesData] = await Promise.all([
        profileResponse.json(),
        readingResponse.json(),
        aiPreferencesResponse.json(),
      ]);
      const failedResponse = [profileResponse, readingResponse, aiPreferencesResponse].find((response) => !response.ok);
      if (failedResponse) {
        const failedData = failedResponse === profileResponse ? profileData : failedResponse === readingResponse ? readingData : aiPreferencesData;
        throw new Error(failedData.error || (zh ? "保存失败" : "Unable to save settings"));
      }

      setProfile(profileData);
      setReadingPreferences(readingData);
      setAiExplanationLanguage(aiPreferencesData.explanationLanguage === "en" ? "en" : "zh-CN");
      setDictionaryTranslationMode(aiPreferencesData.dictionaryTranslationMode === "auto" ? "auto" : "manual");
      writeDictionaryDisplayMode(dictionaryDisplayMode);
      writeDictionaryCardOverflowMode(dictionaryCardOverflowMode);
      window.localStorage.removeItem(defaultReadingGoalKey);
      setLocale(interfaceLocale);
      setSuccess(true);
      window.setTimeout(() => setSuccess(false), 3000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? "保存失败" : "Unable to save settings"));
    } finally {
      setSaving(false);
    }
  };

  const updatePreset = (index: number, minutes: number) => {
    const presets = [...readingPreferences.presets] as [number, number, number];
    const previous = presets[index];
    presets[index] = minutes;
    setReadingPreferences({ ...readingPreferences, presets, defaultMinutes: readingPreferences.defaultMinutes === previous ? minutes : readingPreferences.defaultMinutes });
  };

  const handleLogout = async () => {
    await logout();
    window.location.href = "/";
  };

  const testAiConnection = async () => {
    const confirmed = window.confirm(zh
      ? "连接测试会发送一次很短的 AI 请求，并计入每分钟测试次数；不会消耗每日学习额度。是否继续？"
      : "This sends one short AI request and counts toward the test-attempt limit, but does not use daily learning quota. Continue?");
    if (!confirmed) return;
    setTestingAi(true);
    setAiTestResult(null);
    setAiTestError(null);
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) {
        const quotaUnavailable = typeof data.failureCode === "string" && data.failureCode.startsWith("QUOTA_");
        throw new Error(quotaUnavailable ? (zh ? "AI 暂不可用" : "AI is temporarily unavailable") : data.error || (zh ? "AI 连接失败" : "AI connection failed"));
      }
      setAiTestResult(data);
      setAiStatus((current) => current ? { ...current, active: true, configured: true, remaining: data.remaining, provider: data.provider, model: data.model } : current);
    } catch (cause) {
      setAiTestError(cause instanceof Error ? cause.message : (zh ? "AI 连接失败" : "AI connection failed"));
    } finally {
      setTestingAi(false);
    }
  };

  if (loading) return <div className="flex min-h-[55vh] items-center justify-center text-sm text-[var(--ink-soft)]">{zh ? "正在准备读者资料…" : "Preparing your reader profile…"}</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-9 border-b border-[var(--shelf-line)] pb-7">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--brass)]">READER PROFILE</p>
        <h1 className="mt-3 font-display text-4xl font-semibold">{zh ? "阅览室设置" : "Reading room settings"}</h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">{zh ? "管理读者身份、阅读偏好与 AI 服务状态。" : "Manage your identity, reading preferences and AI service status."}</p>
      </header>

      {error && <div role="alert" className="mb-5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label={zh ? "关闭提示" : "Close message"}><X size={15} /></button></div>}

      <section className="rounded-[1.5rem] border border-[var(--shelf-line)] bg-white/45 p-6 shadow-sm sm:p-8">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold"><User size={19} className="text-[var(--green)]" />{zh ? "读者卡" : "Reader card"}</h2>
        <div className="mt-6 space-y-5">
          <div><label htmlFor="display-name" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">{zh ? "显示名称" : "Display name"}</label><input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="h-11 w-full rounded-xl border border-[var(--shelf-line)] bg-[#fffdf8]/70 px-4 text-sm outline-none focus:border-[var(--green)]" /></div>
          <div><label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">{zh ? "邮箱" : "Email"}</label><input value={profile?.email || ""} disabled className="h-11 w-full rounded-xl border border-[var(--shelf-line)] bg-[var(--muted)] px-4 text-sm text-[var(--ink-soft)]" /></div>
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--ink-soft)]">{zh ? "界面语言" : "Interface language"}</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setInterfaceLocale("zh-CN")} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm ${interfaceLocale === "zh-CN" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45"}`}><Languages size={15} />简体中文{interfaceLocale === "zh-CN" && <Check size={14} />}</button>
              <button type="button" onClick={() => setInterfaceLocale("en")} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm ${interfaceLocale === "en" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45"}`}><Languages size={15} />English{interfaceLocale === "en" && <Check size={14} />}</button>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">{zh ? "点击底部“保存读者资料”后切换界面语言。" : "The interface language changes after you click Save reader profile below."}</p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[1.5rem] border border-[var(--shelf-line)] bg-white/45 p-6 shadow-sm sm:p-8">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold"><Languages size={19} className="text-[var(--green)]" />{zh ? "词典来源与许可" : "Dictionary sources and licenses"}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">{zh ? "英文释义来自本地固定版本；中文词义来自 Wiktionary 对应词，不是机器翻译的完整中文解释。所有查词请求均由服务器处理。" : "English definitions come from a pinned local dataset. Chinese meanings are Wiktionary equivalents rather than complete machine-translated definitions. All dictionary requests are handled by the server."}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <a href="https://en-word.net/" target="_blank" rel="noreferrer" className="rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8]/65 p-4 hover:border-[var(--green)]"><p className="text-sm font-semibold">Open English WordNet 2025 Core</p><p className="mt-1 text-xs text-[var(--ink-soft)]">CC BY 4.0 · {zh ? "本地英文主词典" : "Local primary English dictionary"}</p></a>
          <a href="https://freedictionaryapi.com/" target="_blank" rel="noreferrer" className="rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8]/65 p-4 hover:border-[var(--green)]"><p className="text-sm font-semibold">Wiktionary / FreeDictionaryAPI</p><p className="mt-1 text-xs text-[var(--ink-soft)]">CC BY-SA 4.0 · {zh ? "中文词义与英文补充" : "Chinese meanings and English fallback"}</p></a>
        </div>
        <div className="mt-5 border-t border-[var(--shelf-line)] pt-5">
          <h3 className="text-sm font-semibold">{zh ? "查词卡语言" : "Dictionary card language"}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{zh ? "点击底部保存后，该偏好会保存在当前浏览器；不会同步到其他设备。中文词义是 Wiktionary 对应词，不是机器翻译的完整中文解释。" : "After you save below, this preference is stored in this browser and does not sync to other devices. Chinese meanings are Wiktionary equivalents, not machine-translated definitions."}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => updateDictionaryDisplayMode("bilingual")} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${dictionaryDisplayMode === "bilingual" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45 hover:border-[var(--green)]"}`}>{zh ? "中英双语" : "Bilingual"}{dictionaryDisplayMode === "bilingual" && <Check size={14} className="ml-2 inline" />}</button>
            <button type="button" onClick={() => updateDictionaryDisplayMode("english")} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${dictionaryDisplayMode === "english" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45 hover:border-[var(--green)]"}`}>{zh ? "仅英文" : "English only"}{dictionaryDisplayMode === "english" && <Check size={14} className="ml-2 inline" />}</button>
          </div>
        </div>
        <div className="mt-5 border-t border-[var(--shelf-line)] pt-5">
          <h3 className="text-sm font-semibold">{zh ? "词卡满 15 张时" : "When 15 cards are full"}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{zh ? "选择继续查词前是否询问。点击底部保存后，该偏好只保存在当前浏览器，不会同步到其他设备。" : "Choose whether to ask before continuing a lookup. After you save below, this preference is stored only in this browser and does not sync to other devices."}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => updateDictionaryCardOverflowMode("ask")} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${dictionaryCardOverflowMode === "ask" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45 hover:border-[var(--green)]"}`}>{zh ? "每次询问" : "Ask every time"}{dictionaryCardOverflowMode === "ask" && <Check size={14} className="ml-2 inline" />}</button>
            <button type="button" onClick={() => updateDictionaryCardOverflowMode("replace-oldest")} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${dictionaryCardOverflowMode === "replace-oldest" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45 hover:border-[var(--green)]"}`}>{zh ? "自动移除最早词卡" : "Replace oldest automatically"}{dictionaryCardOverflowMode === "replace-oldest" && <Check size={14} className="ml-2 inline" />}</button>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[1.5rem] border border-[var(--shelf-line)] bg-white/45 p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="flex items-center gap-2 font-display text-2xl font-semibold"><Clock3 size={19} className="text-[var(--green)]" />{zh ? "阅读偏好" : "Reading preferences"}</h2><p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{zh ? "设置开始阅读时显示的三个时间。这些偏好会同步到你的账户，并在所有设备生效。" : "Set the three times shown before reading. These preferences sync to your account and all your devices."}</p></div>
          <button type="button" onClick={() => setReadingPreferences(DEFAULT_READING_PREFERENCES)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--shelf-line)] bg-white/45 px-3 py-2 text-xs font-semibold hover:bg-white"><RotateCcw size={13} />{zh ? "恢复默认" : "Restore defaults"}</button>
        </div>
        <div className="mt-5 grid grid-cols-2 items-stretch gap-3 sm:grid-cols-4">
          {readingPreferences.presets.map((minutes, index) => {
            const selected = readingPreferences.defaultMinutes === minutes;
            return <div key={index} className={`flex h-full flex-col rounded-xl border p-3 transition ${selected ? "border-[var(--green)] bg-[var(--green)]/5" : "border-[var(--shelf-line)] bg-[#fffdf8]/70"}`}><label htmlFor={`reading-preset-${index}`} className="sr-only">{zh ? `阅读时长 ${index + 1}` : `Reading duration ${index + 1}`}</label><div className="flex items-center gap-1"><input id={`reading-preset-${index}`} type="number" min={1} max={180} step={1} value={minutes} onChange={(event) => updatePreset(index, Number(event.target.value))} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--shelf-line)] bg-white px-2 text-center text-sm font-semibold outline-none focus:border-[var(--green)]" /><span className="text-xs text-[var(--ink-soft)]">{zh ? "分" : "min"}</span></div><button type="button" onClick={() => setReadingPreferences({ ...readingPreferences, defaultMinutes: minutes })} className={`mt-auto w-full rounded-lg px-2 py-1.5 text-[10px] font-semibold ${selected ? "bg-[var(--green)] text-white" : "bg-[var(--muted)] text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}>{selected ? (zh ? "默认选中" : "Default") : (zh ? "设为默认" : "Make default")}</button></div>;
          })}
          <div className={`flex h-full flex-col rounded-xl border p-3 transition ${readingPreferences.defaultMinutes === null ? "border-[var(--green)] bg-[var(--green)]/5" : "border-[var(--shelf-line)] bg-[#fffdf8]/70"}`}><div className="flex h-9 items-center justify-center text-sm font-semibold">{zh ? "不计时" : "Open-ended"}</div><button type="button" onClick={() => setReadingPreferences({ ...readingPreferences, defaultMinutes: null })} className={`mt-auto w-full rounded-lg px-2 py-1.5 text-[10px] font-semibold ${readingPreferences.defaultMinutes === null ? "bg-[var(--green)] text-white" : "bg-[var(--muted)] text-[var(--ink-soft)] hover:text-[var(--ink)]"}`}>{readingPreferences.defaultMinutes === null ? (zh ? "默认选中" : "Default") : (zh ? "设为默认" : "Make default")}</button></div>
        </div>
        <p className="mt-3 text-xs text-[var(--ink-soft)]">{zh ? `开始阅读时将显示：${[...readingPreferences.presets].sort((a, b) => a - b).join(" / ")} 分钟 / 不计时` : `Before reading: ${[...readingPreferences.presets].sort((a, b) => a - b).join(" / ")} min / open-ended`}</p>
        <div className="mt-7 border-t border-[var(--shelf-line)] pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="text-sm font-semibold">{zh ? "无操作暂停" : "Idle pause"}</h3><p className="mt-1 max-w-xl text-xs leading-5 text-[var(--ink-soft)]">{zh ? "当阅读页面可见，但连续设定时间没有滚动、点击、触摸、键盘、文字选择或目录操作时，系统会静默暂停计时；下一次操作自动恢复。切换到其他页面时会立即暂停。" : "When the reader stays visible without reading activity for this long, timing pauses quietly and resumes on the next action. Switching away pauses immediately."}</p></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={readingPreferences.idlePauseMinutes === null} onChange={(event) => setReadingPreferences({ ...readingPreferences, idlePauseMinutes: event.target.checked ? null : 10 })} />{zh ? "不自动暂停" : "Do not pause automatically"}</label></div>
          {readingPreferences.idlePauseMinutes !== null && <div className="mt-4 flex max-w-xs items-center gap-3"><input type="number" min={1} max={60} step={1} value={readingPreferences.idlePauseMinutes} onChange={(event) => setReadingPreferences({ ...readingPreferences, idlePauseMinutes: Number(event.target.value) })} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-10 w-24 rounded-xl border border-[var(--shelf-line)] bg-white px-3 text-center text-sm font-semibold outline-none focus:border-[var(--green)]" /><span className="text-sm text-[var(--ink-soft)]">{zh ? "分钟无操作后暂停" : "minutes without activity"}</span></div>}
        </div>
      </section>

      <section className="mt-6 rounded-[1.5rem] border border-[var(--shelf-line)] bg-white/45 p-6 shadow-sm sm:p-8">
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold"><Brain size={19} className="text-[var(--green)]" />{zh ? "AI 配置" : "AI configuration"}</h2>
        <div className="mt-5 rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8]/65 p-5">
          <div><h3 className="text-sm font-semibold">{zh ? "AI 解释语言" : "AI explanation language"}</h3><p className="mt-1 max-w-xl text-xs leading-5 text-[var(--ink-soft)]">{zh ? "控制本文含义、句子解释和语法分析的输出语言；词典原始释义仍保持英文。该偏好会同步到你的账户。" : "Controls contextual meaning, sentence explanation, and grammar analysis. Original dictionary definitions stay in English. This preference syncs to your account."}</p></div>
          <div className="mt-4 grid grid-cols-2 gap-3"><button type="button" onClick={() => setAiExplanationLanguage("zh-CN")} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${aiExplanationLanguage === "zh-CN" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45 hover:border-[var(--green)]"}`}>中文解释</button><button type="button" onClick={() => setAiExplanationLanguage("en")} className={`rounded-xl border px-4 py-3 text-sm font-semibold ${aiExplanationLanguage === "en" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/45 hover:border-[var(--green)]"}`}>English explanations</button></div>
        </div>
        <div className="mt-5 rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8]/65 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{zh ? "我的 DeepSeek API Key" : "My DeepSeek API key"}</h3><p className="mt-1 max-w-xl text-xs leading-5 text-[var(--ink-soft)]">{zh ? "验证成功后由服务器使用 AES-256-GCM 加密保存，可跨设备使用。页面不会读取或回显完整 Key。所有费用由你的 DeepSeek 账户承担，本站不设置每日次数上限。" : "After validation, the server encrypts the key with AES-256-GCM for cross-device use. The full key is never returned to this page. Charges belong to your DeepSeek account; this site sets no daily request limit."}</p></div>{aiCredential?.configured && <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-800">DeepSeek · •••• {aiCredential.keyLast4}</span>}</div>
          {!aiCredential?.encryptionConfigured && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">{zh ? "服务器尚未配置 AI_CREDENTIAL_ENCRYPTION_KEY，因此暂时不能安全保存用户 Key。" : "AI_CREDENTIAL_ENCRYPTION_KEY is not configured, so user keys cannot be stored safely yet."}</p>}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row"><input type="password" autoComplete="off" spellCheck={false} value={aiKeyInput} onChange={(event) => setAiKeyInput(event.target.value.slice(0, 512))} placeholder={aiCredential?.configured ? (zh ? "输入新 Key 以更换" : "Enter a new key to replace it") : "sk-…"} className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--shelf-line)] bg-white px-4 text-sm outline-none focus:border-[var(--green)]" /><button type="button" disabled={savingAiKey || !aiKeyInput.trim() || !aiCredential?.encryptionConfigured} onClick={() => void saveAiCredential()} className="h-11 shrink-0 rounded-full bg-[var(--green)] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">{savingAiKey ? (zh ? "测试中…" : "Testing…") : aiCredential?.configured ? (zh ? "测试并更换" : "Test and replace") : (zh ? "测试并保存" : "Test and save")}</button>{aiCredential?.configured && <button type="button" onClick={() => void deleteAiCredential()} className="h-11 shrink-0 rounded-full border border-red-200 bg-red-50 px-5 text-sm font-semibold text-red-700 hover:bg-red-100">{zh ? "删除 Key" : "Delete key"}</button>}</div>
          {aiCredentialMessage && <p className="mt-3 rounded-lg bg-[var(--paper)] px-3 py-2 text-xs leading-5 text-[var(--ink-soft)]">{aiCredentialMessage}</p>}
          <div className="mt-5 border-t border-[var(--shelf-line)] pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">{zh ? "缺失中文时自动翻译" : "Translate automatically when Chinese is missing"}</p><p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{zh ? "默认关闭。开启后，仅在免费词典没有可靠常用中文对应词时调用你的 Key；缓存命中不会再次调用。" : "Off by default. When enabled, your key is used only when the free dictionary has no reliable common Chinese equivalent; cached results do not call the provider again."}</p></div><button type="button" disabled={!aiCredential?.configured} onClick={() => setDictionaryTranslationMode(dictionaryTranslationMode === "auto" ? "manual" : "auto")} className={`rounded-full border px-4 py-2 text-xs font-semibold ${dictionaryTranslationMode === "auto" ? "border-[var(--green)] bg-[var(--green)] text-white" : "border-[var(--shelf-line)] bg-white/60"} disabled:cursor-not-allowed disabled:opacity-45`}>{dictionaryTranslationMode === "auto" ? (zh ? "已开启" : "On") : (zh ? "已关闭" : "Off")}</button></div></div>
        </div>
        <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8]/65 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-[var(--green)]" />{aiStatus?.active === false ? (zh ? "AI 暂不可用" : "AI is temporarily unavailable") : aiStatus?.configured ? (zh ? "AI 服务已配置" : "AI service configured") : aiStatus ? (zh ? "当前使用本地降级模式" : "Local fallback mode") : (zh ? "正在检查 AI 状态…" : "Checking AI availability…")}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">{zh ? "用户 Key 加密保存在账户中，站点 Key 仍只存在服务器环境变量；完整 Key 不会返回浏览器。免费词典与阅读功能始终可用。" : "User keys are encrypted in the account, while the site key remains in server environment variables. Full keys are never returned to the browser. Reading and the free dictionary remain available."}</p>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">{zh ? "提供商" : "Provider"}: {aiStatus?.active ? (aiStatus.provider || "deepseek") : (zh ? "服务不可用" : "Unavailable")} · {zh ? "模型" : "Model"}: {aiStatus?.active ? (aiStatus.model || (zh ? "未配置" : "not configured")) : (zh ? "暂不可用" : "Unavailable")}</p>
          </div>
          {aiStatus?.usageMode === "byok" ? <div className="shrink-0 rounded-xl bg-green-50 px-4 py-3 text-center text-xs font-semibold text-green-800">{zh ? "用户 Key · 站内不限次" : "Your key · no site quota"}</div> : typeof aiStatus?.remaining === "number" && typeof aiStatus.limit === "number" && <div className="shrink-0 rounded-xl bg-[var(--paper)] px-4 py-3 text-center"><div className="text-xl font-semibold text-[var(--green)]">{aiStatus.remaining}/{aiStatus.limit}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-[var(--ink-soft)]">{zh ? "今日剩余" : "remaining today"}</div></div>}
        </div>
        {aiStatus?.active && !aiStatus.configured && <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs leading-6 text-amber-950">
          <p className="font-semibold">{zh ? "在本机配置 DeepSeek" : "Configure DeepSeek on this computer"}</p>
          <p className="mt-1">{zh ? "打开项目根目录的 .env.local，填写 AI_API_KEY，并保留 AI_BASE_URL、AI_MODEL、AI_PROVIDER 和 AI_DAILY_LIMIT；保存后重启网站。Key 不会显示在此页面。" : "Open .env.local in the project root, set AI_API_KEY, keep the base URL, model, provider and daily limit, then restart the site. The key is never shown here."}</p>
          <p className="mt-1 break-all font-mono text-[10px] text-amber-800">.env.local</p>
        </div>}
        <div className="mt-4 rounded-2xl border border-[var(--shelf-line)] bg-[#fffdf8]/65 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-[var(--ink-soft)]">{aiStatus?.usageMode === "byok" ? (zh ? "只有主动点击才会测试连接；使用你的 Key，不计入站内每日额度。" : "The connection is tested only when you click, using your key without site quota.") : (zh ? "只有主动点击才会测试连接；站点 Key 每分钟最多测试 3 次，且不会消耗每日学习额度。" : "The connection is tested only when you click. Site-key tests are limited to 3 attempts per minute and do not use daily learning quota.")}</p>
            <button type="button" disabled={testingAi || !aiStatus?.active || !aiStatus.configured} onClick={() => void testAiConnection()} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--shelf-line)] bg-white px-4 text-xs font-semibold hover:border-[var(--green)] disabled:cursor-not-allowed disabled:opacity-45">{testingAi && <Loader2 className="animate-spin" size={13} />}{testingAi ? (zh ? "测试中…" : "Testing…") : (zh ? "测试 AI 连接" : "Test AI connection")}</button>
          </div>
          {aiTestResult && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">{zh ? "连接成功" : "Connected"} · {aiTestResult.provider} · {aiTestResult.model} · {aiTestResult.latencyMs} ms · {zh ? "剩余" : "remaining"} {aiTestResult.remaining}</p>}
          {aiTestError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{aiTestError}</p>}
        </div>
      </section>

      <div className="mt-7 grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <button type="button" onClick={handleLogout} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-5 text-sm font-semibold text-red-700 hover:bg-red-100 sm:w-auto sm:justify-self-start"><LogOut size={15} />{zh ? "退出阅览室" : "Sign out"}</button>
        <div className="flex min-h-11 items-center justify-center text-center" aria-live="polite">
          {success ? <span role="status" className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50/80 px-4 py-2 text-sm font-semibold text-green-800 shadow-sm"><Check size={15} />{zh ? "保存成功" : "Saved successfully"}</span> : <span className="text-xs leading-5 text-[var(--ink-soft)]">{zh ? "未保存的更改在离开页面后不会保留" : "Unsaved changes are discarded when you leave"}</span>}
        </div>
        <button type="button" onClick={handleSave} disabled={saving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-6 text-sm font-semibold text-[var(--paper)] hover:bg-[var(--green)] disabled:opacity-50 sm:w-auto sm:justify-self-end"><Check size={15} />{saving ? (zh ? "正在保存…" : "Saving…") : (zh ? "保存读者资料" : "Save reader profile")}</button>
      </div>
    </div>
  );
}

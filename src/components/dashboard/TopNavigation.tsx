"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, BookOpenText, Highlighter, Languages, LibraryBig, Menu, Settings, Store, X } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", key: "nav.store", icon: Store },
  { href: "/dashboard/ebook", key: "nav.shelves", icon: LibraryBig },
  { href: "/dashboard/highlights", key: "nav.highlights", icon: Highlighter },
  { href: "/dashboard/vocabulary", key: "nav.vocabulary", icon: BookOpen },
  { href: "/dashboard/settings", key: "nav.settings", icon: Settings },
] as const;

export function TopNavigation() {
  const pathname = usePathname();
  const { locale, setLocale, t } = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = (href: string) => href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--shelf-line)]/80 bg-[rgba(244,240,230,0.94)] backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1480px] items-center gap-5 px-4 sm:px-6 lg:px-10">
        <Link href="/dashboard" className="group flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--brass)]/45 bg-[var(--ink)] text-[var(--paper)] shadow-sm transition-transform group-hover:-rotate-3">
            <BookOpenText size={19} strokeWidth={1.6} />
          </span>
          <span className="min-w-0 leading-none">
            <span className="block truncate font-display text-[18px] font-semibold tracking-tight text-[var(--ink)]">{t("brand.name")}</span>
            <span className="mt-1 block text-[9px] font-semibold uppercase tracking-[0.28em] text-[var(--walnut)]">{t("brand.room")}</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          {links.map(({ href, key, icon: Icon }) => (
            <Link key={href} href={href} className={cn(
              "relative flex items-center gap-2 rounded-full px-3.5 py-2 text-sm transition-colors",
              active(href) ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-soft)] hover:bg-white/60 hover:text-[var(--ink)]",
            )}>
              <Icon size={15} strokeWidth={1.7} />
              {t(key)}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-2">
          <button type="button" onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-[var(--ink-soft)] transition hover:bg-white/70 hover:text-[var(--ink)]" aria-label={t("locale.label")}>
            <Languages size={15} />
            {t("locale.switch")}
          </button>
          <button type="button" onClick={() => setMobileOpen((value) => !value)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink)] hover:bg-white/70 lg:hidden" aria-label={t("nav.menu")}>
            {mobileOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="border-t border-[var(--shelf-line)]/70 px-4 py-3 lg:hidden">
          <div className="mx-auto grid max-w-xl grid-cols-3 gap-2">
            {links.map(({ href, key, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm",
                active(href) ? "bg-[var(--ink)] text-[var(--paper)]" : "bg-white/45 text-[var(--ink-soft)]",
              )}>
                <Icon size={16} />
                {t(key)}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}

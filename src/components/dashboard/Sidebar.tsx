"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Brain, Highlighter, Home, Library, Repeat2, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const primaryItems = [
  { href: "/dashboard", label: "学习首页", icon: Home },
  { href: "/dashboard/ebook", label: "精读书库", icon: Library },
  { href: "/dashboard/highlights", label: "高亮与笔记", icon: Highlighter },
  { href: "/dashboard/vocabulary", label: "生词本", icon: BookOpen },
  { href: "/dashboard/review", label: "今日复习", icon: Repeat2 },
  { href: "/dashboard/coach", label: "学习教练", icon: Brain },
];

export default function Sidebar() {
  const pathname = usePathname();
  const active = (href: string) => href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const renderItem = ({ href, label, icon: Icon }: (typeof primaryItems)[number]) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active(href)
          ? "bg-primary text-primary-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      )}
    >
      <Icon size={18} />
      {label}
    </Link>
  );

  return (
    <aside className="flex h-svh w-[240px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">E</div>
        <div>
          <p className="font-semibold text-sidebar-foreground">Enjoy English</p>
          <p className="text-[11px] text-sidebar-foreground/50">AI 精读教练</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">学习闭环</p>
        <div className="space-y-1">{primaryItems.map(renderItem)}</div>

      </nav>

      <div className="border-t border-border p-3">
        <Link href="/dashboard/settings" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent">
          <Settings size={18} /> 设置
        </Link>
      </div>
    </aside>
  );
}

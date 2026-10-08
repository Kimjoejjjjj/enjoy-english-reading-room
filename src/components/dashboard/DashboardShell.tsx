"use client";

import { usePathname } from "next/navigation";
import { TopNavigation } from "@/components/dashboard/TopNavigation";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isReader = pathname.startsWith("/dashboard/ebook/read/");

  if (isReader) return <div className="h-svh w-full overflow-hidden">{children}</div>;

  return (
    <div className="min-h-svh bg-[var(--paper)] text-[var(--ink)]">
      <TopNavigation />
      <main className="mx-auto w-full max-w-[1480px] px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12">{children}</main>
    </div>
  );
}
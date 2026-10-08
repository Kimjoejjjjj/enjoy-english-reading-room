import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { AuthProvider } from "@/hooks/useAuth";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { normalizeLocale, UI_LOCALE_COOKIE } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Enjoy English · Reading Room",
  description: "A quiet English intensive-reading room for books, words, highlights, and thoughtful progress.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(UI_LOCALE_COOKIE)?.value);

  return (
    <html lang={locale}>
      <body className="min-h-full">
        <LocaleProvider initialLocale={locale}>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
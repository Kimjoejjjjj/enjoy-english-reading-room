"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

interface BookCoverProps {
  title: string;
  author?: string | null;
  coverUrl?: string | null;
  className?: string;
  priority?: boolean;
  aliceStyle?: boolean;
}

export function BookCover({ title, author, coverUrl, className, priority = false, aliceStyle = false }: BookCoverProps) {
  const resolvedCoverUrl = coverUrl?.startsWith("/uploads/books/covers/")
    ? `/api/book-covers/${encodeURIComponent(coverUrl.slice("/uploads/books/covers/".length))}`
    : coverUrl;

  const retryCover = (image: HTMLImageElement) => {
    const attempt = Number(image.dataset.coverRetry || "0");
    if (!resolvedCoverUrl || attempt >= 3) {
      image.style.display = "none";
      return;
    }
    image.dataset.coverRetry = String(attempt + 1);
    window.setTimeout(() => {
      const separator = resolvedCoverUrl.includes("?") ? "&" : "?";
      image.removeAttribute("srcset");
      image.src = `${resolvedCoverUrl}${separator}retry=${attempt + 1}`;
    }, 350 * (attempt + 1));
  };

  return (
    <div className={cn("relative aspect-[2/3] overflow-hidden rounded-r-[5px] rounded-l-[2px] bg-[var(--green)] text-[#f7f0df]", className)}>
      <div className={cn("absolute inset-0 flex flex-col p-[12%]", aliceStyle ? "bg-[#c6b6cf] text-[#241d2b]" : "bg-[linear-gradient(145deg,#355548,#223b32)]")}>
          <div className="h-px w-8 bg-current opacity-45" />
          <p className="mt-[18%] text-[7px] font-semibold uppercase tracking-[0.22em] opacity-75 sm:text-[9px]">{author || "Enjoy English Press"}</p>
          <h3 className="mt-[8%] line-clamp-5 font-display text-[clamp(1rem,2.2vw,1.75rem)] font-semibold leading-[0.98] tracking-[-0.03em]">{title}</h3>
          <div className="mt-auto flex items-end justify-between">
            <span className="text-[7px] uppercase tracking-[0.2em] opacity-65">Reading Room</span>
            <span className="font-display text-4xl font-light opacity-25">{title.charAt(0).toUpperCase()}</span>
          </div>
      </div>
      {resolvedCoverUrl && (
        <Image key={resolvedCoverUrl} src={resolvedCoverUrl} alt={`${title} cover`} fill sizes="(max-width: 640px) 42vw, 240px" priority={priority} unoptimized onError={(event) => retryCover(event.currentTarget)} className="object-contain bg-[#eee8dc]" />
      )}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[5%] bg-gradient-to-r from-black/20 to-transparent" />
      <span className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/10" />
    </div>
  );
}

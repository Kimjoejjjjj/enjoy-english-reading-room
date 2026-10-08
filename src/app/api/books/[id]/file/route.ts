import path from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { resolveBookSourcePath } from "@/lib/app-storage";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const contentTypes: Record<string, string> = {
  EPUB: "application/epub+zip",
  PDF: "application/pdf",
  TXT: "text/plain; charset=utf-8",
};

function requestedRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return "invalid" as const;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return "invalid" as const;
  end = Math.min(end, size - 1);
  return { start, end };
}

async function serve(req: NextRequest, context: Context, headOnly: boolean) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const book = await prisma.content.findFirst({ where: { id, userId }, select: { fileUrl: true, format: true, title: true } });
  if (!book) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  try {
    const filePath = await resolveBookSourcePath(book.fileUrl);
    const fileSize = (await stat(filePath)).size;
    const range = requestedRange(req.headers.get("range"), fileSize);
    if (range === "invalid") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${fileSize}` } });
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, fileSize - 1);
    const length = fileSize === 0 ? 0 : end - start + 1;
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Length": String(length),
      "Content-Type": contentTypes[book.format] || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(book.title))}`,
      "X-Content-Type-Options": "nosniff",
    });
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    if (headOnly || fileSize === 0) return new Response(null, { status: range ? 206 : 200, headers });
    const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Book file not found" }, { status: 404 });
  }
}

export function GET(req: NextRequest, context: Context) { return serve(req, context, false); }
export function HEAD(req: NextRequest, context: Context) { return serve(req, context, true); }

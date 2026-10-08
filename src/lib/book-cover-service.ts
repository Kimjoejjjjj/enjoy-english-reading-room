import path from "node:path";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { extractBookCover } from "@/lib/book-parser";
import { createTextCover, deleteStoredCover, saveBookCover } from "@/lib/book-cover";
import { resolveBookSourcePath } from "@/lib/app-storage";

interface CoverBook {
  id: string;
  title: string;
  author?: string | null;
  format: string;
  fileUrl: string;
  coverUrl?: string | null;
}

export async function regenerateBookCover(book: CoverBook): Promise<string> {
  let nextUrl: string;
  if (book.fileUrl.startsWith("sample://")) {
    nextUrl = await saveBookCover(createTextCover(book.title, book.author));
  } else {
    const filePath = await resolveBookSourcePath(book.fileUrl);
    const buffer = await readFile(filePath);
    const cover = await extractBookCover(buffer, path.basename(filePath), book.format, book.title, book.author);
    nextUrl = await saveBookCover(cover);
  }

  try {
    await prisma.content.update({ where: { id: book.id }, data: { coverUrl: nextUrl } });
  } catch (cause) {
    await deleteStoredCover(nextUrl);
    throw cause;
  }
  await deleteStoredCover(book.coverUrl);
  return nextUrl;
}

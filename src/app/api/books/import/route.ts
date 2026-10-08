import { randomBytes } from "node:crypto";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { countWords, parseBook, toSegments } from "@/lib/book-parser";
import { deleteStoredCover, saveBookCover } from "@/lib/book-cover";
import { getBookStorageDirectory, getBookTempDirectory, toBookStorageKey } from "@/lib/app-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BOOK_SIZE = 200 * 1024 * 1024;
const allowedExtensions = new Set([".epub", ".pdf", ".txt"]);

interface StreamedUpload {
  originalName: string;
  mimeType: string;
  tempPath: string;
  size: number;
  fields: Record<string, string>;
}
async function streamMultipart(req: NextRequest): Promise<StreamedUpload> {
  if (!req.body) throw new Error("上传内容为空");
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new Error("上传格式无效");

  const tempDirectory = getBookTempDirectory();
  await mkdir(tempDirectory, { recursive: true });
  const fields: Record<string, string> = {};

  return new Promise<StreamedUpload>((resolve, reject) => {
    let uploaded: Omit<StreamedUpload, "fields"> | null = null;
    let writeTask: Promise<void> | null = null;
    let tooLarge = false;
    let fileCount = 0;
    let settled = false;
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      const cleanup = writeTask
        ? writeTask.catch(() => undefined).then(() => uploaded?.tempPath ? unlink(uploaded.tempPath).catch(() => undefined) : undefined)
        : uploaded?.tempPath ? unlink(uploaded.tempPath).catch(() => undefined) : Promise.resolve();
      void cleanup;
      reject(cause instanceof Error ? cause : new Error("上传失败"));
    };

    const parser = busboy({
      headers: Object.fromEntries(req.headers.entries()),
      limits: { files: 1, fileSize: MAX_BOOK_SIZE, fields: 10, fieldSize: 1024 * 1024 },
    });

    parser.on("field", (name, value) => {
      if (["title", "author", "description"].includes(name)) fields[name] = value;
    });

    parser.on("file", (_name, stream, info) => {
      fileCount += 1;
      const tempPath = path.join(tempDirectory, `${randomBytes(12).toString("hex")}.upload`);
      uploaded = { originalName: path.basename(info.filename || "book"), mimeType: info.mimeType || "application/octet-stream", tempPath, size: 0 };
      stream.on("data", (chunk: Buffer) => { if (uploaded) uploaded.size += chunk.length; });
      stream.on("limit", () => { tooLarge = true; });
      writeTask = pipeline(stream, createWriteStream(tempPath));
    });

    parser.on("filesLimit", () => fail(new Error("每次只能上传一本书")));
    parser.on("error", fail);
    parser.on("close", async () => {
      if (settled) return;
      try {
        if (writeTask) await writeTask;
        if (!uploaded || fileCount !== 1) throw new Error("请选择 EPUB、PDF 或 TXT 文件");
        if (tooLarge) throw new Error("文件不能超过 200MB");
        settled = true;
        resolve({ ...uploaded, fields });
      } catch (cause) {
        fail(cause);
      }
    });

    const incoming = Readable.fromWeb(req.body as never);
    incoming.on("error", fail);
    incoming.pipe(parser);
  });
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let tempPath: string | null = null;
  let savedPath: string | null = null;
  let coverUrl: string | null = null;
  try {
    const upload = await streamMultipart(req);
    tempPath = upload.tempPath;
    const extension = path.extname(upload.originalName).toLowerCase();
    if (!allowedExtensions.has(extension)) throw new Error("仅支持 EPUB、PDF 和 TXT 文件");
    if (upload.size <= 0) throw new Error("上传文件为空");

    const buffer = await readFile(upload.tempPath);
    const parsed = await parseBook(buffer, upload.originalName, upload.mimeType);
    const safeBase = path.parse(upload.originalName).name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "book";
    const storedName = `${safeBase}_${randomBytes(6).toString("hex")}${extension}`;
    const uploadDirectory = getBookStorageDirectory();
    await mkdir(uploadDirectory, { recursive: true });
    savedPath = path.join(uploadDirectory, storedName);
    await rename(upload.tempPath, savedPath);
    tempPath = null;
    coverUrl = await saveBookCover(parsed.cover);

    const wordCount = parsed.sections.reduce(
      (total, section) => total + section.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0),
      0,
    );

    const content = await prisma.$transaction(async (tx) => {
      const created = await tx.content.create({
        data: {
          userId,
          title: (upload.fields.title || parsed.title).trim(),
          author: (upload.fields.author || parsed.author || "").trim() || null,
          description: (upload.fields.description || "").trim() || null,
          format: parsed.format,
          source: "UPLOAD",
          status: "READY",
          fileUrl: toBookStorageKey(storedName),
          coverUrl,
          parserVersion: parsed.parserVersion,
          navigationJson: parsed.navigationEntries.length ? JSON.stringify(parsed.navigationEntries) : null,
          sourceSectionCount: parsed.sourceSectionCount,
          sectionCount: parsed.sections.length,
          wordCount,
        },
      });

      for (const [orderIndex, section] of parsed.sections.entries()) {
        const plainText = section.paragraphs.join("\n\n");
        await tx.contentSection.create({
          data: {
            contentId: created.id,
            orderIndex,
            title: section.title,
            chapterTitle: section.chapterTitle || null,
            kind: section.kind,
            locator: section.locator || null,
            plainText,
            wordCount: countWords(plainText),
            segments: { create: toSegments(section.paragraphs) },
          },
        });
      }
      return created;
    });

    return NextResponse.json({
      ...content,
      fileUrl: undefined,
      fileDownloadUrl: `/api/books/${content.id}/file`,
      parseReport: parsed.cleanupSummary,
    }, { status: 201 });
  } catch (error) {
    if (tempPath) await unlink(tempPath).catch(() => undefined);
    if (savedPath) await unlink(savedPath).catch(() => undefined);
    if (coverUrl) await deleteStoredCover(coverUrl);
    const message = error instanceof Error ? error.message : "书籍解析失败";
    console.error("Book import failed:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

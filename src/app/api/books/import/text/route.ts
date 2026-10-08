import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { countWords, normalizeText, parseBook, toSegments } from "@/lib/book-parser";
import { readingWrite } from "@/lib/reading-write";
import { isUuid } from "@/lib/reading-ledger-contract";
import { readingEventBindingHash } from "@/lib/reading-event-contract";
import { getBookStorageDirectory, getBookTempDirectory, getCoverStorageDirectory, toBookStorageKey } from "@/lib/app-storage";
import { getJwtSecret } from "@/lib/auth-config";

export const runtime = "nodejs";
const MAX_TEXT_BYTES = 1024 * 1024;
const PREVIEW_TTL_SECONDS = 900;

type PreviewPayload = { userId: string; fingerprint: string; expiresAt: number };
const secret = () => getJwtSecret();
const sign = (encoded: string) => createHmac("sha256", secret()).update(encoded).digest("base64url");
const previewToken = (payload: PreviewPayload) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
};
const verifyPreview = (token: unknown): PreviewPayload | null => {
  if (typeof token !== "string") return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as PreviewPayload;
    return payload.expiresAt >= Date.now() ? payload : null;
  } catch {
    return null;
  }
};

function normalizeInput(body: Record<string, unknown>) {
  const title = String(body.title || "").trim().replace(/\s+/g, " ").slice(0, 200);
  const author = String(body.author || "").trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const text = normalizeText(String(body.text || ""));
  const bytes = Buffer.byteLength(text, "utf8");
  const words = countWords(text);
  if (!title) return { error: "请输入书名" } as const;
  if (!text || words === 0) return { error: "请粘贴非空英文文本" } as const;
  if (bytes > MAX_TEXT_BYTES) return { error: "粘贴文本不能超过 1MB" } as const;
  const contentHash = readingEventBindingHash({ text });
  const fingerprint = readingEventBindingHash({ operationType: "PASTE_IMPORT", title, author, contentHash, cleanupVersion: "1" });
  return { title, author, text, words, contentHash, fingerprint } as const;
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = normalizeInput(body);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  if (body.action !== "CONFIRM") {
    const expiresAt = Date.now() + PREVIEW_TTL_SECONDS * 1000;
    return NextResponse.json({ title: input.title, author: input.author, wordCount: input.words, excerpt: input.text.slice(0, 320), previewToken: previewToken({ userId, fingerprint: input.fingerprint, expiresAt }), expiresAt });
  }

  if (!isUuid(body.idempotencyKey)) return NextResponse.json({ error: "Invalid idempotency key" }, { status: 400 });
  const idempotencyKey = body.idempotencyKey;
  const bindingHash = readingEventBindingHash({ operationType: "PASTE_IMPORT", userId, fingerprint: input.fingerprint, title: input.title, author: input.author, contentHash: input.contentHash });
  const existing = await prisma.importOperation.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.userId !== userId || existing.operationType !== "PASTE_IMPORT" || existing.bindingHash !== bindingHash) return NextResponse.json({ error: "Request conflicts with its original binding" }, { status: 409 });
    if (existing.status === "COMPLETED" && existing.contentId) return NextResponse.json({ contentId: existing.contentId, replayed: true });
  }
  const verified = verifyPreview(body.previewToken);
  if (!verified || verified.userId !== userId || verified.fingerprint !== input.fingerprint) return NextResponse.json({ error: "Preview is expired or does not match" }, { status: 409 });

  const uploadDirectory = getBookStorageDirectory();
  const coverDirectory = getCoverStorageDirectory();
  const requestPrefix = idempotencyKey.replaceAll("-", "");
  const attemptId = randomUUID().replaceAll("-", "");
  const claimToken = `RUNNING:${attemptId}`;
  const stem = `pasted_${requestPrefix}_${attemptId}`;
  const tempPath = path.join(getBookTempDirectory(), `${stem}.tmp`);
  const finalPath = path.join(uploadDirectory, `${stem}.txt`);
  const coverPath = path.join(coverDirectory, `cover_${requestPrefix}${attemptId}.svg`);
  const finalUrl = toBookStorageKey(`${stem}.txt`);
  const coverUrl = `/api/book-covers/${path.basename(coverPath)}`;
  const ownedPath = (value: string | null) => value && [getBookTempDirectory(), uploadDirectory, coverDirectory].includes(path.dirname(path.resolve(value))) && (path.basename(value).startsWith(`pasted_${requestPrefix}_`) || path.basename(value).startsWith(`cover_${requestPrefix}`));
  const claimed = await readingWrite(userId, async (tx) => {
    const prior = await tx.importOperation.findUnique({ where: { idempotencyKey } });
    if (prior && (prior.userId !== userId || prior.bindingHash !== bindingHash)) return { kind: "conflict" as const };
    if (prior?.status === "COMPLETED" && prior.contentId) return { kind: "done" as const, contentId: prior.contentId };
    if (prior?.status === "PENDING" && prior.updatedAt.getTime() > Date.now() - 300_000) return { kind: "busy" as const };
    for (const previous of [prior?.tempSourcePath, prior?.finalSourcePath]) {
      if (!previous || !ownedPath(previous)) continue;
      const bytes = await readFile(previous).catch(() => null);
      if (bytes && readingEventBindingHash({ text: bytes.toString("utf8") }) !== input.contentHash) return { kind: "conflict" as const };
    }
    const priorUrls = [prior?.finalSourcePath, prior?.finalCoverPath].filter((value): value is string => Boolean(value && ownedPath(value))).map(value => value.endsWith(".svg") ? { coverUrl: `/api/book-covers/${path.basename(value)}` } : { fileUrl: toBookStorageKey(path.basename(value)) });
    if (priorUrls.length && await tx.content.findFirst({ where: { OR: priorUrls }, select: { id: true } })) return { kind: "conflict" as const };
    const data = { status: "PENDING", cleanupStatus: claimToken, errorCode: null, tempSourcePath: tempPath, finalSourcePath: finalPath, finalCoverPath: coverPath };
    if (prior) await tx.importOperation.update({ where: { idempotencyKey }, data });
    else await tx.importOperation.create({ data: { ...data, idempotencyKey, userId, bindingHash, previewFingerprint: input.fingerprint, title: input.title, author: input.author, contentHash: input.contentHash } });
    return { kind: "claimed" as const, prior };
  });
  if (claimed.kind === "conflict") return NextResponse.json({ error: "Request conflicts with its original binding" }, { status: 409 });
  if (claimed.kind === "done") return NextResponse.json({ contentId: claimed.contentId, replayed: true });
  if (claimed.kind === "busy") return NextResponse.json({ error: "Import is already in progress; retry later" }, { status: 409 });

  const heartbeat = setInterval(() => {
    void prisma.importOperation.updateMany({ where: { idempotencyKey, status: "PENDING", cleanupStatus: claimToken }, data: { updatedAt: new Date() } }).catch(() => {});
  }, 15_000);
  try {
    // Recovery inspects only the paths persisted by this exact request.
    for (const previous of [claimed.prior?.tempSourcePath, claimed.prior?.finalSourcePath]) {
      if (!previous || !ownedPath(previous)) continue;
      const bytes = await readFile(previous).catch(() => null);
      if (bytes && readingEventBindingHash({ text: bytes.toString("utf8") }) !== input.contentHash) throw new Error("Owned source hash mismatch");
      await unlink(previous).catch(() => undefined);
    }
    if (claimed.prior?.finalCoverPath && ownedPath(claimed.prior.finalCoverPath)) await unlink(claimed.prior.finalCoverPath).catch(() => undefined);
    await mkdir(path.dirname(tempPath), { recursive: true });
    await mkdir(path.dirname(coverPath), { recursive: true });
    await readingWrite(userId, async (tx) => {
      const owner = await tx.importOperation.findUniqueOrThrow({ where: { idempotencyKey } });
      if (owner.status !== "PENDING" || owner.cleanupStatus !== claimToken) throw new Error("Import ownership changed");
      await writeFile(tempPath, input.text, { encoding: "utf8", flag: "wx" });
    });
    const parsed = await parseBook(Buffer.from(input.text), `${input.title}.txt`, "text/plain");
    // Promotion and completion share the writer reservation. A superseded worker
    // cannot promote files or commit a second content after recovery has claimed it.
    const content = await readingWrite(userId, async (tx) => {
      const operation = await tx.importOperation.findUniqueOrThrow({ where: { idempotencyKey } });
      if (operation.status !== "PENDING" || operation.cleanupStatus !== claimToken) throw new Error("Import ownership changed");
      const source = await readFile(tempPath);
      if (readingEventBindingHash({ text: source.toString("utf8") }) !== input.contentHash) throw new Error("Source changed");
      await rename(tempPath, finalPath);
      await writeFile(coverPath, parsed.cover.data, { flag: "wx" });
      const created = await tx.content.create({ data: { userId, title: input.title, author: input.author, format: "TXT", source: "UPLOAD", status: "READY", fileUrl: finalUrl, coverUrl, parserVersion: parsed.parserVersion, navigationJson: parsed.navigationEntries.length ? JSON.stringify(parsed.navigationEntries) : null, sourceSectionCount: parsed.sourceSectionCount, sectionCount: parsed.sections.length, wordCount: input.words } });
      for (const [orderIndex, section] of parsed.sections.entries()) {
        const plainText = section.paragraphs.join("\n\n");
        await tx.contentSection.create({ data: { contentId: created.id, orderIndex, title: section.title, chapterTitle: section.chapterTitle || null, kind: section.kind, locator: section.locator || null, plainText, wordCount: countWords(plainText), segments: { create: toSegments(section.paragraphs) } } });
      }
      await tx.importOperation.update({ where: { idempotencyKey }, data: { status: "COMPLETED", cleanupStatus: "COMPLETED", contentId: created.id, tempSourcePath: null, resultJson: JSON.stringify({ contentId: created.id }) } });
      return created;
    }, 60_000);
    return NextResponse.json({ contentId: content.id, replayed: false }, { status: 201 });
  } catch (error) {
    // Never remove files belonging to an acknowledged or concurrently completed book.
    const operation = await prisma.importOperation.findUnique({ where: { idempotencyKey } });
    const referenced = await prisma.content.findFirst({ where: { OR: [{ fileUrl: finalUrl }, { coverUrl }] }, select: { id: true } });
    if (operation?.status !== "COMPLETED" && !referenced) {
      for (const own of [tempPath, finalPath, coverPath]) await unlink(own).catch(() => undefined);
      await prisma.importOperation.updateMany({ where: { idempotencyKey, status: "PENDING", cleanupStatus: claimToken }, data: { status: "FAILED", cleanupStatus: "FILES_REMOVED", errorCode: "IMPORT_FAILED" } }).catch(() => undefined);
    }
    console.error("Pasted text import failed:", error);
    return NextResponse.json({ error: "文本导入失败，请重试" }, { status: 400 });
  } finally { clearInterval(heartbeat); }
}

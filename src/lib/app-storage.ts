import path from "node:path";
import { lstat, mkdir, realpath } from "node:fs/promises";

const BOOK_STORAGE_PREFIX = "storage://books/";
const SAFE_FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function getAppDataRoot() {
  const configured = process.env.APP_DATA_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("APP_DATA_DIR must be an absolute path");
    return path.resolve(configured);
  }
  if (process.env.NODE_ENV === "production") throw new Error("APP_DATA_DIR is required in production");
  return path.resolve(process.cwd(), ".tmp", "app-data");
}

export function getBookStorageDirectory() {
  return path.join(getAppDataRoot(), "books");
}

export function getBookTempDirectory() {
  return path.join(getBookStorageDirectory(), ".tmp");
}

export function getCoverStorageDirectory() {
  return path.join(getAppDataRoot(), "covers");
}

export async function ensurePrivateStorageDirectories() {
  await Promise.all([
    mkdir(getBookTempDirectory(), { recursive: true }),
    mkdir(getCoverStorageDirectory(), { recursive: true }),
  ]);
}

export function toBookStorageKey(fileName: string) {
  if (!SAFE_FILE_NAME.test(fileName) || fileName.includes("..")) throw new Error("Invalid storage file name");
  return `${BOOK_STORAGE_PREFIX}${fileName}`;
}

function storageFileName(storageKey: string) {
  if (!storageKey.startsWith(BOOK_STORAGE_PREFIX)) return null;
  const fileName = storageKey.slice(BOOK_STORAGE_PREFIX.length);
  return SAFE_FILE_NAME.test(fileName) && !fileName.includes("..") ? fileName : null;
}

function contained(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function assertRegularContainedFile(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!contained(resolvedRoot, resolvedCandidate)) throw new Error("Storage path escapes its root");
  const info = await lstat(resolvedCandidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Storage entry is not a regular file");
  const canonical = await realpath(resolvedCandidate);
  if (!contained(resolvedRoot, canonical)) throw new Error("Storage file resolves outside its root");
  return canonical;
}

export async function resolveBookSourcePath(fileUrl: string) {
  const fileName = storageFileName(fileUrl);
  if (fileName) return assertRegularContainedFile(getBookStorageDirectory(), path.join(getBookStorageDirectory(), fileName));
  if (fileUrl.startsWith("/uploads/books/") && !fileUrl.includes("..")) {
    const legacyRoot = path.resolve(process.cwd(), "public", "uploads", "books");
    return assertRegularContainedFile(legacyRoot, path.join(legacyRoot, path.basename(fileUrl)));
  }
  throw new Error("Book source is not stored locally");
}

export async function resolveCoverPath(fileName: string) {
  if (!/^cover_[a-f0-9]+\.(png|jpg|webp|svg)$/.test(fileName)) throw new Error("Invalid cover file name");
  const privateCandidate = path.join(getCoverStorageDirectory(), fileName);
  try {
    return await assertRegularContainedFile(getCoverStorageDirectory(), privateCandidate);
  } catch {
    const legacyRoot = path.resolve(process.cwd(), "public", "uploads", "books", "covers");
    return assertRegularContainedFile(legacyRoot, path.join(legacyRoot, fileName));
  }
}

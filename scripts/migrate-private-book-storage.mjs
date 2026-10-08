import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key === "--apply") args.set(key, true);
  else args.set(key, process.argv[++index]);
}

const database = path.resolve(String(args.get("--database") || ""));
const appData = path.resolve(String(args.get("--app-data-dir") || ""));
const project = process.cwd();
const legacyRootArgument = String(args.get("--legacy-root") || "");
if (legacyRootArgument && !path.isAbsolute(legacyRootArgument)) throw new Error("--legacy-root must be absolute");
const legacyBooks = legacyRootArgument ? path.resolve(legacyRootArgument) : path.resolve(project, "public", "uploads", "books");
const legacyCovers = path.join(legacyBooks, "covers");
const apply = args.has("--apply");

if (!path.isAbsolute(String(args.get("--database") || "")) || !path.isAbsolute(String(args.get("--app-data-dir") || ""))) {
  throw new Error("Pass absolute --database and --app-data-dir paths");
}
if (!existsSync(database)) throw new Error("Database does not exist");
if (apply) {
  const backup = String(args.get("--confirmed-backup") || "");
  if (!backup || !path.isAbsolute(backup) || !existsSync(backup)) throw new Error("--apply requires an existing absolute --confirmed-backup path");
}

const prisma = new PrismaClient({ datasources: { db: { url: `file:${database.replaceAll("\\", "/")}` } } });
const connected = await prisma.$queryRawUnsafe("PRAGMA database_list");
assert.equal(path.resolve(connected.find((row) => row.name === "main").file), database);

const digest = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const records = await prisma.content.findMany({
  where: { source: "UPLOAD", fileUrl: { startsWith: "/uploads/books/" } },
  select: { id: true, fileUrl: true, coverUrl: true },
});
const operations = [];
for (const record of records) {
  const fileName = path.basename(record.fileUrl);
  const source = path.join(legacyBooks, fileName);
  if (!existsSync(source) || !(await stat(source)).isFile()) throw new Error(`Missing legacy source for ${record.id}`);
  operations.push({ kind: "book", id: record.id, source, destination: path.join(appData, "books", fileName), storageKey: `storage://books/${fileName}` });
  const coverName = record.coverUrl?.match(/^\/api\/book-covers\/(cover_[a-f0-9]+\.(?:png|jpg|webp|svg))$/)?.[1];
  if (coverName && existsSync(path.join(legacyCovers, coverName))) operations.push({ kind: "cover", id: record.id, source: path.join(legacyCovers, coverName), destination: path.join(appData, "covers", coverName) });
}

const evidence = [];
for (const operation of operations) {
  const sourceHash = await digest(operation.source);
  if (apply) {
    await mkdir(path.dirname(operation.destination), { recursive: true });
    if (!existsSync(operation.destination)) await copyFile(operation.source, operation.destination, constants.COPYFILE_EXCL);
    const destinationHash = await digest(operation.destination);
    if (destinationHash !== sourceHash) throw new Error(`Hash mismatch for ${operation.destination}`);
  }
  evidence.push({ kind: operation.kind, contentId: operation.id, source: operation.source, destination: operation.destination, sha256: sourceHash });
}

if (apply) {
  await prisma.$transaction(async (tx) => {
    for (const operation of operations.filter((item) => item.kind === "book")) {
      const changed = await tx.content.updateMany({ where: { id: operation.id, fileUrl: `/uploads/books/${path.basename(operation.source)}` }, data: { fileUrl: operation.storageKey } });
      if (changed.count !== 1) throw new Error(`Book changed during migration: ${operation.id}`);
    }
  });
}

console.log(JSON.stringify({ mode: apply ? "applied" : "preview", database, appData, records: records.length, files: evidence }, null, 2));
await prisma.$disconnect();

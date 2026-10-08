import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import Module from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, createHmac } from "node:crypto";

const project = process.cwd();
const require = createRequire(import.meta.url);
const ts = require("typescript");
if (process.env.DATABASE_URL) throw new Error("Refuse inherited DATABASE_URL; run with a clean test environment");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "enjoy-repair-"));
const database = path.resolve(sandbox, "synthetic.db");
assert.ok(database.startsWith(path.resolve(os.tmpdir()) + path.sep));
assert.equal(path.dirname(database), sandbox);
assert.ok(path.basename(sandbox).startsWith("enjoy-repair-"));
assert.equal(fs.existsSync(database), false);
process.env.DATABASE_URL = `file:${database.replaceAll("\\", "/")}`;
process.env.JWT_SECRET = "synthetic-test-only-secret";
process.env.READING_LEDGER_ENABLED = "true";
process.env.OEWN_INDEX_DIR = path.join(project, "vendor", "dictionaries", "generated");
const schema = path.join(sandbox, "schema.prisma");
fs.copyFileSync(path.join(project, "prisma/schema.prisma"), schema);
const sql = execFileSync(process.execPath, [path.join(project, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], { cwd: sandbox, encoding: "utf8", env: process.env });
fs.writeFileSync(path.join(sandbox, "schema.sql"), sql);
execFileSync("python", ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(open(sys.argv[2],encoding='utf8').read()); c.close()", database, path.join(sandbox, "schema.sql")]);
const resolveOriginal = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(project, "src", request.slice(2));
  return resolveOriginal.call(this, request, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } });
  module._compile(compiled.outputText, filename);
};
// The generated client may embed a literal datasource URL. Override it explicitly
// and verify SQLite's actual connected file BEFORE importing routes or writing rows.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const connections = await prisma.$queryRawUnsafe("PRAGMA database_list");
assert.equal(path.resolve(connections.find(row => row.name === "main").file), database);
assert.equal(await prisma.user.count(), 0);
globalThis.prisma = prisma;
assert.equal(require("@/lib/db").prisma, prisma);
const { signToken } = require("@/lib/auth");
const { NextRequest } = require("next/server");
const sessionRoute = require("@/app/api/reading/session/route");
const leaseRoute = require("@/app/api/reading/lease/route");
const deltaRoute = require("@/app/api/reading/delta/route");
const saveRoute = require("@/app/api/vocabulary/save/route");
const lookupRoute = require("@/app/api/vocabulary/lookup/route");
const highlightRoute = require("@/app/api/highlights/route");
const importRoute = require("@/app/api/books/import/text/route");
const reparseRoute = require("@/app/api/books/[id]/reparse/route");
const studyRoute = require("@/app/api/books/[id]/sections/[sectionId]/study/route");
const completeRoute = require("@/app/api/books/[id]/sections/[sectionId]/complete/route");
const progressRoute = require("@/app/api/books/[id]/progress/route");
const { ReadingDeltaQueue, claimReadingTab } = require("@/lib/reading-client");
const { anchorPositions } = require("@/lib/reparse-anchor");
const { parseBook, toSegments } = require("@/lib/book-parser");
process.chdir(sandbox);
let fault = null, intercept = null;
prisma.$use(async (params, next) => { if (intercept) await intercept(params); if (fault?.(params)) { fault = null; throw new Error("INJECTED_FAILURE"); } return next(params); });
const providerFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (url) => {
  assert.match(String(url), /^https:\/\/freedictionaryapi\.com\//);
  providerCalls++;
  const lemma = decodeURIComponent(String(url).match(/\/en\/([^?]+)/)?.[1] || "quiet");
  const fixture = lemma === "go"
    ? { word: "go", entries: [{ partOfSpeech: "verb", pronunciations: [{ text: "/goʊ/" }], forms: [{ word: "went", tags: ["past"] }, { word: "gone", tags: ["past participle"] }], senses: [{ definition: "To move from one place to another.", translations: [{ language: { code: "zh" }, word: "去／前往" }] }] }] }
    : { word: "quiet", entries: [{ partOfSpeech: "adjective", pronunciations: [{ text: "/quiet/" }], senses: [{ definition: "Making little noise.", translations: [{ language: { code: "zh" }, word: "安靜／安静" }, { language: { code: "zh" }, word: "quiet" }] }] }] };
  return new Response(JSON.stringify({ ...fixture, source: { url: `https://en.wiktionary.org/wiki/${lemma}`, license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } } }), { status: 200 });
};
const user = await prisma.user.create({ data: { email: `fixture-${randomUUID()}@example.invalid` } });
const other = await prisma.user.create({ data: { email: `fixture-${randomUUID()}@example.invalid` } });
const token = (id = user.id) => signToken({ userId: id, email: "fixture@example.invalid" });
const request = (body, method = "POST", id = user.id, url = "http://fixture.invalid/api") => new NextRequest(url, { method, headers: { Cookie: `token=${token(id)}`, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
const call = async (route, body, method = "POST", context, id = user.id) => {
  const response = await route[method](request(body, method, id), context);
  return { status: response.status, data: await response.json() };
};
const book = await prisma.content.create({ data: { userId: user.id, title: "Synthetic", source: "UPLOAD", format: "TXT", fileUrl: "/uploads/books/synthetic.txt", status: "READY" } });
const a = await prisma.contentSection.create({ data: { contentId: book.id, orderIndex: 0, title: "A", plainText: "A quiet room.", segments: { create: { orderIndex: 0, text: "A quiet room.", wordCount: 3 } } }, include: { segments: true } });
const b = await prisma.contentSection.create({ data: { contentId: book.id, orderIndex: 1, title: "B", plainText: "A calm garden.", segments: { create: { orderIndex: 0, text: "A calm garden.", wordCount: 3 } } }, include: { segments: true } });
let session1, session2, lease1, lease2;
const delta = (lease, sectionId = a.id) => ({ deltaId: randomUUID(), sessionId: lease.sessionId, contentId: book.id, sectionId, ownerToken: lease.ownerToken, fencingVersion: lease.fencingVersion, seconds: 15 });

test("single-flight queue keeps unacknowledged B when duplicate callers overlap", async () => {
  const queue = new ReadingDeltaQueue([{ deltaId: "A" }, { deltaId: "B" }], () => {});
  const sent = [];
  let resolveA;
  const send = (item) => { sent.push(item.deltaId); return item.deltaId === "A" ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve(false); };
  const first = queue.flush(send), second = queue.flush(send);
  assert.equal(first, second);
  resolveA(true);
  assert.equal(await first, false);
  assert.deepEqual(sent, ["A", "B"]);
  assert.deepEqual(queue.items.map(item => item.deltaId), ["B"]);
  assert.equal(await queue.flush(async () => true), true);
  assert.equal(await queue.flush(async () => true), true);
  queue.append({ deltaId: "C" });
  assert.equal(await queue.flush(async () => true), true);
});
test("same delta ID survives network failure and response-loss replay", async () => {
  const queue = new ReadingDeltaQueue([{ deltaId: "A" }], () => {});
  assert.equal(await queue.flush(async () => { throw new Error("offline"); }), false);
  assert.equal(queue.items[0].deltaId, "A");
  queue.acknowledge(["A"]);
  assert.equal(queue.items.length, 0);
});
test("same-page, same-paragraph, and overlapping repeats are ambiguous", () => {
  assert.equal(anchorPositions("quiet quiet", "quiet").length, 2);
  assert.equal(anchorPositions("aaaa", "aa").length, 3);
  assert.deepEqual(anchorPositions("a  quiet\nroom", "quiet room"), [{ start: 3, end: 13 }]);
});
test("copied tab storage rotates identity while the original browser lock is held", async () => {
  const values = new Map(); globalThis.sessionStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const held = new Set();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (name, options, callback) => {
    if (held.has(name)) return callback(null);
    held.add(name); try { return await callback({ name }); } finally { held.delete(name); }
  } } } });
  const first = await claimReadingTab(book.id); const second = await claimReadingTab(book.id);
  assert.notEqual(first.id, second.id); first.release(); second.release();
});
test("client-keyed session create/update replays without creating orphan sessions", async () => {
  const sessionId = randomUUID();
  const first = await call(sessionRoute, { sessionId, contentId: book.id, sectionId: a.id });
  session1 = first.data;
  const replay = await call(sessionRoute, { sessionId, contentId: book.id, sectionId: a.id });
  assert.equal(first.status, 200); assert.equal(replay.data.id, session1.id);
  assert.equal(await prisma.readingSession.count({ where: { id: sessionId } }), 1);
  lease1 = (await call(leaseRoute, { sessionId, action: "ACQUIRE" })).data;
  assert.ok(lease1.serverNow && lease1.leaseExpiresAt);
  assert.equal((await call(leaseRoute, { sessionId, action: "ACQUIRE" })).data.ownerToken, lease1.ownerToken);
});
test("occupied lease and duplicate acquisition never delete an existing session", async () => {
  session2 = (await call(sessionRoute, { contentId: book.id, sectionId: a.id })).data;
  const occupied = await call(leaseRoute, { sessionId: session2.id, action: "ACQUIRE" });
  assert.equal(occupied.status, 409);
  assert.ok(await prisma.readingSession.findUnique({ where: { id: session2.id } }));
  assert.equal((await call(leaseRoute, { ...lease1, action: "ACQUIRE" })).data.ownerToken, lease1.ownerToken);
});
test("old chapter delta remains bound; new chapter lookup/save/highlight succeeds after synchronization", async () => {
  const oldDelta = delta(lease1);
  assert.equal((await call(sessionRoute, { sessionId: session1.id, contentId: book.id, sectionId: b.id })).status, 200);
  assert.equal((await call(deltaRoute, oldDelta)).status, 201);
  assert.equal((await call(deltaRoute, oldDelta)).status, 200);
  assert.equal((await call(deltaRoute, { ...oldDelta, seconds: 16 })).status, 409);
  const lookup = await call(lookupRoute, { word: "quiet", contentId: book.id, sectionId: b.id, sessionId: session1.id, requestId: randomUUID() });
  assert.equal(lookup.status, 200); assert.ok(lookup.data.meanings.length);
  assert.deepEqual(lookup.data.translations, [{ language: "zh", words: ["安静"], partOfSpeech: "adjective", definition: "Making little noise.", tags: [], secondary: false }]);
  const save = { word: "calm garden", selectedText: "calm garden", contentId: book.id, sectionId: b.id, segmentId: b.segments[0].id, sessionId: session1.id, requestId: randomUUID() };
  assert.equal((await call(saveRoute, save)).status, 201);
  assert.equal((await call(saveRoute, save)).status, 200);
  assert.equal(await prisma.vocabularyOccurrence.count({ where: { sectionId: b.id } }), 1);
  const wentLookup = await call(lookupRoute, { word: "went", contentId: book.id, sectionId: b.id, sessionId: session1.id, requestId: randomUUID() });
  assert.equal(wentLookup.status, 200);
  assert.equal(wentLookup.data.requestedLemma, "went");
  assert.equal(wentLookup.data.lemma, "go");
  assert.equal(wentLookup.data.inflection.relation, "past");
  assert.deepEqual(wentLookup.data.translations, [{ language: "zh", words: ["去", "前往"], partOfSpeech: "verb", definition: "To move from one place to another.", tags: [], secondary: false }]);
  const callsBeforeCachedWent = providerCalls;
  const cachedWent = await call(lookupRoute, { word: "went", contentId: book.id, sectionId: b.id, sessionId: session1.id, requestId: randomUUID() });
  assert.equal(cachedWent.status, 200);
  assert.equal(cachedWent.data.cached, true);
  assert.equal(cachedWent.data.inflection.relation, "past");
  assert.equal(providerCalls, callsBeforeCachedWent);
  const wentSave = await call(saveRoute, { word: wentLookup.data.lemma, selectedText: "went", definition: wentLookup.data.definition, translation: "去、前往", contentId: book.id, sectionId: b.id, segmentId: b.segments[0].id, sessionId: session1.id, requestId: randomUUID() });
  assert.equal(wentSave.status, 201);
  assert.equal(wentSave.data.entry.lemma, "go");
  assert.equal(wentSave.data.occurrences.at(-1).selectedText, "went");
  assert.equal((await call(highlightRoute, { contentId: book.id, sectionId: b.id, segmentId: b.segments[0].id, quote: "calm garden", sessionId: session1.id, requestId: randomUUID(), locator: JSON.stringify({ version: 1, ranges: [{ segmentId: b.segments[0].id, start: 2, end: 13 }] }) })).status, 201);
  assert.equal((await call(saveRoute, { ...save, sectionId: a.id, requestId: randomUUID() })).status, 409);
});
test("second tab can save without a timing lease; expiry resumes same binding and takeover fences the old owner", async () => {
  assert.equal((await call(saveRoute, { word: "quiet room", contentId: book.id, sectionId: a.id, segmentId: a.segments[0].id, sessionId: session2.id, requestId: randomUUID() })).status, 201);
  await prisma.readingLease.update({ where: { userId: user.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await call(leaseRoute, { ...lease1, action: "HEARTBEAT" })).status, 409);
  assert.equal((await call(leaseRoute, { sessionId: session2.id, action: "ACQUIRE" })).status, 409);
  const resumed = await call(leaseRoute, { ...lease1, action: "RESUME" });
  assert.equal(resumed.status, 200); assert.equal(resumed.data.ownerToken, lease1.ownerToken);
  assert.equal((await call(deltaRoute, delta(lease1, b.id))).status, 201);
  lease2 = (await call(leaseRoute, { sessionId: session2.id, action: "TAKEOVER" })).data;
  assert.equal(lease2.fencingVersion, lease1.fencingVersion + 1);
  assert.equal((await call(leaseRoute, { ...lease1, action: "RESUME" })).status, 409);
  assert.equal((await call(deltaRoute, delta(lease1))).status, 409);
});
test("delta reconciliation isolates accounts and close snapshot replays unchanged", async () => {
  const accepted = await prisma.readingTimeDelta.findFirst({ where: { sessionId: session1.id } });
  const check = await deltaRoute.GET(request(null, "GET", other.id, `http://fixture.invalid/api?deltaId=${accepted.deltaId}`));
  assert.deepEqual((await check.json()).accepted, []);
  const closeRequestId = randomUUID();
  const closed = await call(sessionRoute, { sessionId: session1.id, closeRequestId }, "PATCH");
  assert.equal(closed.status, 200); assert.equal(closed.data.summary.durationSeconds, 30);
  assert.equal(closed.data.summary.lookupCount, 3); assert.equal(closed.data.summary.savedVocabularyCount, 2); assert.equal(closed.data.summary.highlightCount, 1);
  assert.equal(closed.data.summary.sectionId, b.id);
  assert.deepEqual((await call(sessionRoute, { sessionId: session1.id, closeRequestId }, "PATCH")).data.summary, closed.data.summary);
  assert.equal((await call(deltaRoute, delta(lease1))).status, 409);
  assert.equal((await prisma.readingLease.findUnique({ where: { userId: user.id } })).sessionId, session2.id);
});
const importInput = { title: "Pasted fixture", author: "Fixture", text: "Chapter One\n\nA quiet room beside a calm garden. This synthetic English text is for isolated tests only." };
let preview, imported;
test("preview creates zero files/rows and concurrent confirm produces one book", async () => {
  const before = await prisma.content.count();
  preview = (await call(importRoute, importInput)).data;
  assert.equal(await prisma.importOperation.count(), 0); assert.equal(await prisma.content.count(), before);
  assert.equal(fs.existsSync(path.join(sandbox, "public")), false);
  const body = { ...importInput, action: "CONFIRM", previewToken: preview.previewToken, idempotencyKey: randomUUID() };
  const responses = await Promise.all([call(importRoute, body), call(importRoute, body)]);
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(await prisma.content.count(), before + 1);
  imported = { body, contentId: responses.find(response => response.status === 201).data.contentId };
});
test("completed import replays after token expiry; changed input or account conflicts", async () => {
  const encoded = Buffer.from(JSON.stringify({ userId: user.id, fingerprint: "irrelevant", expiresAt: 0 })).toString("base64url");
  const expired = `${encoded}.${createHmac("sha256", process.env.JWT_SECRET).update(encoded).digest("base64url")}`;
  const replay = await call(importRoute, { ...imported.body, previewToken: expired });
  assert.equal(replay.status, 200); assert.equal(replay.data.contentId, imported.contentId);
  assert.equal((await call(importRoute, { ...imported.body, text: "Changed English text." })).status, 409);
  assert.equal((await call(importRoute, imported.body, "POST", undefined, other.id)).status, 409);
});
test("ordinary failure after file promotion rolls back content, removes owned files, and same key retries", async () => {
  const body = { ...importInput, action: "CONFIRM", previewToken: preview.previewToken, idempotencyKey: randomUUID() };
  const before = await prisma.content.count();
  fault = params => params.model === "ContentSection" && params.action === "create";
  assert.equal((await call(importRoute, body)).status, 400);
  const failed = await prisma.importOperation.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
  assert.equal(failed.status, "FAILED"); assert.equal(await prisma.content.count(), before);
  for (const file of [failed.tempSourcePath, failed.finalSourcePath, failed.finalCoverPath]) assert.equal(fs.existsSync(file), false);
  assert.equal((await call(importRoute, body)).status, 201);
});
test("stale pending/crashed import recovers only its persisted request paths", async () => {
  const body = { ...importInput, action: "CONFIRM", previewToken: preview.previewToken, idempotencyKey: randomUUID() };
  fault = params => params.model === "Content" && params.action === "create";
  assert.equal((await call(importRoute, body)).status, 400);
  const operation = await prisma.importOperation.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
  fs.writeFileSync(operation.finalSourcePath, importInput.text);
  fs.mkdirSync(path.join(sandbox, "public", "uploads", "books"), { recursive: true });
  const unrelated = path.join(sandbox, "public/uploads/books/unrelated.txt"); fs.writeFileSync(unrelated, "keep");
  await prisma.importOperation.update({ where: { idempotencyKey: body.idempotencyKey }, data: { status: "PENDING", cleanupStatus: "RUNNING:crashed", updatedAt: new Date(Date.now() - 600_000) } });
  assert.equal((await call(importRoute, body)).status, 201);
  assert.equal(fs.existsSync(operation.finalSourcePath), false); assert.equal(fs.readFileSync(unrelated, "utf8"), "keep");
});
async function reparseFixture(text, quote) {
  const parsed = await parseBook(Buffer.from(text), "fixture.txt", "text/plain");
  const fileName = `reparse_${randomUUID()}.txt`;
  fs.mkdirSync(path.join(sandbox, "public", "uploads", "books"), { recursive: true });
  fs.writeFileSync(path.join(sandbox, "public/uploads/books", fileName), text);
  const content = await prisma.content.create({ data: { userId: user.id, title: "Reparse", format: "TXT", source: "UPLOAD", fileUrl: `/uploads/books/${fileName}`, parserVersion: parsed.parserVersion } });
  for (const [orderIndex, section] of parsed.sections.entries()) await prisma.contentSection.create({ data: { contentId: content.id, orderIndex, title: section.title, plainText: section.paragraphs.join("\n\n"), kind: section.kind, segments: { create: toSegments(section.paragraphs) } } });
  const section = await prisma.contentSection.findFirst({ where: { contentId: content.id }, include: { segments: true } });
  if (quote) {
    const segment = section.segments.find(item => item.text.includes(quote)); const start = segment.text.indexOf(quote);
    await prisma.highlight.create({ data: { userId: user.id, contentId: content.id, sectionId: section.id, segmentId: segment.id, quote, locator: JSON.stringify({ version: 1, ranges: [{ segmentId: segment.id, start, end: start + quote.length }] }) } });
  }
  return { content, section, context: { params: Promise.resolve({ id: content.id }) } };
}
test("reparse blocks repeats within one paragraph and never moves a highlight to first occurrence", async () => {
  const fixture = await reparseFixture("Chapter One\n\nA quiet room. A quiet room. The garden is calm.", "A quiet room.");
  const response = await call(reparseRoute, {}, "POST", fixture.context);
  assert.equal(response.status, 409); assert.equal(response.data.canConfirm, false);
  assert.equal(response.data.preview.unmatchedHighlightCount, 1);
});
test("reparse protects ledger seconds, rejects stale preview, and same-batch replay returns persisted result", async () => {
  const fixture = await reparseFixture("Chapter One\n\nA quiet room beside a calm garden. The birds sing softly.", "quiet room");
  const reading = await prisma.readingSession.create({ data: { userId: user.id, contentId: fixture.content.id, currentSectionId: fixture.section.id, status: "CLOSED" } });
  await prisma.readingTimeDelta.create({ data: { deltaId: randomUUID(), userId: user.id, contentId: fixture.content.id, sectionId: fixture.section.id, sessionId: reading.id, kind: "LIVE", seconds: 19, ownerToken: "fixture", fencingVersion: 1 } });
  const firstPreview = (await call(reparseRoute, {}, "POST", fixture.context)).data;
  assert.equal(firstPreview.canConfirm, true);
  await prisma.learningEvent.create({ data: { userId: user.id, contentId: fixture.content.id, sectionId: fixture.section.id, eventType: "FIXTURE" } });
  assert.equal((await call(reparseRoute, { confirmReset: true, batchId: randomUUID(), contentFingerprint: firstPreview.contentFingerprint, protectedFingerprint: firstPreview.protectedFingerprint }, "POST", fixture.context)).status, 409);
  const fresh = (await call(reparseRoute, {}, "POST", fixture.context)).data;
  const body = { confirmReset: true, batchId: randomUUID(), contentFingerprint: fresh.contentFingerprint, protectedFingerprint: fresh.protectedFingerprint };
  const result = await call(reparseRoute, body, "POST", fixture.context);
  assert.equal(result.status, 200);
  const replay = await call(reparseRoute, body, "POST", fixture.context);
  assert.equal(replay.status, 200); assert.equal(replay.data.replayed, true);
  assert.equal((await prisma.readingTimeDelta.aggregate({ where: { contentId: fixture.content.id }, _sum: { seconds: true } }))._sum.seconds, 19);
  const oldSource = { contentId: fixture.content.id, sectionId: fixture.section.id, segmentId: fixture.section.segments[0].id, word: "quiet", requestId: randomUUID(), sessionId: reading.id };
  assert.equal((await call(saveRoute, oldSource)).status, 409);
  assert.equal((await call(progressRoute, { sectionId: fixture.section.id }, "PUT", fixture.context)).status, 400);
});
test("reparse replacement failure rolls back old sections, locators, and completed batch", async () => {
  const fixture = await reparseFixture("Chapter One\n\nThe calm garden has a single quiet doorway.", "single quiet doorway");
  const preview = (await call(reparseRoute, {}, "POST", fixture.context)).data;
  const body = { confirmReset: true, batchId: randomUUID(), contentFingerprint: preview.contentFingerprint, protectedFingerprint: preview.protectedFingerprint };
  fault = params => params.model === "ReparseBatch" && params.action === "create";
  assert.equal((await call(reparseRoute, body, "POST", fixture.context)).status, 400);
  assert.ok(await prisma.contentSection.findUnique({ where: { id: fixture.section.id } }));
  assert.equal((await prisma.highlight.findFirst({ where: { contentId: fixture.content.id } })).sectionId, fixture.section.id);
  assert.equal(await prisma.reparseBatch.count({ where: { batchId: body.batchId } }), 0);
});
test("concurrent protected write waits for replacement and rejects its stale section", async () => {
  const fixture = await reparseFixture("Chapter One\n\nA unique quiet garden awaits its reader.", "unique quiet garden");
  const preview = (await call(reparseRoute, {}, "POST", fixture.context)).data;
  const body = { confirmReset: true, batchId: randomUUID(), contentFingerprint: preview.contentFingerprint, protectedFingerprint: preview.protectedFingerprint };
  let entered, release;
  const gate = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  intercept = async params => {
    if (params.model === "ContentSection" && params.action === "deleteMany") { intercept = null; entered(); await gate; }
  };
  const replacing = call(reparseRoute, body, "POST", fixture.context);
  await reached;
  const writing = call(studyRoute, { secondsSpent: 0 }, "PUT", { params: Promise.resolve({ id: fixture.content.id, sectionId: fixture.section.id }) });
  await new Promise(resolve => setTimeout(resolve, 50));
  release();
  assert.equal((await replacing).status, 200);
  assert.ok([404, 409].includes((await writing).status));
  assert.equal(await prisma.sectionProgress.count({ where: { sectionId: fixture.section.id } }), 0);
});

test("import failure before file promotion and mismatched crash source remain safe", async () => {
  const body = { ...importInput, action: "CONFIRM", previewToken: preview.previewToken, idempotencyKey: randomUUID() };
  const before = await prisma.content.count();
  let claims = 0;
  fault = params => params.model === "ImportOperation" && params.action === "findUniqueOrThrow" && ++claims === 1;
  assert.equal((await call(importRoute, body)).status, 400);
  const failed = await prisma.importOperation.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
  assert.equal(await prisma.content.count(), before);
  for (const file of [failed.tempSourcePath, failed.finalSourcePath, failed.finalCoverPath]) assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(failed.tempSourcePath, "mismatched contents");
  await prisma.importOperation.update({ where: { idempotencyKey: body.idempotencyKey }, data: { status: "PENDING", updatedAt: new Date(Date.now() - 600000) } });
  assert.equal((await call(importRoute, body)).status, 409);
  assert.equal(fs.readFileSync(failed.tempSourcePath, "utf8"), "mismatched contents");
  fs.unlinkSync(failed.tempSourcePath);
  assert.equal((await call(importRoute, body)).status, 201);
});

test("legacy endpoints cannot add seconds while ledger is active", async () => {
  const context = { params: Promise.resolve({ id: book.id, sectionId: a.id }) };
  assert.equal((await call(studyRoute, { secondsSpent: 123 }, "PUT", context)).status, 200);
  assert.equal((await call(completeRoute, { secondsSpent: 123 }, "POST", context)).status, 200);
  assert.equal((await prisma.sectionProgress.findUnique({ where: { userId_sectionId: { userId: user.id, sectionId: a.id } } })).secondsSpent, 0);
});
test("disabled ledger keeps the sole timer's legacy sync idempotent", async () => {
  process.env.READING_LEDGER_ENABLED = "false";
  try {
    const context = { params: Promise.resolve({ id: book.id, sectionId: a.id }) };
    const body = { secondsSpent: 7, requestId: randomUUID() };
    const before = (await prisma.sectionProgress.findUnique({ where: { userId_sectionId: { userId: user.id, sectionId: a.id } } })).secondsSpent;
    assert.equal((await call(studyRoute, body, "PUT", context)).status, 200);
    assert.equal((await call(studyRoute, body, "PUT", context)).status, 200);
    assert.equal((await call(studyRoute, { ...body, secondsSpent: 8 }, "PUT", context)).status, 409);
    assert.equal((await prisma.sectionProgress.findUnique({ where: { userId_sectionId: { userId: user.id, sectionId: a.id } } })).secondsSpent, before + 7);
  } finally { process.env.READING_LEDGER_ENABLED = "true"; }
});

after(async () => {
  assert.equal((await prisma.$queryRawUnsafe("PRAGMA integrity_check"))[0].integrity_check, "ok");
  assert.equal((await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")).length, 0);
  await prisma.$disconnect();
  globalThis.fetch = providerFetch; Module._resolveFilename = resolveOriginal; process.chdir(project);
  console.log(JSON.stringify({ evidence: "fresh synthetic SQLite and actual route handlers; provider stubs only", sandbox, providerCalls, liveDataAccess: false }));
});

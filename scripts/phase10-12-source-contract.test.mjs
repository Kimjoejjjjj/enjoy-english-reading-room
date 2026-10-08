import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("receipt-counted mutations bind request and session and replay persisted entities", async () => {
  const [lookup, save, highlights, session] = await Promise.all([
    read("src/app/api/vocabulary/lookup/route.ts"),
    read("src/app/api/vocabulary/save/route.ts"),
    read("src/app/api/highlights/route.ts"),
    read("src/app/api/reading/session/route.ts"),
  ]);
  assert.match(lookup, /eventType: "LOOKUP_SUCCEEDED"/);
  assert.match(lookup, /if \(!succeeded\) return/);
  assert.match(save, /resultEntityId: userVocabulary\.id/);
  assert.match(save, /replay\.resultEntityId/);
  assert.match(highlights, /resultEntityId: created\.id/);
  assert.match(highlights, /tx\.highlight\.create/);
  assert.match(session, /eventType: \{ in: \["LOOKUP_SUCCEEDED", "VOCABULARY_SAVED", "HIGHLIGHT_CREATED"\]/);
});

test("pasted-text preview is stateless and confirmation is fingerprint-bound", async () => {
  const route = await read("src/app/api/books/import/text/route.ts");
  const previewBranch = route.slice(route.indexOf('if (body.action !== "CONFIRM")'), route.indexOf('if (!isUuid(body.idempotencyKey))'));
  assert.doesNotMatch(previewBranch, /prisma\./);
  assert.match(route, /PREVIEW_TTL_SECONDS = 900/);
  assert.match(route, /existing\.bindingHash !== bindingHash/);
  assert.match(route, /status: "COMPLETED"[^}]*contentId: created\.id/);
  assert.match(route, /for \(const own of \[tempPath, finalPath, coverPath\]\)/);
});

test("reparse requires unique anchors, protects ledger rows, and commits completed batch atomically", async () => {
  const route = await read("src/app/api/books/[id]/reparse/route.ts");
  assert.match(route, /candidates\.length === 1/);
  assert.doesNotMatch(route, /preferredParsedIndex/);
  assert.doesNotMatch(route, /completionPercent \/ 100/);
  assert.match(route, /readingSession\.findMany/);
  assert.match(route, /readingTimeDelta\.findMany/);
  assert.match(route, /freshFingerprint !== protectedFingerprint/);
  assert.match(route, /tx\.reparseBatch\.create/);
});

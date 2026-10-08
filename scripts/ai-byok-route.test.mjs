import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import Module from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const project = process.cwd();
const require = createRequire(import.meta.url);
const ts = require("typescript");
if (process.env.DATABASE_URL) throw new Error("Refuse inherited DATABASE_URL");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "enjoy-byok-"));
const database = path.join(sandbox, "byok.db");
process.env.DATABASE_URL = `file:${database.replaceAll("\\", "/")}`;
process.env.JWT_SECRET = "synthetic-byok-test-secret";
process.env.AI_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.AI_MODEL = "deepseek-chat";
delete process.env.AI_API_KEY;
delete process.env.OPENAI_API_KEY;

const schema = path.join(sandbox, "schema.prisma");
fs.copyFileSync(path.join(project, "prisma", "schema.prisma"), schema);
const sql = execFileSync(process.execPath, [path.join(project, "node_modules", "prisma", "build", "index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], { cwd: sandbox, encoding: "utf8", env: process.env });
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

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
globalThis.prisma = prisma;
assert.equal(require("@/lib/db").prisma, prisma);
const { signToken } = require("@/lib/auth");
const { NextRequest } = require("next/server");
const credentialRoute = require("@/app/api/user/ai-credential/route");
const translationRoute = require("@/app/api/vocabulary/ai-translation/route");

const user = await prisma.user.create({ data: { email: `byok-${randomUUID()}@example.invalid` } });
const token = signToken({ userId: user.id, email: user.email });
const request = (body, method = "POST") => new NextRequest("http://fixture.invalid/api", {
  method,
  headers: { Cookie: `token=${token}`, ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
  ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
});
const call = async (route, body, method = "POST") => {
  const response = await route[method](request(body, method));
  return { status: response.status, data: await response.json() };
};

const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://api.deepseek.com/chat/completions");
  assert.match(String(options?.headers?.Authorization), /^Bearer sk-/);
  providerCalls++;
  const payload = JSON.parse(String(options?.body));
  const isDictionary = String(payload.messages?.[0]?.content).includes("英汉词典翻译助手");
  if (!isDictionary) {
    assert.deepEqual(payload.thinking, { type: "disabled" });
    assert.equal(payload.max_tokens, 32);
  }
  const content = isDictionary
    ? JSON.stringify({ translations: [
      { definitionId: "throat-n-1", translation: "位于颈部、通向胃和肺的通道" },
      { definitionId: "throat-n-2", translation: "形状或功能类似喉部的通道" },
    ] })
    : "连接成功";
  return new Response(JSON.stringify({ model: "deepseek-chat", choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const definitions = [
  { id: "throat-n-1", partOfSpeech: "noun", definition: "the passage to the stomach and lungs" },
  { id: "throat-n-2", partOfSpeech: "noun", definition: "a passage resembling a throat in shape or function" },
];

test("validated key is encrypted, masked, and never returned", async () => {
  const apiKey = "sk-synthetic-user-key";
  const saved = await call(credentialRoute, { apiKey }, "PUT");
  assert.equal(saved.status, 200);
  assert.equal(saved.data.keyLast4, "-key");
  assert.equal(JSON.stringify(saved.data).includes(apiKey), false);
  const row = await prisma.userAiCredential.findUnique({ where: { userId: user.id } });
  assert.equal(row.encryptedApiKey.includes(apiKey), false);
  assert.notEqual(row.authTag.length, 0);
  const status = await call(credentialRoute, null, "GET");
  assert.equal(status.data.configured, true);
  assert.equal(JSON.stringify(status.data).includes(apiKey), false);
  assert.equal(providerCalls, 1);
});

test("dictionary translations use BYOK, cache results, and do not consume site quota", async () => {
  const requestId = randomUUID();
  const generated = await call(translationRoute, { requestId, lemma: "throat", definitions });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.usageMode, "byok");
  assert.equal(generated.data.remaining, undefined);
  assert.equal(generated.data.translations[0].definitionId, "throat-n-1");
  assert.equal(providerCalls, 2);

  const replay = await call(translationRoute, { requestId, lemma: "throat", definitions });
  assert.equal(replay.status, 200);
  assert.equal(providerCalls, 2);
  const cacheHit = await call(translationRoute, { requestId: randomUUID(), lemma: "throat", definitions, cacheOnly: true });
  assert.equal(cacheHit.status, 200);
  assert.equal(cacheHit.data.cached, true);
  assert.equal(providerCalls, 2);

  const quota = await prisma.aiDailyQuota.findFirst({ where: { userId: user.id } });
  assert.deepEqual({ successCount: quota.successCount, reservedCount: quota.reservedCount }, { successCount: 0, reservedCount: 0 });
  const reservation = await prisma.aiQuotaReservation.findUnique({ where: { requestId } });
  assert.equal(reservation.quotaMode, "BYOK_UNMETERED");
  const log = await prisma.aiUsageLog.findFirst({ where: { userId: user.id, requestType: "DICTIONARY_TRANSLATION" } });
  assert.equal(log.quotaMode, "BYOK_UNMETERED");
});

test("deleting the key keeps cached translations but blocks new dictionary AI calls", async () => {
  assert.equal((await call(credentialRoute, null, "DELETE")).status, 200);
  const cached = await call(translationRoute, { requestId: randomUUID(), lemma: "throat", definitions, cacheOnly: true });
  assert.equal(cached.status, 200);
  assert.equal(cached.data.cached, true);
  const uncached = await call(translationRoute, { requestId: randomUUID(), lemma: "against", definitions: [{ id: "against-p-1", partOfSpeech: "preposition", definition: "in a contrary direction to" }] });
  assert.equal(uncached.status, 409);
  assert.equal(uncached.data.code, "BYOK_REQUIRED");
  assert.equal(providerCalls, 2);
});

after(async () => {
  assert.equal((await prisma.$queryRawUnsafe("PRAGMA integrity_check"))[0].integrity_check, "ok");
  assert.equal((await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")).length, 0);
  await prisma.$disconnect();
  globalThis.fetch = originalFetch;
  Module._resolveFilename = resolveOriginal;
  process.chdir(project);
  console.log(JSON.stringify({ evidence: "fresh synthetic SQLite and mocked DeepSeek only", providerCalls, liveDataAccess: false }));
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import Module from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const project = process.cwd();
const require = createRequire(import.meta.url);
const ts = require("typescript");
if (process.env.DATABASE_URL) throw new Error("Refuse inherited DATABASE_URL");
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "enjoy-auth-storage-"));
const database = path.join(sandbox, "fixture.db");
const appData = path.join(sandbox, "app-data");
process.env.DATABASE_URL = `file:${database.replaceAll("\\", "/")}`;
process.env.APP_DATA_DIR = appData;
process.env.JWT_SECRET = "synthetic-jwt-secret-at-least-32-characters";
process.env.OTP_HASH_SECRET = "synthetic-otp-secret-at-least-32-characters";
process.env.TRUST_PROXY_HOPS = "1";

const invited = Array.from({ length: 24 }, (_, index) => `reader${index}@example.invalid`);
process.env.LOGIN_ALLOWED_EMAILS = invited.join(",");

const schema = path.join(sandbox, "schema.prisma");
fs.copyFileSync(path.join(project, "prisma", "schema.prisma"), schema);
const sql = execFileSync(process.execPath, [path.join(project, "node_modules", "prisma", "build", "index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", schema, "--script"], { cwd: sandbox, encoding: "utf8", env: process.env });
const sqlFile = path.join(sandbox, "schema.sql");
fs.writeFileSync(sqlFile, sql);
execFileSync("python", ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(open(sys.argv[2],encoding='utf8').read()); c.close()", database, sqlFile]);

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
const connections = await prisma.$queryRawUnsafe("PRAGMA database_list");
assert.equal(path.resolve(connections.find((row) => row.name === "main").file), path.resolve(database));
assert.equal(await prisma.user.count(), 0);
globalThis.prisma = prisma;
assert.equal(require("@/lib/db").prisma, prisma);

const { NextRequest } = require("next/server");
const { issueLoginCode, consumeLoginCode } = require("@/lib/email-login");
const { signToken } = require("@/lib/auth");
const { getEmailDeliveryConfig, getJwtSecret } = require("@/lib/auth-config");
const { assertProductionRuntimeConfiguration } = require("@/lib/runtime-config");
const fileRoute = require("@/app/api/books/[id]/file/route");
const bookRoute = require("@/app/api/books/[id]/route");
const progressRoute = require("@/app/api/books/[id]/progress/route");
const sectionRoute = require("@/app/api/books/[id]/sections/[sectionId]/route");
const reparseRoute = require("@/app/api/books/[id]/reparse/route");
const loginRoute = require("@/app/api/auth/login/route");
const userRoute = require("@/app/api/user/route");
const mediaRoute = require("@/app/api/media/route");
const uploadRoute = require("@/app/api/upload/route");
const { proxy } = require("@/proxy");

const request = (url = "http://fixture.invalid/api/auth/send-code", init = {}) => new NextRequest(url, {
  headers: { "x-forwarded-for": "203.0.113.10", ...(init.headers || {}) },
  ...init,
});

test("uninvited email is indistinguishable and creates no code", async () => {
  let sends = 0;
  assert.equal(await issueLoginCode(request(), "not-invited@example.invalid", new Date("2026-10-06T00:00:00Z"), async () => { sends++; }), "generic");
  assert.equal(sends, 0);
  assert.equal(await prisma.emailLoginCode.count(), 0);
});

test("production rejects default secrets and non-persistent database paths", () => {
  const saved = Object.fromEntries(["NODE_ENV", "JWT_SECRET", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "AI_QUOTA_ENABLED", "DATABASE_URL"].map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "replace-with-a-long-random-secret";
    assert.throws(() => getJwtSecret(), /non-default secret/);
    process.env.JWT_SECRET = "production-jwt-secret-at-least-32-characters";
    process.env.RESEND_API_KEY = "synthetic-resend-key";
    process.env.RESEND_FROM_EMAIL = "login@example.invalid";
    process.env.AI_QUOTA_ENABLED = "false";
    assert.throws(() => assertProductionRuntimeConfiguration(), /inside APP_DATA_DIR/);
    process.env.DATABASE_URL = `file:${path.join(appData, "enjoy.db").replaceAll("\\", "/")}`;
    assert.doesNotThrow(() => assertProductionRuntimeConfiguration());
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("console delivery is development-only and partial Resend configuration fails", () => {
  const saved = Object.fromEntries(["NODE_ENV", "RESEND_API_KEY", "RESEND_FROM_EMAIL"].map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = "development";
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    assert.deepEqual(getEmailDeliveryConfig(), { mode: "console" });

    process.env.RESEND_API_KEY = "synthetic-resend-key";
    assert.throws(() => getEmailDeliveryConfig(), /configured together/);

    process.env.RESEND_FROM_EMAIL = "login@example.invalid";
    assert.equal(getEmailDeliveryConfig().mode, "resend");

    process.env.NODE_ENV = "production";
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    assert.throws(() => getEmailDeliveryConfig(), /configured together/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("code is hashed, expires, is single-use, and a newer code invalidates the old one", async () => {
  const sent = [];
  const sender = async (email, code) => sent.push({ email, code });
  const start = new Date("2026-10-06T01:00:00Z");
  assert.equal(await issueLoginCode(request(), invited[0], start, sender), "generic");
  const first = await prisma.emailLoginCode.findFirstOrThrow({ where: { email: invited[0] } });
  assert.equal(first.codeHash.includes(sent[0].code), false);
  assert.equal(await issueLoginCode(request(), invited[0], new Date(start.getTime() + 30_000), sender), "cooldown");
  assert.equal(await issueLoginCode(request(), invited[0], new Date(start.getTime() + 61_000), sender), "generic");
  assert.equal(await consumeLoginCode(invited[0], sent[0].code, new Date(start.getTime() + 62_000)), false);
  assert.equal(await consumeLoginCode(invited[0], sent[1].code, new Date(start.getTime() + 62_000)), true);
  assert.equal(await consumeLoginCode(invited[0], sent[1].code, new Date(start.getTime() + 63_000)), false);
});

test("five wrong attempts consume a code", async () => {
  let code = "";
  const start = new Date("2026-10-06T02:00:00Z");
  await issueLoginCode(request(), invited[1], start, async (_email, value) => { code = value; });
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(await consumeLoginCode(invited[1], "000000", new Date(start.getTime() + attempt + 1)), false);
  assert.equal(await consumeLoginCode(invited[1], code, new Date(start.getTime() + 10_000)), false);
});

test("concurrent sends admit only one code for an email", async () => {
  let sends = 0;
  const now = new Date("2026-10-06T02:30:00Z");
  const results = await Promise.all([
    issueLoginCode(request(), invited[19], now, async () => { sends++; }),
    issueLoginCode(request(), invited[19], now, async () => { sends++; }),
  ]);
  assert.deepEqual(results.sort(), ["cooldown", "generic"]);
  assert.equal(sends, 1);
  assert.equal(await prisma.emailLoginCode.count({ where: { email: invited[19] } }), 1);
});

test("email and IP hourly send limits are enforced", async () => {
  const base = new Date("2026-10-06T03:00:00Z");
  const limitedRequest = () => request("http://fixture.invalid/api/auth/send-code", { headers: { "x-forwarded-for": "198.51.100.7" } });
  for (let index = 0; index < 5; index++) {
    assert.equal(await issueLoginCode(limitedRequest(), invited[2], new Date(base.getTime() + index * 61_000), async () => {}), "generic");
  }
  assert.equal(await issueLoginCode(limitedRequest(), invited[2], new Date(base.getTime() + 5 * 61_000), async () => {}), "limited");
  for (let index = 3; index < 18; index++) {
    assert.equal(await issueLoginCode(limitedRequest(), invited[index], new Date(base.getTime() + 10_000), async () => {}), "generic");
  }
  assert.equal(await issueLoginCode(limitedRequest(), invited[18], new Date(base.getTime() + 10_000), async () => {}), "limited");
});

test("login route returns only the user, sets HttpOnly cookie, and restores the session", async () => {
  let code = "";
  const now = new Date();
  const loginRequest = request("http://fixture.invalid/api/auth/send-code", { headers: { "x-forwarded-for": "192.0.2.44" } });
  await issueLoginCode(loginRequest, invited[20], now, async (_email, value) => { code = value; });
  const response = await loginRoute.POST(request("http://fixture.invalid/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: invited[20], code }),
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal("token" in data, false);
  assert.equal(data.user.email, invited[20]);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Path=\//i);
  const cookie = setCookie.split(";")[0];
  const current = await userRoute.GET(request("http://fixture.invalid/api/user", { headers: { Cookie: cookie } }));
  assert.equal(current.status, 200);
  assert.equal((await current.json()).email, invited[20]);
  const replay = await loginRoute.POST(request("http://fixture.invalid/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: invited[20], code }) }));
  assert.equal(replay.status, 401);
});

test("private book file supports owner range and rejects another account", async () => {
  const owner = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
  const other = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
  fs.mkdirSync(path.join(appData, "books"), { recursive: true });
  fs.writeFileSync(path.join(appData, "books", "fixture.txt"), "private-reading-text");
  const book = await prisma.content.create({ data: { userId: owner.id, title: "Fixture", format: "TXT", source: "UPLOAD", status: "READY", fileUrl: "storage://books/fixture.txt" } });
  const call = (userId, range) => fileRoute.GET(request(`http://fixture.invalid/api/books/${book.id}/file`, { headers: { Cookie: `token=${signToken({ userId, email: "fixture@example.invalid" })}`, ...(range ? { Range: range } : {}) } }), { params: Promise.resolve({ id: book.id }) });
  const partial = await call(owner.id, "bytes=0-6");
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), "private");
  assert.equal((await call(other.id)).status, 404);
});

test("a second account cannot read or mutate another account's book resources", async () => {
  const owner = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
  const other = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
  const book = await prisma.content.create({
    data: {
      userId: owner.id,
      title: "Owner only",
      format: "TXT",
      source: "UPLOAD",
      status: "READY",
      fileUrl: "storage://books/owner-only.txt",
      sections: { create: { orderIndex: 0, title: "Private section", plainText: "private text" } },
    },
    include: { sections: true },
  });
  const headers = { Cookie: `token=${signToken({ userId: other.id, email: other.email })}`, "Content-Type": "application/json" };
  const bookContext = { params: Promise.resolve({ id: book.id }) };
  const sectionContext = { params: Promise.resolve({ id: book.id, sectionId: book.sections[0].id }) };

  assert.equal((await bookRoute.GET(request(`http://fixture.invalid/api/books/${book.id}`, { headers }), bookContext)).status, 404);
  assert.equal((await bookRoute.PATCH(request(`http://fixture.invalid/api/books/${book.id}`, { method: "PATCH", headers, body: JSON.stringify({ title: "Stolen" }) }), bookContext)).status, 404);
  assert.equal((await bookRoute.DELETE(request(`http://fixture.invalid/api/books/${book.id}`, { method: "DELETE", headers }), bookContext)).status, 404);
  assert.equal((await progressRoute.GET(request(`http://fixture.invalid/api/books/${book.id}/progress`, { headers }), bookContext)).status, 404);
  assert.equal((await progressRoute.PUT(request(`http://fixture.invalid/api/books/${book.id}/progress`, { method: "PUT", headers, body: JSON.stringify({ completionPercent: 100 }) }), bookContext)).status, 404);
  assert.equal((await sectionRoute.GET(request(`http://fixture.invalid/api/books/${book.id}/sections/${book.sections[0].id}`, { headers }), sectionContext)).status, 404);
  assert.equal((await reparseRoute.POST(request(`http://fixture.invalid/api/books/${book.id}/reparse`, { method: "POST", headers, body: "{}" }), bookContext)).status, 404);
  assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: book.id } })).title, "Owner only");
  assert.equal(await prisma.readingProgress.count({ where: { contentId: book.id } }), 0);
});

test("storage migration previews, copies with matching hash, and keeps legacy files", async () => {
  const owner = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
  const legacyRoot = path.join(sandbox, "legacy-books");
  const migrationData = path.join(sandbox, "migrated-data");
  const source = path.join(legacyRoot, "legacy.txt");
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(source, "legacy-private-text");
  const book = await prisma.content.create({ data: { userId: owner.id, title: "Legacy", format: "TXT", source: "UPLOAD", status: "READY", fileUrl: "/uploads/books/legacy.txt" } });
  const script = path.join(project, "scripts", "migrate-private-book-storage.mjs");
  const common = [script, "--database", database, "--app-data-dir", migrationData, "--legacy-root", legacyRoot];
  const previewResult = JSON.parse(execFileSync(process.execPath, common, { cwd: project, encoding: "utf8" }));
  assert.equal(previewResult.mode, "preview");
  assert.equal(fs.existsSync(path.join(migrationData, "books", "legacy.txt")), false);
  const backup = path.join(sandbox, "confirmed-backup.db");
  fs.copyFileSync(database, backup);
  const applied = JSON.parse(execFileSync(process.execPath, [...common, "--apply", "--confirmed-backup", backup], { cwd: project, encoding: "utf8" }));
  assert.equal(applied.mode, "applied");
  assert.equal(fs.readFileSync(path.join(migrationData, "books", "legacy.txt"), "utf8"), "legacy-private-text");
  assert.equal(fs.existsSync(source), true);
  assert.equal((await prisma.content.findUniqueOrThrow({ where: { id: book.id } })).fileUrl, "storage://books/legacy.txt");
});

test("legacy media routes are disabled and cross-site mutations are rejected", async () => {
  assert.equal((await mediaRoute.GET(request("http://fixture.invalid/api/media"))).status, 404);
  assert.equal((await uploadRoute.POST(request("http://fixture.invalid/api/upload", { method: "POST" }))).status, 404);
  const denied = proxy(request("http://fixture.invalid/api/user", { method: "PUT", headers: { Origin: "https://attacker.invalid", "sec-fetch-site": "cross-site" } }));
  assert.equal(denied.status, 403);
});

after(async () => {
  await prisma.$disconnect();
  fs.rmSync(sandbox, { recursive: true, force: true });
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = process.cwd();
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) { if (request.startsWith("@/")) request = path.join(root, "src", request.slice(2)); return originalResolve.call(this, request, parent, ...rest); };
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values }; };
let current;
const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
const hooks = {
  ...require("react"),
  useState(initial) {
    const i = current.index++; const owner = current;
    if (!owner.cells[i]) { const cell = { value: typeof initial === "function" ? initial() : initial }; cell.set = value => { const next = typeof value === "function" ? value(cell.value) : value; if (!Object.is(next, cell.value)) { cell.value = next; owner.dirty = true; } }; owner.cells[i] = cell; }
    return [owner.cells[i].value, owner.cells[i].set];
  },
  useRef(value) { const i = current.index++; return current.cells[i] ||= { current: value }; },
  useMemo(callback, deps) { const i = current.index++; if (!current.cells[i] || !same(current.cells[i].deps, deps)) current.cells[i] = { value: callback(), deps }; return current.cells[i].value; },
  useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
  useEffect(callback, deps) { const i = current.index++; const old = current.cells[i]; if (!old || !same(old.deps, deps)) { current.effects.push(() => { old?.cleanup?.(); current.cells[i].cleanup = callback(); }); current.cells[i] = { deps, cleanup: old?.cleanup }; } },
};
const pushes = [];
const originalLoad = Module._load;
Module._load = function(request, parent, ...rest) {
  if (request === "react" && (parent?.filename.endsWith("FocusTimer.tsx") || parent?.filename.endsWith("BookImportModal.tsx"))) return hooks;
  if (request === "react-dom" && (parent?.filename.endsWith("FocusTimer.tsx") || parent?.filename.endsWith("BookImportModal.tsx"))) return { createPortal: child => child };
  if (request === "next/navigation" && (parent?.filename.endsWith("FocusTimer.tsx") || parent?.filename.endsWith("BookImportModal.tsx"))) return { useRouter: () => router };
  if (request === "@/components/i18n/LocaleProvider") return { useLocale: () => ({ t: key => key, locale: "zh-CN" }) };
  if (request === "@/components/reader/ReadingGoalDialog") return { readingSessionKey: id => `enjoy-reading-session:${id}` };
  return originalLoad.call(this, request, parent, ...rest);
};
const router = { push: value => pushes.push(value) };
const { FocusTimer } = require("@/components/reader/FocusTimer");
const { getReadingBinding } = require("@/lib/reading-client");
const nodes = value => { if (!value || typeof value !== "object") return []; if (Array.isArray(value)) return value.flatMap(nodes); return [value, ...nodes(value.props?.children)]; };
let clock = 0;
Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
const intervals = new Map(); let intervalId = 0;
const timers = new EventTarget();
timers.setInterval = (callback, ms) => { intervals.set(++intervalId, { callback, ms }); return intervalId; };
timers.clearInterval = id => intervals.delete(id);
timers.setTimeout = setTimeout; timers.clearTimeout = clearTimeout;
globalThis.window = timers;
globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible", body: { nodeType: 1 } });
globalThis.localStorage = storage(); globalThis.sessionStorage = storage(); timers.localStorage = localStorage;
const locks = new Set();
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (name, options, callback) => { if (locks.has(name)) return callback(null); locks.add(name); try { return await callback({ name }); } finally { locks.delete(name); } } } } });
let currentUser = "fixture-user";
let mode = "normal", currentSection = "A", sessionId, lease, closed = false, closeCalls = 0;
const accepted = new Map(), submitted = [], readiness = [];
globalThis.fetch = async (url, options) => {
  const body = options?.body ? JSON.parse(options.body) : {};
  if (mode === "offline") throw new Error("offline");
  if (url === "/api/reading/session" && !options) return Response.json({ userId: currentUser, ledgerEnabled: true });
  if (url === "/api/reading/session" && options.method === "POST") { currentSection = body.sectionId; sessionId = body.sessionId; return Response.json({ id: sessionId }); }
  if (url === "/api/reading/lease") {
    if (mode === "taken-over") return Response.json({ error: "stale" }, { status: 409 });
    lease ||= { sessionId, ownerToken: "fixture-owner", fencingVersion: 1, heartbeatIntervalSeconds: 15 };
    return Response.json({ ...lease, leaseExpiresAt: new Date(100000 + clock + 45000).toISOString(), serverNow: new Date(100000 + clock).toISOString() });
  }
  if (String(url).startsWith("/api/reading/delta?")) { const ids = new URL(url, "http://fixture.invalid").searchParams.getAll("deltaId"); return Response.json({ accepted: ids.filter(id => accepted.has(id)) }); }
  if (url === "/api/reading/delta") {
    submitted.push(body);
    if (mode === "taken-over" || closed) return Response.json({ error: "stale" }, { status: 409 });
    accepted.set(body.deltaId, body); return Response.json(body);
  }
  if (url === "/api/reading/session" && options.method === "PATCH") { closeCalls++; closed = true; return Response.json({ summary: { bookTitle: "Fixture", sectionTitle: currentSection, durationSeconds: [...accepted.values()].reduce((sum, delta) => sum + delta.seconds, 0), lookupCount: 0, savedVocabularyCount: 0, highlightCount: 0 } }); }
  throw new Error(`Unexpected request ${url}`);
};
let owner = { cells: [], effects: [], index: 0, dirty: true, tree: null };
const props = { contentId: "fixture-book", sectionId: "A", onSessionReady: value => readiness.push(value) };
async function settle() {
  for (let round = 0; round < 15; round++) {
    if (owner.dirty) { current = owner; owner.index = 0; owner.dirty = false; owner.tree = FocusTimer(props); const effects = owner.effects.splice(0); for (const effect of effects) effect(); }
    await new Promise(resolve => setImmediate(resolve));
  }
}
async function tick(count = 1) { for (let i = 0; i < count; i++) { clock += 1000; for (const timer of [...intervals.values()]) if (timer.ms === 1000) timer.callback(); await settle(); } }

test("actual FocusTimer synchronizes chapters and persists old-section seconds", async () => {
  localStorage.setItem("enjoy-reading-session:fixture-book", JSON.stringify({ contentId: "fixture-book", targetSeconds: null, elapsedActiveSeconds: 0, idlePauseSeconds: 600, status: "active", lastActivityAt: Date.now() }));
  await settle();
  assert.equal(getReadingBinding("fixture-book").sectionId, "A");
  await tick(3);
  props.sectionId = "B"; owner.dirty = true; await settle();
  assert.equal(getReadingBinding("fixture-book").sectionId, "B");
  assert.equal(submitted[0].sectionId, "A"); assert.equal(submitted[0].seconds, 3);
  await tick(2);
});
test("lease deadline prevents counting offline/sleep time; original identity resumes", async () => {
  mode = "offline"; clock += 50000; await tick(2);
  const before = owner.cells[0].value.elapsedActiveSeconds;
  await tick(3); assert.equal(owner.cells[0].value.elapsedActiveSeconds, before);
  mode = "normal"; window.dispatchEvent(new Event("online")); await settle();
  await tick(); assert.equal(owner.cells[0].value.elapsedActiveSeconds, before + 1);
});
test("refresh restores the same tab session and pending IDs without extra counted time", async () => {
  const original = sessionId;
  await tick();
  const before = owner.cells[0].value.elapsedActiveSeconds;
  for (const cell of owner.cells) cell?.cleanup?.();
  await new Promise(resolve => setImmediate(resolve));
  owner = { cells: [], effects: [], index: 0, dirty: true, tree: null };
  await settle();
  assert.equal(sessionId, original);
  assert.equal(owner.cells[0].value.elapsedActiveSeconds, before);
  assert.equal(getReadingBinding("fixture-book").sectionId, "B");
  await tick();
});
test("failed exit pauses actual timer, retries the same deltas, and remains usable", async () => {
  mode = "offline"; window.dispatchEvent(new Event("enjoy-reader-exit")); await settle();
  assert.equal(owner.cells[0].value.status, "paused");
  const before = owner.cells[0].value.elapsedActiveSeconds;
  await tick(3); assert.equal(owner.cells[0].value.elapsedActiveSeconds, before);
  assert.equal(closeCalls, 0);
});
test("takeover offers explicit accepted-only exit and keeps unaccepted IDs locally", async () => {
  mode = "taken-over"; window.dispatchEvent(new Event("enjoy-reader-exit")); await settle();
  const partial = nodes(owner.tree).find(node => node.type === "button" && node.props.children === "按已同步记录退出");
  assert.ok(partial); const queuedBefore = [...localStorage.values.entries()].find(([key]) => key.includes("ledger:v2") && !key.endsWith(":pending") && !key.endsWith(":close"));
  assert.ok(JSON.parse(queuedBefore[1]).length);
  partial.props.onClick(); await settle();
  assert.equal(closeCalls, 1); assert.ok([...localStorage.values.keys()].some(key => key.endsWith(":unresolved")));
  assert.ok(nodes(owner.tree).some(node => node.props?.role === "dialog"));
});
test("receipt freezes timing and repeated exit cannot close or submit again", async () => {
  const before = submitted.length;
  await tick(4); window.dispatchEvent(new Event("enjoy-reader-exit")); await settle();
  assert.equal(closeCalls, 1); assert.equal(submitted.length, before);
  assert.equal(getReadingBinding("fixture-book"), null);
  for (const cell of owner.cells) cell?.cleanup?.();
});

test("initial offline identity and failed chapter update recover on online", async () => {
  mode = "offline"; closed = false; lease = null;
  owner = { cells: [], effects: [], index: 0, dirty: true, tree: null };
  await settle();
  assert.equal(getReadingBinding("fixture-book"), null);
  mode = "normal"; window.dispatchEvent(new Event("online")); await settle();
  assert.equal(getReadingBinding("fixture-book").sectionId, "B");
  mode = "offline"; props.sectionId = "C"; owner.dirty = true; await settle();
  assert.equal(getReadingBinding("fixture-book"), null);
  mode = "normal"; window.dispatchEvent(new Event("online")); await settle();
  assert.equal(getReadingBinding("fixture-book").sectionId, "C");
  const before = owner.cells[0].value.elapsedActiveSeconds;
  clock += 10000; await tick();
  assert.equal(owner.cells[0].value.elapsedActiveSeconds, before);
  for (const cell of owner.cells) cell?.cleanup?.();
});

test("account switch uses a fresh timer/session and preserves the prior account queue", async () => {
  const oldKeys = [...localStorage.values.keys()].filter(key => key.startsWith("enjoy-reading-ledger:v2:fixture-user:"));
  const oldId = sessionId;
  currentUser = "fixture-other"; lease = null;
  owner = { cells: [], effects: [], index: 0, dirty: true, tree: null };
  await settle();
  assert.notEqual(sessionId, oldId);
  assert.equal(getReadingBinding("fixture-book").userId, "fixture-other");
  assert.equal(owner.cells[0].value.elapsedActiveSeconds, 0);
  assert.ok(oldKeys.every(key => localStorage.getItem(key) !== null));
  await tick();
  for (const cell of owner.cells) cell?.cleanup?.();
  assert.ok([...localStorage.values.keys()].some(key => key.startsWith("enjoy-reading-ledger:v2:fixture-other:")));
});

test("actual pasted-text modal releases busy state after preview and confirmation network failure", async () => {
  const BookImportModal = require("@/components/reader/BookImportModal").default;
  const modal = { cells: [], effects: [], index: 0, dirty: true, tree: null };
  let closedModal = 0;
  const draw = () => { current = modal; modal.index = 0; modal.tree = BookImportModal({ open: true, onClose: () => closedModal++, onImported: () => {} }); };
  draw();
  nodes(modal.tree).find(node => node.type === "button" && node.props.children === "粘贴文本").props.onClick(); draw();
  const inputs = nodes(modal.tree).filter(node => node.type === "input");
  inputs[0].props.onChange({ target: { value: "Fixture" } });
  nodes(modal.tree).find(node => node.type === "textarea").props.onChange({ target: { value: "A quiet garden." } }); draw();
  globalThis.fetch = async () => { throw new Error("offline"); };
  let action = nodes(modal.tree).filter(node => node.type === "button").at(-1);
  await action.props.onClick(); draw();
  action = nodes(modal.tree).filter(node => node.type === "button").at(-1);
  assert.equal(action.props.disabled, false);
  globalThis.fetch = async () => Response.json({ title: "Fixture", excerpt: "A quiet garden.", wordCount: 3, previewToken: "fixture", expiresAt: Date.now() + 10000 });
  await action.props.onClick(); draw();
  globalThis.fetch = async () => { throw new Error("offline"); };
  await nodes(modal.tree).filter(node => node.type === "button").at(-1).props.onClick(); draw();
  assert.equal(nodes(modal.tree).filter(node => node.type === "button").at(-1).props.disabled, false);
  nodes(modal.tree).find(node => node.type === "button" && node.props.children === "取消").props.onClick();
  assert.equal(closedModal, 1);
});

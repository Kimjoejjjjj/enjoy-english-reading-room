import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { restoreDeletedHighlight } from "../src/lib/highlight-undo.ts";

test("restored highlight returns to created-at order without duplication", () => {
  const newest = { id: "newest", createdAt: "2026-10-06T03:00:00.000Z" };
  const middle = { id: "middle", createdAt: "2026-10-06T02:00:00.000Z" };
  const oldest = { id: "oldest", createdAt: "2026-10-06T01:00:00.000Z" };

  assert.deepEqual(restoreDeletedHighlight([newest, oldest], middle), [newest, middle, oldest]);
  assert.deepEqual(restoreDeletedHighlight([newest, middle, oldest], middle), [newest, middle, oldest]);
});

test("undo restores the pending item locally instead of calling highlight creation", () => {
  const source = readFileSync(new URL("../src/components/reader/HighlightsManager.tsx", import.meta.url), "utf8");
  const undoBlock = source.slice(source.indexOf("const undoDelete"), source.indexOf("if (loading)"));

  assert.match(undoBlock, /restoreDeletedHighlight\(current, deleted\)/);
  assert.match(undoBlock, /pendingDelete\.current = null/);
  assert.doesNotMatch(undoBlock, /fetch\(/);
  assert.doesNotMatch(undoBlock, /method: "POST"/);
});

test("delete is committed after the undo window and flushed when leaving", () => {
  const source = readFileSync(new URL("../src/components/reader/HighlightsManager.tsx", import.meta.url), "utf8");

  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]*persistHighlightDelete\(item\);[\s\S]*\}, 7000\)/);
  assert.match(source, /method: "DELETE", keepalive: true/);
  assert.match(source, /删除失败，高亮已恢复/);
});

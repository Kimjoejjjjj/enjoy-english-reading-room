import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/reader/HighlightsManager.tsx", import.meta.url), "utf8");

test("highlight filters keep search and book filtering behavior", () => {
  assert.match(source, /if \(bookFilter !== "ALL" && highlight\.contentId !== bookFilter\) return false/);
  assert.match(source, /query\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /setBookFilter/);
});

test("highlight book filter uses the styled accessible select instead of a native select", () => {
  assert.match(source, /import \{ Select \} from "@base-ui\/react\/select"/);
  assert.match(source, /<Select\.Root<string>/);
  assert.match(source, /<Select\.ItemIndicator/);
  assert.match(source, /data-\[highlighted\]:bg-\[var\(--green\)\]\/10/);
  assert.doesNotMatch(source, /<select[\s>]/);
});

test("highlight search and book filter are separate equal-height responsive controls", () => {
  assert.match(source, /md:grid-cols-\[minmax\(0,1fr\)_minmax\(13rem,17rem\)\]/);
  assert.match(source, /focus-within:border-\[var\(--green\)\]/);
  assert.match(source, /<Select\.Trigger[\s\S]*className="flex h-11/);
  assert.match(source, /<div className="flex h-11 min-w-0 items-center/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildHighlightLabelMappingPreview, HIGHLIGHT_REVIEW_SLOTS, isHighlightReviewEnabled } from "../src/lib/highlight-review-contract.ts";

test("fixed review slots separate stable identity/default eligibility from name and color", () => {
  assert.deepEqual(HIGHLIGHT_REVIEW_SLOTS.map(({ slotKey, reviewEnabled }) => [slotKey, reviewEnabled]), [["QUOTE", false], ["UNCLEAR", true], ["IMPORTANT", true]]);
  assert.equal(isHighlightReviewEnabled({ slotKey: "UNCLEAR", reviewEnabled: true }), true);
  assert.equal(isHighlightReviewEnabled({ slotKey: "QUOTE", reviewEnabled: false }), false);
  assert.equal(isHighlightReviewEnabled({ slotKey: null, reviewEnabled: true }), false);
  assert.equal(isHighlightReviewEnabled({ slotKey: "UNKNOWN", reviewEnabled: true }), false);
});

test("mapping preview resolves only exact confirmed names and leaves 新/新2 unresolved", () => {
  const preview = buildHighlightLabelMappingPreview([
    { id: "quote", name: "金句", color: "AMBER", archived: false },
    { id: "new-one", name: "新", color: "PLUM", archived: true },
    { id: "new-two", name: "新2", color: "BRICK", archived: true },
  ], [
    { labelId: "quote", color: "RED", count: 2 },
    { labelId: "new-one", color: "YELLOW", count: 1 },
    { labelId: null, color: "GREEN", count: 1 },
  ]);
  assert.equal(preview.mappings[0].targetSlot, "QUOTE");
  assert.deepEqual(preview.unresolvedLabels.map((item) => item.name), ["新", "新2"]);
  assert.equal(preview.legacyColorCounts.RED, 2);
  assert.equal(preview.legacyColorCounts.YELLOW, 1);
  assert.equal(preview.legacyColorCounts.GREEN, 1);
  assert.equal(preview.unlabeledCount, 1);
  assert.equal(preview.canProceed, false);
});

test("label GET is read-only and PATCH updates only the requested label", () => {
  const route = readFileSync(new URL("../src/app/api/highlight-labels/route.ts", import.meta.url), "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(get, /\.create\(|\.update\(|updateMany|\.upsert\(/);
  const patch = route.slice(route.indexOf("export async function PATCH"), route.indexOf("export async function DELETE"));
  assert.match(patch, /highlightLabel\.update\(\{ where: \{ id: existing\.id \}, data \}\)/);
  assert.doesNotMatch(patch, /highlight\.updateMany|ensureFixedLabels|slotKey\s*:/);
  assert.match(patch, /reviewEnabled/);
  const review = readFileSync(new URL("../src/app/api/highlight-reviews/route.ts", import.meta.url), "utf8");
  assert.match(review, /slotKey: \{ not: null \}, reviewEnabled: true/);
  assert.doesNotMatch(review, /color: \{ in: \["RED", "YELLOW"\] \}/);
});

test("mapping preview is authenticated and runs label/count reads in one read transaction", () => {
  const route = readFileSync(new URL("../src/app/api/highlight-labels/mapping-preview/route.ts", import.meta.url), "utf8");
  assert.match(route, /getUserId\(req\)/);
  assert.match(route, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(route, /highlightLabel\.findMany[\s\S]*highlight\.groupBy/);
  assert.match(route, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.doesNotMatch(route, /\.create\(|\.update\(|deleteMany|\.upsert\(/);
});
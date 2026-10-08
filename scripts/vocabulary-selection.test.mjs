import test from "node:test";
import assert from "node:assert/strict";
import { classifyVocabularySelection, normalizeNestedDictionaryWord } from "../src/lib/vocabulary-selection.ts";

test("classifies and normalizes words and phrases without losing the original selection", () => {
  assert.deepEqual(classifyVocabularySelection("  \"Don't\"  "), { entryType: "WORD", normalized: "don't", selectedText: "\"Don't\"" });
  assert.deepEqual(classifyVocabularySelection("  in   spite of! "), { entryType: "PHRASE", normalized: "in spite of", selectedText: "in spite of!" });
});

test("rejects non-English selections and keeps nested dictionary lookup word-only", () => {
  assert.equal(classifyVocabularySelection("中文"), null);
  assert.equal(normalizeNestedDictionaryWord("single"), "single");
  assert.equal(normalizeNestedDictionaryWord("two words"), null);
});

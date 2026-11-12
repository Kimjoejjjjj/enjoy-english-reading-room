import test from "node:test";
import assert from "node:assert/strict";
import { classifyPhraseSelection, classifyVocabularySelection, normalizeNestedDictionaryWord, readPhraseTextSelection } from "../src/lib/vocabulary-selection.ts";

test("classifies and normalizes words and phrases without losing the original selection", () => {
  assert.deepEqual(classifyVocabularySelection("  \"Don't\"  "), { entryType: "WORD", normalized: "don't", selectedText: "\"Don't\"" });
  assert.deepEqual(classifyVocabularySelection("  in   spite of! "), { entryType: "PHRASE", normalized: "in spite of", selectedText: "in spite of!" });
});

test("rejects non-English selections and keeps nested dictionary lookup word-only", () => {
  assert.equal(classifyVocabularySelection("中文"), null);
  assert.equal(normalizeNestedDictionaryWord("single"), "single");
  assert.equal(normalizeNestedDictionaryWord("two words"), null);
  assert.equal(normalizeNestedDictionaryWord("This is a complete sentence"), null);
});

test("phrase saving accepts short multiword selections without reopening dictionary lookup", () => {
  assert.deepEqual(classifyPhraseSelection("  in spite of! ", 6), { entryType: "PHRASE", normalized: "in spite of", selectedText: "in spite of!" });
  assert.equal(classifyPhraseSelection("single", 6), null);
  assert.equal(classifyPhraseSelection("one two three four five six", 6)?.normalized, "one two three four five six");
  assert.equal(classifyPhraseSelection("one two three four five six seven", 6), null);
  assert.equal(classifyPhraseSelection("one two three four five six seven eight", 8)?.entryType, "PHRASE");
  assert.equal(classifyPhraseSelection("one two three four five six seven eight nine", 8), null);
});

test("a long sentence can be edited down to a phrase for manual saving", () => {
  const sentence = "He succeeded in spite of the many difficulties he faced.";
  assert.equal(normalizeNestedDictionaryWord(sentence), null);
  assert.equal(classifyPhraseSelection(sentence, 8), null);
  assert.equal(classifyPhraseSelection("in spite of", 8)?.normalized, "in spite of");
});

test("phrase draft auto-fill accepts only text selected inside the current quote", () => {
  const quoteNode = { id: "current-quote" };
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: quoteNode }),
    toString: () => "  in   spite\nof  ",
  };
  assert.equal(readPhraseTextSelection(selection, (node) => node === quoteNode), "in spite of");
  assert.equal(readPhraseTextSelection(selection, () => false), "", "selections elsewhere cannot overwrite the draft");
  assert.equal(readPhraseTextSelection({ ...selection, isCollapsed: true }, () => true), "");
  assert.equal(readPhraseTextSelection({ ...selection, rangeCount: 0 }, () => true), "");
  assert.equal(readPhraseTextSelection(null, () => true), "");
});


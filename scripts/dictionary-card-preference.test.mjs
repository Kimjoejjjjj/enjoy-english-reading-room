import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_DICTIONARY_CARD_OVERFLOW_MODE,
  DICTIONARY_CARD_OVERFLOW_MODE_EVENT,
  DICTIONARY_CARD_OVERFLOW_MODE_KEY,
  focusExpandedDictionaryCard,
  MAX_DICTIONARY_CARDS,
  MAX_EXPANDED_DICTIONARY_CARDS,
  normalizeDictionaryCardOverflowMode,
  readDictionaryCardOverflowMode,
  removeExpandedDictionaryCard,
  toggleExpandedDictionaryCard,
  writeDictionaryCardOverflowMode,
} from "../src/lib/dictionary-card-preference.ts";

test("dictionary card overflow preference defaults to ask and persists replace-oldest", () => {
  assert.equal(normalizeDictionaryCardOverflowMode(null), DEFAULT_DICTIONARY_CARD_OVERFLOW_MODE);
  assert.equal(normalizeDictionaryCardOverflowMode("invalid"), "ask");
  assert.equal(normalizeDictionaryCardOverflowMode("replace-oldest"), "replace-oldest");

  const values = new Map();
  const events = [];
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    dispatchEvent: (event) => events.push(event),
  };

  try {
    assert.equal(readDictionaryCardOverflowMode(), "ask");
    writeDictionaryCardOverflowMode("replace-oldest");
    assert.equal(values.get(DICTIONARY_CARD_OVERFLOW_MODE_KEY), "replace-oldest");
    assert.equal(readDictionaryCardOverflowMode(), "replace-oldest");
    assert.equal(events.at(-1)?.type, DICTIONARY_CARD_OVERFLOW_MODE_EVENT);
    assert.equal(events.at(-1)?.detail, "replace-oldest");
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
});

test("expanded card queue keeps the five most recently expanded cards", () => {
  let expanded = [];
  for (const id of ["one", "two", "three", "four", "five"]) {
    expanded = focusExpandedDictionaryCard(expanded, id);
  }
  assert.equal(MAX_EXPANDED_DICTIONARY_CARDS, 5);
  assert.deepEqual(expanded, ["one", "two", "three", "four", "five"]);

  expanded = focusExpandedDictionaryCard(expanded, "six");
  assert.deepEqual(expanded, ["two", "three", "four", "five", "six"]);

  expanded = focusExpandedDictionaryCard(expanded, "three");
  assert.deepEqual(expanded, ["two", "four", "five", "six", "three"]);

  expanded = toggleExpandedDictionaryCard(expanded, "four");
  assert.deepEqual(expanded, ["two", "five", "six", "three"]);
  assert.deepEqual(removeExpandedDictionaryCard(expanded, "six"), ["two", "five", "three"]);
});

test("reader and settings expose the 15-card replacement controls", () => {
  const reader = readFileSync(new URL("../src/components/reader/ReaderInspector.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/app/dashboard/settings/page.tsx", import.meta.url), "utf8");

  assert.equal(MAX_DICTIONARY_CARDS, 15);
  assert.match(reader, /focusExpandedDictionaryCard/);
  assert.match(reader, /toggleExpandedDictionaryCard/);
  assert.match(reader, /确认后，以后达到上限将自动移除最早词卡/);
  assert.match(reader, /writeDictionaryCardOverflowMode\("replace-oldest"\)/);
  assert.match(settings, /词卡满 15 张时/);
  assert.match(settings, /updateDictionaryCardOverflowMode\("ask"\)/);
  assert.match(settings, /updateDictionaryCardOverflowMode\("replace-oldest"\)/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DICTIONARY_CACHE_VERSION,
  classifyDictionaryHttpStatus,
  combineDictionaryResults,
  getPrimaryChineseWords,
  parseCachedMeanings,
  parseFreeDictionaryApi,
  resolveDictionaryAttempts,
} from "../src/lib/dictionary-contract.ts";

const freeFixture = {
  word: "Bright",
  entries: [{
    partOfSpeech: "adjective",
    pronunciations: [{ text: "/braɪt/" }],
    forms: [{ word: "brighter", tags: ["comparative"] }, { word: "brighter", tags: ["comparative", "UK"] }],
    senses: [
      { definition: "Giving out or reflecting a lot of light.", examples: ["A bright room."], translations: [{ language: { code: "zh" }, word: "明亮" }], subsenses: [{ definition: "With a vivid colour.", translations: [{ language: { code: "zh" }, word: "鲜艳／鮮艷" }, { language: { code: "zh" }, word: "not-chinese" }] }] },
      { definition: "Intelligent and quick-witted.", examples: ["A bright student."] },
    ],
  }],
  source: { url: "https://en.wiktionary.org/wiki/bright", license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" } },
};

const wordNetFixture = {
  lemma: "bright",
  definition: "Giving out or reflecting a lot of light.",
  phonetic: null,
  audioUrl: null,
  meanings: [{
    partOfSpeech: "adjective",
    definitions: [
      { id: "m1d1", definition: "Giving out or reflecting a lot of light.", example: null },
      { id: "m1d2", definition: "Full of promise.", example: "A bright future." },
    ],
  }],
  translations: [],
  source: { provider: "Open English WordNet", url: "https://en-word.net/", licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", version: "2025 Core" },
  sources: [{ provider: "Open English WordNet", url: "https://en-word.net/", licenseName: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", version: "2025 Core" }],
};

test("combines WordNet then Wiktionary with stable deduped IDs", () => {
  const free = parseFreeDictionaryApi(freeFixture, "bright");
  assert.ok(free);
  const result = combineDictionaryResults([wordNetFixture, free]);
  assert.ok(result);
  assert.equal(result.lemma, "bright");
  assert.equal(result.phonetic, "/braɪt/");
  assert.equal(result.audioUrl, null);
  assert.deepEqual(result.meanings[0].definitions.map(({ id, definition, example }) => ({ id, definition, example })), [
    { id: "m1d1", definition: "Giving out or reflecting a lot of light.", example: "A bright room." },
    { id: "m1d2", definition: "Full of promise.", example: "A bright future." },
    { id: "m1d3", definition: "Intelligent and quick-witted.", example: "A bright student." },
  ]);
  assert.equal(result.sources.length, 2);
  assert.equal(result.source.licenseName, "CC BY 4.0 · CC BY-SA 4.0");
  assert.equal(result.source.licenseUrl, null);
  assert.deepEqual(result.translations, [
    { language: "zh", words: ["明亮"], partOfSpeech: "adjective", definition: "Giving out or reflecting a lot of light.", tags: [], secondary: false },
    { language: "zh", words: ["鲜艳", "鮮艷"], partOfSpeech: "adjective", definition: "With a vivid colour.", tags: [], secondary: false },
  ]);
  assert.deepEqual(result.forms, [{ word: "brighter", tags: ["comparative", "UK"] }]);
});

test("Wiktionary parser keeps Chinese equivalents aligned to their part of speech and sense", () => {
  const result = parseFreeDictionaryApi(freeFixture, "bright");
  assert.equal(result.meanings[0].definitions[0].id, "m1d1");
  assert.equal(result.sources[0].licenseName, "CC BY-SA 4.0");
  assert.deepEqual(result.translations.map(({ partOfSpeech, definition, words }) => ({ partOfSpeech, definition, words })), [
    { partOfSpeech: "adjective", definition: "Giving out or reflecting a lot of light.", words: ["明亮"] },
    { partOfSpeech: "adjective", definition: "With a vivid colour.", words: ["鲜艳", "鮮艷"] },
  ]);
});

test("specialized, archaic, and rare equivalents do not become the saved primary translation", () => {
  const result = parseFreeDictionaryApi({
    word: "hole",
    entries: [{
      partOfSpeech: "noun",
      senses: [
        { definition: "An opening into or through something.", translations: [{ language: { code: "zh" }, word: "洞／孔" }] },
        { definition: "The absence of an electron in a semiconductor.", translations: [{ language: { code: "zh" }, word: "电洞" }] },
        { definition: "An old hiding place.", tags: ["archaic"], translations: [{ language: { code: "zh" }, word: "旧穴" }] },
      ],
    }],
  }, "hole");
  assert.deepEqual(result.translations.map(({ words, secondary }) => ({ words, secondary })), [
    { words: ["洞", "孔"], secondary: false },
    { words: ["电洞"], secondary: true },
    { words: ["旧穴"], secondary: true },
  ]);
  assert.deepEqual(getPrimaryChineseWords(result.translations), ["洞", "孔"]);
});

test("against and legend style source gaps remain honest instead of synthesizing Chinese", () => {
  for (const word of ["against", "legend"]) {
    const result = parseFreeDictionaryApi({ word, entries: [{ partOfSpeech: "noun", senses: [{ definition: `English definition for ${word}.` }] }] }, word);
    assert.deepEqual(result.translations, [], word);
    assert.deepEqual(getPrimaryChineseWords(result.translations), [], word);
  }
});

test("provider 404 and empty meanings are notFound, while timeout/network is unavailable", () => {
  const noMeaning = resolveDictionaryAttempts("missing", [
    classifyDictionaryHttpStatus(404),
    classifyDictionaryHttpStatus(404),
  ]);
  assert.equal(noMeaning.notFound, true);
  assert.equal(noMeaning.unavailable, false);
  assert.deepEqual(noMeaning.meanings, []);

  const unavailable = resolveDictionaryAttempts("missing", [
    classifyDictionaryHttpStatus(500),
    classifyDictionaryHttpStatus(503),
  ]);
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.notFound, false);
  assert.equal(Boolean(unavailable.unavailable), true, "ReaderInspector enters fallback only for unavailable responses");
  assert.equal(Boolean(noMeaning.unavailable), false, "ReaderInspector does not fallback for a 404 not-found response");
});

test("429 and 500/503 remain available for fallback while another provider can still succeed", () => {
  assert.deepEqual(classifyDictionaryHttpStatus(429), { responded: false, result: null });
  assert.deepEqual(classifyDictionaryHttpStatus(500), { responded: false, result: null });
  assert.deepEqual(classifyDictionaryHttpStatus(503), { responded: false, result: null });
  const free = parseFreeDictionaryApi(freeFixture, "bright");
  const result = resolveDictionaryAttempts("bright", [
    classifyDictionaryHttpStatus(503),
    { responded: true, result: free },
  ]);
  assert.equal(result.definition, "Giving out or reflecting a lot of light.");
  assert.equal(result.unavailable, undefined);
  assert.equal(result.notFound, undefined);
});

test("one successful provider survives the other provider failure", () => {
  const free = parseFreeDictionaryApi(freeFixture, "bright");
  const result = resolveDictionaryAttempts("bright", [
    { responded: false, result: null },
    { responded: true, result: free },
  ]);
  assert.equal(result.unavailable, undefined);
  assert.equal(result.notFound, undefined);
  assert.equal(result.source.provider, "FreeDictionaryAPI · Wiktionary");
});

test("cache accepts only version 5 payloads with sense-aligned translations", () => {
  const parsed = parseFreeDictionaryApi(freeFixture, "bright");
  const valid = JSON.stringify({ version: DICTIONARY_CACHE_VERSION, meanings: parsed.meanings, translations: parsed.translations, sources: parsed.sources, forms: parsed.forms });
  assert.deepEqual(parseCachedMeanings(valid), { version: 5, meanings: parsed.meanings, translations: parsed.translations, sources: parsed.sources, forms: parsed.forms });
  assert.equal(parseCachedMeanings(JSON.stringify({ version: 4, meanings: parsed.meanings, translations: parsed.translations, sources: parsed.sources, forms: parsed.forms })), null);
  assert.equal(parseCachedMeanings(JSON.stringify({ version: 5, meanings: [], translations: parsed.translations, sources: parsed.sources, forms: parsed.forms })), null);
  assert.equal(parseCachedMeanings(JSON.stringify({ version: 5, meanings: parsed.meanings, translations: parsed.translations, sources: [], forms: parsed.forms })), null);
  assert.equal(parseCachedMeanings(JSON.stringify({ version: 5, meanings: parsed.meanings, translations: parsed.translations, sources: parsed.sources })), null);
  assert.equal(parseCachedMeanings(JSON.stringify({ version: 5, meanings: parsed.meanings, translations: [{ language: "zh", words: ["明亮"] }], sources: parsed.sources, forms: parsed.forms })), null);
  assert.equal(parseCachedMeanings("not-json"), null);
});

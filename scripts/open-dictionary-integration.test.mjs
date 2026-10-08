import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import OpenCC from "opencc-js";
import { lookupOpenEnglishWordNet, resolveOpenEnglishWordNetForm } from "../src/lib/open-english-wordnet.ts";
import { normalizeDictionaryDisplayMode } from "../src/lib/dictionary-display-preference.ts";

const shard = (name) => JSON.parse(readFileSync(new URL(`../vendor/dictionaries/generated/entries-${name}.json`, import.meta.url), "utf8"));

test("pinned Open English WordNet index contains common parts of speech and ordered senses", () => {
  const bright = shard("b").bright;
  const run = shard("r").run;
  const book = shard("b").book;
  assert.equal(bright[0].partOfSpeech, "adjective");
  assert.match(bright[0].definition, /light/i);
  assert.ok(run.some((item) => item.partOfSpeech === "verb"));
  assert.ok(book.some((item) => item.partOfSpeech === "noun"));
  assert.ok(bright.length > 2, "multiple senses are retained");
});

test("traditional Chinese equivalents convert deterministically to simplified Chinese", () => {
  const convert = OpenCC.Converter({ from: "hk", to: "cn" });
  assert.equal(convert("鮮艷"), "鲜艳");
  assert.equal(convert("蘋果"), "苹果");
});

test("word forms resolve to canonical lemmas while true ambiguity remains explicit", async () => {
  const cases = {
    cats: ["cat", "plural"],
    studies: ["study", "plural"],
    running: ["run", "presentParticiple"],
    stopped: ["stop", "past"],
    larger: ["large", "comparative"],
    went: ["go", "past"],
    gone: ["go", "pastParticiple"],
    better: ["good", "comparative"],
    best: ["good", "superlative"],
    mice: ["mouse", "plural"],
  };
  for (const [word, [lemma, relation]] of Object.entries(cases)) {
    const candidates = await resolveOpenEnglishWordNetForm(word);
    assert.equal(candidates.length, 1, word);
    assert.equal(candidates[0].lemma, lemma, word);
    assert.equal(candidates[0].relation, relation, word);
    assert.ok(await lookupOpenEnglishWordNet(lemma), lemma);
  }
  assert.deepEqual((await resolveOpenEnglishWordNetForm("axes")).map((candidate) => candidate.lemma), ["ax", "axis"]);
  assert.ok((await lookupOpenEnglishWordNet("running")).meanings.some((meaning) => meaning.partOfSpeech === "noun"));
});

test("dictionary display mode defaults to bilingual and accepts English-only", () => {
  assert.equal(normalizeDictionaryDisplayMode(null), "bilingual");
  assert.equal(normalizeDictionaryDisplayMode("unknown"), "bilingual");
  assert.equal(normalizeDictionaryDisplayMode("english"), "english");
});

test("dictionary traffic is server-only and DictionaryAPI.dev is no longer in the provider chain", () => {
  const route = readFileSync(new URL("../src/app/api/vocabulary/lookup/route.ts", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../src/components/reader/ReaderInspector.tsx", import.meta.url), "utf8");
  assert.match(route, /lookupOpenEnglishWordNet/);
  assert.match(route, /freedictionaryapi\.com[\s\S]*translations=true/);
  assert.doesNotMatch(route, /dictionaryapi\.dev/);
  assert.doesNotMatch(reader, /freedictionaryapi\.com|dictionaryapi\.dev|parseFreeDictionaryApi/);
});

test("reader keeps common results concise and places full or specialized material behind disclosure controls", () => {
  const reader = readFileSync(new URL("../src/components/reader/ReaderInspector.tsx", import.meta.url), "utf8");
  assert.match(reader, /sliceDictionaryMeanings\(card\.meanings, 0, 4\)/);
  assert.match(reader, /常用中文对应词（Wiktionary）/);
  assert.match(reader, /查看专业、古旧或罕见对应词/);
  assert.match(reader, /查看完整释义/);
  assert.match(reader, /getPrimaryChineseWords\(card\.translations \|\| \[\]\)/);
});

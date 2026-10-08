import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AI_GRAMMAR_CONTRACT_VERSION, formatGrammarExplanation, parseGrammarOutput } from "../src/lib/ai-grammar-contract.ts";

const valid = JSON.stringify({
  summary: "This sentence uses the present perfect.",
  points: [{ label: "have finished", explanation: "Have plus the past participle marks a completed action with present relevance.", evidence: "I have finished." }],
});

test("grammar.v2 accepts bounded strict JSON and renders natural text", () => {
  assert.equal(AI_GRAMMAR_CONTRACT_VERSION, "grammar.v2");
  const grammar = parseGrammarOutput(valid);
  assert.ok(grammar);
  assert.match(formatGrammarExplanation(grammar, "en", "Evidence"), /\n  Evidence: I have finished\./);
  assert.doesNotMatch(formatGrammarExplanation(grammar, "zh-CN", "原文依据"), /^\s*\{/);
});

test("grammar.v2 rejects malformed, markdown, unknown, empty, and oversized output", () => {
  assert.equal(parseGrammarOutput("```json\n" + valid + "\n```"), null);
  assert.equal(parseGrammarOutput(JSON.stringify({ summary: "ok", points: [{ label: "x", explanation: "y" }], extra: true })), null);
  assert.equal(parseGrammarOutput(JSON.stringify({ summary: "ok", points: [{ label: "x", explanation: "y", extra: true }] })), null);
  assert.equal(parseGrammarOutput(JSON.stringify({ summary: "ok", points: [] })), null);
  assert.equal(parseGrammarOutput(JSON.stringify({ summary: "ok", points: [{ label: "x", explanation: "y", evidence: "" }] })), null);
  assert.equal(parseGrammarOutput(JSON.stringify({ summary: "x".repeat(1_201), points: [{ label: "x", explanation: "y" }] })), null);
  assert.equal(parseGrammarOutput(JSON.stringify({ summary: "ok", points: [{ label: "x", explanation: "y".repeat(801) }] })), null);
  assert.equal(parseGrammarOutput("not json"), null);
});

test("Explain binds grammar.v2 into cache identity and validates cache hits", () => {
  const route = readFileSync(new URL("../src/app/api/ai/explain/route.ts", import.meta.url), "utf8");
  assert.match(route, /requestType === "GRAMMAR"[\s\S]*?AI_GRAMMAR_CONTRACT_VERSION/);
  assert.match(route, /cachedNeedsValidation = \["EXPLAIN", "CONTEXT", "GRAMMAR", "QUIZ_JSON"\]/);
  assert.match(route, /requestType === "GRAMMAR" && cachedGrammar/);
  assert.match(route, /requestType === "GRAMMAR" && !grammar/);
  const provider = readFileSync(new URL("../src/lib/ai-provider.ts", import.meta.url), "utf8");
  assert.match(provider, /requestType === "EXPLAIN" \|\| requestType === "CONTEXT" \|\| requestType === "GRAMMAR" \|\| requestType === "QUIZ_JSON"/);
  const reader = readFileSync(new URL("../src/components/reader/ReaderInspector.tsx", import.meta.url), "utf8");
  assert.match(reader, /formatGrammarExplanation\(data\.grammar, locale/);
  assert.match(reader, /requestType === "GRAMMAR"\s*\? grammarOutput/);
});
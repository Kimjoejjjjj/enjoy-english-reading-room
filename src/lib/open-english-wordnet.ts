import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DictionaryInflectionCandidate, DictionaryLookupResult, DictionaryMeaning, DictionarySource } from "@/lib/dictionary-contract";

interface OpenEnglishWordNetDefinition {
  partOfSpeech: string | null;
  definition: string;
  example: string | null;
}

type OpenEnglishWordNetShard = Record<string, OpenEnglishWordNetDefinition[]>;
type OpenEnglishWordNetFormShard = Record<string, DictionaryInflectionCandidate[]>;

const shardCache = new Map<string, Promise<OpenEnglishWordNetShard>>();
const formShardCache = new Map<string, Promise<OpenEnglishWordNetFormShard>>();
const source: DictionarySource = {
  provider: "Open English WordNet",
  url: "https://en-word.net/",
  licenseName: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  version: "2025 Core",
};

function shardName(lemma: string) {
  const first = lemma[0]?.toLowerCase() || "0";
  return /^[a-z]$/.test(first) ? first : "0";
}

async function loadShard(name: string) {
  const existing = shardCache.get(name);
  if (existing) return existing;
  const indexDir = process.env.OEWN_INDEX_DIR || path.join(process.cwd(), "vendor", "dictionaries", "generated");
  const request = readFile(path.join(indexDir, `entries-${name}.json`), "utf8")
    .then((value) => JSON.parse(value) as OpenEnglishWordNetShard)
    .catch((error) => {
      shardCache.delete(name);
      throw error;
    });
  shardCache.set(name, request);
  return request;
}

async function loadFormShard(name: string) {
  const existing = formShardCache.get(name);
  if (existing) return existing;
  const indexDir = process.env.OEWN_INDEX_DIR || path.join(process.cwd(), "vendor", "dictionaries", "generated");
  const request = readFile(path.join(indexDir, `forms-${name}.json`), "utf8")
    .then((value) => JSON.parse(value) as OpenEnglishWordNetFormShard)
    .catch((error) => {
      formShardCache.delete(name);
      throw error;
    });
  formShardCache.set(name, request);
  return request;
}

export async function resolveOpenEnglishWordNetForm(lemma: string) {
  const normalized = lemma.toLowerCase();
  const shard = await loadFormShard(shardName(normalized));
  const candidates = (shard[normalized] || []).filter((candidate) => candidate.lemma !== normalized);
  const explicit = candidates.filter((candidate) => candidate.explicit);
  const relevant = explicit.length ? explicit : candidates;
  const preferredLemma = ({ better: "good", best: "good" } as Record<string, string>)[normalized];
  const preferred = preferredLemma ? relevant.filter((candidate) => candidate.lemma === preferredLemma) : relevant;
  const grouped = new Map<string, DictionaryInflectionCandidate>();
  for (const candidate of preferred.length ? preferred : relevant) {
    const existing = grouped.get(candidate.lemma);
    if (!existing || candidate.explicit && !existing.explicit) grouped.set(candidate.lemma, candidate);
  }
  return [...grouped.values()];
}

export async function lookupOpenEnglishWordNet(lemma: string): Promise<DictionaryLookupResult | null> {
  const normalized = lemma.toLowerCase();
  const shard = await loadShard(shardName(normalized));
  const definitions = shard[normalized];
  if (!definitions?.length) return null;

  const grouped = new Map<string | null, OpenEnglishWordNetDefinition[]>();
  for (const definition of definitions) {
    const values = grouped.get(definition.partOfSpeech) || [];
    if (values.length < 5) values.push(definition);
    grouped.set(definition.partOfSpeech, values);
  }
  const meanings: DictionaryMeaning[] = [...grouped.entries()].slice(0, 6).map(([partOfSpeech, values], meaningIndex) => ({
    partOfSpeech,
    definitions: values.map((value, definitionIndex) => ({
      id: `m${meaningIndex + 1}d${definitionIndex + 1}`,
      definition: value.definition,
      example: value.example,
    })),
  }));

  return {
    lemma: normalized,
    definition: meanings[0]?.definitions[0]?.definition || null,
    phonetic: null,
    audioUrl: null,
    meanings,
    translations: [],
    source,
    sources: [source],
  };
}

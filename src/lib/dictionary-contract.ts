export interface DictionaryDefinition {
  id: string;
  definition: string;
  example: string | null;
}

export interface DictionaryMeaning {
  partOfSpeech: string | null;
  definitions: DictionaryDefinition[];
}

export interface DictionaryTranslation {
  language: "zh";
  words: string[];
  partOfSpeech: string | null;
  definition: string | null;
  tags: string[];
  secondary: boolean;
}

export type DictionaryInflectionRelation =
  | "plural"
  | "thirdPersonSingular"
  | "past"
  | "pastParticiple"
  | "presentParticiple"
  | "comparative"
  | "superlative"
  | "inflected";

export interface DictionaryForm {
  word: string;
  tags: string[];
}

export interface DictionaryInflectionCandidate {
  lemma: string;
  relation: DictionaryInflectionRelation;
  partOfSpeech: string | null;
  explicit: boolean;
}

export interface DictionaryInflection {
  selectedLemma: string;
  baseLemma: string | null;
  relation: DictionaryInflectionRelation | null;
  ambiguous: boolean;
  candidates: DictionaryInflectionCandidate[];
}

export interface DictionarySource {
  provider: string;
  url: string | null;
  licenseName: string | null;
  licenseUrl: string | null;
  version?: string | null;
}

export interface DictionaryLookupResult {
  requestedLemma?: string;
  lemma: string;
  definition: string | null;
  phonetic: string | null;
  audioUrl: string | null;
  meanings: DictionaryMeaning[];
  formMeanings?: DictionaryMeaning[];
  translations: DictionaryTranslation[];
  forms?: DictionaryForm[];
  inflection?: DictionaryInflection | null;
  source: DictionarySource | null;
  sources: DictionarySource[];
  translationUnavailable?: boolean;
  cached?: boolean;
  unavailable?: boolean;
  notFound?: boolean;
}

export interface DictionaryCachePayload {
  version: number;
  meanings: DictionaryMeaning[];
  translations: DictionaryTranslation[];
  sources: DictionarySource[];
  forms: DictionaryForm[];
}

export interface DictionaryProviderAttempt {
  responded: boolean;
  result: DictionaryLookupResult | null;
}

export const DICTIONARY_CACHE_VERSION = 5;

export function classifyDictionaryHttpStatus(status: number): DictionaryProviderAttempt {
  return { responded: status === 404, result: null };
}

interface FreeTranslation { language?: { code?: string; name?: string }; word?: string }
interface FreeSense { definition?: string; examples?: string[]; translations?: FreeTranslation[]; subsenses?: FreeSense[]; tags?: string[] }
interface FreePronunciation { text?: string }
interface FreeForm { word?: string; tags?: string[] }
interface FreeEntry { partOfSpeech?: string; pronunciations?: FreePronunciation[]; forms?: FreeForm[]; senses?: FreeSense[] }
interface FreeDictionaryResponse {
  word?: string;
  entries?: FreeEntry[];
  source?: { url?: string; license?: { name?: string; url?: string } };
}

export function normalizeAudioUrl(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("//")) return `https:${value}`;
  return value.replace(/^http:\/\//i, "https://");
}

export function normalizeDictionaryLemma(value: unknown, fallback: string) {
  const lemma = typeof value === "string" ? value.toLowerCase().replace(/[^a-z'-]/g, "").slice(0, 80) : "";
  return lemma || fallback;
}

function withDefinitionIds(meanings: Array<{ partOfSpeech: string | null; definitions: Array<{ definition: string; example: string | null }> }>) {
  return meanings.map((meaning, meaningIndex) => ({
    ...meaning,
    definitions: meaning.definitions.map((definition, definitionIndex) => ({
      ...definition,
      id: `m${meaningIndex + 1}d${definitionIndex + 1}`,
    })),
  }));
}

export function parseFreeDictionaryApi(data: unknown, fallbackLemma: string): DictionaryLookupResult | null {
  const candidate = data && typeof data === "object" ? data as FreeDictionaryResponse : {};
  const entries = Array.isArray(candidate.entries) ? candidate.entries : [];
  const meanings = withDefinitionIds(entries.slice(0, 6).map((entry) => ({
    partOfSpeech: entry.partOfSpeech || null,
    definitions: (entry.senses || []).slice(0, 5).filter((sense) => Boolean(sense.definition)).map((sense) => ({ definition: sense.definition!, example: Array.isArray(sense.examples) ? sense.examples[0] || null : null })),
  })).filter((meaning) => meaning.definitions.length > 0));
  if (!meanings.length) return null;
  const pronunciation = entries.flatMap((entry) => entry.pronunciations || []).find((item) => item.text);
  const translations: DictionaryTranslation[] = [];
  const secondarySensePattern = /\b(archaic|obsolete|rare|dated|historical|nonstandard|dialectal|slang|offensive|vulgar|technical|physics|chemistry|computing|electronics|medicine|pathology|mathematics|cartography|heraldry|law|golf|electron|semiconductor|quantum|geology|anatomy|linguistics|botany|zoology|nautical)\b/i;
  const visitSenses = (senses: FreeSense[], partOfSpeech: string | null, inheritedTags: string[] = []) => {
    for (const sense of senses) {
      const tags = [...new Set([...inheritedTags, ...(Array.isArray(sense.tags) ? sense.tags.filter((tag): tag is string => typeof tag === "string") : [])])];
      const words: string[] = [];
      const seenWords = new Set<string>();
      for (const translation of sense.translations || []) {
        if (translation.language?.code !== "zh" || typeof translation.word !== "string") continue;
        for (const candidate of translation.word.split(/[／/;,，；]/)) {
          const normalized = candidate.trim();
          if (!normalized || !/\p{Script=Han}/u.test(normalized) || seenWords.has(normalized)) continue;
          seenWords.add(normalized);
          words.push(normalized);
        }
      }
      if (words.length) {
        const definition = typeof sense.definition === "string" ? sense.definition.trim() || null : null;
        translations.push({
          language: "zh",
          words,
          partOfSpeech,
          definition,
          tags,
          secondary: secondarySensePattern.test(`${tags.join(" ")} ${definition || ""}`),
        });
      }
      visitSenses(sense.subsenses || [], partOfSpeech, tags);
    }
  };
  for (const entry of entries.slice(0, 6)) visitSenses(entry.senses || [], entry.partOfSpeech || null);
  const formsByWord = new Map<string, DictionaryForm>();
  for (const form of entries.flatMap((entry) => entry.forms || [])) {
    if (typeof form.word !== "string" || !form.word.trim()) continue;
    const word = normalizeDictionaryLemma(form.word, "");
    if (!word) continue;
    const tags = Array.isArray(form.tags) ? form.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const existing = formsByWord.get(word);
    formsByWord.set(word, { word, tags: [...new Set([...(existing?.tags || []), ...tags])] });
  }
  const forms = [...formsByWord.values()];
  const source = {
    provider: "FreeDictionaryAPI · Wiktionary",
    url: candidate.source?.url || `https://en.wiktionary.org/wiki/${encodeURIComponent(fallbackLemma)}`,
    licenseName: candidate.source?.license?.name || "CC BY-SA 4.0",
    licenseUrl: candidate.source?.license?.url || "https://creativecommons.org/licenses/by-sa/4.0/",
  };
  return {
    lemma: normalizeDictionaryLemma(candidate.word, fallbackLemma),
    definition: meanings[0]?.definitions[0]?.definition || null,
    phonetic: pronunciation?.text || null,
    audioUrl: null,
    meanings,
    translations,
    forms,
    source,
    sources: [source],
  };
}

function normalizedDefinition(value: string) {
  return value.toLowerCase().replace(/[“”"'`.,;:!?()[\]{}]/g, "").replace(/\s+/g, " ").trim();
}

export function mergeDictionaryMeanings(results: DictionaryLookupResult[]) {
  const merged: Array<{ partOfSpeech: string | null; definitions: Array<{ definition: string; example: string | null }> }> = [];
  const seen = new Map<string, { definition: string; example: string | null }>();
  for (const result of results) {
    for (const meaning of result.meanings) {
      for (const definition of meaning.definitions) {
        const key = `${(meaning.partOfSpeech || "").toLowerCase()}|${normalizedDefinition(definition.definition)}`;
        const existing = seen.get(key);
        if (existing) {
          if (!existing.example && definition.example) existing.example = definition.example;
          continue;
        }
        const mergedMeaning = merged.find((item) => item.partOfSpeech === meaning.partOfSpeech);
        const mergedDefinition = { definition: definition.definition, example: definition.example };
        if (mergedMeaning) mergedMeaning.definitions.push(mergedDefinition);
        else merged.push({ partOfSpeech: meaning.partOfSpeech, definitions: [mergedDefinition] });
        seen.set(key, mergedDefinition);
      }
    }
  }
  return withDefinitionIds(merged);
}

export function combineDictionaryResults(results: DictionaryLookupResult[]): DictionaryLookupResult | null {
  if (!results.length) return null;
  const sources = results.flatMap((result) => result.sources);
  const firstWithValue = <T,>(pick: (result: DictionaryLookupResult) => T | null) => results.map(pick).find((value): value is T => Boolean(value)) || null;
  const meanings = mergeDictionaryMeanings(results);
  if (!meanings.length) return null;
  const firstSource = results.map((result) => result.source).find((source): source is DictionarySource => Boolean(source));
  const source = {
    provider: sources.map((item) => item.provider).join(" · "),
    url: firstWithValue((result) => result.source?.url || null),
    licenseName: sources.map((item) => item.licenseName).filter(Boolean).join(" · ") || null,
    licenseUrl: new Set(sources.map((item) => item.licenseUrl).filter(Boolean)).size === 1 ? firstWithValue((result) => result.source?.licenseUrl || null) : null,
    version: sources.map((item) => item.version).filter(Boolean).join(" · ") || null,
  };
  const translations = [...new Map(results.flatMap((result) => result.translations)
    .filter((translation) => translation.language === "zh" && translation.words.length)
    .map((translation) => [
      `${translation.partOfSpeech || ""}|${translation.definition || ""}|${translation.secondary}|${translation.words.join("|")}`,
      translation,
    ] as const)).values()];
  const forms = [...new Map(results.flatMap((result) => result.forms || []).map((form) => [form.word, form] as const)).values()];
  return {
    lemma: results[0].lemma,
    definition: meanings[0]?.definitions[0]?.definition || null,
    phonetic: firstWithValue((result) => result.phonetic),
    audioUrl: firstWithValue((result) => result.audioUrl),
    meanings,
    translations,
    forms,
    source: firstSource ? source : null,
    sources,
  };
}

export function getPrimaryChineseWords(translations: DictionaryTranslation[], limit = 4) {
  const words: string[] = [];
  const seen = new Set<string>();
  for (const translation of translations) {
    if (translation.language !== "zh" || translation.secondary) continue;
    for (const word of translation.words) {
      if (!word || seen.has(word)) continue;
      seen.add(word);
      words.push(word);
      if (words.length === limit) return words;
    }
  }
  return words;
}

export function parseCachedMeanings(value: string | null): DictionaryCachePayload | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as Partial<DictionaryCachePayload>;
    if (payload.version !== DICTIONARY_CACHE_VERSION || !Array.isArray(payload.meanings) || !payload.meanings.some((meaning) => meaning.definitions?.length)) return null;
    if (!Array.isArray(payload.sources) || !payload.sources.length || !Array.isArray(payload.translations) || !Array.isArray(payload.forms)) return null;
    if (!payload.translations.every((translation) => translation.language === "zh" && Array.isArray(translation.words) && Array.isArray(translation.tags) && typeof translation.secondary === "boolean")) return null;
    return { version: DICTIONARY_CACHE_VERSION, meanings: payload.meanings, translations: payload.translations, sources: payload.sources, forms: payload.forms };
  } catch {
    return null;
  }
}

export function resolveDictionaryAttempts(lemma: string, attempts: DictionaryProviderAttempt[]) {
  const result = combineDictionaryResults(attempts.flatMap((attempt) => attempt.result ? [attempt.result] : []));
  if (result) return result;
  const providerResponded = attempts.some((attempt) => attempt.responded);
  return {
    lemma,
    definition: null,
    phonetic: null,
    audioUrl: null,
    meanings: [],
    translations: [],
    forms: [],
    source: null,
    sources: [],
    unavailable: !providerResponded,
    notFound: providerResponded,
  } satisfies DictionaryLookupResult;
}

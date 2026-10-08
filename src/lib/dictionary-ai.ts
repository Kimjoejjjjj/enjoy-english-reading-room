import { createHash } from "node:crypto";
import type { DictionaryMeaning } from "@/lib/dictionary-contract";

export const DICTIONARY_TRANSLATION_PROMPT_VERSION = "dictionary-translation-v1";

export interface DictionaryAiDefinition {
  id: string;
  partOfSpeech: string | null;
  definition: string;
}

export interface DictionaryAiTranslation {
  definitionId: string;
  translation: string;
}

export function dictionaryAiDefinitions(meanings: DictionaryMeaning[], limit = 4): DictionaryAiDefinition[] {
  const definitions: DictionaryAiDefinition[] = [];
  for (const meaning of meanings) {
    for (const definition of meaning.definitions) {
      const text = definition.definition.trim().slice(0, 1_000);
      if (!definition.id || !text) continue;
      definitions.push({ id: definition.id, partOfSpeech: meaning.partOfSpeech, definition: text });
      if (definitions.length === limit) return definitions;
    }
  }
  return definitions;
}

export function dictionaryTranslationInput(lemma: string, definitions: DictionaryAiDefinition[]) {
  return JSON.stringify({ lemma: lemma.toLowerCase(), definitions });
}

export function dictionaryTranslationCacheHash(lemma: string, definitions: DictionaryAiDefinition[], model: string) {
  return createHash("sha256").update(JSON.stringify({ provider: "deepseek", model, promptVersion: DICTIONARY_TRANSLATION_PROMPT_VERSION, lemma: lemma.toLowerCase(), definitions })).digest("hex");
}

export function parseDictionaryAiTranslations(value: string, definitions: DictionaryAiDefinition[]): DictionaryAiTranslation[] | null {
  try {
    const cleaned = value.replace(/^```json\s*|\s*```$/gi, "").trim();
    const parsed = JSON.parse(cleaned) as { translations?: unknown };
    if (!Array.isArray(parsed.translations) || parsed.translations.length !== definitions.length) return null;
    const expected = new Set(definitions.map((definition) => definition.id));
    const seen = new Set<string>();
    const translations: DictionaryAiTranslation[] = [];
    for (const item of parsed.translations) {
      if (!item || typeof item !== "object") return null;
      const candidate = item as { definitionId?: unknown; translation?: unknown };
      const definitionId = typeof candidate.definitionId === "string" ? candidate.definitionId : "";
      const translation = typeof candidate.translation === "string" ? candidate.translation.replace(/\s+/g, " ").trim() : "";
      if (!expected.has(definitionId) || seen.has(definitionId) || !translation || translation.length > 500) return null;
      seen.add(definitionId);
      translations.push({ definitionId, translation });
    }
    if (seen.size !== expected.size) return null;
    return definitions.map((definition) => translations.find((item) => item.definitionId === definition.id)!);
  } catch {
    return null;
  }
}

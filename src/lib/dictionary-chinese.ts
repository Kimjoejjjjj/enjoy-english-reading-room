import OpenCC from "opencc-js";
import type { DictionaryTranslation } from "@/lib/dictionary-contract";

const toSimplified = OpenCC.Converter({ from: "hk", to: "cn" });

export function normalizeChineseTranslations(translations: DictionaryTranslation[]): DictionaryTranslation[] {
  const normalizedTranslations: DictionaryTranslation[] = [];
  for (const translation of translations) {
    if (translation.language !== "zh") continue;
    const words: string[] = [];
    const seen = new Set<string>();
    for (const value of translation.words) {
      const normalized = toSimplified(value).replace(/\s+/g, " ").trim();
      if (!normalized || !/\p{Script=Han}/u.test(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      words.push(normalized);
      if (words.length === 4) break;
    }
    if (words.length) normalizedTranslations.push({ ...translation, words });
    if (normalizedTranslations.length === 12) break;
  }
  return normalizedTranslations;
}

export type VocabularyEntryType = "WORD" | "PHRASE";

export interface VocabularySelection {
  entryType: VocabularyEntryType;
  normalized: string;
  selectedText: string;
}

const WORD_PATTERN = /^[A-Za-z]+(?:['’][A-Za-z]+)*$/;

export function classifyVocabularySelection(value: string): VocabularySelection | null {
  const selectedText = value.trim().replace(/\s+/g, " ").slice(0, 240);
  const normalized = selectedText
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!normalized || !/[A-Za-z]/.test(normalized)) return null;
  if (!/^[A-Za-z]+(?:['’][A-Za-z]+)*(?:\s+[A-Za-z]+(?:['’][A-Za-z]+)*)*$/.test(normalized)) return null;
  return { entryType: WORD_PATTERN.test(normalized) ? "WORD" : "PHRASE", normalized, selectedText };
}

export function normalizeNestedDictionaryWord(value: string): string | null {
  const selected = classifyVocabularySelection(value);
  return selected?.entryType === "WORD" ? selected.normalized : null;
}

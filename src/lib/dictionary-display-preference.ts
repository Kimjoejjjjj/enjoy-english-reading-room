export type DictionaryDisplayMode = "bilingual" | "english";

export const DICTIONARY_DISPLAY_MODE_KEY = "enjoy-english.dictionary-display.v1";
export const DICTIONARY_DISPLAY_MODE_EVENT = "enjoy-english:dictionary-display";
export const DEFAULT_DICTIONARY_DISPLAY_MODE: DictionaryDisplayMode = "bilingual";

export function normalizeDictionaryDisplayMode(value: unknown): DictionaryDisplayMode {
  return value === "english" ? "english" : DEFAULT_DICTIONARY_DISPLAY_MODE;
}

export function readDictionaryDisplayMode(): DictionaryDisplayMode {
  if (typeof window === "undefined") return DEFAULT_DICTIONARY_DISPLAY_MODE;
  return normalizeDictionaryDisplayMode(window.localStorage.getItem(DICTIONARY_DISPLAY_MODE_KEY));
}

export function writeDictionaryDisplayMode(mode: DictionaryDisplayMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DICTIONARY_DISPLAY_MODE_KEY, normalizeDictionaryDisplayMode(mode));
  window.dispatchEvent(new CustomEvent(DICTIONARY_DISPLAY_MODE_EVENT, { detail: mode }));
}

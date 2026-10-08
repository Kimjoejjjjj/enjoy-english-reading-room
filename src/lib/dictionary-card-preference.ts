export type DictionaryCardOverflowMode = "ask" | "replace-oldest";

export const MAX_DICTIONARY_CARDS = 15;
export const MAX_EXPANDED_DICTIONARY_CARDS = 5;
export const DICTIONARY_CARD_OVERFLOW_MODE_KEY = "enjoy-english.dictionary-card-overflow.v1";
export const DICTIONARY_CARD_OVERFLOW_MODE_EVENT = "enjoy-english:dictionary-card-overflow";
export const DEFAULT_DICTIONARY_CARD_OVERFLOW_MODE: DictionaryCardOverflowMode = "ask";

export function normalizeDictionaryCardOverflowMode(value: unknown): DictionaryCardOverflowMode {
  return value === "replace-oldest" ? "replace-oldest" : DEFAULT_DICTIONARY_CARD_OVERFLOW_MODE;
}

export function readDictionaryCardOverflowMode(): DictionaryCardOverflowMode {
  if (typeof window === "undefined") return DEFAULT_DICTIONARY_CARD_OVERFLOW_MODE;
  return normalizeDictionaryCardOverflowMode(window.localStorage.getItem(DICTIONARY_CARD_OVERFLOW_MODE_KEY));
}

export function writeDictionaryCardOverflowMode(mode: DictionaryCardOverflowMode) {
  if (typeof window === "undefined") return;
  const normalized = normalizeDictionaryCardOverflowMode(mode);
  window.localStorage.setItem(DICTIONARY_CARD_OVERFLOW_MODE_KEY, normalized);
  window.dispatchEvent(new CustomEvent(DICTIONARY_CARD_OVERFLOW_MODE_EVENT, { detail: normalized }));
}

export function focusExpandedDictionaryCard(
  expandedCardIds: string[],
  cardId: string,
  limit = MAX_EXPANDED_DICTIONARY_CARDS,
): string[] {
  return [...expandedCardIds.filter((id) => id !== cardId), cardId].slice(-limit);
}

export function toggleExpandedDictionaryCard(
  expandedCardIds: string[],
  cardId: string,
  limit = MAX_EXPANDED_DICTIONARY_CARDS,
): string[] {
  if (expandedCardIds.includes(cardId)) return expandedCardIds.filter((id) => id !== cardId);
  return focusExpandedDictionaryCard(expandedCardIds, cardId, limit);
}

export function removeExpandedDictionaryCard(expandedCardIds: string[], cardId: string): string[] {
  return expandedCardIds.filter((id) => id !== cardId);
}

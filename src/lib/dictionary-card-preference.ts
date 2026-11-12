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

/** 新卡置于顶部；确认溢出时先排除指定旧卡，再保留最近的 limit 张。 */
export function addRecentDictionaryCard<T extends { id: string }>(cards: T[], card: T, removedCardId?: string, limit = MAX_DICTIONARY_CARDS): T[] {
  return [card, ...cards.filter((item) => item.id !== removedCardId && item.id !== card.id)].slice(0, limit);
}

/** 再次查询已有卡片时同样按最近使用置顶，不重复发起词典请求。 */
export function promoteRecentDictionaryCard<T extends { id: string }>(cards: T[], cardId: string): T[] {
  const existing = cards.find((item) => item.id === cardId);
  if (!existing || cards[0]?.id === cardId) return cards;
  return [existing, ...cards.filter((item) => item.id !== cardId)];
}

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

/**
 * 词组只提供保存入口，不自动打开词典卡。短选区可一键保存，长句可在面板中
 * 编辑为词组后保存；是否值得收藏由用户决定，不尝试猜测短句是不是词组。
 */
export function classifyPhraseSelection(value: string, maxWords = 8): VocabularySelection | null {
  const selected = classifyVocabularySelection(value);
  if (selected?.entryType !== "PHRASE") return null;
  const wordCount = selected.normalized.split(" ").length;
  return wordCount <= maxWords ? selected : null;
}

interface PhraseTextSelection {
  isCollapsed: boolean;
  rangeCount: number;
  getRangeAt(index: number): { commonAncestorContainer: unknown };
  toString(): string;
}

/** 只读取指定原文容器内的选区，避免页面其他位置的划词覆盖词组输入框。 */
export function readPhraseTextSelection(selection: PhraseTextSelection | null, contains: (node: unknown) => boolean): string {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return "";
  if (!contains(selection.getRangeAt(0).commonAncestorContainer)) return "";
  return selection.toString().trim().replace(/\s+/g, " ").slice(0, 240);
}

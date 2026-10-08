export const HIGHLIGHT_REVIEW_SLOTS = [
  { slotKey: "QUOTE", name: "金句", color: "AMBER", reviewEnabled: false },
  { slotKey: "UNCLEAR", name: "不懂", color: "BLUE", reviewEnabled: true },
  { slotKey: "IMPORTANT", name: "重要", color: "SAGE", reviewEnabled: true },
] as const;

export type HighlightReviewSlotKey = (typeof HIGHLIGHT_REVIEW_SLOTS)[number]["slotKey"];

export function isHighlightReviewSlotKey(value: unknown): value is HighlightReviewSlotKey {
  return HIGHLIGHT_REVIEW_SLOTS.some((slot) => slot.slotKey === value);
}

export function isHighlightReviewEnabled(value: { slotKey: string | null; reviewEnabled: boolean | null } | null | undefined) {
  return Boolean(value && isHighlightReviewSlotKey(value.slotKey) && value.reviewEnabled === true);
}

export interface HighlightLabelPreviewRow {
  id: string;
  name: string;
  color: string;
  archived: boolean;
}

export interface HighlightCountBucket {
  labelId: string | null;
  color: string;
  count: number;
}

export function buildHighlightLabelMappingPreview(labels: HighlightLabelPreviewRow[], buckets: HighlightCountBucket[]) {
  const countByLabel = new Map<string, number>();
  const legacyColorCounts: Record<string, number> = { RED: 0, YELLOW: 0, GREEN: 0 };
  let unlabeledCount = 0;
  const labelIds = new Set(labels.map((label) => label.id));
  let orphanedCount = 0;

  for (const bucket of buckets) {
    if (bucket.color in legacyColorCounts) legacyColorCounts[bucket.color] += bucket.count;
    if (bucket.labelId === null) unlabeledCount += bucket.count;
    else if (!labelIds.has(bucket.labelId)) orphanedCount += bucket.count;
    else countByLabel.set(bucket.labelId, (countByLabel.get(bucket.labelId) || 0) + bucket.count);
  }

  const mappings = labels.map((label) => {
    const target = HIGHLIGHT_REVIEW_SLOTS.find((slot) => slot.name === label.name) || null;
    return { ...label, highlightCount: countByLabel.get(label.id) || 0, targetSlot: target?.slotKey || null, defaultReviewEnabled: target?.reviewEnabled ?? null };
  });
  const duplicateSlots = HIGHLIGHT_REVIEW_SLOTS.flatMap((slot) => {
    const candidates = mappings.filter((mapping) => mapping.targetSlot === slot.slotKey);
    return candidates.length > 1 ? [{ slotKey: slot.slotKey, labelIds: candidates.map((candidate) => candidate.id) }] : [];
  });
  const unresolvedLabels = mappings.filter((mapping) => mapping.targetSlot === null).map(({ id, name, highlightCount, archived }) => ({ id, name, highlightCount, archived }));
  return {
    legacyColorCounts,
    unlabeledCount,
    orphanedCount,
    mappings,
    unresolvedLabels,
    duplicateSlots,
    canProceed: unlabeledCount === 0 && orphanedCount === 0 && unresolvedLabels.length === 0 && duplicateSlots.length === 0,
  };
}
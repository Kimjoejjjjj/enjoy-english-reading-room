import { prisma } from "@/lib/db";

export const legacyHighlightLabelSelect = {
  id: true,
  userId: true,
  name: true,
  color: true,
  sortOrder: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const highlightReviewLabelSelect = {
  ...legacyHighlightLabelSelect,
  slotKey: true,
  reviewEnabled: true,
} as const;

export const legacyHighlightReviewWhere = {
  color: { in: ["RED", "YELLOW"] },
};

export async function hasHighlightReviewColumns() {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("HighlightLabel")');
  const names = new Set(columns.map((column) => column.name));
  return names.has("slotKey") && names.has("reviewEnabled");
}

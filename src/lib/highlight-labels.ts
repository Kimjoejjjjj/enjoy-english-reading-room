export const HIGHLIGHT_LABEL_COLORS = ["BRICK", "AMBER", "SAGE", "BLUE", "PLUM"] as const;

export type HighlightLabelColor = (typeof HIGHLIGHT_LABEL_COLORS)[number];

export const labelButtonClasses: Record<HighlightLabelColor, string> = {
  BRICK: "bg-red-100 text-red-700",
  AMBER: "bg-yellow-100 text-yellow-700",
  SAGE: "bg-green-100 text-green-700",
  BLUE: "bg-blue-100 text-blue-700",
  PLUM: "bg-purple-100 text-purple-700",
};

export const inlineHighlightClasses: Record<HighlightLabelColor, string> = {
  BRICK: "rounded-sm bg-red-200/80 text-inherit",
  AMBER: "rounded-sm bg-yellow-200/90 text-inherit",
  SAGE: "rounded-sm bg-green-200/80 text-inherit",
  BLUE: "rounded-sm bg-blue-200/80 text-inherit",
  PLUM: "rounded-sm bg-purple-200/75 text-inherit",
};

export const blockHighlightClasses: Record<HighlightLabelColor, string> = {
  BRICK: "border-l-4 border-red-400 bg-red-50/50",
  AMBER: "border-l-4 border-yellow-400 bg-yellow-50/60",
  SAGE: "border-l-4 border-green-400 bg-green-50/50",
  BLUE: "border-l-4 border-blue-400 bg-blue-50/50",
  PLUM: "border-l-4 border-purple-400 bg-purple-50/50",
};

export function normalizeLabelColor(value?: string | null): HighlightLabelColor {
  return HIGHLIGHT_LABEL_COLORS.includes(value as HighlightLabelColor)
    ? value as HighlightLabelColor
    : "AMBER";
}

export function legacyColorToLabelColor(value?: string | null): HighlightLabelColor {
  if (value === "RED") return "BRICK";
  if (value === "GREEN") return "SAGE";
  return "AMBER";
}

export function labelColorToLegacyColor(value?: string | null) {
  if (value === "BRICK") return "RED";
  if (value === "SAGE") return "GREEN";
  return "YELLOW";
}

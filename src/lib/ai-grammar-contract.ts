export const AI_GRAMMAR_CONTRACT_VERSION = "grammar.v2";

export interface GrammarPoint {
  label: string;
  explanation: string;
  evidence?: string;
}

export interface GrammarExplanation {
  summary: string;
  points: GrammarPoint[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= limit ? normalized : null;
}

export function parseGrammarOutput(output: string): GrammarExplanation | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ["summary", "points"])) return null;
    const summary = boundedText(parsed.summary, 1_200);
    if (!summary || !Array.isArray(parsed.points) || parsed.points.length < 1 || parsed.points.length > 6) return null;

    const points: GrammarPoint[] = [];
    for (const rawPoint of parsed.points) {
      if (!isRecord(rawPoint) || !hasOnlyKeys(rawPoint, ["label", "explanation", "evidence"])) return null;
      const label = boundedText(rawPoint.label, 80);
      const explanation = boundedText(rawPoint.explanation, 800);
      const evidence = rawPoint.evidence === undefined ? undefined : boundedText(rawPoint.evidence, 500);
      if (!label || !explanation || rawPoint.evidence !== undefined && !evidence) return null;
      points.push({ label, explanation, ...(evidence ? { evidence } : {}) });
    }
    return { summary, points };
  } catch {
    return null;
  }
}

export function formatGrammarExplanation(grammar: GrammarExplanation, language: "zh-CN" | "en", evidenceLabel: string) {
  const separator = language === "en" ? ": " : "：";
  return [grammar.summary, ...grammar.points.map((point) => {
    const evidence = point.evidence ? `\n  ${evidenceLabel}${separator}${point.evidence}` : "";
    return `• ${point.label}${separator}${point.explanation}${evidence}`;
  })].join("\n\n");
}
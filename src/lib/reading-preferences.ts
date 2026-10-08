import type { ReadingPreferences } from "@/types";

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  presets: [15, 25, 40],
  defaultMinutes: 25,
  idlePauseMinutes: 10,
  source: "default",
};

export function normalizeReadingPreferences(input: unknown): ReadingPreferences {
  if (!input || typeof input !== "object") throw new Error("Invalid reading preferences");
  const value = input as Record<string, unknown>;
  if (!Array.isArray(value.presets) || value.presets.length !== 3) throw new Error("Exactly three reading times are required");

  const presets = value.presets.map(Number);
  if (presets.some((minutes) => !Number.isInteger(minutes) || minutes < 1 || minutes > 180)) {
    throw new Error("Reading times must be whole minutes from 1 to 180");
  }
  if (new Set(presets).size !== 3) throw new Error("Reading times must be different");
  presets.sort((left, right) => left - right);

  const defaultMinutes = value.defaultMinutes === null ? null : Number(value.defaultMinutes);
  if (defaultMinutes !== null && (!Number.isInteger(defaultMinutes) || !presets.includes(defaultMinutes))) {
    throw new Error("Default reading time must be one of the three options or open-ended");
  }

  const idlePauseMinutes = value.idlePauseMinutes === null ? null : Number(value.idlePauseMinutes);
  if (idlePauseMinutes !== null && (!Number.isInteger(idlePauseMinutes) || idlePauseMinutes < 1 || idlePauseMinutes > 60)) {
    throw new Error("Idle pause must be a whole number from 1 to 60 minutes or disabled");
  }

  return {
    presets: presets as [number, number, number],
    defaultMinutes,
    idlePauseMinutes,
  };
}

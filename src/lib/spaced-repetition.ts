export type ReviewRating = "AGAIN" | "HARD" | "GOOD" | "EASY";

const QUALITY: Record<ReviewRating, number> = {
  AGAIN: 1,
  HARD: 3,
  GOOD: 4,
  EASY: 5,
};

export function isReviewRating(value: unknown): value is ReviewRating {
  return typeof value === "string" && value in QUALITY;
}

export function scheduleReview(input: {
  rating: ReviewRating;
  easeFactor: number;
  intervalDays: number;
  reviewCount: number;
  now?: Date;
}) {
  const quality = QUALITY[input.rating];
  let easeFactor = input.easeFactor;
  let intervalDays = input.intervalDays;

  if (quality < 3) {
    intervalDays = 1;
  } else {
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    intervalDays = input.reviewCount === 0
      ? 1
      : input.reviewCount === 1
        ? 3
        : Math.max(1, Math.round(Math.max(1, intervalDays) * easeFactor));
  }

  const now = input.now || new Date();
  return {
    quality,
    easeFactor,
    intervalDays,
    nextReview: new Date(now.getTime() + intervalDays * 86_400_000),
  };
}

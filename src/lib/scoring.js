const MAX_POINTS    = 1000;
const MIN_POINTS    = 100;
const TIME_LIMIT_MS = 20000;

/**
 * Kahoot-style speed scoring.
 * Correct + instant = 1000 pts. Correct + 20s = 100 pts. Wrong = 0.
 */
export function calculatePoints(isCorrect, timeTakenMs) {
  if (!isCorrect) return 0;
  const clamped   = Math.min(timeTakenMs, TIME_LIMIT_MS);
  const timeRatio = clamped / TIME_LIMIT_MS;
  return Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * timeRatio);
}

export { TIME_LIMIT_MS };

import type { SyncPoint } from "@openvoicing/score-model";

export type SyncConfidence = "good" | "fair" | "poor";

/**
 * Move one sync anchor to a new time, clamped to stay strictly between its
 * neighbors (with a 50ms gap). Returns a new array; the input is untouched.
 */
export function clampSyncMove(
  points: SyncPoint[],
  index: number,
  timeSeconds: number,
  duration: number,
): SyncPoint[] {
  const gap = 0.05;
  const min = index > 0 ? points[index - 1]!.timeSeconds + gap : 0;
  const max =
    index < points.length - 1
      ? points[index + 1]!.timeSeconds - gap
      : duration || points[index]!.timeSeconds + 1;
  const clamped = Math.min(Math.max(timeSeconds, min), Math.max(min, max));
  return points.map((p, i) => (i === index ? { ...p, timeSeconds: clamped } : p));
}

/**
 * Per-bar sync confidence from spacing regularity: a bar whose interval to its
 * neighbors deviates sharply from the median interval is a likely bad anchor.
 * Returns null when there are too few points to judge.
 */
export function computeSyncConfidence(points: SyncPoint[] | null): SyncConfidence[] | null {
  if (!points || points.length < 3) return null;
  const gaps = points.slice(1).map((p, i) => p.timeSeconds - points[i]!.timeSeconds);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return points.map((_, i) => {
    const before = i > 0 ? gaps[i - 1]! : median;
    const after = i < gaps.length ? gaps[i]! : median;
    const dev = Math.max(Math.abs(before - median), Math.abs(after - median)) / (median || 1);
    return dev < 0.15 ? "good" : dev < 0.4 ? "fair" : "poor";
  });
}

import { PPQ, type BarSpec, type SyncAnchor, type SyncMap } from "./types";

export function barDurationTicks(bar: BarSpec): number {
  return Math.round(bar.timeSignature.beats * (4 / bar.timeSignature.beatUnit) * PPQ);
}

/** Absolute tick position of (barIndex, tick) from the start of the score. */
export function absoluteTick(bars: BarSpec[], barIndex: number, tick: number): number {
  let total = 0;
  for (let i = 0; i < barIndex; i++) {
    const bar = bars[i];
    if (!bar) throw new RangeError(`bar index ${barIndex} out of range`);
    total += barDurationTicks(bar);
  }
  return total + tick;
}

/**
 * Media timestamp for a musical position, linearly interpolated between the
 * surrounding anchors. Positions outside the anchored range extrapolate from
 * the nearest pair.
 */
export function mediaTimeAt(
  syncMap: SyncMap,
  bars: BarSpec[],
  barIndex: number,
  tick: number,
): number {
  const anchors = syncMap.anchors;
  if (anchors.length === 0) throw new Error("sync map has no anchors");
  const pos = absoluteTick(bars, barIndex, tick);
  const points = anchors.map((a: SyncAnchor) => ({
    tick: absoluteTick(bars, a.barIndex, a.tick),
    time: a.timeSeconds,
  }));
  points.sort((a, b) => a.tick - b.tick);

  const first = points[0]!;
  if (points.length === 1) return first.time;

  let lo = first;
  let hi = points[points.length - 1]!;
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i]!.tick <= pos) {
      lo = points[i]!;
      hi = points[i + 1]!;
    }
  }
  if (hi.tick === lo.tick) return lo.time;
  return lo.time + ((pos - lo.tick) / (hi.tick - lo.tick)) * (hi.time - lo.time);
}

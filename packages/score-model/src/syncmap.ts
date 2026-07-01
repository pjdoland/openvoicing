import { mediaTimeAtTick, type SyncPoint } from "./sync-points";
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

/** Bar-relative sync anchors converted to absolute-tick sync points. */
export function syncMapToPoints(syncMap: SyncMap, bars: BarSpec[]): SyncPoint[] {
  return syncMap.anchors.map((a: SyncAnchor) => ({
    tick: absoluteTick(bars, a.barIndex, a.tick),
    timeSeconds: a.timeSeconds,
  }));
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
  return mediaTimeAtTick(syncMapToPoints(syncMap, bars), absoluteTick(bars, barIndex, tick));
}

/**
 * A (musical tick, media time) anchor pair in absolute-tick space. The
 * renderer-facing form of SyncMap anchors: bar-relative anchors are converted
 * to absolute ticks before interpolation.
 */
export interface SyncPoint {
  tick: number;
  timeSeconds: number;
}

function interpolate(
  points: Array<{ x: number; y: number }>,
  x: number,
): number {
  if (points.length === 0) throw new Error("no sync points");
  // This runs once per frame while following; sync points are stored ascending,
  // so only pay for a copy+sort when they are actually out of order.
  let sorted = points;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.x < points[i - 1]!.x) {
      sorted = [...points].sort((a, b) => a.x - b.x);
      break;
    }
  }
  const first = sorted[0]!;
  if (sorted.length === 1) return first.y;

  // Default to the first segment so an x before the first anchor extrapolates
  // along the adjacent slope, not the whole-range first-to-last secant.
  let lo = first;
  let hi = sorted[1]!;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i]!.x <= x) {
      lo = sorted[i]!;
      hi = sorted[i + 1]!;
    }
  }
  if (hi.x === lo.x) return lo.y;
  return lo.y + ((x - lo.x) / (hi.x - lo.x)) * (hi.y - lo.y);
}

/** Media timestamp for a musical position, interpolated between anchors. */
export function mediaTimeAtTick(points: SyncPoint[], tick: number): number {
  return interpolate(
    points.map((p) => ({ x: p.tick, y: p.timeSeconds })),
    tick,
  );
}

/** Musical position for a media timestamp, interpolated between anchors. */
export function tickAtMediaTime(points: SyncPoint[], timeSeconds: number): number {
  return interpolate(
    points.map((p) => ({ x: p.timeSeconds, y: p.tick })),
    timeSeconds,
  );
}

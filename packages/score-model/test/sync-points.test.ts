import { describe, expect, it } from "vitest";
import { mediaTimeAtTick, tickAtMediaTime, type SyncPoint } from "../src/index";

const points: SyncPoint[] = [
  { tick: 0, timeSeconds: 10 },
  { tick: 3840, timeSeconds: 14 },
  { tick: 11520, timeSeconds: 20 },
];

describe("mediaTimeAtTick", () => {
  it("returns anchor times exactly", () => {
    expect(mediaTimeAtTick(points, 0)).toBe(10);
    expect(mediaTimeAtTick(points, 3840)).toBe(14);
    expect(mediaTimeAtTick(points, 11520)).toBe(20);
  });

  it("interpolates and extrapolates", () => {
    expect(mediaTimeAtTick(points, 1920)).toBe(12);
    expect(mediaTimeAtTick(points, 7680)).toBe(17);
    expect(mediaTimeAtTick(points, 15360)).toBe(23);
  });

  it("handles unsorted input", () => {
    const shuffled = [points[2]!, points[0]!, points[1]!];
    expect(mediaTimeAtTick(shuffled, 1920)).toBe(12);
  });

  it("extrapolates before the first anchor along the first segment", () => {
    // First segment slope is 4s / 3840 ticks, so tick -1920 -> 8s. The old code
    // used the whole-range first-to-last secant, which would give ~8.33.
    expect(mediaTimeAtTick(points, -1920)).toBe(8);
    expect(tickAtMediaTime(points, 8)).toBe(-1920);
  });
});

describe("tickAtMediaTime", () => {
  it("is the inverse of mediaTimeAtTick", () => {
    expect(tickAtMediaTime(points, 10)).toBe(0);
    expect(tickAtMediaTime(points, 12)).toBe(1920);
    expect(tickAtMediaTime(points, 17)).toBe(7680);
    expect(tickAtMediaTime(points, 23)).toBe(15360);
  });

  it("round-trips arbitrary positions", () => {
    for (const tick of [0, 500, 3840, 5000, 11000]) {
      expect(tickAtMediaTime(points, mediaTimeAtTick(points, tick))).toBeCloseTo(tick, 6);
    }
  });
});

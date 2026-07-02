import { describe, expect, it } from "vitest";
import { clampSyncMove, computeSyncConfidence } from "../src/sync-utils";
import type { SyncPoint } from "@openvoicing/score-model";

const points: SyncPoint[] = [
  { tick: 0, timeSeconds: 0 },
  { tick: 3840, timeSeconds: 2 },
  { tick: 7680, timeSeconds: 4 },
];

describe("clampSyncMove", () => {
  it("moves a middle anchor within its neighbors", () => {
    const moved = clampSyncMove(points, 1, 3, 10);
    expect(moved[1]!.timeSeconds).toBe(3);
    // Others untouched; input not mutated.
    expect(moved[0]!.timeSeconds).toBe(0);
    expect(points[1]!.timeSeconds).toBe(2);
  });

  it("clamps against the previous neighbor with a 50ms gap", () => {
    expect(clampSyncMove(points, 1, -5, 10)[1]!.timeSeconds).toBe(0.05);
  });

  it("clamps against the next neighbor with a 50ms gap", () => {
    expect(clampSyncMove(points, 1, 99, 10)[1]!.timeSeconds).toBeCloseTo(3.95, 5);
  });

  it("clamps the last anchor against the duration", () => {
    expect(clampSyncMove(points, 2, 99, 8)[2]!.timeSeconds).toBe(8);
  });

  it("falls back past the last anchor when duration is unknown", () => {
    expect(clampSyncMove(points, 2, 99, 0)[2]!.timeSeconds).toBe(5);
  });
});

describe("computeSyncConfidence", () => {
  it("returns null for too few points", () => {
    expect(computeSyncConfidence(null)).toBeNull();
    expect(computeSyncConfidence(points.slice(0, 2))).toBeNull();
  });

  it("marks evenly spaced anchors as good", () => {
    const even = [0, 2, 4, 6, 8].map((t, i) => ({ tick: i * 3840, timeSeconds: t }));
    expect(computeSyncConfidence(even)).toEqual(["good", "good", "good", "good", "good"]);
  });

  it("flags an anchor with an irregular gap", () => {
    // Bars at 0, 2, 2.3, 4.3, 6.3: the third anchor is far too close.
    const uneven = [0, 2, 2.3, 4.3, 6.3].map((t, i) => ({ tick: i * 3840, timeSeconds: t }));
    const conf = computeSyncConfidence(uneven)!;
    expect(conf[1]).not.toBe("good");
    expect(conf).toContain("poor");
  });
});

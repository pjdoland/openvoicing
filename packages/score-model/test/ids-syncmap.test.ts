import { describe, expect, it } from "vitest";
import {
  absoluteTick,
  barDurationTicks,
  newId,
  PPQ,
  syncMapToPoints,
  type BarSpec,
  type SyncMap,
} from "../src/index";

describe("newId", () => {
  it("prefixes and stays unique", () => {
    const a = newId("note");
    const b = newId("note");
    expect(a).toMatch(/^note_[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

const bars: BarSpec[] = [
  { id: "b0", index: 0, timeSignature: { beats: 4, beatUnit: 4 }, keyFifths: 0 },
  { id: "b1", index: 1, timeSignature: { beats: 3, beatUnit: 4 }, keyFifths: 0 },
  { id: "b2", index: 2, timeSignature: { beats: 6, beatUnit: 8 }, keyFifths: 0 },
];

describe("barDurationTicks", () => {
  it("computes ticks for common meters", () => {
    expect(barDurationTicks(bars[0]!)).toBe(4 * PPQ);
    expect(barDurationTicks(bars[1]!)).toBe(3 * PPQ);
    expect(barDurationTicks(bars[2]!)).toBe(3 * PPQ); // 6/8 = 6 eighths = 3 quarters
  });
});

describe("absoluteTick", () => {
  it("accumulates across mixed meters", () => {
    expect(absoluteTick(bars, 0, 0)).toBe(0);
    expect(absoluteTick(bars, 1, 0)).toBe(4 * PPQ);
    expect(absoluteTick(bars, 2, PPQ)).toBe(4 * PPQ + 3 * PPQ + PPQ);
  });

  it("throws for an out-of-range bar", () => {
    expect(() => absoluteTick(bars, 9, 0)).toThrow(RangeError);
  });
});

describe("syncMapToPoints", () => {
  it("converts bar-relative anchors to absolute ticks", () => {
    const map: SyncMap = {
      id: "s",
      scoreId: "sc",
      recordingId: "r",
      anchors: [
        { barIndex: 0, tick: 0, timeSeconds: 1 },
        { barIndex: 1, tick: 0, timeSeconds: 3 },
        { barIndex: 2, tick: 0, timeSeconds: 5 },
      ],
    };
    expect(syncMapToPoints(map, bars)).toEqual([
      { tick: 0, timeSeconds: 1 },
      { tick: 4 * PPQ, timeSeconds: 3 },
      { tick: 7 * PPQ, timeSeconds: 5 },
    ]);
  });
});

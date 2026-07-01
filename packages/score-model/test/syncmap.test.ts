import { describe, expect, it } from "vitest";
import {
  absoluteTick,
  mediaTimeAt,
  PPQ,
  type BarSpec,
  type SyncMap,
} from "../src/index";

const bars: BarSpec[] = [0, 1, 2, 3].map((index) => ({
  id: `bar_${index}`,
  index,
  timeSignature: { beats: 4, beatUnit: 4 },
  keyFifths: 0,
}));

const syncMap: SyncMap = {
  id: "sync_1",
  scoreId: "score_1",
  recordingId: "rec_1",
  anchors: [
    { barIndex: 0, tick: 0, timeSeconds: 10 },
    { barIndex: 1, tick: 0, timeSeconds: 14 },
    { barIndex: 3, tick: 0, timeSeconds: 20 },
  ],
};

describe("absoluteTick", () => {
  it("accumulates bar durations", () => {
    expect(absoluteTick(bars, 0, 0)).toBe(0);
    expect(absoluteTick(bars, 1, 0)).toBe(4 * PPQ);
    expect(absoluteTick(bars, 2, PPQ)).toBe(9 * PPQ);
  });
});

describe("mediaTimeAt", () => {
  it("returns anchor times exactly", () => {
    expect(mediaTimeAt(syncMap, bars, 0, 0)).toBe(10);
    expect(mediaTimeAt(syncMap, bars, 1, 0)).toBe(14);
    expect(mediaTimeAt(syncMap, bars, 3, 0)).toBe(20);
  });

  it("interpolates between anchors", () => {
    expect(mediaTimeAt(syncMap, bars, 0, 2 * PPQ)).toBe(12);
    expect(mediaTimeAt(syncMap, bars, 2, 0)).toBe(17);
  });

  it("extrapolates past the last anchor", () => {
    expect(mediaTimeAt(syncMap, bars, 3, 4 * PPQ)).toBe(23);
  });
});

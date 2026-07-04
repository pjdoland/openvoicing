import { describe, expect, it } from "vitest";
import { snapRate } from "../src/youtube-player";

const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

describe("snapRate", () => {
  it("snaps an arbitrary speed to the nearest supported rate", () => {
    expect(snapRate(0.6, YT_RATES)).toBe(0.5);
    expect(snapRate(0.7, YT_RATES)).toBe(0.75);
    expect(snapRate(1.1, YT_RATES)).toBe(1);
    expect(snapRate(1.9, YT_RATES)).toBe(2);
  });

  it("returns exact rates unchanged", () => {
    for (const r of YT_RATES) expect(snapRate(r, YT_RATES)).toBe(r);
  });

  it("returns the target when no rates are available yet", () => {
    expect(snapRate(0.6, [])).toBe(0.6);
  });
});

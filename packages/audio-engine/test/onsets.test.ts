import { describe, expect, it } from "vitest";
import { alignBarsToOnsets, detectOnsets } from "../src/onsets";

const SAMPLE_RATE = 44100;

/** Plucked-style test signal: decaying bursts at the given onset times. */
function synth(onsetTimes: number[], durationSeconds: number): Float32Array {
  const out = new Float32Array(Math.round(durationSeconds * SAMPLE_RATE));
  for (const t of onsetTimes) {
    const start = Math.round(t * SAMPLE_RATE);
    for (let i = 0; i < SAMPLE_RATE * 0.3 && start + i < out.length; i++) {
      const env = Math.exp((-6 * i) / SAMPLE_RATE);
      out[start + i]! += 0.7 * env * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    }
  }
  return out;
}

describe("detectOnsets", () => {
  it("finds decaying bursts within ~25ms", () => {
    const truth = [0.5, 1.0, 1.6, 2.4, 3.0];
    const onsets = detectOnsets([synth(truth, 4)], SAMPLE_RATE);
    expect(onsets.length).toBe(truth.length);
    truth.forEach((t, i) => {
      expect(Math.abs(onsets[i]! - t)).toBeLessThan(0.025);
    });
  });

  it("returns nothing for silence", () => {
    expect(detectOnsets([new Float32Array(SAMPLE_RATE)], SAMPLE_RATE)).toEqual([]);
  });
});

describe("alignBarsToOnsets", () => {
  it("recovers a tempo scale and offset", () => {
    // Score says bars at 0, 2, 4, 6, 8s; the recording plays 10% slower,
    // starting 1.3s in, with a couple of extra onsets in between.
    const expected = [0, 2, 4, 6, 8];
    const scale = 1.1;
    const offset = 1.3;
    const onsets = expected
      .map((t) => t * scale + offset)
      .concat([2.1, 5.05, 9.4])
      .sort((a, b) => a - b);
    const aligned = alignBarsToOnsets(expected, onsets);
    expected.forEach((t, i) => {
      expect(Math.abs(aligned[i]! - (t * scale + offset))).toBeLessThan(0.03);
    });
  });

  it("keeps predictions where onsets are missing", () => {
    const expected = [0, 2, 4, 6];
    // Bar 3's onset is missing entirely.
    const onsets = [1.0, 3.0, 7.0];
    const aligned = alignBarsToOnsets(expected, onsets);
    expect(Math.abs(aligned[0]! - 1.0)).toBeLessThan(0.03);
    expect(Math.abs(aligned[2]! - 5.0)).toBeLessThan(0.2);
    expect(aligned).toHaveLength(4);
  });

  it("stays strictly increasing", () => {
    const aligned = alignBarsToOnsets([0, 0.01, 0.02], [0.5]);
    expect(aligned[1]!).toBeGreaterThan(aligned[0]!);
    expect(aligned[2]!).toBeGreaterThan(aligned[1]!);
  });

  it("falls back to expected times without onsets", () => {
    expect(alignBarsToOnsets([1, 2, 3], [])).toEqual([1, 2, 3]);
  });
});

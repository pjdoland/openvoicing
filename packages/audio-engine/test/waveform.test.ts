import { describe, expect, it } from "vitest";
import { computePeaks, computePeaksAsync } from "../src/waveform";

describe("computePeaks", () => {
  it("computes min/max per bucket", () => {
    const samples = new Float32Array([0, 0.5, 1, -1, -0.5, 0, 0.25, -0.25]);
    const peaks = computePeaks([samples], 4);
    expect(peaks.length).toBe(4);
    expect(Array.from(peaks.max)).toEqual([0.5, 1, 0, 0.25]);
    expect(Array.from(peaks.min)).toEqual([0, -1, -0.5, -0.25]);
  });

  it("mixes channels down to mono", () => {
    const left = new Float32Array([1, 1]);
    const right = new Float32Array([0, -1]);
    const peaks = computePeaks([left, right], 2);
    expect(Array.from(peaks.max)).toEqual([0.5, 0]);
    expect(Array.from(peaks.min)).toEqual([0.5, 0]);
  });

  it("handles more buckets than samples", () => {
    const samples = new Float32Array([0.5, -0.5]);
    const peaks = computePeaks([samples], 4);
    expect(peaks.length).toBe(4);
    expect(peaks.max[0]).toBe(0.5);
  });

  it("handles empty input", () => {
    const peaks = computePeaks([], 10);
    expect(peaks.length).toBe(0);
  });
});

describe("computePeaksAsync", () => {
  it("matches computePeaks and reports progress", async () => {
    const samples = new Float32Array(20000);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 50);
    const sync = computePeaks([samples], 256);
    const progress: number[] = [];
    const async = await computePeaksAsync([samples], 256, (f) => progress.push(f));
    expect(Array.from(async.max)).toEqual(Array.from(sync.max));
    expect(Array.from(async.min)).toEqual(Array.from(sync.min));
    expect(progress.at(-1)).toBe(1);
  });

  it("handles empty input", async () => {
    const peaks = await computePeaksAsync([], 10);
    expect(peaks.length).toBe(0);
  });
});

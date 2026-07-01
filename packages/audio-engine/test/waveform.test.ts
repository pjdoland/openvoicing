import { describe, expect, it } from "vitest";
import { computePeaks } from "../src/waveform";

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

export interface OnsetOptions {
  /** Analysis frame length in samples. */
  frameSize?: number;
  /** Hop between frames in samples. */
  hopSize?: number;
  /** Multiplier over the local average onset strength required to fire. */
  sensitivity?: number;
  /** Minimum time between reported onsets, in seconds. */
  minSeparation?: number;
}

/**
 * Energy-flux onset detection: frame-wise energy, half-wave rectified
 * difference, adaptive threshold, and peak picking. Crude next to spectral
 * methods but reliable for percussive and plucked material, and fast enough
 * for the main thread.
 */
export function detectOnsets(
  channels: Float32Array[],
  sampleRate: number,
  options: OnsetOptions = {},
): number[] {
  if (channels.length === 0 || sampleRate <= 0) return [];
  const frameSize = options.frameSize ?? 1024;
  const hopSize = options.hopSize ?? 512;
  const sensitivity = options.sensitivity ?? 1.5;
  const minSeparation = options.minSeparation ?? 0.05;

  const length = channels[0]!.length;
  const frameCount = Math.max(0, Math.floor((length - frameSize) / hopSize) + 1);
  if (frameCount < 3) return [];

  const energy = new Float64Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    let sum = 0;
    for (let i = start; i < start + frameSize; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i]!;
      sample /= channels.length;
      sum += sample * sample;
    }
    energy[f] = sum;
  }

  const flux = new Float64Array(frameCount);
  for (let f = 1; f < frameCount; f++) {
    flux[f] = Math.max(0, energy[f]! - energy[f - 1]!);
  }

  const half = Math.max(1, Math.round((0.5 * sampleRate) / hopSize));
  const onsets: number[] = [];
  let lastOnset = -Infinity;
  for (let f = 1; f < frameCount - 1; f++) {
    if (flux[f]! <= flux[f - 1]! || flux[f]! < flux[f + 1]!) continue;
    const from = Math.max(0, f - half);
    const to = Math.min(frameCount, f + half);
    let mean = 0;
    for (let i = from; i < to; i++) mean += flux[i]!;
    mean /= to - from;
    if (flux[f]! < mean * sensitivity || flux[f]! === 0) continue;
    const time = (f * hopSize) / sampleRate;
    if (time - lastOnset < minSeparation) continue;
    onsets.push(time);
    lastOnset = time;
  }
  return onsets;
}

/**
 * Map expected event times (from the score at nominal tempo) onto detected
 * onsets: search a global tempo scale and offset that lands the most events
 * on onsets, then snap each event to the nearest onset within a window.
 * The result is strictly increasing.
 */
export function alignBarsToOnsets(expectedTimes: number[], onsets: number[]): number[] {
  if (expectedTimes.length === 0) return [];
  if (onsets.length === 0) return [...expectedTimes];

  const first = expectedTimes[0]!;
  const tolerance = 0.1;
  let best = { scale: 1, offset: onsets[0]! - first, hits: -1 };
  for (let scale = 0.5; scale <= 2.0001; scale += 0.01) {
    for (const candidate of onsets.slice(0, 8)) {
      const offset = candidate - first * scale;
      let hits = 0;
      for (const expected of expectedTimes) {
        const predicted = expected * scale + offset;
        if (Math.abs(nearest(onsets, predicted) - predicted) <= tolerance) hits++;
      }
      // Dense periodic onsets make several tempo octaves fit perfectly, so
      // ties break toward the scale closest to the score's nominal tempo.
      const better =
        hits > best.hits ||
        (hits === best.hits && Math.abs(Math.log(scale)) < Math.abs(Math.log(best.scale)));
      if (better) best = { scale, offset, hits };
    }
  }

  const gaps = expectedTimes.slice(1).map((t, i) => t - expectedTimes[i]!);
  const medianGap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : 1;
  const snapWindow = 0.3 * medianGap * best.scale;

  const result = expectedTimes.map((expected) => {
    const predicted = expected * best.scale + best.offset;
    const candidate = nearest(onsets, predicted);
    return Math.abs(candidate - predicted) <= snapWindow ? candidate : predicted;
  });

  for (let i = 1; i < result.length; i++) {
    if (result[i]! <= result[i - 1]!) result[i] = result[i - 1]! + 0.05;
  }
  return result.map((t) => Math.max(0, t));
}

function nearest(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sorted[lo - 1]! - target) < Math.abs(sorted[lo]! - target)) lo--;
  return sorted[lo]!;
}

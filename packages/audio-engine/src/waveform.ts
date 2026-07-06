export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
  /** Number of buckets. */
  length: number;
}

/** Min/max of the mono mixdown over sample range [start, end). */
function bucketMinMax(channels: Float32Array[], start: number, end: number): [number, number] {
  const n = channels.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = start; i < end; i++) {
    let sample = 0;
    for (const channel of channels) sample += channel[i]!;
    sample /= n;
    if (sample < lo) lo = sample;
    if (sample > hi) hi = sample;
  }
  return [lo === Infinity ? 0 : lo, hi === -Infinity ? 0 : hi];
}

/** Sample-range bounds of bucket `b` (at least one sample wide). */
function bucketBounds(b: number, samplesPerBucket: number, sampleCount: number): [number, number] {
  const start = Math.floor(b * samplesPerBucket);
  const end = Math.min(sampleCount, Math.max(start + 1, Math.floor((b + 1) * samplesPerBucket)));
  return [start, end];
}

/**
 * Like computePeaks but yields to the event loop between chunks, so peaks for
 * very long recordings do not freeze the tab. onProgress reports 0..1.
 */
export async function computePeaksAsync(
  channels: Float32Array[],
  buckets: number,
  onProgress?: (fraction: number) => void,
): Promise<WaveformPeaks> {
  if (channels.length === 0 || buckets <= 0) {
    return { min: new Float32Array(0), max: new Float32Array(0), length: 0 };
  }
  const sampleCount = channels[0]!.length;
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const samplesPerBucket = sampleCount / buckets;
  const chunk = 2000;

  for (let b = 0; b < buckets; b++) {
    const [start, end] = bucketBounds(b, samplesPerBucket, sampleCount);
    [min[b], max[b]] = bucketMinMax(channels, start, end);
    if (b % chunk === chunk - 1) {
      onProgress?.(b / buckets);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(1);
  return { min, max, length: buckets };
}

/**
 * Min/max peaks over equal-sized buckets of a mono mixdown, for waveform
 * rendering. Channels must be equal length.
 */
export function computePeaks(channels: Float32Array[], buckets: number): WaveformPeaks {
  if (channels.length === 0 || buckets <= 0) {
    return { min: new Float32Array(0), max: new Float32Array(0), length: 0 };
  }
  const sampleCount = channels[0]!.length;
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const samplesPerBucket = sampleCount / buckets;

  for (let b = 0; b < buckets; b++) {
    const [start, end] = bucketBounds(b, samplesPerBucket, sampleCount);
    [min[b], max[b]] = bucketMinMax(channels, start, end);
  }
  return { min, max, length: buckets };
}

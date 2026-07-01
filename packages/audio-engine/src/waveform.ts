export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
  /** Number of buckets. */
  length: number;
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
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(sampleCount, Math.max(start + 1, Math.floor((b + 1) * samplesPerBucket)));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i]!;
      sample /= channels.length;
      if (sample < lo) lo = sample;
      if (sample > hi) hi = sample;
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { min, max, length: buckets };
}

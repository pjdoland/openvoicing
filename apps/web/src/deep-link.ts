export interface DeepLinkPreset {
  /** Playback speed factor (0.25 to 1.5), if valid. */
  speed?: number;
  /** Loop region in seconds, from loop=<start>-<end>. */
  loopSeconds?: { start: number; end: number };
  /** Loop region as 1-based bar numbers, from loop=b<start>-<end>. */
  loopBars?: { fromBar: number; toBar: number };
  /** Start position in seconds, from t=<seconds>. */
  start?: number;
}

/**
 * Parse embed deep-link query params into a normalized preset. Pure: does not
 * touch any player. Invalid or out-of-range values are dropped.
 */
export function parseDeepLink(params: URLSearchParams): DeepLinkPreset {
  const preset: DeepLinkPreset = {};

  const speed = Number(params.get("speed"));
  if (Number.isFinite(speed) && speed >= 0.25 && speed <= 1.5) {
    preset.speed = speed;
  }

  const loop = params.get("loop");
  if (loop) {
    const bars = /^b(\d+)-(\d+)$/.exec(loop);
    const secs = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(loop);
    if (bars) {
      const fromBar = Number(bars[1]);
      const toBar = Number(bars[2]);
      if (fromBar >= 1 && toBar >= fromBar) preset.loopBars = { fromBar, toBar };
    } else if (secs) {
      const start = Number(secs[1]);
      const end = Number(secs[2]);
      if (end > start) preset.loopSeconds = { start, end };
    }
  }

  const start = Number(params.get("t"));
  if (Number.isFinite(start) && start > 0) preset.start = start;

  return preset;
}

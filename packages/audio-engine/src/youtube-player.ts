import type { LoopRegion, MediaPlayer, MediaPlayerEvents } from "./media-player";

/**
 * Plays a YouTube video through the official IFrame Player API and exposes it
 * as a MediaPlayer, so the app's sync/cursor/loop code treats it exactly like a
 * decoded recording. Position comes from polling getCurrentTime (the API has no
 * high-rate position event); speed snaps to YouTube's discrete rates; looping
 * is emulated by seeking back at the loop end. We embed via youtube-nocookie
 * and never download media, per YouTube's Terms of Service.
 */

const YT_RATES_FALLBACK = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
// YT.PlayerState.PLAYING === 1.
const YT_PLAYING = 1;

/** Snap a requested speed to the nearest rate the player actually supports. */
export function snapRate(target: number, rates: number[]): number {
  if (rates.length === 0) return target;
  return rates.reduce((best, r) => (Math.abs(r - target) < Math.abs(best - target) ? r : best));
}

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  getPlayerState(): number;
  destroy(): void;
}

interface YTGlobal {
  Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer;
}

let apiPromise: Promise<YTGlobal> | null = null;

/** Load the IFrame Player API script once and resolve when YT is ready. */
function loadYouTubeApi(): Promise<YTGlobal> {
  const w = window as unknown as {
    YT?: YTGlobal & { Player?: unknown };
    onYouTubeIframeAPIReady?: () => void;
  };
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTGlobal>((resolve) => {
    if (w.YT?.Player) {
      resolve(w.YT);
      return;
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT as YTGlobal);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export interface YouTubePlayerOptions {
  videoId: string;
  /** Clip start within the video, in seconds. */
  startSeconds?: number;
  /** Clip end within the video, in seconds; playback stops/loops here. */
  endSeconds?: number;
}

export class YouTubePlayer implements MediaPlayer {
  private yt: YTPlayer | null = null;
  private _duration = 0;
  private _position = 0;
  private _playing = false;
  private _speed = 1;
  private _rates = YT_RATES_FALLBACK;
  private _loop: LoopRegion | null = null;
  private readonly start: number;
  private readonly end: number | undefined;
  private raf: number | null = null;
  private readyResolve!: () => void;
  private readonly readyPromise: Promise<void>;
  private readonly listeners: { [K in keyof MediaPlayerEvents]: Set<MediaPlayerEvents[K]> } = {
    stateChanged: new Set(),
    positionChanged: new Set(),
    speedChanged: new Set(),
    loopChanged: new Set(),
    looped: new Set(),
  };

  constructor(container: HTMLElement, opts: YouTubePlayerOptions) {
    this.start = opts.startSeconds ?? 0;
    this.end = opts.endSeconds;
    this.readyPromise = new Promise((resolve) => (this.readyResolve = resolve));
    void this.mount(container, opts);
  }

  private async mount(container: HTMLElement, opts: YouTubePlayerOptions): Promise<void> {
    const YT = await loadYouTubeApi();
    const host = container.appendChild(document.createElement("div"));
    this.yt = new YT.Player(host, {
      videoId: opts.videoId,
      host: "https://www.youtube-nocookie.com",
      width: "100%",
      height: "100%",
      playerVars: {
        start: this.start ? Math.floor(this.start) : undefined,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => this.onReady(),
        onStateChange: (e: { data: number }) => this.onStateChange(e.data),
      },
    });
  }

  private onReady(): void {
    if (!this.yt) return;
    this._duration = this.end ?? this.yt.getDuration();
    this._position = this.start;
    const rates = this.yt.getAvailablePlaybackRates();
    if (rates?.length) this._rates = rates;
    this.readyResolve();
    this.emit("positionChanged", this._position, this._duration);
  }

  private onStateChange(state: number): void {
    const playing = state === YT_PLAYING;
    if (playing === this._playing) return;
    this._playing = playing;
    this.emit("stateChanged", playing);
    if (playing) this.startPolling();
    else this.stopPolling();
  }

  /** Resolves once the underlying player is ready (duration known). */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  get duration(): number {
    return this._duration;
  }

  get position(): number {
    return this._position;
  }

  get playing(): boolean {
    return this._playing;
  }

  get availableSpeeds(): number[] | null {
    return this._rates;
  }

  get loopRegion(): LoopRegion | null {
    return this._loop;
  }

  get speed(): number {
    return this._speed;
  }

  set speed(value: number) {
    const snapped = snapRate(value, this._rates);
    this._speed = snapped;
    this.yt?.setPlaybackRate(snapped);
    this.emit("speedChanged", snapped);
  }

  async play(): Promise<void> {
    await this.readyPromise;
    this.yt?.playVideo();
  }

  pause(): void {
    this.yt?.pauseVideo();
  }

  seek(seconds: number): void {
    const clamped = Math.max(this.start, this.end != null ? Math.min(seconds, this.end) : seconds);
    this._position = clamped;
    this.yt?.seekTo(clamped, true);
    this.emit("positionChanged", clamped, this._duration);
  }

  setLoopRegion(region: LoopRegion | null): void {
    this._loop = region;
    this.emit("loopChanged", region);
  }

  private startPolling(): void {
    if (this.raf != null) return;
    const tick = (): void => {
      if (!this.yt) return;
      let t = this.yt.getCurrentTime();
      if (this._loop) {
        // A/B loop: wrap from the loop end back to the loop start.
        if (t >= this._loop.end - 0.03) {
          this.yt.seekTo(this._loop.start, true);
          t = this._loop.start;
          this.emit("looped");
        }
      } else if (this.end != null && t >= this.end - 0.03) {
        // A bare clip end (no loop) stops at the end, the way decoded audio
        // halts at its duration, instead of restarting forever.
        this.pause();
        t = this.end;
        this._position = t;
        this.emit("positionChanged", t, this._duration);
        return;
      }
      this._position = t;
      this.emit("positionChanged", t, this._duration);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopPolling(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  on<K extends keyof MediaPlayerEvents>(event: K, handler: MediaPlayerEvents[K]): () => void {
    this.listeners[event].add(handler);
    return () => this.listeners[event].delete(handler);
  }

  private emit<K extends keyof MediaPlayerEvents>(
    event: K,
    ...args: Parameters<MediaPlayerEvents[K]>
  ): void {
    for (const handler of this.listeners[event]) {
      (handler as (...a: Parameters<MediaPlayerEvents[K]>) => void)(...args);
    }
  }

  destroy(): void {
    this.stopPolling();
    this.yt?.destroy();
    this.yt = null;
  }
}

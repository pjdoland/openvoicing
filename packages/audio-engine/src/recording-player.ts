/// <reference path="./signalsmith-stretch.d.ts" />
import SignalsmithStretch, { type SignalsmithStretchNode } from "signalsmith-stretch";

export interface LoopRegion {
  start: number;
  end: number;
}

export interface RecordingPlayerEvents {
  loaded: (info: { duration: number; channels: Float32Array[]; sampleRate: number }) => void;
  stateChanged: (playing: boolean) => void;
  positionChanged: (seconds: number, duration: number) => void;
  speedChanged: (speed: number) => void;
  loopChanged: (region: LoopRegion | null) => void;
  /** Fired each time playback wraps from the end of the loop back to the start. */
  looped: () => void;
}

const POSITION_INTERVAL_MS = 50;

/**
 * Plays a decoded recording through the Signalsmith Stretch AudioWorklet, so
 * speed changes preserve pitch. The AudioContext is created lazily on first
 * load/play, which must happen from a user gesture for audio to be audible.
 */
export class RecordingPlayer {
  private context: AudioContext | null = null;
  private node: SignalsmithStretchNode | null = null;
  private _duration = 0;
  private _loadedInfo: { duration: number; channels: Float32Array[]; sampleRate: number } | null =
    null;
  private _speed = 1;
  private _playing = false;
  private _position = 0;
  private _loop: LoopRegion | null = null;
  private _pitchSemitones = 0;
  /** Silence inserted between loop repeats, with count-in clicks. */
  loopGapSeconds = 0;
  private gapTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners: {
    [K in keyof RecordingPlayerEvents]: Set<RecordingPlayerEvents[K]>;
  } = {
    loaded: new Set(),
    stateChanged: new Set(),
    positionChanged: new Set(),
    speedChanged: new Set(),
    loopChanged: new Set(),
    looped: new Set(),
  };

  on<K extends keyof RecordingPlayerEvents>(
    event: K,
    handler: RecordingPlayerEvents[K],
  ): () => void {
    this.listeners[event].add(handler);
    return () => this.listeners[event].delete(handler);
  }

  private emit<K extends keyof RecordingPlayerEvents>(
    event: K,
    ...args: Parameters<RecordingPlayerEvents[K]>
  ): void {
    for (const handler of this.listeners[event]) {
      (handler as (...a: Parameters<RecordingPlayerEvents[K]>) => void)(...args);
    }
  }

  private async ensureNode(): Promise<SignalsmithStretchNode> {
    if (!this.context) this.context = new AudioContext();
    if (!this.node) {
      this.node = await SignalsmithStretch(this.context);
      this.node.connect(this.context.destination);
    }
    return this.node;
  }

  async load(data: ArrayBuffer): Promise<void> {
    const node = await this.ensureNode();
    this.pause();
    // decodeAudioData resamples to the context rate, so worklet input seconds
    // line up with the context clock.
    const buffer = await this.context!.decodeAudioData(data);
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    await node.dropBuffers();
    await node.addBuffers(channels);
    this._duration = buffer.duration;
    this._position = 0;
    this._loop = null;
    this._loadedInfo = { duration: buffer.duration, channels, sampleRate: buffer.sampleRate };
    this.emit("loaded", {
      duration: buffer.duration,
      channels,
      sampleRate: buffer.sampleRate,
    });
    this.emit("positionChanged", 0, this._duration);
  }

  get duration(): number {
    return this._duration;
  }

  /**
   * The most recently loaded audio, for a UI that subscribed after load() fired
   * its "loaded" event (e.g. a panel that mounts lazily). Null before any load.
   */
  get loadedInfo(): { duration: number; channels: Float32Array[]; sampleRate: number } | null {
    return this._loadedInfo;
  }

  get playing(): boolean {
    return this._playing;
  }

  get position(): number {
    return this._position;
  }

  /** Playback rate factor, 1 is original speed. Pitch is preserved. */
  get speed(): number {
    return this._speed;
  }

  set speed(value: number) {
    this._speed = value;
    if (this._playing) this.applySchedule();
    this.emit("speedChanged", value);
  }

  /** Pitch shift in semitones (fractional allowed), independent of speed. */
  get pitchSemitones(): number {
    return this._pitchSemitones;
  }

  set pitchSemitones(value: number) {
    this._pitchSemitones = value;
    if (this._playing) this.applySchedule();
  }

  get loopRegion(): LoopRegion | null {
    return this._loop;
  }

  setLoopRegion(region: LoopRegion | null): void {
    this._loop = region;
    if (this._playing) {
      if (region && (this._position < region.start || this._position >= region.end)) {
        this._position = region.start;
      }
      this.applySchedule();
    }
    this.emit("loopChanged", region);
  }

  /**
   * Scheduled changes replace any later scheduled state in the worklet, so
   * every change re-sends the complete playback state. Gapped loops are
   * driven manually from tick() instead of the worklet's auto-loop.
   */
  private applySchedule(): void {
    const autoLoop = this._loop && this.loopGapSeconds <= 0 ? this._loop : null;
    this.node?.schedule({
      active: this._playing,
      input: this._position,
      rate: this._speed,
      semitones: this._pitchSemitones,
      ...(autoLoop
        ? { loopStart: autoLoop.start, loopEnd: autoLoop.end }
        : { loopStart: 0, loopEnd: 0 }),
    });
  }

  private playGapClicks(gapSeconds: number): void {
    const context = this.context;
    if (!context) return;
    const clicks = 4;
    for (let i = 0; i < clicks; i++) {
      const at = context.currentTime + (i * gapSeconds) / clicks;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.frequency.value = i === clicks - 1 ? 1320 : 880;
      gain.gain.setValueAtTime(0.4, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.08);
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + 0.1);
    }
  }

  async play(): Promise<void> {
    if (this._duration === 0 || this._playing) return;
    // Resume the AudioContext synchronously, within the click gesture, BEFORE
    // any await. Safari only honours resume() while the user gesture is still
    // on the stack; awaiting the worklet module first consumes the gesture and
    // leaves the context suspended (silent playback on Safari/iOS).
    if (!this.context) this.context = new AudioContext();
    const resuming = this.context.state === "suspended" ? this.context.resume() : undefined;
    const node = await this.ensureNode();
    await resuming;
    if (this._loop && (this._position < this._loop.start || this._position >= this._loop.end)) {
      this._position = this._loop.start;
    }
    if (this._position >= this._duration) this._position = 0;
    this._playing = true;
    this.applySchedule();
    this.emit("stateChanged", true);
    this.timer = setInterval(() => this.tick(), POSITION_INTERVAL_MS);
  }

  private tick(): void {
    if (!this.node) return;
    const previous = this._position;
    this._position = this.node.inputTime;
    if (
      this._loop &&
      previous > this._position &&
      previous - this._position > (this._loop.end - this._loop.start) / 2
    ) {
      this.emit("looped");
    }
    if (this._loop && this.loopGapSeconds > 0 && this._position >= this._loop.end) {
      // Manual loop with a breathing gap: stop, click a count-in, restart.
      const loop = this._loop;
      const gap = this.loopGapSeconds;
      this._position = loop.end;
      this.node.schedule({ active: false, input: loop.start, rate: this._speed, loopStart: 0, loopEnd: 0 });
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.playGapClicks(gap);
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null;
        if (!this._playing) return;
        this._position = loop.start;
        this.applySchedule();
        this.timer = setInterval(() => this.tick(), POSITION_INTERVAL_MS);
        this.emit("looped");
      }, gap * 1000);
      return;
    }
    if (!this._loop && this._position >= this._duration) {
      this._position = this._duration;
      this.pause();
    }
    this.emit("positionChanged", this._position, this._duration);
  }

  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    this.applySchedule();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit("stateChanged", false);
  }

  seek(seconds: number): void {
    this._position = Math.min(Math.max(0, seconds), this._duration);
    if (this._playing) {
      this.applySchedule();
    } else {
      this.emit("positionChanged", this._position, this._duration);
    }
  }

  destroy(): void {
    this.pause();
    this.node?.disconnect();
    this.node = null;
    void this.context?.close();
    this.context = null;
  }
}

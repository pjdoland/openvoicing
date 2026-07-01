import * as alphaTab from "@coderline/alphatab";

export interface TrackInfo {
  index: number;
  name: string;
  mute: boolean;
  solo: boolean;
}

export interface PlayerOptions {
  /** URL of an sf2/sf3 soundfont used for synth playback. */
  soundFontUrl: string;
  /** Directory URL serving the Bravura music font files, with trailing slash. */
  fontDirectory: string;
  scale?: number;
}

/** Structural address of a beat within the score. */
export interface BeatLocation {
  trackIndex: number;
  barIndex: number;
  voiceIndex: number;
  beatIndex: number;
}

export interface PlayerEvents {
  scoreLoaded: (info: { title: string; artist: string; tracks: TrackInfo[] }) => void;
  playerStateChanged: (playing: boolean) => void;
  positionChanged: (currentSeconds: number, totalSeconds: number) => void;
  playerReady: () => void;
  /** A beat was clicked: its absolute playback tick and structural address. */
  beatClicked: (tick: number, location: BeatLocation) => void;
  error: (error: Error) => void;
}

export interface BarTicks {
  /** Absolute playback tick where the bar starts. */
  start: number;
  duration: number;
}

/**
 * The OpenVoicing player: notation rendering, synth playback, and practice
 * tools behind a renderer-agnostic surface. Currently implemented on alphaTab;
 * consumers must not depend on alphaTab types so the engine stays swappable.
 */
export class Player {
  private readonly api: alphaTab.AlphaTabApi;
  private readonly listeners: { [K in keyof PlayerEvents]: Set<PlayerEvents[K]> } = {
    scoreLoaded: new Set(),
    playerStateChanged: new Set(),
    positionChanged: new Set(),
    playerReady: new Set(),
    beatClicked: new Set(),
    error: new Set(),
  };

  constructor(container: HTMLElement, options: PlayerOptions) {
    this.api = new alphaTab.AlphaTabApi(container, {
      core: {
        fontDirectory: options.fontDirectory,
      },
      display: {
        scale: options.scale ?? 1,
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledAutomatic,
        soundFont: options.soundFontUrl,
      },
    });

    this.api.scoreLoaded.on((score) => {
      this.emit("scoreLoaded", {
        title: score.title,
        artist: score.artist,
        tracks: this.tracks,
      });
    });
    this.api.playerReady.on(() => this.emit("playerReady"));
    this.api.playerStateChanged.on((args) => {
      this.emit("playerStateChanged", args.state === alphaTab.synth.PlayerState.Playing);
    });
    this.api.playerPositionChanged.on((args) => {
      this.emit("positionChanged", args.currentTime / 1000, args.endTime / 1000);
    });
    this.api.beatMouseDown.on((beat) => {
      this.emit("beatClicked", beat.absolutePlaybackStart, {
        trackIndex: beat.voice.bar.staff.track.index,
        barIndex: beat.voice.bar.index,
        voiceIndex: beat.voice.index,
        beatIndex: beat.index,
      });
    });
    this.api.error.on((error) => this.emit("error", error));
  }

  on<K extends keyof PlayerEvents>(event: K, handler: PlayerEvents[K]): () => void {
    this.listeners[event].add(handler);
    return () => this.listeners[event].delete(handler);
  }

  private emit<K extends keyof PlayerEvents>(
    event: K,
    ...args: Parameters<PlayerEvents[K]>
  ): void {
    for (const handler of this.listeners[event]) {
      (handler as (...a: Parameters<PlayerEvents[K]>) => void)(...args);
    }
  }

  loadTex(tex: string): void {
    this.api.tex(tex);
  }

  load(data: ArrayBuffer | Uint8Array): boolean {
    return this.api.load(data);
  }

  playPause(): void {
    this.api.playPause();
  }

  stop(): void {
    this.api.stop();
  }

  get playing(): boolean {
    return this.api.playerState === alphaTab.synth.PlayerState.Playing;
  }

  /** Playback speed as a factor, 1 is original tempo. Pitch is unaffected. */
  get speed(): number {
    return this.api.playbackSpeed;
  }

  set speed(value: number) {
    this.api.playbackSpeed = value;
  }

  /** When enabled, playback loops the current selection or the whole piece. */
  setLooping(enabled: boolean): void {
    this.api.isLooping = enabled;
  }

  /** Restrict synth playback to a tick range (and loop it), or clear with null. */
  setPlaybackRange(range: { startTick: number; endTick: number } | null): void {
    this.api.playbackRange = range;
    if (range) this.api.isLooping = true;
  }

  setMetronome(enabled: boolean): void {
    this.api.metronomeVolume = enabled ? 1 : 0;
  }

  setCountIn(enabled: boolean): void {
    this.api.countInVolume = enabled ? 1 : 0;
  }

  /** The score's nominal tempo in beats per minute. */
  get tempoBpm(): number {
    return this.api.score?.tempo ?? 120;
  }

  /** Start tick and duration of each bar, in absolute playback ticks. */
  get barTicks(): BarTicks[] {
    const score = this.api.score;
    if (!score) return [];
    return score.masterBars.map((mb) => ({
      start: mb.start,
      duration: mb.calculateDuration(),
    }));
  }

  /**
   * The playback cursor position in absolute ticks. Setting it moves the
   * rendered cursor and scrolls to it, whether or not the synth is playing.
   */
  get cursorTick(): number {
    return this.api.tickPosition;
  }

  set cursorTick(tick: number) {
    this.api.tickPosition = tick;
  }

  /** Seek synth playback to a time position in seconds. */
  seekSeconds(seconds: number): void {
    this.api.timePosition = seconds * 1000;
  }

  get tracks(): TrackInfo[] {
    const score = this.api.score;
    if (!score) return [];
    return score.tracks.map((t) => ({
      index: t.index,
      name: t.name,
      mute: t.playbackInfo.isMute,
      solo: t.playbackInfo.isSolo,
    }));
  }

  setTrackMute(trackIndex: number, mute: boolean): void {
    const track = this.api.score?.tracks[trackIndex];
    if (track) this.api.changeTrackMute([track], mute);
  }

  setTrackSolo(trackIndex: number, solo: boolean): void {
    const track = this.api.score?.tracks[trackIndex];
    if (track) this.api.changeTrackSolo([track], solo);
  }

  destroy(): void {
    this.api.destroy();
  }
}

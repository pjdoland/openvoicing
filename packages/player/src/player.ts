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
  private readonly container: HTMLElement;
  private loopMarkerLayer: HTMLDivElement | null = null;
  private loopRange: { startBar: number; endBar: number } | null = null;
  private readonly listeners: { [K in keyof PlayerEvents]: Set<PlayerEvents[K]> } = {
    scoreLoaded: new Set(),
    playerStateChanged: new Set(),
    positionChanged: new Set(),
    playerReady: new Set(),
    beatClicked: new Set(),
    error: new Set(),
  };

  constructor(container: HTMLElement, options: PlayerOptions) {
    this.container = container;
    this.api = new alphaTab.AlphaTabApi(container, {
      core: {
        fontDirectory: options.fontDirectory,
      },
      display: {
        scale: options.scale ?? 1,
        resources: {
          // alphaTab greys secondary voices; a piano left hand is a second
          // voice, so keep it solid black like the right hand.
          secondaryGlyphColor: new alphaTab.model.Color(0, 0, 0, 255),
        },
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledAutomatic,
        soundFont: options.soundFontUrl,
        // Show where playback is: highlight the active bar/beat and follow it.
        enableCursor: true,
        enableAnimatedBeatCursor: true,
        enableElementHighlighting: true,
        scrollMode: alphaTab.ScrollMode.Continuous,
        // Scroll the notation pane itself (it has its own overflow), not the
        // whole page, so following and jumps move the score into view.
        scrollElement: container.parentElement ?? container,
        scrollOffsetY: -10,
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
    // Re-place loop markers whenever the score is (re-)laid out.
    this.api.renderFinished.on(() => this.renderLoopMarkers());
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

  /** Move the cursor to a tick and start synth playback from there. */
  playFromTick(tick: number): void {
    this.api.tickPosition = tick;
    if (this.api.playerState !== alphaTab.synth.PlayerState.Playing) this.api.playPause();
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

  /** Bar index whose start tick is at or before `tick`. */
  barIndexAtTick(tick: number): number {
    const bars = this.barTicks;
    let idx = 0;
    for (let i = 0; i < bars.length; i++) {
      if (bars[i]!.start <= tick) idx = i;
      else break;
    }
    return idx;
  }

  private barBounds(barIndex: number): { x: number; y: number; w: number; h: number } | null {
    const bl = this.api.renderer?.boundsLookup as
      | { staffSystems?: Array<{ bars: Array<{ index: number; realBounds: { x: number; y: number; w: number; h: number } }> }> }
      | undefined;
    if (!bl?.staffSystems) return null;
    for (const sys of bl.staffSystems) {
      for (const bar of sys.bars) {
        if (bar.index === barIndex) return bar.realBounds;
      }
    }
    return null;
  }

  /**
   * Scroll the notation pane so a bar is in view, using the rendered bar bounds
   * (deterministic, unlike alphaTab's cursor scroll). Only scrolls when the bar
   * has left the viewport, so following reads like a page turn.
   */
  scrollBarIntoView(barIndex: number): void {
    const pane = this.container.parentElement;
    const b = this.barBounds(barIndex);
    if (!pane || !b) return;
    const top = b.y;
    const bottom = b.y + b.h;
    if (top < pane.scrollTop + 8 || bottom > pane.scrollTop + pane.clientHeight - 8) {
      pane.scrollTop = Math.max(0, top - pane.clientHeight * 0.25);
    }
  }

  /** Bracket the first and last bars of a looped range, or clear with null. */
  setLoopMarkers(range: { startBar: number; endBar: number } | null): void {
    this.loopRange = range;
    this.renderLoopMarkers();
  }

  private renderLoopMarkers(): void {
    let layer = this.loopMarkerLayer;
    if (!layer || !layer.isConnected) {
      layer = document.createElement("div");
      layer.className = "ov-loop-markers";
      this.container.style.position = "relative";
      this.container.appendChild(layer);
      this.loopMarkerLayer = layer;
    }
    layer.textContent = "";
    const range = this.loopRange;
    if (!range) return;
    const draw = (barIndex: number, side: "start" | "end") => {
      const b = this.barBounds(barIndex);
      if (!b) return;
      const el = document.createElement("div");
      el.className = `ov-loop-bracket ${side}`;
      el.style.left = `${b.x}px`;
      el.style.top = `${b.y}px`;
      el.style.width = `${b.w}px`;
      el.style.height = `${b.h}px`;
      layer!.appendChild(el);
    };
    draw(range.startBar, "start");
    draw(range.endBar, "end");
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

  /** Open the browser print dialog with a paginated copy of the score. */
  print(): void {
    this.api.print();
  }

  destroy(): void {
    this.api.destroy();
  }
}

import * as alphaTab from "@coderline/alphatab";
import { v1 } from "@openvoicing/score-model";
import { toAlphaTabScore } from "./alphatab-adapter";

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
  /** v1 model beat id, when the score was rendered from the v1 model. */
  modelBeatId?: string;
}

/** A selected editable element: a specific note, or a rest (by its beat). */
export interface EditSelection {
  noteId?: string;
  restBeatId?: string;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlayerEvents {
  scoreLoaded: (info: { title: string; artist: string; tracks: TrackInfo[] }) => void;
  playerStateChanged: (playing: boolean) => void;
  positionChanged: (currentSeconds: number, totalSeconds: number) => void;
  playerReady: () => void;
  /** A beat was clicked: its absolute playback tick and structural address. */
  beatClicked: (tick: number, location: BeatLocation) => void;
  /** A specific note was clicked (v1 model note id + its beat id). */
  noteClicked: (noteId: string | undefined, beatId: string | undefined) => void;
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
  private highlightLayer: HTMLDivElement | null = null;
  private selection: EditSelection | null = null;
  private pendingScrollTop: number | null = null;
  private watermarkObserver: MutationObserver | null = null;
  private readonly listeners: { [K in keyof PlayerEvents]: Set<PlayerEvents[K]> } = {
    scoreLoaded: new Set(),
    playerStateChanged: new Set(),
    positionChanged: new Set(),
    playerReady: new Set(),
    beatClicked: new Set(),
    noteClicked: new Set(),
    error: new Set(),
  };

  constructor(container: HTMLElement, options: PlayerOptions) {
    this.container = container;
    this.api = new alphaTab.AlphaTabApi(container, {
      core: {
        fontDirectory: options.fontDirectory,
        // Needed for note-level click selection (noteMouseDown) and per-note
        // bounds used to highlight the exact selected note.
        includeNoteBounds: true,
        // Render on the main thread. alphaTab's worker renderer serializes its
        // BoundsLookup back to the main thread via BoundsLookup.fromJson, which
        // crashes on some multi-staff note bounds ("Cannot read properties of
        // undefined (reading 'notes')") under CI's Linux headless timing.
        // Practice-piece scores lay out fast enough that main-thread rendering
        // is imperceptible, and it avoids the fragile serialization path.
        useWorkers: false,
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
        modelBeatId: (beat as unknown as { ovBeatId?: string }).ovBeatId,
      });
    });
    this.api.noteMouseDown.on((note) => {
      this.emit(
        "noteClicked",
        (note as unknown as { ovNoteId?: string }).ovNoteId,
        (note.beat as unknown as { ovBeatId?: string }).ovBeatId,
      );
    });
    this.api.error.on((error) => this.emit("error", error));
    // Re-place loop markers whenever the score is (re-)laid out.
    this.api.renderFinished.on(() => {
      this.renderLoopMarkers();
      this.renderHighlight();
      // Undo alphaTab's auto-scroll-to-cursor after an edit re-render so the
      // view stays where the user was working. alphaTab scrolls a few frames
      // later (its cursor update), so pin the position across that window.
      if (this.pendingScrollTop !== null) {
        const pane = this.container.parentElement;
        const top = this.pendingScrollTop;
        this.pendingScrollTop = null;
        if (pane) {
          pane.scrollTop = top;
          let frames = 0;
          const pin = () => {
            pane.scrollTop = top;
            if (++frames < 20) requestAnimationFrame(pin);
          };
          requestAnimationFrame(pin);
          setTimeout(() => (pane.scrollTop = top), 60);
          setTimeout(() => (pane.scrollTop = top), 180);
        }
      }
    });
    // Hide alphaTab's "rendered by alphaTab" annotation. postRenderFinished
    // catches it after a normal render; a MutationObserver also re-hides it
    // after late re-layouts (font load, resize) that re-add it without firing
    // postRenderFinished. The observer watches childList only (not the
    // per-frame cursor attribute updates) and coalesces to one call per frame.
    this.api.postRenderFinished.on(() => this.hideEngineWatermark());
    if (typeof MutationObserver !== "undefined") {
      let watermarkScheduled = false;
      this.watermarkObserver = new MutationObserver(() => {
        if (watermarkScheduled) return;
        watermarkScheduled = true;
        requestAnimationFrame(() => {
          watermarkScheduled = false;
          this.hideEngineWatermark();
        });
      });
      this.watermarkObserver.observe(this.container, { childList: true, subtree: true });
    }
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

  private autoScrollTimer: ReturnType<typeof setTimeout> | null = null;
  private autoScrollOff = false;
  /**
   * Stand the engine's own follow-scroll down (or back up), e.g. while the user
   * scrolls the notation by hand. Passing on=false with resumeMs re-enables
   * after that delay. Toggling only on transitions keeps it cheap on a wheel.
   */
  setAutoScroll(on: boolean, resumeMs = 0): void {
    const settings = this.api?.settings;
    if (!settings) return;
    if (this.autoScrollTimer !== null) {
      clearTimeout(this.autoScrollTimer);
      this.autoScrollTimer = null;
    }
    if (!on) {
      if (!this.autoScrollOff) {
        this.autoScrollOff = true;
        settings.player.scrollMode = alphaTab.ScrollMode.Off;
      }
      if (resumeMs > 0) {
        this.autoScrollTimer = setTimeout(() => this.setAutoScroll(true), resumeMs);
      }
    } else if (this.autoScrollOff) {
      this.autoScrollOff = false;
      settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
    }
  }

  /** Outline a looped bar range as one continuous region, or clear with null. */
  setLoopMarkers(range: { startBar: number; endBar: number } | null): void {
    this.loopRange = range;
    this.renderLoopMarkers();
  }

  /**
   * Hide alphaTab's hardcoded "rendered by alphaTab" annotation. It has no
   * setting to disable and reads to newcomers as an unfinished/debug page
   * (hallway test C7). Attribution is preserved: the engine is credited
   * intentionally in the app footer ("Engraving by alphaTab").
   */
  private hideEngineWatermark(): void {
    for (const el of this.container.querySelectorAll<SVGTextElement>("text")) {
      if (el.textContent?.includes("rendered by alphaTab")) el.style.display = "none";
    }
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
    type Box = { x: number; y: number; w: number; h: number };
    const bl = this.api.renderer?.boundsLookup as
      | { staffSystems?: Array<{ bars: Array<{ index: number; realBounds: Box; visualBounds?: Box }> }> }
      | undefined;
    if (!bl?.staffSystems) return;
    const lo = Math.min(range.startBar, range.endBar);
    const hi = Math.max(range.startBar, range.endBar);
    // One continuous span per staff system (row): union the bounds of every
    // in-range bar on that row. The vertical end walls appear only on the rows
    // holding the true first/last bar, so a multi-line loop reads as one region.
    for (const sys of bl.staffSystems) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let hasStart = false;
      let hasEnd = false;
      let any = false;
      for (const bar of sys.bars) {
        if (bar.index < lo || bar.index > hi) continue;
        any = true;
        // Horizontal from realBounds (full bar width, so bars connect); vertical
        // from the tighter visualBounds so the wash hugs the staves instead of
        // bleeding into the padding below the system.
        const rb = bar.realBounds;
        const vb = bar.visualBounds ?? bar.realBounds;
        minX = Math.min(minX, rb.x);
        maxX = Math.max(maxX, rb.x + rb.w);
        minY = Math.min(minY, vb.y);
        maxY = Math.max(maxY, vb.y + vb.h);
        if (bar.index === lo) hasStart = true;
        if (bar.index === hi) hasEnd = true;
      }
      if (!any) continue;
      const el = document.createElement("div");
      el.className = `ov-loop-region${hasStart ? " at-start" : ""}${hasEnd ? " at-end" : ""}`;
      el.style.left = `${minX}px`;
      el.style.top = `${minY}px`;
      el.style.width = `${maxX - minX}px`;
      el.style.height = `${maxY - minY}px`;
      layer.appendChild(el);
    }
  }

  /**
   * Resolve the v1 model note id nearest a screen position: the beat under the
   * cursor, then its note closest in the vertical (pitch) axis. This makes a
   * click select the note the user aimed at even between stacked noteheads.
   */
  elementAtPosition(clientX: number, clientY: number): EditSelection | undefined {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: EditSelection | undefined;
    let bestDist = Infinity;
    // Nearest notehead or rest across every voice/staff (overlapping voices
    // share an x column, so a per-beat search would pick the wrong voice).
    this.forEachSelectable((sel, b) => {
      const dx = b.x + b.w / 2 - x;
      const dy = b.y + b.h / 2 - y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = sel;
      }
    });
    // Ignore clicks far from any element so empty-staff clicks don't grab one.
    return Math.sqrt(bestDist) <= 48 ? best : undefined;
  }

  private forEachSelectable(cb: (sel: EditSelection, bounds: Bounds) => void): void {
    const bl = this.api.renderer?.boundsLookup as
      | {
          staffSystems?: Array<{
            bars: Array<{
              bars: Array<{
                beats: Array<{
                  beat?: { isRest?: boolean; ovBeatId?: string };
                  visualBounds?: Bounds;
                  notes?: Array<{ note?: { ovNoteId?: string }; noteHeadBounds?: Bounds }> | null;
                }>;
              }>;
            }>;
          }>;
        }
      | undefined;
    if (!bl?.staffSystems) return;
    for (const sys of bl.staffSystems)
      for (const mb of sys.bars)
        for (const bar of mb.bars)
          for (const bb of bar.beats) {
            if (bb.notes?.length) {
              for (const nb of bb.notes) {
                if (nb.note?.ovNoteId && nb.noteHeadBounds) cb({ noteId: nb.note.ovNoteId }, nb.noteHeadBounds);
              }
            } else if (bb.beat?.isRest && bb.beat.ovBeatId && bb.visualBounds) {
              cb({ restBeatId: bb.beat.ovBeatId }, bb.visualBounds);
            }
          }
  }

  /** Highlight the selected note or rest, or clear with null. */
  highlightSelection(selection: EditSelection | null): void {
    this.selection = selection;
    this.renderHighlight();
  }

  private selectionBounds(selection: EditSelection): Bounds | null {
    let found: Bounds | null = null;
    this.forEachSelectable((sel, bounds) => {
      if ((selection.noteId && sel.noteId === selection.noteId) ||
          (selection.restBeatId && sel.restBeatId === selection.restBeatId)) {
        found = bounds;
      }
    });
    return found;
  }

  private renderHighlight(): void {
    let layer = this.highlightLayer;
    if (!layer || !layer.isConnected) {
      layer = document.createElement("div");
      layer.className = "ov-note-highlight-layer";
      this.container.style.position = "relative";
      this.container.appendChild(layer);
      this.highlightLayer = layer;
    }
    layer.textContent = "";
    if (!this.selection) return;
    const b = this.selectionBounds(this.selection);
    if (!b) return;
    const el = document.createElement("div");
    el.className = "ov-note-highlight";
    // Pad around the notehead/rest so the selection reads clearly.
    el.style.left = `${b.x - 4}px`;
    el.style.top = `${b.y - 4}px`;
    el.style.width = `${b.w + 8}px`;
    el.style.height = `${b.h + 8}px`;
    layer.appendChild(el);
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

  /** True once a score is loaded and can be exported. */
  get hasScore(): boolean {
    return this.api.score !== null;
  }

  /**
   * Download the rendered score as a Standard MIDI File. Works for any loaded
   * score (including read-only imports), since alphaTab generates it from the
   * rendered model rather than our editable document.
   */
  downloadMidi(): void {
    this.api.downloadMidi();
  }

  /**
   * Render a programmatically-constructed alphaTab Score (the model→render
   * adapter's target). alphaTab does not finish a hand-built score, so we run
   * the finish pipeline first — without it, playback ticks
   * (beat.playbackStart/Duration) stay 0 and the score won't play or sync.
   */
  renderScore(score: alphaTab.model.Score): void {
    score.finish(this.api.settings);
    score.rebuildRepeatGroups();
    this.api.renderScore(score, undefined);
  }

  /**
   * Render a full-fidelity v1 document via the model→alphaTab adapter. Pass
   * `preserveScroll` for edit re-renders so the view stays put instead of
   * jumping to the cursor at the top of the score.
   */
  renderV1(doc: v1.ScoreV1, opts: { preserveScroll?: boolean; colorVoices?: boolean } = {}): void {
    const pane = this.container.parentElement;
    this.pendingScrollTop = opts.preserveScroll && pane ? pane.scrollTop : null;
    this.renderScore(toAlphaTabScore(doc, { colorVoices: opts.colorVoices }));
  }

  /**
   * P0 render-adapter proof: build a minimal Score from scratch and render it
   * via {@link renderScore}. Kept as an executable reference + e2e regression
   * guard for the programmatic-render path Option C depends on.
   */
  spikeRenderMinimal(): void {
    const m = alphaTab.model;
    const score = new m.Score();
    score.title = "spike";
    for (let i = 0; i < 2; i++) {
      const mb = new m.MasterBar();
      mb.timeSignatureNumerator = 4;
      mb.timeSignatureDenominator = 4;
      score.addMasterBar(mb);
    }
    const track = new m.Track();
    track.name = "Spike";
    score.addTrack(track);
    const staff = new m.Staff();
    track.addStaff(staff);
    const tonesPerBar = [
      [0, 2, 4, 5],
      [7, 9, 11, 0],
    ];
    for (const tones of tonesPerBar) {
      const bar = new m.Bar();
      bar.clef = m.Clef.G2;
      staff.addBar(bar);
      const voice = new m.Voice();
      bar.addVoice(voice);
      for (const tone of tones) {
        const beat = new m.Beat();
        beat.duration = m.Duration.Quarter;
        voice.addBeat(beat);
        const note = new m.Note();
        note.octave = 4;
        note.tone = tone;
        beat.addNote(note);
      }
    }
    this.renderScore(score);
  }

  destroy(): void {
    this.watermarkObserver?.disconnect();
    this.watermarkObserver = null;
    this.api.destroy();
  }
}

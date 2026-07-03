import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Player, type EditSelection, type TrackInfo } from "@openvoicing/player";
import { alignBarsToOnsets, detectOnsets, RecordingPlayer } from "@openvoicing/audio-engine";
import {
  mediaTimeAtTick,
  tickAtMediaTime,
  v1,
  type SyncPoint,
} from "@openvoicing/score-model";
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  createBundle,
  readBundle,
  scoreFileExtension,
  scoreTypeFromFileName,
  type SavedLoop,
  type ScoreType,
} from "@openvoicing/bundle";
// FluidR3 (full General MIDI, MIT) self-hosted; cached on first play. Much
// richer than alphaTab's bundled sonivox, at ~24MB loaded once.
const soundFontUrl = "/soundfont/FluidR3Mono_GM.sf3";
import { DEMO_TEX } from "./demo";
import { RecordingPanel } from "./RecordingPanel";
import { SpeedControl, clampSpeed } from "./SpeedControl";
import { clampSyncMove as clampSyncMovePure, computeSyncConfidence } from "./sync-utils";
import { CheatSheet, useAppSettings, type Theme } from "./Settings";
import { Menu, type MenuItem } from "./ui/Menu";
import { Popover } from "./ui/Popover";
import { CollapsiblePanel, resetLayout } from "./ui/CollapsiblePanel";
import { CommandPalette } from "./ui/CommandPalette";
import { NavigateControl } from "./ui/NavigateControl";
import type { Command } from "./ui/commands";
import {
  BookmarkIcon,
  ExportIcon,
  FileIcon,
  HelpIcon,
  LoopIcon,
  MetronomeIcon,
  NavigateIcon,
  PauseIcon,
  PlayIcon,
  RecordIcon,
  ShareIcon,
  StopIcon,
  ViewIcon,
} from "./ui/icons";
import { MicRecorder } from "./mic";
import { storage, type RecordingMeta, type StoredFile } from "./storage";

interface ScoreSource {
  name: string;
  type: ScoreType;
  data: ArrayBuffer;
}

/**
 * Loads a score source, routing plain MusicXML through the canonical score
 * model (which makes it editable) and everything else through alphaTab's own
 * parsers. Returns an editor when the model path succeeded.
 */
interface LoadedScore {
  v1Editor: v1.ScoreEditorV1 | null;
}

function loadScoreIntoPlayer(player: Player, source: ScoreSource): LoadedScore {
  if (source.type === "alphatex") {
    player.loadTex(new TextDecoder().decode(source.data));
    return { v1Editor: null };
  }
  if (source.type === "musicxml") {
    const bytes = new Uint8Array(source.data);
    // .mxl is a zip container; unwrap it to the root MusicXML document first.
    const text = v1.isMxl(bytes) ? v1.unwrapMxl(bytes) : new TextDecoder().decode(bytes);
    // All MusicXML (simple and multi-staff) goes through the full-fidelity v1
    // model now; the v0 editor path is retired.
    try {
      const doc = v1.importMusicXmlV1(text);
      player.renderV1(doc);
      return { v1Editor: new v1.ScoreEditorV1(doc) };
    } catch {
      // Anything v1 cannot parse falls back to native, read-only rendering.
    }
  }
  player.load(new Uint8Array(source.data));
  return { v1Editor: null };
}

/** True when a MusicXML has more than one part or a second staff (grand staff). */
function isMultiStaffMusicXml(xml: string): boolean {
  const parts = xml.match(/<score-part\b/g)?.length ?? 0;
  if (parts > 1) return true;
  return /<staff>\s*[2-9]/.test(xml) || /<staves>\s*[2-9]/.test(xml);
}

function newRecordingId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

const KEY_OPTIONS: Array<{ fifths: number; label: string }> = [
  { fifths: -6, label: "6♭" }, { fifths: -5, label: "5♭" }, { fifths: -4, label: "4♭" },
  { fifths: -3, label: "3♭ (E♭)" }, { fifths: -2, label: "2♭ (B♭)" }, { fifths: -1, label: "1♭ (F)" },
  { fifths: 0, label: "0 (C)" }, { fifths: 1, label: "1♯ (G)" }, { fifths: 2, label: "2♯ (D)" },
  { fifths: 3, label: "3♯ (A)" }, { fifths: 4, label: "4♯ (E)" }, { fifths: 5, label: "5♯" }, { fifths: 6, label: "6♯" },
];

// Number keys 1-9 map to note values (whole through 256th) for v1 duration entry.
const DURATION_KEYS: Record<number, v1.NoteType> = {
  1: "whole", 2: "half", 3: "quarter", 4: "eighth", 5: "16th",
  6: "32nd", 7: "64th", 8: "128th", 9: "256th",
};

const NOTE_TYPE_LABEL: Record<string, string> = {
  whole: "whole", half: "half", quarter: "quarter", eighth: "eighth",
  "16th": "16th", "32nd": "32nd", "64th": "64th", "128th": "128th", "256th": "256th",
  maxima: "maxima", long: "long", breve: "breve",
};
const accSym = (a: number) => (a > 0 ? "♯".repeat(a) : a < 0 ? "♭".repeat(-a) : "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The common note values as a tappable palette. Faces show the value as a
// fraction of a whole note (reliable everywhere) with the number-key hint.
const DURATION_PALETTE: Array<{ type: v1.NoteType; face: string; label: string; key: string }> = [
  { type: "whole", face: "1", label: "Whole note", key: "1" },
  { type: "half", face: "½", label: "Half note", key: "2" },
  { type: "quarter", face: "¼", label: "Quarter note", key: "3" },
  { type: "eighth", face: "⅛", label: "Eighth note", key: "4" },
  { type: "16th", face: "1⁄16", label: "16th note", key: "5" },
];

// Articulation toggles: glyph + accessible label + key hint.
const MARK_PALETTE: Array<{ type: v1.ArticulationType; glyph: string; label: string }> = [
  { type: "staccato", glyph: "·", label: "Staccato" },
  { type: "accent", glyph: ">", label: "Accent" },
  { type: "tenuto", glyph: "‒", label: "Tenuto" },
];

function sanitizeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function App() {
  const settings = useAppSettings();
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [countInNumber, setCountInNumber] = useState<number | null>(null);
  const [micRec] = useState(() => new MicRecorder());
  const [micRecording, setMicRecording] = useState(false);
  const [pitchSemitones, setPitchSemitones] = useState(0);
  const [standMode, setStandMode] = useState(false);
  // Locked (student) mode via ?lock=1 hides editing and export.
  const [locked] = useState(() => new URLSearchParams(window.location.search).get("lock") === "1");
  const [assignment, setAssignment] = useState("");
  const [showTour, setShowTour] = useState(false);

  // Basic vs Advanced: Basic keeps the surface calm; Advanced reveals practice
  // aids, capture, and editing extras. Locked mode is always the minimal end.
  const [mode, setMode] = useState<"basic" | "advanced">(
    () => (localStorage.getItem("ov-mode") as "basic" | "advanced") || "basic",
  );
  useEffect(() => {
    localStorage.setItem("ov-mode", mode);
  }, [mode]);
  const advanced = mode === "advanced" && !locked;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const scoreInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<Array<{ barIndex: number; label: string }>>([]);
  useEffect(() => {
    void storage.get<Array<{ barIndex: number; label: string }>>("sections").then((s) => setSections(s ?? []));
  }, []);
  function currentBarIndex(): number {
    const player = playerRef.current;
    if (!player) return 0;
    const tick = player.cursorTick;
    const bars = player.barTicks;
    let idx = 0;
    for (let i = 0; i < bars.length; i++) if (bars[i]!.start <= tick) idx = i;
    return idx;
  }
  function addSection() {
    const label = window.prompt("Section label (e.g. Verse, Chorus, B)");
    if (!label) return;
    const next = [...sections.filter((s) => s.barIndex !== currentBarIndex()), { barIndex: currentBarIndex(), label }].sort(
      (a, b) => a.barIndex - b.barIndex,
    );
    setSections(next);
    void storage.set("sections", next);
    showToast(`Section "${label}" added at bar ${currentBarIndex() + 1}.`);
  }
  function jumpToSection(barIndex: number) {
    const player = playerRef.current;
    const bar = player?.barTicks[barIndex];
    if (player && bar) {
      player.cursorTick = bar.start;
      player.scrollBarIntoView(barIndex);
    }
  }
  function renameSection(barIndex: number) {
    const existing = sections.find((s) => s.barIndex === barIndex);
    const label = window.prompt("Rename section", existing?.label ?? "");
    if (label === null) return;
    const next = sections
      .map((s) => (s.barIndex === barIndex ? { ...s, label } : s))
      .filter((s) => s.label);
    setSections(next);
    void storage.set("sections", next);
  }
  function deleteSection(barIndex: number) {
    const next = sections.filter((s) => s.barIndex !== barIndex);
    setSections(next);
    void storage.set("sections", next);
  }
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [recording] = useState(() => new RecordingPlayer());
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [barCount, setBarCount] = useState(0);
  const [scoreTitle, setScoreTitle] = useState("");
  const [scoreArtist, setScoreArtist] = useState("");
  const scoreSourceRef = useRef<ScoreSource | null>(null);
  const [position, setPosition] = useState({ current: 0, total: 0 });
  const [preferredSource, setPreferredSource] = useState<"synth" | "recording">("synth");

  // Full-fidelity editor. Edits/selection/export route through the v1 model.
  const v1EditorRef = useRef<v1.ScoreEditorV1 | null>(null);
  const [hasV1Editor, setHasV1Editor] = useState(false);
  const selectedV1Ref = useRef<EditSelection | null>(null);
  const [selectedV1, setSelectedV1] = useState<EditSelection | null>(null);
  const v1ClipboardRef = useRef<v1.CopiedBeat | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const [scorePanelOpen, setScorePanelOpen] = useState(false);
  const [coachSeen, setCoachSeen] = useState(() => {
    try {
      return localStorage.getItem("ov-edit-coached") === "1";
    } catch {
      return false;
    }
  });
  const dismissCoach = () => {
    setCoachSeen(true);
    try {
      localStorage.setItem("ov-edit-coached", "1");
    } catch {
      /* ignore */
    }
  };
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [noteInputMode, setNoteInputMode] = useState(false);
  // Bumped after each v1 edit so the edit band's disabled states refresh.
  const [v1Version, setV1Version] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);

  const noteInputModeRef = useRef(false);
  useEffect(() => {
    noteInputModeRef.current = noteInputMode;
  }, [noteInputMode]);

  useEffect(() => {
    editModeRef.current = editMode;
    setAnnouncement(editMode ? "Edit mode on" : "Edit mode off");
    if (!editMode) setNoteInputMode(false);
    // Re-render so voice coloring turns on/off with edit mode.
    if (v1EditorRef.current) v1Rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  useEffect(() => {
    const unsubs = [
      recording.on("stateChanged", (p) => setAnnouncement(p ? "Recording playing" : "Paused")),
      recording.on("speedChanged", (s) => setAnnouncement(`Speed ${Math.round(s * 100)} percent`)),
    ];
    return () => {
      for (const u of unsubs) u();
    };
  }, [recording]);

  useEffect(() => {
    selectedV1Ref.current = selectedV1;
    playerRef.current?.highlightSelection(selectedV1);
  }, [selectedV1]);

  function adoptEditor(loaded: LoadedScore): void {
    v1EditorRef.current = loaded.v1Editor;
    setHasV1Editor(loaded.v1Editor !== null);
    setSelectedV1(null);
    setEditMode(false);
    void storage.delete("scoreDoc");
  }

  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [activeRecId, setActiveRecId] = useState<string | null>(null);
  const [savedLoops, setSavedLoops] = useState<SavedLoop[]>([]);
  const savedLoopsRef = useRef<SavedLoop[]>([]);
  useEffect(() => {
    savedLoopsRef.current = savedLoops;
  }, [savedLoops]);

  async function loadSavedLoops(id: string | null) {
    setSavedLoops(id ? ((await storage.get<SavedLoop[]>(`loops:${id}`)) ?? []) : []);
  }

  function persistSavedLoops(id: string, loops: SavedLoop[]) {
    setSavedLoops(loops);
    if (loops.length) void storage.set(`loops:${id}`, loops);
    else void storage.delete(`loops:${id}`);
  }

  function saveCurrentLoop() {
    const region = recording.loopRegion;
    if (!region || !activeRecId) return;
    const name = window.prompt("Loop name", `Loop ${savedLoops.length + 1}`);
    if (!name) return;
    persistSavedLoops(activeRecId, [
      ...savedLoops,
      { id: newRecordingId(), name, start: region.start, end: region.end },
    ]);
  }

  function recallLoop(loop: SavedLoop) {
    recording.setLoopRegion({ start: loop.start, end: loop.end });
    recording.seek(loop.start);
  }

  function deleteSavedLoop(id: string) {
    if (!activeRecId) return;
    persistSavedLoops(activeRecId, savedLoops.filter((l) => l.id !== id));
  }
  const [syncPoints, setSyncPoints] = useState<SyncPoint[] | null>(null);
  const syncPointsRef = useRef<SyncPoint[] | null>(null);
  const [follow, setFollow] = useState(false);
  const [tapCount, setTapCount] = useState<number | null>(null);
  const tapsRef = useRef<number[]>([]);
  // Persistence effects stay quiet until the stored session has been restored,
  // so the initial empty state does not overwrite it.
  const hydratedRef = useRef(false);

  useEffect(() => {
    syncPointsRef.current = syncPoints;
  }, [syncPoints]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const player = new Player(container, {
      soundFontUrl,
      fontDirectory: "/alphatab/font/",
    });
    playerRef.current = player;
    player.on("scoreLoaded", (info) => {
      setTracks(info.tracks);
      setBarCount(player.barTicks.length);
      setScoreTitle(info.title);
      setScoreArtist(info.artist);
    });
    player.on("playerReady", () => setReady(true));
    player.on("playerStateChanged", (p) => {
      setPlaying(p);
      if (activeRecIdRef.current === null) setAnnouncement(p ? "Playing" : "Paused");
    });
    player.on("positionChanged", (current, total) => {
      // The recording drives the position readout when it is the active source.
      if (preferredSourceRef.current === "recording") return;
      setPosition((prev) => {
        const next = { current: Math.floor(current), total: Math.floor(total) };
        return prev.current === next.current && prev.total === next.total ? prev : next;
      });
    });
    player.on("beatClicked", (tick) => {
      // In edit mode, v1-backed scores select the exact clicked note (see
      // noteClicked); beat clicks are ignored so a click near a beat doesn't
      // pick the top note.
      if (editModeRef.current) return;
      const points = syncPointsRef.current;
      if (points) recording.seek(mediaTimeAtTick(points, tick));
    });
    // Note-level selection for v1 editing: resolve the note nearest the cursor
    // on any staff click, so clicking between stacked notes still targets the
    // one you aimed at (alphaTab's noteMouseDown only fires on an exact hit).
    const onScoreClick = (e: MouseEvent) => {
      if (!editModeRef.current || !v1EditorRef.current) return;
      const el = playerRef.current?.elementAtPosition(e.clientX, e.clientY);
      if (el) setSelectedV1(el);
    };
    container.addEventListener("click", onScoreClick);
    // Right-click / long-press a note or rest: select it and open a menu of the
    // actions that apply, so nothing has to be memorized as a shortcut.
    const onScoreContext = (e: MouseEvent) => {
      if (!editModeRef.current || !v1EditorRef.current) return;
      const el = playerRef.current?.elementAtPosition(e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();
      setSelectedV1(el);
      setContextMenu({ x: e.clientX, y: e.clientY });
    };
    container.addEventListener("contextmenu", onScoreContext);
    player.on("error", (error) => console.error("[openvoicing]", error));
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__ovPlayer = player;
      w.__ovRecording = recording;
      w.__ovV1Editor = () => v1EditorRef.current;
      w.__ovSelectedV1 = () => selectedV1Ref.current?.noteId ?? selectedV1Ref.current?.restBeatId ?? null;
      w.__ovSelectV1 = (id: string) => setSelectedV1({ noteId: id });
      // Dev hook: render any MusicXML through the full-fidelity v1 pipeline
      // (import -> v1 model -> alphaTab adapter), the Option C render path.
      w.__ovRenderV1 = (xml: string) => player.renderV1(v1.importMusicXmlV1(xml));
    }
    let disposed = false;
    void (async () => {
      let stored: (StoredFile & { type?: ScoreType }) | undefined;
      try {
        stored = await storage.get<StoredFile & { type?: ScoreType }>("score");
      } catch {
        stored = undefined;
      }
      if (disposed) return;
      if (stored) {
        const source: ScoreSource = {
          name: stored.name,
          type: stored.type ?? scoreTypeFromFileName(stored.name),
          data: stored.data,
        };
        scoreSourceRef.current = source;
        const loaded = loadScoreIntoPlayer(player, source);
        v1EditorRef.current = loaded.v1Editor;
        setHasV1Editor(loaded.v1Editor !== null);
      } else {
        const data = new TextEncoder().encode(DEMO_TEX).buffer as ArrayBuffer;
        scoreSourceRef.current = { name: "demo.alphatex", type: "alphatex", data };
        player.loadTex(DEMO_TEX);
      }
    })();
    return () => {
      disposed = true;
      playerRef.current = null;
      container.removeEventListener("click", onScoreClick);
      container.removeEventListener("contextmenu", onScoreContext);
      player.destroy();
    };
  }, [recording]);

  useEffect(() => () => recording.destroy(), [recording]);

  const recordingAudioRef = useRef<{ channels: Float32Array[]; sampleRate: number } | null>(
    null,
  );

  // Sync-map-driven metronome: click on each bar boundary of the real recording.
  const [syncedClick, setSyncedClick] = useState(false);
  const clickCtxRef = useRef<AudioContext | null>(null);
  const lastClickBarRef = useRef(-1);
  function playClick(accent: boolean) {
    let ctx = clickCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      clickCtxRef.current = ctx;
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  useEffect(() => {
    return recording.on("loaded", ({ channels, sampleRate }) => {
      recordingAudioRef.current = { channels, sampleRate };
      recording.speed = speedRef.current; // carry the current practice tempo over
      applyPreferred("recording"); // a loaded recording is the focus
      setSyncPoints(null);
      setFollow(false);
      setTapCount(null);
    });
  }, [recording]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Legacy single-recording sessions migrate to the per-id scheme.
        if ((await storage.get<RecordingMeta[]>("recordings")) === undefined) {
          const legacy = await storage.get<StoredFile>("recording");
          if (legacy) {
            const id = "take1";
            await storage.set(`recording:${id}`, legacy);
            const legacySync = await storage.get<SyncPoint[]>("sync");
            if (legacySync?.length) await storage.set(`sync:${id}`, legacySync);
            await storage.set("recordings", [{ id, name: legacy.name }]);
            await storage.set("activeRecording", id);
            await storage.delete("recording");
            await storage.delete("sync");
          }
        }

        const list = (await storage.get<RecordingMeta[]>("recordings")) ?? [];
        if (cancelled) return;
        setRecordings(list);
        if (list.length === 0) return;

        const storedActive = await storage.get<string>("activeRecording");
        const meta = list.find((r) => r.id === storedActive) ?? list[0]!;
        const stored = await storage.get<StoredFile>(`recording:${meta.id}`);
        if (cancelled || !stored) return;
        await recording.load(stored.data);
        if (cancelled) return;
        setActiveRecId(meta.id);
        await loadSavedLoops(meta.id);
        const sync = await storage.get<SyncPoint[]>(`sync:${meta.id}`);
        if (!cancelled && sync?.length) {
          setSyncPoints(sync);
          setFollow((await storage.get<boolean>("follow")) ?? true);
        }
        // Restore the previous session's practice state.
        const practice = await storage.get<{
          speed?: number;
          synthSpeed?: number; // legacy: split synth/recording speeds
          recordingSpeed?: number;
          loop?: { start: number; end: number } | null;
          position?: number;
        }>("practice");
        if (cancelled || !practice) return;
        // One practice tempo drives both sources; fall back to the legacy fields.
        const savedSpeed = practice.speed ?? practice.synthSpeed ?? practice.recordingSpeed;
        if (savedSpeed) setSynthSpeed(savedSpeed);
        if (practice.loop) recording.setLoopRegion(practice.loop);
        if (practice.position) recording.seek(practice.position);
      } catch (error) {
        console.error("[openvoicing] session restore failed", error);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recording]);

  useEffect(() => {
    if (!hydratedRef.current || !activeRecId) return;
    const timer = setTimeout(() => {
      if (syncPoints?.length) void storage.set(`sync:${activeRecId}`, syncPoints);
      else void storage.delete(`sync:${activeRecId}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [syncPoints, activeRecId]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void storage.set("follow", follow);
  }, [follow]);

  // Practice-state memory: speed, loop, and position survive reloads.
  const practiceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePracticeState = () => {
    if (!hydratedRef.current) return;
    if (practiceSaveTimerRef.current) clearTimeout(practiceSaveTimerRef.current);
    practiceSaveTimerRef.current = setTimeout(() => {
      void storage.set("practice", {
        speed: speedRef.current,
        loop: recording.loopRegion,
        position: recording.position,
      });
    }, 600);
  };
  const savePracticeRef = useRef(savePracticeState);
  savePracticeRef.current = savePracticeState;

  useEffect(() => {
    const save = () => savePracticeRef.current();
    const unsubs = [
      recording.on("speedChanged", save),
      recording.on("loopChanged", save),
      recording.on("stateChanged", save),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [recording]);

  useEffect(() => {
    if (!hydratedRef.current || !activeRecId) return;
    void storage.set("activeRecording", activeRecId);
  }, [activeRecId]);

  function saveRecordingsList(next: RecordingMeta[]): void {
    setRecordings(next);
    void storage.set("recordings", next);
  }

  async function addRecordingFile(file: File) {
    const buffer = await file.arrayBuffer();
    // decodeAudioData detaches the buffer, so persist a copy.
    const copy = buffer.slice(0);
    const id = newRecordingId();
    await recording.load(buffer);
    void storage.set(`recording:${id}`, { name: file.name, data: copy } satisfies StoredFile);
    saveRecordingsList([...recordings, { id, name: file.name }]);
    setActiveRecId(id);
    setSavedLoops([]);
  }

  async function selectRecording(id: string) {
    if (id === activeRecId) return;
    const stored = await storage.get<StoredFile>(`recording:${id}`);
    if (!stored) return;
    // Preserve position and play state so two takes A/B at the same spot.
    const wasPlaying = recording.playing;
    const position = recording.position;
    await recording.load(stored.data);
    recording.pitchSemitones = pitchSemitones;
    recording.seek(Math.min(position, recording.duration));
    if (wasPlaying) void recording.play();
    setActiveRecId(id);
    await loadSavedLoops(id);
    const sync = await storage.get<SyncPoint[]>(`sync:${id}`);
    if (sync?.length) {
      setSyncPoints(sync);
      setFollow(true);
    }
  }

  async function removeRecording(id: string) {
    void storage.delete(`recording:${id}`);
    void storage.delete(`sync:${id}`);
    void storage.delete(`loops:${id}`);
    const next = recordings.filter((r) => r.id !== id);
    saveRecordingsList(next);
    if (id !== activeRecId) return;
    if (next.length > 0) {
      setActiveRecId(null);
      await selectRecording(next[0]!.id);
    } else {
      recording.pause();
      applyPreferred("synth");
      setActiveRecId(null);
      setSyncPoints(null);
      setFollow(false);
    }
  }

  // Mirror the recording's playhead into the shared position readout.
  useEffect(() => {
    return recording.on("positionChanged", (seconds, total) => {
      if (preferredSourceRef.current !== "recording") return;
      setPosition((prev) => {
        const next = { current: Math.floor(seconds), total: Math.floor(total) };
        return prev.current === next.current && prev.total === next.total ? prev : next;
      });
    });
  }, [recording]);

  const lastScrollRef = useRef(0);
  useEffect(() => {
    if (!follow || !syncPoints) return;
    return recording.on("positionChanged", (seconds) => {
      const player = playerRef.current;
      if (!player) return;
      const tick = Math.max(0, Math.round(tickAtMediaTime(syncPoints, seconds)));
      player.cursorTick = tick;
      // The synth is not playing during recording follow, so alphaTab's own
      // scroll-on-play never fires; keep the current bar in the notation pane.
      const now = performance.now();
      if (now - lastScrollRef.current > 250) {
        lastScrollRef.current = now;
        player.scrollBarIntoView(player.barIndexAtTick(tick));
      }
    });
  }, [follow, syncPoints, recording]);

  // A loop set on the waveform (drag, saved-loop recall, [ ] keys) flows into
  // the shared loop state, which then brackets the bars and mirrors to the
  // synth. Ignore the echo from our own apply-effect.
  useEffect(() => {
    return recording.on("loopChanged", (region) => {
      if (applyingLoopRef.current) return;
      const player = playerRef.current;
      const points = syncPointsRef.current;
      if (!player) return;
      if (!region) {
        setLoop(false);
        setLoopBars(null);
        return;
      }
      if (!points?.length) return;
      const startTick = Math.max(0, Math.round(tickAtMediaTime(points, region.start)));
      const endTick = Math.round(tickAtMediaTime(points, region.end));
      const from = player.barIndexAtTick(startTick) + 1;
      const to = Math.max(from, player.barIndexAtTick(Math.max(startTick, endTick - 1)) + 1);
      setBarsInput(`${from}-${to}`);
      setLoop(true);
      setLoopBars({ from, to });
      player.cursorTick = startTick;
      player.scrollBarIntoView(from - 1);
    });
  }, [recording]);

  useEffect(() => {
    if (!syncedClick || !barTimesRef.current) return;
    lastClickBarRef.current = -1;
    return recording.on("positionChanged", (seconds) => {
      const times = barTimesRef.current;
      if (!times) return;
      // Fire once per bar as the playhead passes each boundary.
      let bar = -1;
      for (let i = 0; i < times.length; i++) {
        if (seconds >= times[i]! - 0.03) bar = i;
        else break;
      }
      if (bar >= 0 && bar !== lastClickBarRef.current) {
        lastClickBarRef.current = bar;
        playClick(bar === 0);
      }
    });
  }, [syncedClick, recording]);

  // Sync-map edits share an undo stack, separate from the score editor.
  const syncHistoryRef = useRef<SyncPoint[][]>([]);
  const [syncCanUndo, setSyncCanUndo] = useState(false);
  const [toast, setToast] = useState<{ message: string; action?: () => void } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, action?: () => void) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, action });
    toastTimerRef.current = setTimeout(() => setToast(null), 8000);
  }

  function commitSync(next: SyncPoint[] | null, options: { pushHistory?: boolean } = {}) {
    if (options.pushHistory !== false && syncPointsRef.current) {
      syncHistoryRef.current.push(syncPointsRef.current);
      setSyncCanUndo(true);
    }
    setSyncPoints(next);
  }

  function undoSync() {
    const prev = syncHistoryRef.current.pop();
    if (prev === undefined) return;
    setSyncPoints(prev);
    setSyncCanUndo(syncHistoryRef.current.length > 0);
  }

  async function toggleMicRecording() {
    if (micRec.recording) {
      const file = await micRec.stop();
      setMicRecording(false);
      await addRecordingFile(file);
      showToast(`Recorded ${file.name}.`);
    } else {
      try {
        await micRec.start();
        setMicRecording(true);
      } catch {
        window.alert("Microphone access was denied.");
      }
    }
  }

  // Switch which source the transport plays, jumping to the same musical
  // position and preserving whether it was playing. Silences the other source
  // first so the two can never sound at once.
  function switchSource(target: "synth" | "recording") {
    const player = playerRef.current;
    if (!player || activeRecIdRef.current === null || preferredSourceRef.current === target) return;
    const points = syncPointsRef.current;
    const wasPlaying = recording.playing || player.playing;
    if (target === "synth") {
      const tick = points ? Math.round(tickAtMediaTime(points, recording.position)) : player.cursorTick;
      recording.pause();
      applyPreferred("synth");
      if (wasPlaying) player.playFromTick(Math.max(0, tick));
      else player.cursorTick = Math.max(0, tick);
      setAnnouncement("Synth");
    } else {
      const tick = player.cursorTick;
      const time = points ? mediaTimeAtTick(points, tick) : 0;
      player.stop();
      applyPreferred("recording");
      recording.seek(time);
      if (wasPlaying) void recording.play();
      setAnnouncement("Recording");
    }
  }

  // A/B (key "v"): flip to the other source.
  function toggleSynthRecording() {
    switchSource(preferredSourceRef.current === "recording" ? "synth" : "recording");
  }

  function applyPitchSemitones(value: number) {
    const clamped = Math.max(-12, Math.min(12, value));
    setPitchSemitones(clamped);
    recording.pitchSemitones = clamped;
  }

  function autoSync() {
    const player = playerRef.current;
    const audio = recordingAudioRef.current;
    if (!player || !audio) return;
    const bars = player.barTicks;
    const duration = recording.duration;
    // Sanity check: the recording must be long enough for its bar count. A few
    // hundred ms/bar or less means the score and audio don't match (wrong file,
    // a snippet, or a mis-detected length); skip rather than emit garbage.
    if (bars.length === 0 || duration <= 0) return;
    const secondsPerBar = duration / bars.length;
    if (secondsPerBar < 0.25) {
      showToast(
        `That recording is only ${duration.toFixed(1)}s for ${bars.length} bars, too short to sync. Check the file, or tap sync manually.`,
      );
      return;
    }
    const secondsPerTick = 60 / (player.tempoBpm * 960);
    const expected = bars.map((b) => b.start * secondsPerTick);
    const onsets = detectOnsets(audio.channels, audio.sampleRate);
    const times = alignBarsToOnsets(expected, onsets, duration);
    commitSync(bars.map((b, i) => ({ tick: b.start, timeSeconds: times[i]! })));
    setFollow(true);
    showToast(`Auto-synced ${bars.length} bars over ${formatTime(duration)}.`, undoSync);
  }

  function nudgeSyncPoint(index: number, deltaSeconds: number) {
    const points = syncPointsRef.current;
    if (!points || !points[index]) return;
    commitSync(clampSyncMove(points, index, points[index]!.timeSeconds + deltaSeconds));
  }

  /** Plant the nearest bar's anchor at the current playback time. */
  function dropSyncPointAtPlayhead() {
    const points = syncPointsRef.current;
    const player = playerRef.current;
    if (!points || !player) return;
    const now = recording.position;
    const bars = player.barTicks;
    // Choose the bar whose predicted time is closest to now.
    let best = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.timeSeconds - now);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    void bars;
    commitSync(clampSyncMove(points, best, now));
    showToast(`Sync point for bar ${best + 1} set to ${now.toFixed(2)}s.`);
  }

  // The existing sync map stays until Done replaces it, so Cancel loses nothing.
  function startTapSync() {
    tapsRef.current = [];
    setTapCount(0);
    recording.seek(0);
    void recording.play();
  }

  function tap() {
    const player = playerRef.current;
    if (!player || tapsRef.current.length >= barCount) return;
    tapsRef.current.push(recording.position);
    if (tapsRef.current.length >= barCount) {
      finishTapSync();
    } else {
      setTapCount(tapsRef.current.length);
    }
  }

  function finishTapSync() {
    const player = playerRef.current;
    recording.pause();
    setTapCount(null);
    if (!player || tapsRef.current.length < 2) return;
    const bars = player.barTicks;
    const points = tapsRef.current.map((timeSeconds, i) => ({
      tick: bars[i]!.start,
      timeSeconds,
    }));
    commitSync(points);
    setFollow(true);
  }

  function cancelTapSync() {
    recording.pause();
    setTapCount(null);
  }

  function undoTap() {
    tapsRef.current.pop();
    setTapCount(tapsRef.current.length);
  }

  function clampSyncMove(points: SyncPoint[], index: number, timeSeconds: number): SyncPoint[] {
    return clampSyncMovePure(points, index, timeSeconds, recording.duration);
  }

  // Drag pushes one history entry on pointer-down, then updates without stacking.
  const draggingSyncRef = useRef(false);
  function moveSyncPoint(index: number, timeSeconds: number) {
    const points = syncPointsRef.current;
    if (!points) return;
    const pushHistory = !draggingSyncRef.current;
    draggingSyncRef.current = true;
    commitSync(clampSyncMove(points, index, timeSeconds), { pushHistory });
  }
  function endSyncDrag() {
    draggingSyncRef.current = false;
  }

  const syncConfidence = useMemo(() => computeSyncConfidence(syncPoints), [syncPoints]);

  useEffect(() => {
    if (tapCount === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        tap();
      } else if (e.code === "Backspace") {
        e.preventDefault();
        undoTap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function newScore() {
    const player = playerRef.current;
    if (!player) return;
    setClosed(false);
    // New scores are full-fidelity (v1): a blank canvas of per-beat rest slots
    // to type into. (The old v0 empty-score path is retired.)
    const doc = v1.createEmptyScoreV1({ bars: 8 });
    const v1Editor = new v1.ScoreEditorV1(doc);
    v1EditorRef.current = v1Editor;
    setHasV1Editor(true);
    player.renderV1(doc);
    void storage.delete("scoreDoc");
    const xml = v1.exportMusicXmlV1(doc);
    const data = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    scoreSourceRef.current = { name: "score.musicxml", type: "musicxml", data };
    void storage.set("score", { name: "score.musicxml", type: "musicxml", data });
    for (const meta of recordings) void storage.delete(`sync:${meta.id}`);
    setSyncPoints(null);
    setFollow(false);
    setEditMode(true);
    // Select the first rest so the user can immediately start typing notes.
    setSelectedV1({ restBeatId: doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.id });
  }

  function downloadBlob(blob: Blob, extension: string) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(scoreTitle || "score").replace(/[^\w-]+/g, "-").toLowerCase() || "score"}.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportMusicXml() {
    const type = "application/vnd.recordare.musicxml+xml";
    // Full-fidelity score: export the edited v1 model (edits included).
    if (v1EditorRef.current) {
      downloadBlob(new Blob([v1.exportMusicXmlV1(v1EditorRef.current.doc)], { type }), "musicxml");
      return;
    }
    // Read-only score: re-export the loaded MusicXML source if that is what it is.
    const source = scoreSourceRef.current;
    if (source?.type === "musicxml") {
      downloadBlob(new Blob([source.data], { type }), "musicxml");
      return;
    }
    showToast("This file can't be exported as MusicXML. Try MIDI, Print, or Export bundle.");
  }

  function exportMidi() {
    // alphaTab generates MIDI from the rendered score.
    playerRef.current?.downloadMidi();
  }

  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Full-fidelity (multi-staff) scores edit through the v1 model: click a
      // note, then Arrow Up/Down transposes (Shift = octave), Delete removes,
      // Cmd/Ctrl+Z undoes. Re-render from the model preserves notation.
      const v1Editor = v1EditorRef.current;
      if (v1Editor) {
        v1KeyHandler(e, v1Editor);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode]);

  // Unified play/pause for external transport (media keys, MIDI pedal).
  // One transport for the active source: the recording when one is loaded
  // (the thing you play along to), otherwise the synth. The main Play button,
  // the Space key, and the media keys all route through here so they agree.
  const togglePlayRef = useRef(() => {});
  togglePlayRef.current = () => {
    // Key the decision off the source we control, not alphaTab's async player
    // state, and always silence the other source, so the two can never overlap.
    if (preferredSourceRef.current === "recording" && activeRecIdRef.current !== null) {
      playerRef.current?.stop();
      if (recording.playing) recording.pause();
      else void recording.play();
    } else {
      recording.pause();
      synthPlayPause();
    }
  };

  function transportStop() {
    recording.pause();
    recording.seek(0);
    playerRef.current?.stop();
  }

  // Media Session: hardware/media keys and lock-screen controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler("play", () => togglePlayRef.current());
      navigator.mediaSession.setActionHandler("pause", () => togglePlayRef.current());
    } catch {
      /* some actions unsupported */
    }
  }, []);

  // Web MIDI: a sustain pedal (CC64) or any note toggles play/pause.
  useEffect(() => {
    const nav = navigator as Navigator & {
      requestMIDIAccess?: () => Promise<{ inputs: Map<string, { onmidimessage: ((e: { data: Uint8Array }) => void) | null }> }>;
    };
    if (!nav.requestMIDIAccess) return;
    let cancelled = false;
    void nav.requestMIDIAccess().then((access) => {
      if (cancelled) return;
      for (const input of access.inputs.values()) {
        input.onmidimessage = (e) => {
          const data = e.data;
          if (!data) return;
          const status = data[0] ?? 0;
          const d1 = data[1] ?? 0;
          const d2 = data[2] ?? 0;
          const isNoteOn = (status & 0xf0) === 0x90 && d2 > 0;
          const isPedalDown = (status & 0xf0) === 0xb0 && d1 === 64 && d2 >= 64;
          if (isNoteOn || isPedalDown) togglePlayRef.current();
        };
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // First-run guided tour, shown once (persisted in localStorage).
  useEffect(() => {
    if (!localStorage.getItem("ov-toured")) setShowTour(true);
  }, []);
  function dismissTour() {
    localStorage.setItem("ov-toured", "1");
    setShowTour(false);
  }

  // Assignment note persists with the session.
  useEffect(() => {
    void storage.get<string>("assignment").then((a) => {
      if (a) setAssignment(a);
    });
  }, []);
  function saveAssignment(text: string) {
    setAssignment(text);
    if (text) void storage.set("assignment", text);
    else void storage.delete("assignment");
  }

  // Music-stand mode: full-screen score, wake lock to keep the screen on.
  useEffect(() => {
    if (!standMode) return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    const acquire = () => {
      void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [standMode]);

  // Big visual (and audible) count-in before synth playback when Count-in is on.
  function synthPlayPause() {
    const player = playerRef.current;
    if (!player) return;
    if (player.playing || !countIn) {
      player.playPause();
      return;
    }
    const beatMs = (60 / player.tempoBpm) * 1000;
    let n = 4;
    setCountInNumber(n);
    playClick(true);
    const step = () => {
      n -= 1;
      if (n <= 0) {
        setCountInNumber(null);
        player.playPause();
        return;
      }
      setCountInNumber(n);
      playClick(false);
      window.setTimeout(step, beatMs);
    };
    window.setTimeout(step, beatMs);
  }

  const speedRef = useRef(1);
  // The single practice-tempo control drives whichever source is heard, so the
  // slowdown carries across an A/B switch between synth and recording.
  function setSynthSpeed(value: number) {
    speedRef.current = value;
    setSpeed(value);
    if (playerRef.current) playerRef.current.speed = value;
    recording.speed = value;
    savePracticeRef.current?.();
  }

  const activeRecIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeRecIdRef.current = activeRecId;
  }, [activeRecId]);
  // Which source the transport acts on: flips to "recording" when one loads and
  // back to "synth" via the source toggle, so play/stop/position/speed follow
  // what you hear. The ref is read inside event handlers; the state drives UI.
  const preferredSourceRef = useRef<"synth" | "recording">("synth");
  function applyPreferred(which: "synth" | "recording") {
    preferredSourceRef.current = which;
    setPreferredSource(which);
  }
  const tapCountRef = useRef<number | null>(null);
  useEffect(() => {
    tapCountRef.current = tapCount;
  }, [tapCount]);
  const pendingLoopStartRef = useRef<number | null>(null);
  const halfSpeedReturnRef = useRef<{ transport: string; speed: number } | null>(null);

  // Global transport keys: work anywhere except form fields and tap-sync mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.key === "?" || (e.shiftKey && e.code === "Slash")) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setCheatSheetOpen((v) => !v);
        return;
      }
      if (tapCountRef.current !== null) return;
      // In edit mode the score editor owns the keyboard (its own handler runs).
      if (editModeRef.current) return;
      // Cmd/Ctrl+Z undoes sync-map edits when the score editor is not active.
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        undoSync();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onRecording = activeRecIdRef.current !== null;

      switch (e.code) {
        case "Space": {
          e.preventDefault();
          togglePlayRef.current();
          return;
        }
        case "Minus":
        case "Equal": {
          e.preventDefault();
          const delta = e.code === "Minus" ? -0.05 : 0.05;
          setSynthSpeed(clampSpeed(speedRef.current + delta));
          return;
        }
        case "KeyH": {
          if (editModeRef.current) return;
          e.preventDefault();
          // Toggle to half speed and back; one practice tempo drives both sources.
          const held = halfSpeedReturnRef.current;
          if (speedRef.current === 0.5 && held) {
            setSynthSpeed(held.speed);
            halfSpeedReturnRef.current = null;
          } else {
            halfSpeedReturnRef.current = { transport: "synth", speed: speedRef.current };
            setSynthSpeed(0.5);
          }
          return;
        }
        case "BracketLeft": {
          if (!onRecording) return;
          e.preventDefault();
          pendingLoopStartRef.current = recording.position;
          return;
        }
        case "BracketRight": {
          if (!onRecording) return;
          e.preventDefault();
          const start = pendingLoopStartRef.current ?? 0;
          const end = recording.position;
          if (end > start + 0.1) {
            recording.setLoopRegion({ start, end });
            pendingLoopStartRef.current = null;
          }
          return;
        }
        case "KeyP": {
          if (editModeRef.current || !onRecording || !syncPointsRef.current) return;
          e.preventDefault();
          dropSyncPointAtPlayhead();
          return;
        }
        case "KeyV": {
          if (!onRecording) return;
          e.preventDefault();
          toggleSynthRecording();
          return;
        }
      }
      // Number keys recall saved loops (outside edit mode, where they set durations).
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && onRecording && !editModeRef.current) {
        const loop = savedLoopsRef.current[Number(digit[1]) - 1];
        if (loop) {
          e.preventDefault();
          recording.setLoopRegion({ start: loop.start, end: loop.end });
          recording.seek(loop.start);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]);

  // One loop, applied to whichever source is heard. `loop` enables it; an
  // optional `loopBars` range narrows it (whole piece otherwise).
  const [barsInput, setBarsInput] = useState("");
  const [loopBars, setLoopBars] = useState<{ from: number; to: number } | null>(null);
  // Set while we push the loop onto the recording, so its loopChanged echo is
  // not mistaken for a fresh user drag.
  const applyingLoopRef = useRef(false);

  function toggleLoop() {
    setLoop((v) => !v);
  }

  function applyBarLoop() {
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(barsInput.trim());
    const player = playerRef.current;
    if (!player || player.barTicks.length === 0) return;
    if (!match) {
      setLoopBars(null);
      return;
    }
    const n = player.barTicks.length;
    const from = Math.max(1, Math.min(n, parseInt(match[1]!, 10)));
    const to = Math.max(from, Math.min(n, parseInt(match[2]!, 10)));
    setLoopBars({ from, to });
    setLoop(true);
    player.cursorTick = player.barTicks[from - 1]!.start;
    player.scrollBarIntoView(from - 1);
  }

  function clearBarLoop() {
    setLoopBars(null);
    setLoop(false);
    setBarsInput("");
  }

  // Apply the loop to both sources so it survives an A/B switch, and keep the
  // bracket markers in sync. Runs whenever the loop, the range, the active
  // recording, or the sync map changes.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const bars = player.barTicks;
    const region =
      loop && loopBars && bars.length
        ? {
            startTick: bars[loopBars.from - 1]!.start,
            endTick: bars[loopBars.to - 1]!.start + bars[loopBars.to - 1]!.duration,
          }
        : null;

    player.setPlaybackRange(region);
    player.setLooping(loop);
    player.setLoopMarkers(loop && loopBars ? { startBar: loopBars.from - 1, endBar: loopBars.to - 1 } : null);

    if (activeRecIdRef.current !== null) {
      const sp = syncPointsRef.current;
      applyingLoopRef.current = true;
      if (region && sp?.length) {
        recording.setLoopRegion({
          start: mediaTimeAtTick(sp, region.startTick),
          end: mediaTimeAtTick(sp, region.endTick),
        });
      } else if (loop && !loopBars && recording.duration > 0) {
        recording.setLoopRegion({ start: 0, end: recording.duration });
      } else {
        recording.setLoopRegion(null);
      }
      applyingLoopRef.current = false;
    }
  }, [loop, loopBars, activeRecId, syncPoints, barCount, recording]);

  const barTimes = useMemo(() => {
    const player = playerRef.current;
    if (!player || !syncPoints?.length) return null;
    const bars = player.barTicks;
    if (bars.length === 0) return null;
    const times = bars.map((b) => mediaTimeAtTick(syncPoints, b.start));
    const last = bars[bars.length - 1]!;
    times.push(mediaTimeAtTick(syncPoints, last.start + last.duration));
    return times;
    // barCount stands in for the loaded score changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncPoints, barCount]);

  const barTimesRef = useRef<number[] | null>(null);
  useEffect(() => {
    barTimesRef.current = barTimes;
  }, [barTimes]);

  function toggleMetronome() {
    const value = !metronome;
    setMetronome(value);
    playerRef.current?.setMetronome(value);
  }

  function toggleCountIn() {
    // Count-in is handled by our visual + click overlay in synthPlayPause,
    // so alphaTab's own audio count-in stays off to avoid doubling.
    setCountIn(!countIn);
  }

  function setTrackMute(index: number, mute: boolean) {
    playerRef.current?.setTrackMute(index, mute);
    setTracks((ts) => ts.map((t) => (t.index === index ? { ...t, mute } : t)));
  }

  function setTrackSolo(index: number, solo: boolean) {
    playerRef.current?.setTrackSolo(index, solo);
    setTracks((ts) => ts.map((t) => (t.index === index ? { ...t, solo } : t)));
  }

  async function openFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setClosed(false);
    const player = playerRef.current;
    if (!player) return;
    const buffer = await file.arrayBuffer();
    const type = scoreTypeFromFileName(file.name);
    const source: ScoreSource = { name: file.name, type, data: buffer };
    adoptEditor(loadScoreIntoPlayer(player, source));
    scoreSourceRef.current = source;
    void storage.set("score", { name: file.name, type, data: buffer });
    // Sync maps anchor to the old score's ticks; they do not carry over.
    for (const meta of recordings) void storage.delete(`sync:${meta.id}`);
    setSyncPoints(null);
    setFollow(false);
    e.target.value = "";
  }

  async function buildBundleBytes(): Promise<Uint8Array | null> {
    const source = scoreSourceRef.current;
    if (!source) return null;
    const scorePath = `score/score.${scoreFileExtension(source.type)}`;
    // For v1-backed scores, bundle the edited model, not the original source.
    const scoreBytes = v1EditorRef.current
      ? new TextEncoder().encode(v1.exportMusicXmlV1(v1EditorRef.current.doc))
      : new Uint8Array(source.data);
    const files = new Map<string, Uint8Array>([[scorePath, scoreBytes]]);
    const manifestRecordings = [];
    for (const meta of recordings) {
      const rec = await storage.get<StoredFile>(`recording:${meta.id}`);
      if (!rec) continue;
      const sync =
        meta.id === activeRecId
          ? syncPoints
          : ((await storage.get<SyncPoint[]>(`sync:${meta.id}`)) ?? null);
      const loops =
        meta.id === activeRecId
          ? savedLoops
          : ((await storage.get<SavedLoop[]>(`loops:${meta.id}`)) ?? []);
      const recPath = `recordings/${meta.id}/${sanitizeName(rec.name)}`;
      files.set(recPath, new Uint8Array(rec.data));
      manifestRecordings.push({
        id: meta.id,
        name: rec.name,
        path: recPath,
        ...(sync?.length ? { syncPoints: sync } : {}),
        ...(loops.length ? { loops } : {}),
      });
    }
    return createBundle({
      manifest: {
        format: BUNDLE_FORMAT,
        formatVersion: BUNDLE_FORMAT_VERSION,
        title: scoreTitle || "Untitled",
        ...(scoreArtist ? { attribution: { artist: scoreArtist } } : {}),
        ...(assignment ? { assignment } : {}),
        score: { path: scorePath, type: source.type },
        recordings: manifestRecordings,
      },
      files,
    });
  }

  async function exportBundle() {
    const bytes = await buildBundleBytes();
    if (!bytes) return;
    const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(scoreTitle || "score").replace(/[^\w-]+/g, "-").toLowerCase() || "score"}.ovb`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // Library: save the current piece as a bundle in IndexedDB and reopen later.
  const [library, setLibrary] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    void storage.get<Array<{ id: string; title: string }>>("library").then((l) => setLibrary(l ?? []));
  }, []);
  async function saveToLibrary() {
    const bytes = await buildBundleBytes();
    if (!bytes) return;
    const id = newRecordingId();
    const title = scoreTitle || "Untitled";
    await storage.set(`librarypiece:${id}`, bytes.buffer as ArrayBuffer);
    const next = [...library, { id, title }];
    setLibrary(next);
    void storage.set("library", next);
    showToast(`Saved "${title}" to your library.`);
  }
  async function openFromLibrary(id: string) {
    const buffer = await storage.get<ArrayBuffer>(`librarypiece:${id}`);
    if (buffer) await loadBundleBytes(new Uint8Array(buffer));
  }

  function copyEmbedCode() {
    const origin = window.location.origin;
    const snippet = `<script src="${origin}/openvoicing-embed.js"></script>\n<div data-openvoicing-bundle="YOUR_BUNDLE_URL"></div>`;
    void navigator.clipboard.writeText(snippet).then(
      () => showToast("Embed code copied. Replace YOUR_BUNDLE_URL with your hosted .ovb."),
      () => window.prompt("Copy the embed code:", snippet),
    );
  }

  async function openFromUrl() {
    const url = window.prompt("Bundle or MusicXML URL");
    if (!url) return;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const name = url.split("/").pop() || "download";
      if (name.toLowerCase().endsWith(".ovb")) {
        await loadBundleBytes(new Uint8Array(buffer));
      } else {
        const player = playerRef.current;
        if (!player) return;
        const type = scoreTypeFromFileName(name);
        const source: ScoreSource = { name, type, data: buffer };
        adoptEditor(loadScoreIntoPlayer(player, source));
        scoreSourceRef.current = source;
        void storage.set("score", { name, type, data: buffer });
      }
      showToast(`Loaded ${name}.`);
    } catch (err) {
      window.alert(`Could not load: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function openBundle(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await loadBundleBytes(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      console.error("[openvoicing] failed to open bundle", error);
      window.alert(error instanceof Error ? error.message : "Failed to open bundle");
    }
  }

  async function loadBundleBytes(bytes: Uint8Array) {
    setClosed(false);
    {
      const bundle = readBundle(bytes);
      const { manifest } = bundle;
      const player = playerRef.current;

      const scoreBytes = bundle.files.get(manifest.score.path)!;
      const scoreData = scoreBytes.slice().buffer as ArrayBuffer;
      const source: ScoreSource = {
        name: `score.${scoreFileExtension(manifest.score.type)}`,
        type: manifest.score.type,
        data: scoreData,
      };
      scoreSourceRef.current = source;
      if (player) adoptEditor(loadScoreIntoPlayer(player, source));
      void storage.set("score", { name: source.name, type: source.type, data: scoreData });
      saveAssignment(manifest.assignment ?? "");

      // Opening a bundle replaces the session's recordings.
      for (const meta of recordings) {
        void storage.delete(`recording:${meta.id}`);
        void storage.delete(`sync:${meta.id}`);
      }

      const list: RecordingMeta[] = [];
      for (const entry of manifest.recordings) {
        const bytes = bundle.files.get(entry.path)!;
        const id = list.some((r) => r.id === entry.id) ? newRecordingId() : entry.id;
        void storage.set(`recording:${id}`, {
          name: entry.name,
          data: bytes.slice().buffer as ArrayBuffer,
        } satisfies StoredFile);
        if (entry.syncPoints?.length) void storage.set(`sync:${id}`, entry.syncPoints);
        else void storage.delete(`sync:${id}`);
        if (entry.loops?.length) void storage.set(`loops:${id}`, entry.loops);
        else void storage.delete(`loops:${id}`);
        list.push({ id, name: entry.name });
      }
      saveRecordingsList(list);

      const first = manifest.recordings[0];
      if (first) {
        const bytes = bundle.files.get(first.path)!;
        await recording.load(bytes.slice().buffer as ArrayBuffer);
        setActiveRecId(list[0]!.id);
        setSavedLoops(first.loops ?? []);
        if (first.syncPoints?.length) {
          setSyncPoints(first.syncPoints);
          setFollow(true);
        }
      } else {
        recording.pause();
        setActiveRecId(null);
        setSyncPoints(null);
        setFollow(false);
      }
    }
  }

  // Cmd/Ctrl-K opens the command palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canEdit = hasV1Editor && !locked;
  const doPrint = () => playerRef.current?.print();

  // v1 (multi-staff) editing: act on the clicked beat's first note, then
  // re-render from the model so notation is preserved.
  function v1Rerender() {
    const ed = v1EditorRef.current;
    if (ed) {
      playerRef.current?.renderV1(ed.doc, { preserveScroll: true, colorVoices: editModeRef.current });
      schedulePersist();
    }
    setV1Version((n) => n + 1);
  }
  // Export + persist is O(whole score); debounce it so a burst of keystrokes
  // does one export after typing settles, not one per key (matters on big scores).
  function schedulePersist() {
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      const ed = v1EditorRef.current;
      if (!ed) return;
      const data = new TextEncoder().encode(v1.exportMusicXmlV1(ed.doc)).buffer as ArrayBuffer;
      scoreSourceRef.current = { name: "score.musicxml", type: "musicxml", data };
      void storage.set("score", { name: "score.musicxml", type: "musicxml", data });
    }, 300);
  }
  function v1SelectedNoteId(): string | undefined {
    return selectedV1Ref.current?.noteId ?? undefined;
  }
  function v1Transpose(n: number) {
    const ed = v1EditorRef.current;
    const noteId = v1SelectedNoteId();
    if (ed && noteId && ed.transposeNote(noteId, n)) v1Rerender();
  }
  function v1Delete() {
    const ed = v1EditorRef.current;
    const noteId = v1SelectedNoteId();
    if (ed && noteId && ed.deleteNote(noteId)) v1Rerender();
  }
  function v1Undo() {
    const ed = v1EditorRef.current;
    if (ed && ed.undo()) v1Rerender();
  }
  function v1Redo() {
    const ed = v1EditorRef.current;
    if (ed && ed.redo()) v1Rerender();
  }
  function v1SelectedBeatId(): string | undefined {
    const sel = selectedV1Ref.current;
    if (!sel) return undefined;
    return sel.noteId ? v1EditorRef.current?.findNote(sel.noteId)?.beat.id : sel.restBeatId;
  }
  // The full v1 input keymap: A-G pitch (Shift = add to chord), 1-9 duration,
  // "." dot, +/- accidental, r rest, Up/Down transpose, Left/Right navigate,
  // Delete remove, Cmd+Z undo.
  function v1KeyHandler(e: KeyboardEvent, ed: v1.ScoreEditorV1) {
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey ? ed.redo() : ed.undo()) v1Rerender();
      return;
    }
    const selForClip = selectedV1Ref.current;
    const beatForClip = selForClip?.noteId ? ed.findNote(selForClip.noteId)?.beat.id : selForClip?.restBeatId;
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyC" && beatForClip) {
      e.preventDefault();
      v1ClipboardRef.current = ed.copyBeat(beatForClip) ?? null;
      setAnnouncement("Beat copied");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyV" && beatForClip && v1ClipboardRef.current) {
      e.preventDefault();
      if (ed.pasteBeat(beatForClip, v1ClipboardRef.current)) v1Rerender();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Toggle note-input mode (the MuseScore "N" convention).
    if (e.code === "KeyN") {
      e.preventDefault();
      setNoteInputMode((m) => !m);
      return;
    }
    const sel = selectedV1Ref.current;
    const beatId = v1SelectedBeatId();
    const isTabNote = sel?.noteId ? ed.findNote(sel.noteId)?.note.string !== undefined : false;

    // Chord symbol entry (lead sheets): prompt for text on the selected beat.
    if (e.code === "KeyK" && beatId) {
      e.preventDefault();
      const current = ed.findBeat(beatId)?.beat.chordSymbol ?? "";
      const text = window.prompt("Chord symbol (e.g. Cmaj7, G/B)", current);
      if (text !== null && ed.setChordSymbol(beatId, text)) v1Rerender();
      return;
    }

    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      e.preventDefault();
      if (!beatId) return;
      const n = ed.neighbor(beatId, e.code === "ArrowRight" ? 1 : -1);
      if (n) setSelectedV1(n.noteId ? { noteId: n.noteId } : { restBeatId: n.beatId });
      return;
    }
    if (["ArrowUp", "ArrowDown", "Delete", "Backspace"].includes(e.code)) {
      e.preventDefault();
      if (!sel?.noteId) {
        setAnnouncement(sel ? "This is a rest — type A–G to make it a note" : "Click a note to select it first");
        return;
      }
      if (e.code === "ArrowUp") {
        if (ed.transposeNote(sel.noteId, e.shiftKey ? 12 : 1)) v1Rerender();
      } else if (e.code === "ArrowDown") {
        if (ed.transposeNote(sel.noteId, e.shiftKey ? -12 : -1)) v1Rerender();
      } else if (ed.deleteNote(sel.noteId)) {
        v1Rerender();
      }
      return;
    }
    const letter = /^Key([A-G])$/.exec(e.code);
    if (letter) {
      e.preventDefault();
      if (!beatId) {
        setAnnouncement("Click a note or rest first");
        return;
      }
      const step = letter[1] as v1.NoteStep;
      const ok = e.shiftKey
        ? ed.addNoteToBeatByName(beatId, step)
        : sel?.noteId
          ? ed.setPitchByName(sel.noteId, step)
          : ed.restToNoteByName(beatId, step);
      if (ok) {
        v1Rerender();
        if (noteInputModeRef.current && !e.shiftKey) {
          v1AdvanceFrom(beatId);
        } else {
          const top = ed.findBeat(beatId)?.beat.notes[0];
          if (top) setSelectedV1({ noteId: top.id });
        }
      }
      return;
    }
    // On a tab staff, digits type a fret onto the selected note; elsewhere they
    // set the note value.
    const digit = /^Digit([0-9])$/.exec(e.code);
    if (digit && isTabNote && sel?.noteId) {
      e.preventDefault();
      if (ed.setFret(sel.noteId, Number(digit[1]))) v1Rerender();
      return;
    }
    if (digit && Number(digit[1]) >= 1 && beatId) {
      e.preventDefault();
      const type = DURATION_KEYS[Number(digit[1])];
      if (type && ed.setDuration(beatId, type)) v1Rerender();
      return;
    }
    if (e.code === "Period" && beatId) {
      e.preventDefault();
      if (ed.toggleDot(beatId)) v1Rerender();
      return;
    }
    if ((e.code === "Equal" || e.key === "+") && sel?.noteId) {
      e.preventDefault();
      if (ed.cycleAccidental(sel.noteId, 1)) v1Rerender();
      return;
    }
    if (e.code === "Minus" && sel?.noteId) {
      e.preventDefault();
      if (ed.cycleAccidental(sel.noteId, -1)) v1Rerender();
      return;
    }
    if (e.code === "KeyR" && beatId) {
      e.preventDefault();
      if (ed.makeRest(beatId)) {
        v1Rerender();
        setSelectedV1({ restBeatId: beatId });
      }
      return;
    }
    if (e.code === "KeyT" && sel?.noteId) {
      e.preventDefault();
      if (ed.toggleTie(sel.noteId)) v1Rerender();
      return;
    }
    if (e.code === "KeyS" && beatId) {
      e.preventDefault();
      if (ed.toggleSlur(beatId)) v1Rerender();
      return;
    }
    // Cycle which stacked voice is selected at this position.
    if (e.code === "KeyV" && beatId) {
      e.preventDefault();
      v1CycleVoice();
      return;
    }
    // Grace note before the selected beat. "/" (the grace slash), not a letter,
    // since A-G are pitches.
    if (e.code === "Slash" && beatId) {
      e.preventDefault();
      const graceId = ed.insertGraceBefore(beatId);
      if (graceId) {
        v1Rerender();
        setSelectedV1({ noteId: graceId });
      }
      return;
    }
  }
  // Edit-band ops for the selected v1 beat/note.
  function v1BeatOp(fn: (ed: v1.ScoreEditorV1, beatId: string) => boolean) {
    const ed = v1EditorRef.current;
    const beatId = v1SelectedBeatId();
    if (ed && beatId && fn(ed, beatId)) v1Rerender();
  }
  function v1SelectedBarIndex(): number {
    const ed = v1EditorRef.current;
    const beatId = v1SelectedBeatId();
    return (beatId && ed?.findBeat(beatId)?.measure.barIndex) || 0;
  }
  const v1Articulate = (t: v1.ArticulationType) => v1BeatOp((ed, b) => ed.toggleArticulation(b, t));
  const v1Fermata = () => v1BeatOp((ed, b) => ed.toggleFermata(b));
  const v1Dynamic = (value: string) => v1BeatOp((ed, b) => ed.setDynamic(b, value));
  const v1Slur = () => v1BeatOp((ed, b) => ed.toggleSlur(b));
  function v1Tie() {
    const ed = v1EditorRef.current;
    const noteId = selectedV1Ref.current?.noteId;
    if (ed && noteId && ed.toggleTie(noteId)) v1Rerender();
  }
  function v1AddBar() {
    const ed = v1EditorRef.current;
    if (ed && ed.insertMeasure(v1SelectedBarIndex(), "after")) v1Rerender();
  }
  function v1RemoveBar() {
    const ed = v1EditorRef.current;
    if (ed && ed.removeMeasure(v1SelectedBarIndex())) v1Rerender();
  }
  function v1SetTime(value: string) {
    const [beats, unit] = value.split("/").map(Number);
    const ed = v1EditorRef.current;
    if (ed && beats && unit && ed.setTimeSignature(v1SelectedBarIndex(), beats, unit)) v1Rerender();
  }
  function v1SetKey(fifths: number) {
    const ed = v1EditorRef.current;
    if (ed && ed.setKeySignature(v1SelectedBarIndex(), fifths)) v1Rerender();
  }
  function v1EditMeta() {
    const ed = v1EditorRef.current;
    if (!ed) return;
    const title = window.prompt("Title", ed.doc.work.title);
    if (title === null) return;
    const composer = window.prompt("Composer", ed.doc.work.composer ?? "") ?? undefined;
    if (ed.setWork({ title, composer })) {
      v1Rerender();
      setScoreTitle(title);
      setScoreArtist(composer ?? "");
    }
  }
  function v1EditTempo() {
    const ed = v1EditorRef.current;
    if (!ed) return;
    const bar = v1SelectedBarIndex();
    const value = window.prompt("Tempo (bpm)", String(ed.doc.bars[bar]?.tempoBpm ?? 120));
    if (value !== null && ed.setTempo(bar, Number(value) || null)) v1Rerender();
  }
  // Effective time/key at the selected bar, for the edit-band selects.
  const v1EffectiveAttrs = ((): { time: string; key: number } => {
    const measures = v1EditorRef.current?.doc.parts[0]?.measures ?? [];
    const bar = v1SelectedBarIndex();
    let time = { beats: 4, beatUnit: 4 };
    let key = 0;
    for (let i = 0; i <= bar && i < measures.length; i++) {
      const a = measures[i]?.attributes;
      if (a?.time) time = a.time;
      if (a?.key) key = a.key.fifths;
    }
    return { time: `${time.beats}/${time.beatUnit}`, key };
  })();
  const v1TimeValue = v1EffectiveAttrs.time;
  const v1KeyValue = v1EffectiveAttrs.key;
  const doTranspose = (n: number) => v1Transpose(n);

  // Live, selection-aware description of what is selected. Drives the status
  // strip and which toolbar groups + active states show. Recomputes on each
  // edit (v1Version) and selection change.
  const v1Sel = ((): {
    kind: "note" | "rest" | "none";
    desc: string;
    noteType?: v1.NoteType;
    dotted: boolean;
    marks: Set<string>;
    tab: boolean;
    voiceIndex: number;
    voiceCount: number;
  } => {
    void v1Version;
    const empty = { dotted: false, marks: new Set<string>(), tab: false, voiceIndex: 0, voiceCount: 1 };
    const ed = v1EditorRef.current;
    if (!ed || !selectedV1) return { kind: "none", desc: "Nothing selected", ...empty };
    const beatId = selectedV1.noteId ? ed.findNote(selectedV1.noteId)?.beat.id : selectedV1.restBeatId;
    const loc = beatId ? ed.findBeat(beatId) : undefined;
    if (!loc) return { kind: "none", desc: "Nothing selected", ...empty };
    const { beat, measure, beatIndex } = loc;
    const staffVoices = measure.voices.filter((v) => v.staff === loc.voice.staff);
    const voiceIndex = Math.max(0, staffVoices.indexOf(loc.voice));
    const voiceCount = staffVoices.length;
    const marks = new Set<string>(beat.articulations ?? []);
    for (const o of beat.ornaments ?? []) marks.add(o);
    if (beat.grace) marks.add("grace");
    if (beat.fermata) marks.add("fermata");
    if (ed.doc.spanners.some((s) => s.kind === "slur" && s.fromBeat === beat.id)) marks.add("slur");
    const voiceTag = voiceCount > 1 ? ` · voice ${voiceIndex + 1} of ${voiceCount}` : "";
    const where = `bar ${measure.barIndex + 1}, beat ${beatIndex + 1}${voiceTag}`;
    const dur = (beat.duration.dots ? "dotted " : "") + NOTE_TYPE_LABEL[beat.duration.noteType];
    if (selectedV1.noteId) {
      const note = ed.findNote(selectedV1.noteId)?.note;
      const tab = note?.string !== undefined;
      if (note && ed.doc.spanners.some((s) => s.kind === "tie" && s.from.noteId === note.id)) marks.add("tie");
      const pitch = note
        ? tab
          ? `string ${note.string}, fret ${note.fret ?? 0}`
          : `${note.step}${accSym(note.alter)}${note.octave}`
        : "";
      return { kind: "note", desc: `${cap(dur)} note · ${pitch} · ${where}`, noteType: beat.duration.noteType, dotted: beat.duration.dots > 0, marks, tab, voiceIndex, voiceCount };
    }
    return { kind: "rest", desc: `${cap(dur)} rest · ${where}`, noteType: beat.duration.noteType, dotted: beat.duration.dots > 0, marks, tab: false, voiceIndex, voiceCount };
  })();

  // A brand-new / all-rests score, for empty-state coaching.
  const v1IsEmpty = ((): boolean => {
    void v1Version;
    const ed = v1EditorRef.current;
    if (!ed) return false;
    return ed.doc.parts.every((p) => p.measures.every((m) => m.voices.every((vo) => vo.beats.every((b) => b.notes.length === 0))));
  })();

  // Palette op wrappers (all reachable by pointer for touch parity).
  const v1SetDurationType = (nt: v1.NoteType) => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    if (ed && b && ed.setDuration(b, nt, v1Sel.dotted ? 1 : 0)) v1Rerender();
  };
  const v1ToggleDotBtn = () => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    if (ed && b && ed.toggleDot(b)) v1Rerender();
  };
  const v1SetAlter = (alter: number) => {
    const ed = v1EditorRef.current;
    const id = selectedV1?.noteId;
    const note = id ? ed?.findNote(id)?.note : undefined;
    if (ed && id && note && ed.setPitch(id, { step: note.step, alter, octave: note.octave })) v1Rerender();
  };
  const v1AdvanceFrom = (beatId: string) => {
    const n = v1EditorRef.current?.neighbor(beatId, 1);
    if (n) setSelectedV1(n.noteId ? { noteId: n.noteId } : { restBeatId: n.beatId });
  };
  const v1SetPitchLetter = (step: v1.NoteStep) => {
    const ed = v1EditorRef.current;
    const beatId = v1SelectedBeatId();
    if (!ed || !beatId) return;
    const ok = selectedV1?.noteId ? ed.setPitchByName(selectedV1.noteId, step) : ed.restToNoteByName(beatId, step);
    if (ok) {
      v1Rerender();
      // Note-input mode advances to the next beat so melodies flow; select mode
      // stays put so you can keep adjusting the same note.
      if (noteInputModeRef.current) v1AdvanceFrom(beatId);
      else {
        const top = ed.findBeat(beatId)?.beat.notes[0];
        if (top) setSelectedV1({ noteId: top.id });
      }
    }
  };
  const v1SetFretBtn = (fret: number) => {
    const ed = v1EditorRef.current;
    const id = selectedV1?.noteId;
    if (ed && id && ed.setFret(id, fret)) v1Rerender();
  };
  const v1MakeRestBtn = () => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    if (ed && b && ed.makeRest(b)) {
      v1Rerender();
      setSelectedV1({ restBeatId: b });
    }
  };
  const v1ChordSymbolBtn = () => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    if (!ed || !b) return;
    const text = window.prompt("Chord symbol (e.g. Cmaj7, G/B)", ed.findBeat(b)?.beat.chordSymbol ?? "");
    if (text !== null && ed.setChordSymbol(b, text)) v1Rerender();
  };
  const v1Ornament = (t: v1.OrnamentType) => v1BeatOp((ed, b) => ed.toggleOrnament(b, t));
  const v1AddGrace = () => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    if (!ed || !b) return;
    const graceId = ed.insertGraceBefore(b);
    if (graceId) {
      v1Rerender();
      setSelectedV1({ noteId: graceId }); // select it so the pitch can be adjusted
    }
  };
  // Part/staff/voice of the current selection, for voice ops.
  const v1SelectedLoc = () => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    const loc = ed && b ? ed.findBeat(b) : undefined;
    if (!ed || !loc) return null;
    return {
      partIndex: ed.doc.parts.indexOf(loc.part),
      barIndex: loc.measure.barIndex,
      staffIndex: loc.voice.staff,
      voiceIndex: loc.voice.index,
    };
  };
  const v1AddVoice = () => {
    const ed = v1EditorRef.current;
    if (!ed) return;
    const loc = v1SelectedLoc();
    const first = ed.addVoice(loc?.barIndex ?? v1SelectedBarIndex(), loc?.partIndex ?? 0, loc?.staffIndex ?? 0);
    if (first) {
      v1Rerender();
      setSelectedV1({ restBeatId: first }); // ready to type into the new voice
    }
  };
  const v1RemoveVoice = () => {
    const ed = v1EditorRef.current;
    const loc = v1SelectedLoc();
    if (ed && loc && ed.removeVoice(loc.barIndex, loc.voiceIndex, loc.partIndex)) {
      v1Rerender();
      setSelectedV1(null);
    }
  };
  // Move the selection to another voice at the same metric position, so a
  // stacked voice can be picked without a pixel-perfect click.
  const v1SelectVoice = (voiceIndex: number) => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    const target = ed && b ? ed.voiceBeat(b, voiceIndex) : undefined;
    if (target) setSelectedV1(target.noteId ? { noteId: target.noteId } : { restBeatId: target.beatId });
  };
  const v1CycleVoice = () => {
    const ed = v1EditorRef.current;
    const b = v1SelectedBeatId();
    const info = ed && b ? ed.voiceInfo(b) : undefined;
    if (info && info.count > 1) v1SelectVoice((info.index + 1) % info.count);
  };

  // Every action, for the command palette (Cmd-K) and, where sensible, menus.
  const commands: Command[] = [
    { id: "play", label: playing || recording.playing ? "Pause" : "Play", group: "Transport", shortcut: "Space", run: () => togglePlayRef.current() },
    { id: "stop", label: "Stop", group: "Transport", run: () => playerRef.current?.stop(), enabled: ready },
    { id: "half", label: "Toggle half speed", group: "Transport", shortcut: "H", run: () => setSynthSpeed(speedRef.current === 0.5 ? 1 : 0.5) },
    { id: "loop", label: loop ? "Turn loop off" : "Turn loop on", group: "Transport", run: toggleLoop },
    { id: "metro", label: metronome ? "Metronome off" : "Metronome on", group: "Practice", run: toggleMetronome },
    { id: "countin", label: countIn ? "Count-in off" : "Count-in on", group: "Practice", run: toggleCountIn },
    { id: "addsection", label: "Add section here", group: "Navigate", run: addSection, enabled: !locked },
    { id: "record", label: micRecording ? "Stop recording" : "Record with microphone", group: "Capture", run: () => void toggleMicRecording() },
    { id: "ab", label: "A/B synth and recording", group: "Capture", shortcut: "V", run: toggleSynthRecording, enabled: activeRecId !== null },
    { id: "autosync", label: "Auto sync recording", group: "Sync", run: autoSync, enabled: activeRecId !== null },
    { id: "tapsync", label: "Start tap sync", group: "Sync", run: startTapSync, enabled: activeRecId !== null },
    { id: "edit", label: editMode ? "Turn off Edit mode" : "Turn on Edit mode", group: "Edit", run: () => setEditMode((v) => !v), enabled: canEdit },
    { id: "transup", label: "Transpose up a semitone", group: "Edit", run: () => doTranspose(1), enabled: editMode },
    { id: "transdown", label: "Transpose down a semitone", group: "Edit", run: () => doTranspose(-1), enabled: editMode },
    { id: "new", label: "New score", group: "File", run: newScore, enabled: !locked },
    { id: "openfile", label: "Open score file…", group: "File", run: () => scoreInputRef.current?.click(), enabled: !locked },
    { id: "openbundle", label: "Open bundle…", group: "File", run: () => bundleInputRef.current?.click() },
    { id: "openurl", label: "Open from URL…", group: "File", run: () => void openFromUrl() },
    { id: "save", label: "Save to My pieces", group: "File", run: () => void saveToLibrary(), enabled: !locked },
    { id: "expxml", label: "Export MusicXML", group: "File", run: exportMusicXml, enabled: ready && !locked },
    { id: "expmidi", label: "Export MIDI", group: "File", run: exportMidi, enabled: ready && !locked },
    { id: "expbundle", label: "Export bundle", group: "File", run: () => void exportBundle(), enabled: !locked },
    { id: "print", label: "Print / save as PDF", group: "File", shortcut: "", run: doPrint, enabled: ready },
    { id: "embed", label: "Copy embed code", group: "Share", run: copyEmbedCode },
    { id: "stand", label: "Music-stand mode", group: "View", run: () => setStandMode(true) },
    { id: "themeL", label: "Theme: Light", group: "View", run: () => settings.setTheme("light") },
    { id: "themeD", label: "Theme: Dark", group: "View", run: () => settings.setTheme("dark") },
    { id: "themeC", label: "Theme: High contrast", group: "View", run: () => settings.setTheme("contrast") },
    { id: "advanced", label: advanced ? "Switch to Basic view" : "Switch to Advanced view", group: "View", run: () => setMode(advanced ? "basic" : "advanced") },
    { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", shortcut: "?", run: () => setCheatSheetOpen(true) },
    { id: "tour", label: "Show the welcome tour", group: "Help", run: () => setShowTour(true) },
  ];

  const fileMenu: MenuItem[] = [
    { label: "New / Open", heading: true },
    { label: "New score", onSelect: newScore, disabled: locked },
    { label: "Open score file…", onSelect: () => scoreInputRef.current?.click(), disabled: locked },
    { label: "Open bundle…", onSelect: () => bundleInputRef.current?.click() },
    { label: "Open from URL…", onSelect: () => void openFromUrl() },
    { label: "Add recording…", onSelect: () => audioInputRef.current?.click(), disabled: locked },
    { divider: true },
    { label: "Save / Export", heading: true },
    { label: "Save to My pieces", onSelect: () => void saveToLibrary(), disabled: locked },
    { label: "Export bundle", onSelect: () => void exportBundle(), disabled: locked },
    { label: "Export MusicXML", onSelect: exportMusicXml, disabled: !ready },
    { label: "Export MIDI", onSelect: exportMidi, disabled: !ready },
    { divider: true },
    { label: "Print / save as PDF", onSelect: doPrint, disabled: !ready },
    { divider: true },
    { label: "Close piece", onSelect: () => setClosed(true) },
  ];

  const viewMenu: MenuItem[] = [
    { label: "Theme", heading: true },
    { label: "Light", checked: settings.theme === "light", onSelect: () => settings.setTheme("light") },
    { label: "Dark", checked: settings.theme === "dark", onSelect: () => settings.setTheme("dark") },
    { label: "High contrast", checked: settings.theme === "contrast", onSelect: () => settings.setTheme("contrast") },
    { divider: true },
    { label: `Text size: ${settings.scale}px`, heading: true },
    { label: "Larger text", onSelect: () => settings.setScale(Math.min(22, settings.scale + 1)) },
    { label: "Smaller text", onSelect: () => settings.setScale(Math.max(12, settings.scale - 1)) },
    { divider: true },
    { label: "Music-stand mode", onSelect: () => setStandMode(true) },
    { label: "Reset panel layout", onSelect: resetLayout },
  ];

  const shareMenu: MenuItem[] = [
    { label: "Copy embed code", onSelect: copyEmbedCode },
    {
      label: "Copy student practice link",
      onSelect: () => {
        const url = `${window.location.origin}${window.location.pathname}?lock=1`;
        void navigator.clipboard.writeText(url).then(
          () => showToast("Student link copied. Open a shared bundle in it to assign practice."),
          () => window.prompt("Copy the student link:", url),
        );
      },
    },
  ];

  const helpMenu: MenuItem[] = [
    { label: "Keyboard shortcuts", shortcut: "?", onSelect: () => setCheatSheetOpen(true) },
    { label: "Command palette", shortcut: "⌘K", onSelect: () => setPaletteOpen(true) },
    { label: "Show welcome tour", onSelect: () => setShowTour(true) },
  ];

  const isPlaying = playing || recording.playing;

  return (
    <div className={`app${standMode ? " stand-mode" : ""}${closed ? " closed" : ""}${noteInputMode ? " note-input" : ""}`}>
      <header className="header" role="banner">
        <h1>OpenVoicing</h1>
        {scoreTitle && <span className="tagline">{scoreTitle}</span>}
        {/* Hidden file inputs driven by File-menu items and the palette. */}
        <input
          ref={scoreInputRef}
          type="file"
          accept=".musicxml,.xml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx"
          onChange={openFile}
          className="visually-hidden-input"
          aria-hidden="true"
          tabIndex={-1}
        />
        <input
          ref={bundleInputRef}
          type="file"
          accept=".ovb,application/zip,application/octet-stream"
          onChange={openBundle}
          className="visually-hidden-input"
          aria-hidden="true"
          tabIndex={-1}
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addRecordingFile(f);
            e.target.value = "";
          }}
          className="visually-hidden-input"
          aria-hidden="true"
          tabIndex={-1}
        />
        <nav className="menubar" aria-label="Main menu">
          {!locked && <Menu label="File" icon={<FileIcon />} items={fileMenu} />}
          <Menu label="View" icon={<ViewIcon />} items={viewMenu} />
          {!locked && <Menu label="Share" icon={<ShareIcon />} items={shareMenu} />}
          <Menu label="Help" icon={<HelpIcon />} items={helpMenu} />
          {!locked && library.length > 0 && (
            <Menu
              label="My pieces"
              icon={<BookmarkIcon />}
              items={library.map((p) => ({ label: p.title, onSelect: () => void openFromLibrary(p.id) }))}
            />
          )}
          {!locked && (
            <div className="mode-toggle" role="group" aria-label="View complexity">
              <button className={advanced ? "" : "on"} aria-pressed={!advanced} onClick={() => setMode("basic")}>
                Basic
              </button>
              <button className={advanced ? "on" : ""} aria-pressed={advanced} onClick={() => setMode("advanced")}>
                Advanced
              </button>
            </div>
          )}
        </nav>
      </header>

      {standMode && (
        <div className="stand-controls">
          <button onClick={() => togglePlayRef.current()} className="stand-play">
            {playing || recording.playing ? "Pause" : "Play"}
          </button>
          <button onClick={() => setStandMode(false)}>Exit stand mode</button>
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {cheatSheetOpen && <CheatSheet onClose={() => setCheatSheetOpen(false)} />}
      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}
      {showTour && (
        <div className="cheatsheet-backdrop" role="dialog" aria-modal="true" aria-label="Welcome">
          <div className="cheatsheet tour" onClick={(e) => e.stopPropagation()}>
            <h2>Welcome to OpenVoicing</h2>
            <p>This is living sheet music. A demo piece is loaded so you can try it now:</p>
            <ul>
              <li><strong>Play</strong> and drag across the waveform to <strong>loop</strong> a passage.</li>
              <li>Use <strong>−/+</strong> to slow it down without changing pitch.</li>
              <li>Open the <strong>Recording</strong> row to sync a real audio track.</li>
              <li>Turn on <strong>Edit</strong> to change the notes; press <strong>?</strong> any time for shortcuts.</li>
            </ul>
            <button className="tour-dismiss" onClick={dismissTour}>
              Got it
            </button>
          </div>
        </div>
      )}
      {countInNumber !== null && (
        <div className="countin-overlay" aria-hidden="true">
          <span className="countin-number">{countInNumber}</span>
        </div>
      )}

      <div className="toolbar" role="toolbar" aria-label="Playback and navigation">
        {/* Transport (pinned left, always visible) */}
        <div className="tb-zone tb-transport">
          <button
            className="btn-primary"
            onClick={() => togglePlayRef.current()}
            disabled={!ready}
            aria-label={isPlaying ? "Pause" : "Play"}
            title={activeRecId !== null ? "Play the recording" : "Play the score"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button className="btn-icon" onClick={transportStop} disabled={!ready} aria-label="Stop" title="Stop">
            <StopIcon />
          </button>
          <SpeedControl value={speed} onChange={setSynthSpeed} />
          <Popover
            label="Loop"
            icon={<LoopIcon />}
            active={loop}
            title="Loop settings"
          >
            <label className="control">
              <input type="checkbox" checked={loop} onChange={toggleLoop} /> Loop playback
            </label>
            <span className="control">
              <input
                className="bars-input"
                placeholder="bars 3-6"
                aria-label="Loop bar range"
                value={barsInput}
                size={8}
                onChange={(e) => setBarsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyBarLoop();
                }}
              />
              <button className="btn-icon" onClick={applyBarLoop} title="Loop these bars" aria-label="Loop these bars">
                ↵
              </button>
              {loopBars && (
                <button className="btn-icon" onClick={clearBarLoop} title="Clear bar loop" aria-label="Clear bar loop">
                  ×
                </button>
              )}
            </span>
          </Popover>
          {activeRecId !== null && (
            <div className="mode-toggle source-toggle" role="group" aria-label="Playback source">
              <button
                className={preferredSource === "recording" ? "on" : ""}
                aria-pressed={preferredSource === "recording"}
                onClick={() => switchSource("recording")}
                title="Play the recording"
              >
                Recording
              </button>
              <button
                className={preferredSource === "synth" ? "on" : ""}
                aria-pressed={preferredSource === "synth"}
                onClick={() => switchSource("synth")}
                title="Play the notation (synth)"
              >
                Synth
              </button>
            </div>
          )}
        </div>

        {/* Practice aids (advanced) */}
        {advanced && (
          <div className="tb-zone">
            <span className="tb-zone-label">Practice</span>
            <button
              className={metronome ? "btn-icon on" : "btn-icon"}
              onClick={toggleMetronome}
              aria-pressed={metronome}
              aria-label="Metronome"
              title="Metronome"
            >
              <MetronomeIcon />
            </button>
            <label className="control">
              <input type="checkbox" checked={countIn} onChange={toggleCountIn} /> Count-in
            </label>
          </div>
        )}

        {/* Navigation */}
        <div className="tb-zone" role="group" aria-label="Navigation">
          <span className="tb-zone-label">Go to</span>
          <NavigateControl
            barCount={barCount}
            sections={sections}
            locked={locked}
            onJumpBar={(n) => {
              const player = playerRef.current;
              if (player && n >= 1 && n <= player.barTicks.length) {
                player.cursorTick = player.barTicks[n - 1]!.start;
                player.scrollBarIntoView(n - 1);
              }
            }}
            onJumpSection={jumpToSection}
            onAddSection={addSection}
            onRenameSection={renameSection}
            onDeleteSection={deleteSection}
          />
        </div>

        {/* Capture (advanced) */}
        {advanced && (
          <div className="tb-zone">
            <span className="tb-zone-label">Capture</span>
            <button
              className={micRecording ? "btn-icon on" : "btn-icon"}
              onClick={() => void toggleMicRecording()}
              aria-label={micRecording ? "Stop recording" : "Record"}
              title="Record with the microphone"
            >
              <RecordIcon />
            </button>
          </div>
        )}

        <div className="tb-zone tb-right">
          <span className="position">
            {formatTime(position.current)} / {formatTime(position.total)}
          </span>
          {canEdit && (
            <button
              className={editMode ? "btn-primary" : "btn-icon"}
              onClick={() => setEditMode((v) => !v)}
              aria-pressed={editMode}
            >
              {editMode ? "Done editing" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {editMode && hasV1Editor && (
        <>
          <div className="edit-toolbar" role="toolbar" aria-label="Editing tools">
            {/* Always available: history + delete, pinned so they never move. */}
            <div className="etb-group" role="group" aria-label="History">
              <button className="etb-btn" onClick={v1Undo} disabled={!v1EditorRef.current?.canUndo} title="Undo (Cmd+Z)" aria-label="Undo">↶</button>
              <button className="etb-btn" onClick={v1Redo} disabled={!v1EditorRef.current?.canRedo} title="Redo (Shift+Cmd+Z)" aria-label="Redo">↷</button>
              <button className="etb-btn" onClick={v1Delete} disabled={v1Sel.kind !== "note"} title="Delete (Del)" aria-label="Delete note">🗑</button>
            </div>

            {/* Select vs Note-Input mode (MuseScore "N"): in input mode, typing a
                pitch advances to the next beat so melodies flow. */}
            <div className="etb-group" role="group" aria-label="Input mode">
              <button
                className={"etb-btn wide" + (noteInputMode ? " active" : "")}
                aria-pressed={noteInputMode}
                title="Note-input mode (N): notes advance as you type"
                onClick={() => setNoteInputMode((m) => !m)}
              >
                {noteInputMode ? "✎ Input" : "Select"}
              </button>
            </div>

            {/* Voice picker: appears only where a bar has stacked voices, so a
                specific voice can be selected without a pixel-perfect click. */}
            {v1Sel.voiceCount > 1 && (
              <div className="etb-group" role="group" aria-label="Voice">
                <span className="etb-label">Voice</span>
                {Array.from({ length: v1Sel.voiceCount }, (_, i) => (
                  <button
                    key={i}
                    className={"etb-btn voice-pill v" + (i + 1) + (v1Sel.voiceIndex === i ? " active" : "")}
                    aria-pressed={v1Sel.voiceIndex === i}
                    aria-label={`Voice ${i + 1}`}
                    title={`Select voice ${i + 1} (v cycles)`}
                    onClick={() => v1SelectVoice(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Note value (when a note or rest is selected). */}
            {v1Sel.kind !== "none" && (
              <div className="etb-group" role="group" aria-label="Note value">
                <span className="etb-label">Value</span>
                {DURATION_PALETTE.map((d) => (
                  <button
                    key={d.type}
                    className={"etb-btn" + (v1Sel.noteType === d.type ? " active" : "")}
                    aria-pressed={v1Sel.noteType === d.type}
                    aria-label={`${d.label} (${d.key})`}
                    title={`${d.label} (key ${d.key})`}
                    onClick={() => v1SetDurationType(d.type)}
                  >
                    {d.face}
                  </button>
                ))}
                <button className={"etb-btn" + (v1Sel.dotted ? " active" : "")} aria-pressed={v1Sel.dotted} aria-label="Dotted" title="Dotted (.)" onClick={v1ToggleDotBtn}>
                  ・
                </button>
              </div>
            )}

            {/* Pitch entry A-G (standard staves). Fret keypad on tab staves. */}
            {v1Sel.kind !== "none" && !v1Sel.tab && (
              <div className="etb-group" role="group" aria-label="Pitch">
                <span className="etb-label">Pitch</span>
                {(["C", "D", "E", "F", "G", "A", "B"] as v1.NoteStep[]).map((s) => (
                  <button key={s} className="etb-btn" aria-label={`Pitch ${s}`} title={`Pitch ${s} (${s.toLowerCase()})`} onClick={() => v1SetPitchLetter(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {v1Sel.kind === "note" && v1Sel.tab && (
              <div className="etb-group" role="group" aria-label="Fret">
                <span className="etb-label">Fret</span>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((f) => (
                  <button key={f} className="etb-btn" aria-label={`Fret ${f}`} title={`Fret ${f}`} onClick={() => v1SetFretBtn(f)}>
                    {f}
                  </button>
                ))}
              </div>
            )}

            {/* Accidental + octave (note on a standard staff). */}
            {v1Sel.kind === "note" && !v1Sel.tab && (
              <div className="etb-group" role="group" aria-label="Accidental and octave">
                <span className="etb-label">Accidental</span>
                <button className="etb-btn" aria-label="Flat" title="Flat (−)" onClick={() => v1SetAlter(-1)}>♭</button>
                <button className="etb-btn" aria-label="Natural" title="Natural" onClick={() => v1SetAlter(0)}>♮</button>
                <button className="etb-btn" aria-label="Sharp" title="Sharp (+)" onClick={() => v1SetAlter(1)}>♯</button>
                <button className="etb-btn" aria-label="Octave up" title="Octave up (Shift+Up)" onClick={() => v1Transpose(12)}>8va</button>
                <button className="etb-btn" aria-label="Octave down" title="Octave down (Shift+Down)" onClick={() => v1Transpose(-12)}>8vb</button>
              </div>
            )}

            {/* Articulations, tie, slur (note only). Color marks active state. */}
            {v1Sel.kind === "note" && (
              <div className="etb-group" role="group" aria-label="Articulations and slurs">
                <span className="etb-label">Marks</span>
                {MARK_PALETTE.map((m) => (
                  <button
                    key={m.type}
                    className={"etb-btn" + (v1Sel.marks.has(m.type) ? " active" : "")}
                    aria-pressed={v1Sel.marks.has(m.type)}
                    aria-label={m.label}
                    title={m.label}
                    onClick={() => v1Articulate(m.type)}
                  >
                    {m.glyph}
                  </button>
                ))}
                <button className={"etb-btn wide" + (v1Sel.marks.has("fermata") ? " active" : "")} aria-pressed={v1Sel.marks.has("fermata")} aria-label="Fermata" title="Fermata" onClick={v1Fermata}>Hold</button>
                <button className={"etb-btn" + (v1Sel.marks.has("tie") ? " active" : "")} aria-pressed={v1Sel.marks.has("tie")} aria-label="Tie" title="Tie (t)" onClick={v1Tie}>‿</button>
                <button className={"etb-btn" + (v1Sel.marks.has("slur") ? " active" : "")} aria-pressed={v1Sel.marks.has("slur")} aria-label="Slur" title="Slur (s)" onClick={v1Slur}>⌒</button>
              </div>
            )}

            {/* Ornaments + grace note (note only). */}
            {v1Sel.kind === "note" && (
              <div className="etb-group" role="group" aria-label="Ornaments and grace">
                <span className="etb-label">Orn</span>
                <button className={"etb-btn wide" + (v1Sel.marks.has("trill-mark") ? " active" : "")} aria-pressed={v1Sel.marks.has("trill-mark")} aria-label="Trill" title="Trill" onClick={() => v1Ornament("trill-mark")}>tr</button>
                <button className={"etb-btn wide" + (v1Sel.marks.has("mordent") ? " active" : "")} aria-pressed={v1Sel.marks.has("mordent")} aria-label="Mordent" title="Mordent" onClick={() => v1Ornament("mordent")}>Mord</button>
                <button className={"etb-btn wide" + (v1Sel.marks.has("turn") ? " active" : "")} aria-pressed={v1Sel.marks.has("turn")} aria-label="Turn" title="Turn" onClick={() => v1Ornament("turn")}>Turn</button>
                <button className={"etb-btn wide" + (v1Sel.marks.has("grace") ? " active" : "")} aria-label="Add grace note" title="Grace note before this beat (/)" onClick={v1AddGrace}>Grace</button>
              </div>
            )}

            {/* Dynamics, chord symbol, convert-to-rest (note only). */}
            {v1Sel.kind === "note" && (
              <div className="etb-group" role="group" aria-label="Dynamics and chord">
                <label className="etb-select" title="Dynamic">
                  <span className="etb-label">Dyn</span>
                  <select value="" onChange={(e) => e.target.value && v1Dynamic(e.target.value)}>
                    <option value="">–</option>
                    {["pp", "p", "mp", "mf", "f", "ff"].map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <button className="etb-btn wide" aria-label="Chord symbol" title="Chord symbol (k)" onClick={v1ChordSymbolBtn}>Chord</button>
                <button className="etb-btn wide" aria-label="Change to rest" title="Change to rest (r)" onClick={v1MakeRestBtn}>Rest</button>
              </div>
            )}

            {/* Score-level setup: demoted behind one popover, always reachable. */}
            <div className="etb-group etb-right" role="group" aria-label="Score settings">
              <button className={"etb-btn wide" + (scorePanelOpen ? " active" : "")} aria-expanded={scorePanelOpen} aria-haspopup="dialog" title="Bars, time, key, tempo, title" onClick={() => setScorePanelOpen((o) => !o)}>
                ⚙ Score
              </button>
              {scorePanelOpen && (
                <div className="etb-popover" role="dialog" aria-label="Score settings">
                  <div className="etb-pop-row">
                    <span className="etb-label">Measures</span>
                    <button className="etb-btn" onClick={v1AddBar} aria-label="Add a measure after this one" title="Add measure">＋ Bar</button>
                    <button className="etb-btn" onClick={v1RemoveBar} aria-label="Remove this measure" title="Remove measure">－ Bar</button>
                  </div>
                  <div className="etb-pop-row">
                    <span className="etb-label">Voices</span>
                    <button className="etb-btn" onClick={v1AddVoice} aria-label="Add a voice to this bar" title="Add an independent voice to this bar">＋ Voice</button>
                    <button className="etb-btn" onClick={v1RemoveVoice} aria-label="Remove this voice" title="Remove the selected voice">－ Voice</button>
                  </div>
                  <label className="etb-pop-row">
                    <span className="etb-label">Time</span>
                    <select value={v1TimeValue} onChange={(e) => v1SetTime(e.target.value)}>
                      {["2/4", "3/4", "4/4", "6/8", "3/8", "5/4", "12/8"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="etb-pop-row">
                    <span className="etb-label">Key</span>
                    <select value={v1KeyValue} onChange={(e) => v1SetKey(Number(e.target.value))}>
                      {KEY_OPTIONS.map((k) => <option key={k.fifths} value={k.fifths}>{k.label}</option>)}
                    </select>
                  </label>
                  <div className="etb-pop-row">
                    <button className="etb-btn wide" onClick={v1EditTempo} aria-label="Tempo" title="Tempo (bpm)">♩= Tempo</button>
                    <button className="etb-btn wide" onClick={v1EditMeta} aria-label="Title and composer" title="Title & composer">ℹ Title</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Live selection status + the one relevant next action. */}
          <div className="edit-status" role="status" aria-live="polite">
            <span className="edit-status-what">{v1Sel.desc}</span>
            <span className="edit-status-hint">
              {v1Sel.kind === "none"
                ? "Click a note or rest to edit it."
                : noteInputMode
                  ? "Note input: type A–G to place notes; they advance automatically. N to stop."
                  : v1Sel.kind === "rest"
                    ? "Type A–G (or tap Pitch) to turn this rest into a note."
                    : "Type A–G to re-pitch, 1–9 for value, ←/→ to move."}
            </span>
          </div>

          {/* First-run coaching on an empty score: teach the click-then-type loop. */}
          {v1IsEmpty && !coachSeen && (
            <div className="edit-coach" role="note">
              <span className="edit-coach-icon" aria-hidden="true">🎵</span>
              <span>
                <strong>Write your first note.</strong> A rest is already selected. Tap a <strong>Pitch</strong> button
                (or press <kbd>A</kbd>–<kbd>G</kbd>) to place a note, then <kbd>1</kbd>–<kbd>9</kbd> sets its length and{" "}
                <kbd>→</kbd> moves to the next beat.
              </span>
              <button className="btn-sm" onClick={dismissCoach}>Got it</button>
            </div>
          )}

          {/* Right-click / long-press context menu: the actions for what was clicked. */}
          {contextMenu && v1Sel.kind !== "none" && (
            <>
              <div className="ctx-backdrop" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
              <div className="ctx-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
                {v1Sel.kind === "rest" ? (
                  <>
                    <div className="ctx-title">Rest · {NOTE_TYPE_LABEL[v1Sel.noteType ?? "quarter"]}</div>
                    {(["C", "D", "E", "F", "G", "A", "B"] as v1.NoteStep[]).map((s) => (
                      <button key={s} role="menuitem" onClick={() => { v1SetPitchLetter(s); setContextMenu(null); }}>Make {s} note</button>
                    ))}
                  </>
                ) : (
                  <>
                    <div className="ctx-title">{v1Sel.desc}</div>
                    <button role="menuitem" onClick={() => { v1Tie(); setContextMenu(null); }}>{v1Sel.marks.has("tie") ? "Remove tie" : "Tie to next"}</button>
                    <button role="menuitem" onClick={() => { v1Slur(); setContextMenu(null); }}>{v1Sel.marks.has("slur") ? "Remove slur" : "Slur to next"}</button>
                    <button role="menuitem" onClick={() => { v1Articulate("staccato"); setContextMenu(null); }}>{v1Sel.marks.has("staccato") ? "Remove staccato" : "Staccato"}</button>
                    <button role="menuitem" onClick={() => { v1Articulate("accent"); setContextMenu(null); }}>{v1Sel.marks.has("accent") ? "Remove accent" : "Accent"}</button>
                    <button role="menuitem" onClick={() => { v1Ornament("mordent"); setContextMenu(null); }}>{v1Sel.marks.has("mordent") ? "Remove mordent" : "Mordent"}</button>
                    <button role="menuitem" onClick={() => { v1Ornament("turn"); setContextMenu(null); }}>{v1Sel.marks.has("turn") ? "Remove turn" : "Turn"}</button>
                    <button role="menuitem" onClick={() => { v1Ornament("trill-mark"); setContextMenu(null); }}>{v1Sel.marks.has("trill-mark") ? "Remove trill" : "Trill"}</button>
                    <button role="menuitem" onClick={() => { v1AddGrace(); setContextMenu(null); }}>Add grace note</button>
                    <button role="menuitem" onClick={() => { v1ChordSymbolBtn(); setContextMenu(null); }}>Chord symbol…</button>
                    <div className="ctx-sep" />
                    <button role="menuitem" onClick={() => { v1MakeRestBtn(); setContextMenu(null); }}>Change to rest</button>
                    <button role="menuitem" className="ctx-danger" onClick={() => { v1Delete(); setContextMenu(null); }}>Delete note</button>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
      {locked && assignment && (
        <div className="edit-band" role="region" aria-label="Assignment">
          <span className="inspector-title">Assignment</span>
          <span>{assignment}</span>
        </div>
      )}

      {tracks.length > 1 && (
        <div className="tracks">
          {tracks.map((t) => (
            <span key={t.index} className="track">
              {t.name}
              <label>
                <input
                  type="checkbox"
                  checked={t.mute}
                  onChange={(e) => setTrackMute(t.index, e.target.checked)}
                />
                mute
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={t.solo}
                  onChange={(e) => setTrackSolo(t.index, e.target.checked)}
                />
                solo
              </label>
            </span>
          ))}
        </div>
      )}

      {(activeRecId !== null || advanced) && (
        <CollapsiblePanel
          id="recording"
          title={activeRecId !== null ? "Recording & sync" : "Recording"}
          ariaLabel="Recording and sync"
          defaultOpen={activeRecId !== null}
        >
          <RecordingPanel
            player={recording}
            recordings={recordings}
            activeId={activeRecId}
            onSelect={(id) => void selectRecording(id)}
            onAddFile={addRecordingFile}
            onRemove={(id) => void removeRecording(id)}
            syncPoints={syncPoints}
            onMoveSyncPoint={moveSyncPoint}
            onNudgeSyncPoint={nudgeSyncPoint}
            onEndSyncDrag={endSyncDrag}
            syncConfidence={syncConfidence}
            barTimes={barTimes}
            savedLoops={savedLoops}
            onSaveLoop={saveCurrentLoop}
            onRecallLoop={recallLoop}
            onDeleteLoop={deleteSavedLoop}
            pitchSemitones={pitchSemitones}
            onPitchChange={applyPitchSemitones}
          />

          {activeRecId !== null && !locked && (
            <div className="sync-bar" role="region" aria-label="Sync">
              {tapCount === null ? (
                <>
                  <span className="subgroup-label">Sync</span>
                  <button onClick={autoSync}>Auto sync</button>
                  <button onClick={startTapSync}>Start tap sync</button>
                  {syncPoints ? (
                    <>
                      <label className="control">
                        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                        Follow
                      </label>
                      <label className="control" title="Click on each bar of the recording">
                        <input type="checkbox" checked={syncedClick} onChange={(e) => setSyncedClick(e.target.checked)} />
                        Click
                      </label>
                      <button onClick={undoSync} disabled={!syncCanUndo} title="Undo sync edit (Cmd+Z)">
                        Undo sync
                      </button>
                      <span className="hint">
                        {syncPoints.length} bars synced; play + tap P to fix a bar, drag or arrow-nudge a marker
                      </span>
                    </>
                  ) : (
                    <span className="hint">not synced yet; auto-sync or tap each bar's downbeat</span>
                  )}
                </>
              ) : (
                <>
                  <button className="tap-button" onClick={tap}>
                    Tap bar {tapCount + 1} of {barCount} (or press Space)
                  </button>
                  <button onClick={undoTap} disabled={tapCount === 0}>
                    Undo tap
                  </button>
                  <button onClick={finishTapSync} disabled={tapsRef.current.length < 2}>
                    Done
                  </button>
                  <button onClick={cancelTapSync}>Cancel</button>
                  <span className="hint">tip: slow the recording speed to make tapping easier</span>
                </>
              )}
            </div>
          )}
        </CollapsiblePanel>
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}

      {closed && (
        <div className="empty-state">
          <div className="empty-card">
            <h2>No piece open</h2>
            <p>Open a piece to practice, or start a new score.</p>
            <div className="empty-actions">
              <button className="btn-primary" onClick={() => scoreInputRef.current?.click()}>
                Open a piece…
              </button>
              {library.length > 0 && (
                <button
                  className="btn-icon"
                  onClick={() => library[0] && void openFromLibrary(library[0].id)}
                >
                  My pieces
                </button>
              )}
              {!locked && (
                <button className="btn-icon" onClick={newScore}>
                  New score
                </button>
              )}
              <button className="btn-icon" onClick={() => setShowTour(true)}>
                Take the tour
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="sr-only" id="score-summary">
        {scoreTitle}
        {scoreArtist ? ` by ${scoreArtist}` : ""}. {barCount} bars.
      </p>
      <main className="score" aria-label="Score" aria-describedby="score-summary">
        <div ref={containerRef} className="score-surface" role="img" aria-label="Musical notation" />
      </main>

      <footer className="footer">
        {editMode
          ? "Tip: click a note to select it, then ↑/↓ transpose or Del delete."
          : "Tip: click a note to jump there, drag across notes to loop a passage."}
      </footer>
    </div>
  );
}

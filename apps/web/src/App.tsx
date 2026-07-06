import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Player, type EditSelection, type TrackInfo } from "@openvoicing/player";
import {
  alignBarsToOnsets,
  detectOnsets,
  RecordingPlayer,
  YouTubePlayer,
  type MediaPlayer,
} from "@openvoicing/audio-engine";
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
  parseYouTubeId,
  readBundle,
  recordingAudioPath,
  scoreFileExtension,
  scoreTypeFromFileName,
  type BundlePassage,
  type BundleRecording,
  type RecordingMedia,
  type SavedLoop,
  type ScoreType,
} from "@openvoicing/bundle";
// FluidR3 (full General MIDI, MIT) self-hosted; cached on first play. Much
// richer than alphaTab's bundled sonivox, at ~24MB loaded once.
const soundFontUrl = `${import.meta.env.BASE_URL}soundfont/FluidR3Mono_GM.sf3`;
import { DEMO_TEX } from "./demo";
import { RecordingPanel } from "./RecordingPanel";
import { SpeedControl, clampSpeed } from "./SpeedControl";
import { clampSyncMove as clampSyncMovePure, computeSyncConfidence } from "./sync-utils";
import { CheatSheet, useAppSettings, type Theme } from "./Settings";
import { Menu, type MenuItem } from "./ui/Menu";
import { Popover } from "./ui/Popover";
import { CollapsiblePanel, resetLayout } from "./ui/CollapsiblePanel";
import { CommandPalette } from "./ui/CommandPalette";
import { NavigateControl, type Section } from "./ui/NavigateControl";
import { TextPrompt, type TextPromptRequest } from "./ui/TextPrompt";
import { ChordEditor, EMPTY_CHORD } from "./ui/ChordEditor";
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
  TrashIcon,
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
// `glyph` is the SMuFL codepoint (rendered in alphaTab's Bravura font, which is
// always loaded); `face` is the fraction shown if the music font fails to load.
const DURATION_PALETTE: Array<{
  type: v1.NoteType;
  glyph: string;
  face: string;
  label: string;
  key: string;
}> = [
  { type: "whole", glyph: "", face: "1", label: "Whole note", key: "1" },
  { type: "half", glyph: "", face: "½", label: "Half note", key: "2" },
  { type: "quarter", glyph: "", face: "¼", label: "Quarter note", key: "3" },
  { type: "eighth", glyph: "", face: "⅛", label: "Eighth note", key: "4" },
  { type: "16th", glyph: "", face: "1⁄16", label: "16th note", key: "5" },
];

// Articulation toggles: glyph + accessible label + key hint.
const MARK_PALETTE: Array<{ type: v1.ArticulationType; glyph: string; label: string }> = [
  { type: "staccato", glyph: "·", label: "Staccato" },
  { type: "accent", glyph: ">", label: "Accent" },
  { type: "tenuto", glyph: "‒", label: "Tenuto" },
];

/**
 * Responsive "priority+" tier for the edit toolbar, from its OWN width (not the
 * viewport, which is wrong when panels steal space). 3 = wide (all inline),
 * 2 = medium, 1 = narrow, 0 = extra-narrow. Groups collapse into a "More" menu
 * in tier order (see renderEditToolbar). Uses a ResizeObserver, rAF-throttled.
 */
// Priority+ overflow for the edit toolbar. Rather than guess from viewport
// width (which ignores the variable pinned width, e.g. the Voice group only
// appears on multi-voice bars), start at the top tier and step down until the
// pinned cluster (History/Mode/Voice/Value/Pitch) stops clipping. The pinned
// cluster has overflow-x:auto, so it clips internally without the toolbar ever
// reporting overflow; measuring the pinned cluster directly is what catches it.
function useToolbarTier(ref: RefObject<HTMLElement | null>, active: boolean): number {
  const [tier, setTier] = useState(3);
  // Bumped on every resize to force a re-render (and thus a fresh step-down
  // pass) even when the tier is already at the top; otherwise resizing from a
  // wide layout would no-op setTier(3) and never re-measure.
  const [, setResizeNonce] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setTier(3);
        setResizeNonce((n) => n + 1);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref, active]);
  // Runs after every layout: if the pinned cluster is clipping its essential
  // controls, drop a tier so one more overflow-eligible group collapses into
  // "More". Converges (guarded by tier > 0) before the browser paints.
  useLayoutEffect(() => {
    if (!active) return;
    const pinned = ref.current?.querySelector<HTMLElement>(".etb-pinned");
    if (pinned && pinned.scrollWidth > pinned.clientWidth + 1 && tier > 0) {
      setTier((t) => Math.max(0, t - 1));
    }
  });
  return active ? tier : 3;
}

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
  const [textPrompt, setTextPrompt] = useState<TextPromptRequest | null>(null);
  const askText = (req: TextPromptRequest) => setTextPrompt(req);
  const [chordEdit, setChordEdit] = useState<{
    beatId: string;
    symbol: string;
    diagram: v1.ChordDiagram | null;
  } | null>(null);

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
  const [sections, setSections] = useState<Section[]>([]);
  const [notebook, setNotebook] = useState("");
  const [notebookOpen, setNotebookOpen] = useState(false);
  // Named bar-range passages (piece-level): one list drives synth and every take.
  const [passages, setPassages] = useState<BundlePassage[]>([]);
  const passagesRef = useRef<BundlePassage[]>([]);
  passagesRef.current = passages;
  useEffect(() => {
    void storage.get<Section[]>("sections").then((s) => setSections(s ?? []));
    void storage.get<string>("notebook").then((n) => setNotebook(n ?? ""));
    void storage.get<BundlePassage[]>("passages").then((p) => setPassages(p ?? []));
  }, []);
  useEffect(() => {
    if (hydratedRef.current) void storage.set("notebook", notebook);
  }, [notebook]);
  useEffect(() => {
    if (hydratedRef.current) void storage.set("passages", passages);
  }, [passages]);
  function currentBarIndex(): number {
    const player = playerRef.current;
    return player ? player.barIndexAtTick(player.cursorTick) : 0;
  }
  function addSection() {
    const bar = currentBarIndex();
    askText({
      label: "Section label (e.g. Verse, Chorus, B)",
      placeholder: "Verse",
      submit: (label) => {
        if (!label.trim()) return;
        const next = [...sections.filter((s) => s.barIndex !== bar), { barIndex: bar, label: label.trim() }].sort(
          (a, b) => a.barIndex - b.barIndex,
        );
        setSections(next);
        void storage.set("sections", next);
        showToast(`Section "${label.trim()}" added at bar ${bar + 1}.`);
      },
    });
  }
  function jumpToBarIndex(barIndex: number) {
    const player = playerRef.current;
    const bar = player?.barTicks[barIndex];
    if (!player || !bar) return;
    player.cursorTick = bar.start;
    player.scrollBarIntoView(barIndex);
    // Move the recording playhead to the same spot so pressing Play starts
    // here whichever source is active (synth follows cursorTick already).
    const points = syncPointsRef.current;
    if (points) media().seek(mediaTimeAtTick(points, bar.start));
  }
  function jumpToSection(barIndex: number) {
    jumpToBarIndex(barIndex);
  }
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.barIndex - b.barIndex),
    [sections],
  );
  // Which section the playhead is in (index into sortedSections), or -1.
  function currentSectionIndex(): number {
    const player = playerRef.current;
    if (!player || sortedSections.length === 0) return -1;
    const bar = player.barIndexAtTick(player.cursorTick);
    let idx = -1;
    for (let i = 0; i < sortedSections.length; i++) {
      if (sortedSections[i]!.barIndex <= bar) idx = i;
      else break;
    }
    return idx;
  }
  function stepSection(dir: 1 | -1) {
    if (sortedSections.length === 0) return;
    const cur = currentSectionIndex();
    const base = cur < 0 ? -1 : cur;
    const next = Math.max(0, Math.min(sortedSections.length - 1, base + dir));
    jumpToBarIndex(sortedSections[next]!.barIndex);
  }
  // The global keydown effect is bound once (deps [recording]), so PageUp/Down
  // must read the current sections/stepper through refs, not the stale closure
  // captured at mount (sections load asynchronously after mount).
  const stepSectionRef = useRef(stepSection);
  stepSectionRef.current = stepSection;
  const sortedSectionsRef = useRef(sortedSections);
  sortedSectionsRef.current = sortedSections;
  function toggleSectionPracticed(barIndex: number) {
    const next = sections.map((s) =>
      s.barIndex === barIndex ? { ...s, practiced: !s.practiced } : s,
    );
    setSections(next);
    void storage.set("sections", next);
  }
  const practicedCount = sections.filter((s) => s.practiced).length;
  function renameSection(barIndex: number) {
    const existing = sections.find((s) => s.barIndex === barIndex);
    askText({
      label: "Rename section",
      initial: existing?.label ?? "",
      submit: (label) => {
        const next = sections
          .map((s) => (s.barIndex === barIndex ? { ...s, label } : s))
          .filter((s) => s.label);
        setSections(next);
        void storage.set("sections", next);
      },
    });
  }
  function deleteSection(barIndex: number) {
    const next = sections.filter((s) => s.barIndex !== barIndex);
    setSections(next);
    void storage.set("sections", next);
  }
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [recording] = useState(() => new RecordingPlayer());
  // The active recording is either a decoded audio take (`recording`) or an
  // external video (a YouTubePlayer, created on demand and mounted in
  // videoHostRef). Transport acts on media(); audio-only bits (load, pitch,
  // waveform, onset auto-sync) stay on `recording`.
  const youtubeRef = useRef<YouTubePlayer | null>(null);
  // Position + play state to restore once a newly-selected video is ready, so
  // A/B-ing takes keeps the spot (the player is created async by a layout effect).
  const pendingResumeRef = useRef<{ position: number; playing: boolean } | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const [videoLarge, setVideoLarge] = useState(false);
  const [videoHidden, setVideoHidden] = useState(false);
  const [activeMediaKind, setActiveMediaKind] = useState<"audio" | "youtube">("audio");
  // Declared here (not with the other recording state below) so the early media
  // subscriptions can list it as a dependency and re-bind when the take changes.
  const [activeRecId, setActiveRecId] = useState<string | null>(null);
  // The live YouTube player instance, mirrored into state so the recording
  // panel can bind its waveform playhead to it (video + paired audio).
  const [youtubeInstance, setYoutubeInstance] = useState<YouTubePlayer | null>(null);
  // Whether the active video recording has a paired audio file loaded (for the
  // waveform + auto-sync). Set to false whenever the active media changes.
  const [hasPairedAudio, setHasPairedAudio] = useState(false);
  // Guards the RecordingPlayer "loaded" reset when loading paired audio, so the
  // video's existing sync map and source selection are preserved.
  const loadingPairedAudioRef = useRef(false);
  function media(): MediaPlayer {
    return youtubeRef.current ?? recording;
  }
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [countInBars, setCountInBars] = useState(1);
  // Speed trainer: ramp the loop's tempo up as you succeed.
  const [rampOn, setRampOn] = useState(false);
  const [rampStart, setRampStart] = useState(60);
  const [rampStep, setRampStep] = useState(5);
  const [rampEvery, setRampEvery] = useState(2);
  const [rampTarget, setRampTarget] = useState(100);
  const rampCountRef = useRef(0);
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
  const [moreOpen, setMoreOpen] = useState(false);
  const editToolbarRef = useRef<HTMLDivElement | null>(null);
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
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  // Touch devices lack the hardware keys our hints reference; adapt wording.
  const [coarsePointer] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches,
  );
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);

  const noteInputModeRef = useRef(false);
  useEffect(() => {
    noteInputModeRef.current = noteInputMode;
  }, [noteInputMode]);

  // Close the toolbar's More / Score popovers on an outside click.
  useEffect(() => {
    if (!moreOpen && !scorePanelOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && !t.closest(".etb-more") && !t.closest(".etb-right")) {
        setMoreOpen(false);
        setScorePanelOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [moreOpen, scorePanelOpen]);

  const lastSelectionRef = useRef<EditSelection | null>(null);
  useEffect(() => {
    editModeRef.current = editMode;
    setAnnouncement(editMode ? "Edit mode on" : "Edit mode off");
    if (!editMode) {
      // Leaving edit mode: remember where the caret was so re-entering returns
      // there, then drop the live selection/highlight and any open popovers.
      lastSelectionRef.current = selectedV1Ref.current;
      setNoteInputMode(false);
      setSelectedV1(null);
      setMoreOpen(false);
      setScorePanelOpen(false);
      playerRef.current?.highlightSelection(null);
    } else if (lastSelectionRef.current) {
      // Re-entering edit: return to the last-edited spot.
      setSelectedV1(lastSelectionRef.current);
    }
    // Re-render so voice coloring turns on/off with edit mode.
    if (v1EditorRef.current) v1Rerender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  const [mediaPlaying, setMediaPlaying] = useState(false);
  useEffect(() => {
    const m = media();
    const unsubs = [
      m.on("stateChanged", (p) => {
        setMediaPlaying(p);
        setAnnouncement(p ? "Recording playing" : "Paused");
      }),
      m.on("speedChanged", (s) => setAnnouncement(`Speed ${Math.round(s * 100)} percent`)),
    ];
    setMediaPlaying(m.playing);
    return () => {
      for (const u of unsubs) u();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, activeMediaKind, activeRecId]);

  // Speed trainer: drop to the start tempo when enabled, then step the tempo up
  // every N loop repetitions until the target. A loop wrap is signalled by the
  // media player's "looped" event (recording/video) or by the synth player's
  // position jumping backward, so it works for whichever source you practise.
  useEffect(() => {
    if (!rampOn) return;
    rampCountRef.current = 0;
    setSynthSpeed(clampSpeed(rampStart / 100));
    const bump = () => {
      rampCountRef.current += 1;
      if (rampCountRef.current >= rampEvery) {
        rampCountRef.current = 0;
        const nextPct = Math.min(rampTarget, Math.round(speedRef.current * 100) + rampStep);
        setSynthSpeed(clampSpeed(nextPct / 100));
      }
    };
    const unsubMedia = media().on("looped", () => {
      if (preferredSourceRef.current === "recording") bump();
    });
    let lastT = -1;
    const unsubPlayer = playerRef.current?.on("positionChanged", (cur) => {
      if (preferredSourceRef.current === "synth" && lastT >= 0 && cur < lastT - 0.3) bump();
      lastT = cur;
    });
    return () => {
      unsubMedia();
      unsubPlayer?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rampOn, rampStart, rampStep, rampEvery, rampTarget, recording, activeMediaKind, activeRecId]);

  // Turning the trainer on implies looping the passage (otherwise it can never
  // step). Enable loop; the user still chooses the bar range.
  useEffect(() => {
    if (rampOn) setLoop(true);
  }, [rampOn]);

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
  const recordingsRef = useRef<RecordingMeta[]>([]);
  recordingsRef.current = recordings;
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
    const region = media().loopRegion;
    if (!region || !activeRecId) return;
    askText({
      label: "Loop name",
      initial: `Loop ${savedLoops.length + 1}`,
      submit: (name) => {
        if (!name.trim()) return;
        persistSavedLoops(activeRecId, [
          ...savedLoops,
          { id: newRecordingId(), name: name.trim(), start: region.start, end: region.end },
        ]);
      },
    });
  }

  function recallLoop(loop: SavedLoop) {
    media().setLoopRegion({ start: loop.start, end: loop.end });
    media().seek(loop.start);
  }

  function deleteSavedLoop(id: string) {
    if (!activeRecId) return;
    persistSavedLoops(activeRecId, savedLoops.filter((l) => l.id !== id));
  }
  const [syncPoints, setSyncPoints] = useState<SyncPoint[] | null>(null);
  const syncPointsRef = useRef<SyncPoint[] | null>(null);
  const [follow, setFollow] = useState(false);
  const followRef = useRef(false);
  const [tapCount, setTapCount] = useState<number | null>(null);
  // Per-bar tap times; null = skipped, to be interpolated from neighbours.
  const tapsRef = useRef<Array<number | null>>([]);
  // Persistence effects stay quiet until the stored session has been restored,
  // so the initial empty state does not overwrite it.
  const hydratedRef = useRef(false);

  useEffect(() => {
    syncPointsRef.current = syncPoints;
  }, [syncPoints]);
  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const player = new Player(container, {
      soundFontUrl,
      fontDirectory: `${import.meta.env.BASE_URL}alphatab/font/`,
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
      if (points) media().seek(mediaTimeAtTick(points, tick));
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
      w.__ovYouTube = () => youtubeRef.current;
      w.__ovAddYouTube = (url: string) => void addYouTubeRecording(url);
      // Test hook: install a linear sync map (bar i -> i * step seconds).
      w.__ovSetLinearSync = (step: number) => {
        const bars = playerRef.current?.barTicks ?? [];
        const points = bars.map((b, i) => ({ tick: b.start, timeSeconds: i * step }));
        setSyncPoints(points);
        setFollow(true);
      };
      w.__ovV1Editor = () => v1EditorRef.current;
      w.__ovSelectedV1 = () => selectedV1Ref.current?.noteId ?? selectedV1Ref.current?.restBeatId ?? null;
      w.__ovSelectV1 = (id: string) => setSelectedV1({ noteId: id });
      // Test hook: deterministically position the caret on any beat (note or
      // rest) by id, so e2e flows can move between beats without pixel clicks.
      w.__ovSelectBeat = (beatId: string) => {
        const beat = v1EditorRef.current?.findBeat(beatId)?.beat;
        if (beat) setSelectedV1(beat.notes[0] ? { noteId: beat.notes[0].id } : { restBeatId: beatId });
      };
      // Test hook: the current model exported to MusicXML (for round-trip checks).
      w.__ovExportMusicXml = () => (v1EditorRef.current ? v1.exportMusicXmlV1(v1EditorRef.current.doc) : null);
      // Dev hook: render any MusicXML through the full-fidelity v1 pipeline
      // (import -> v1 model -> alphaTab adapter), the Option C render path.
      w.__ovRenderV1 = (xml: string) => player.renderV1(v1.importMusicXmlV1(xml));
    }
    let disposed = false;
    void (async () => {
      // Deep link: ?bundle=<url> loads a specific .ovb (e.g. the promo's demo
      // piece), and &edit=1 opens it in edit mode. Falls through on failure.
      const qs = new URLSearchParams(window.location.search);
      const bundleUrl = qs.get("bundle");
      if (bundleUrl) {
        try {
          const resp = await fetch(bundleUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const bytes = new Uint8Array(await resp.arrayBuffer());
          if (disposed) return;
          await loadBundleBytes(bytes);
          if (qs.get("edit") === "1") setEditMode(true);
          return;
        } catch (error) {
          console.error("[openvoicing] failed to load ?bundle", error);
          // fall through to the stored/demo score below
        }
      }
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
        // Prove autosave by demonstration: the piece you left is back.
        showToast("Restored your last session");
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
    // Safari creates the context suspended; resume so the click is audible.
    if (ctx.state === "suspended") void ctx.resume();
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
      // Paired audio for a video: keep the video as the source and its sync map;
      // we only want the channels (for the waveform + auto-sync).
      if (loadingPairedAudioRef.current) {
        loadingPairedAudioRef.current = false;
        setHasPairedAudio(true);
        return;
      }
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
        if (meta.media?.kind === "youtube") {
          setActiveRecId(meta.id);
          setActiveMediaKind("youtube");
          setHasPairedAudio(false);
          applyPreferred("recording");
          await loadSavedLoops(meta.id);
          const sync = await storage.get<SyncPoint[]>(`sync:${meta.id}`);
          if (!cancelled && sync?.length) {
            setSyncPoints(sync);
            setFollow((await storage.get<boolean>("follow")) ?? true);
          }
          if (!cancelled && meta.media.audioPath) await loadPairedAudioFor(meta.id);
          return;
        }
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
        loop: media().loopRegion,
        position: media().position,
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
    media().pause();
    setActiveMediaKind("audio");
    setHasPairedAudio(false);
    await recording.load(buffer);
    void storage.set(`recording:${id}`, { name: file.name, data: copy } satisfies StoredFile);
    saveRecordingsList([...recordingsRef.current, { id, name: file.name }]);
    setActiveRecId(id);
    setSavedLoops([]);
  }

  // Attach a YouTube video as a recording (paste a URL or id). It plays the
  // video, synced to the score; sync it with tap-sync (Auto-sync needs audio).
  async function addYouTubeRecording(url: string) {
    const videoId = parseYouTubeId(url);
    if (!videoId) {
      window.alert("That does not look like a YouTube link.");
      return;
    }
    const id = newRecordingId();
    const meta: RecordingMeta = { id, name: `YouTube ${videoId}`, media: { kind: "youtube", videoId } };
    media().pause();
    saveRecordingsList([...recordingsRef.current, meta]);
    setSavedLoops([]);
    setSyncPoints(null);
    setFollow(false);
    setActiveRecId(id);
    setActiveMediaKind("youtube");
    setHasPairedAudio(false);
    applyPreferred("recording");
    showToast("YouTube video added. Tap-sync it, or attach audio for Auto-sync.");
  }

  // Attach an audio file to the active YouTube recording, for the waveform and
  // Auto-sync. Playback stays the video; the audio is decoded, not played.
  async function addPairedAudio(file: File) {
    const id = activeRecId;
    if (activeMediaKind !== "youtube" || !id) return;
    const buffer = await file.arrayBuffer();
    const copy = buffer.slice(0);
    loadingPairedAudioRef.current = true;
    await recording.load(buffer);
    void storage.set(`recording:${id}`, { name: file.name, data: copy } satisfies StoredFile);
    saveRecordingsList(
      recordingsRef.current.map((r) =>
        r.id === id && r.media?.kind === "youtube"
          ? { ...r, media: { ...r.media, audioPath: file.name } }
          : r,
      ),
    );
    showToast("Audio attached: waveform and Auto-sync are ready.");
  }

  // Load a video recording's paired audio (if it has one) into the Recording
  // player for the waveform + auto-sync, without changing the video source.
  async function loadPairedAudioFor(id: string): Promise<void> {
    const stored = await storage.get<StoredFile>(`recording:${id}`);
    if (!stored) {
      setHasPairedAudio(false);
      return;
    }
    loadingPairedAudioRef.current = true;
    await recording.load(stored.data);
  }

  async function selectRecording(id: string) {
    if (id === activeRecId) return;
    const meta = recordingsRef.current.find((r) => r.id === id);
    // Preserve position and play state so two takes A/B at the same spot.
    const wasPlaying = media().playing;
    const position = media().position;
    media().pause();
    if (meta?.media?.kind === "youtube") {
      // The video player is (re)created by the layout effect; hand it the spot
      // and play state to restore when it becomes ready.
      pendingResumeRef.current = { position, playing: wasPlaying };
      setActiveRecId(id);
      setActiveMediaKind("youtube");
      setHasPairedAudio(false);
      applyPreferred("recording");
      await loadSavedLoops(id);
      const sync = await storage.get<SyncPoint[]>(`sync:${id}`);
      setSyncPoints(sync?.length ? sync : null);
      setFollow(Boolean(sync?.length));
      if (meta.media.audioPath) await loadPairedAudioFor(id);
      return;
    }
    const stored = await storage.get<StoredFile>(`recording:${id}`);
    if (!stored) return;
    setActiveMediaKind("audio");
    setHasPairedAudio(false);
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
      media().pause();
      setActiveMediaKind("audio");
      applyPreferred("synth");
      setActiveRecId(null);
      setSyncPoints(null);
      setFollow(false);
    }
  }

  // Create/tear down the YouTube player for the active video recording. A
  // layout effect, so the player exists before the passive position/follow
  // subscriptions below (which bind to media()) run in the same commit.
  useLayoutEffect(() => {
    if (activeMediaKind !== "youtube") return;
    const host = videoHostRef.current;
    const meta = recordingsRef.current.find((r) => r.id === activeRecId);
    const m = meta?.media;
    if (!host || m?.kind !== "youtube") return;
    const yt = new YouTubePlayer(host, {
      videoId: m.videoId,
      startSeconds: m.startSeconds,
      endSeconds: m.endSeconds,
    });
    youtubeRef.current = yt;
    setYoutubeInstance(yt);
    void yt.whenReady().then(() => {
      yt.speed = speedRef.current;
      const resume = pendingResumeRef.current;
      pendingResumeRef.current = null;
      if (resume) {
        if (resume.position > 0) yt.seek(resume.position);
        if (resume.playing) void yt.play();
      }
    });
    return () => {
      yt.destroy();
      if (youtubeRef.current === yt) youtubeRef.current = null;
      setYoutubeInstance(null);
      host.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMediaKind, activeRecId]);

  // Mirror the active media's playhead into the shared position readout. Bound
  // to media() (audio take or video) and re-subscribed when the source changes.
  useEffect(() => {
    return media().on("positionChanged", (seconds, total) => {
      if (preferredSourceRef.current !== "recording") return;
      setPosition((prev) => {
        const next = { current: Math.floor(seconds), total: Math.floor(total) };
        return prev.current === next.current && prev.total === next.total ? prev : next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, activeMediaKind, activeRecId]);

  // When the user scrolls the notation by hand, auto-follow yields for a moment
  // so they can look elsewhere (e.g. read ahead) without being yanked back to
  // the playing bar. Follow resumes a few seconds after the last manual scroll.
  const lastUserScrollRef = useRef(0);
  const FOLLOW_YIELD_MS = 3000;
  useEffect(() => {
    const pane = containerRef.current?.parentElement;
    if (!pane) return;
    const mark = () => {
      lastUserScrollRef.current = performance.now();
      // Also stand alphaTab's own continuous scroll (synth) down for the window.
      playerRef.current?.setAutoScroll(false, FOLLOW_YIELD_MS);
    };
    pane.addEventListener("wheel", mark, { passive: true });
    pane.addEventListener("touchmove", mark, { passive: true });
    return () => {
      pane.removeEventListener("wheel", mark);
      pane.removeEventListener("touchmove", mark);
    };
  }, []);

  const lastScrollRef = useRef(0);
  useEffect(() => {
    if (!follow || !syncPoints) return;
    return media().on("positionChanged", (seconds) => {
      const player = playerRef.current;
      if (!player) return;
      const tick = Math.max(0, Math.round(tickAtMediaTime(syncPoints, seconds)));
      player.cursorTick = tick;
      // The synth is not playing during recording/video follow, so alphaTab's
      // own scroll-on-play never fires; keep the current bar in the pane.
      const now = performance.now();
      if (now - lastScrollRef.current > 250 && now - lastUserScrollRef.current > FOLLOW_YIELD_MS) {
        lastScrollRef.current = now;
        player.scrollBarIntoView(player.barIndexAtTick(tick));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, syncPoints, recording, activeMediaKind, activeRecId]);

  // A loop set on the waveform (drag, saved-loop recall, [ ] keys) flows into
  // the shared loop state, which then brackets the bars and mirrors to the
  // synth. Ignore the echo from our own apply-effect.
  useEffect(() => {
    return media().on("loopChanged", (region) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, activeMediaKind, activeRecId]);

  useEffect(() => {
    if (!syncedClick || !barTimesRef.current) return;
    lastClickBarRef.current = -1;
    return media().on("positionChanged", (seconds) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedClick, recording, activeMediaKind, activeRecId]);

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
    const wasPlaying = media().playing || player.playing;
    if (target === "synth") {
      const tick = points ? Math.round(tickAtMediaTime(points, media().position)) : player.cursorTick;
      media().pause();
      applyPreferred("synth");
      if (wasPlaying) player.playFromTick(Math.max(0, tick));
      else player.cursorTick = Math.max(0, tick);
      setAnnouncement("Playing the written notes");
    } else {
      const tick = player.cursorTick;
      const time = points ? mediaTimeAtTick(points, tick) : 0;
      player.stop();
      applyPreferred("recording");
      media().seek(time);
      if (wasPlaying) void media().play();
      setAnnouncement(activeMediaKind === "youtube" ? "Playing the video" : "Playing the performance");
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
    const now = media().position;
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
    commitSync(clampSyncMove(points, best, now));
    showToast(`Sync point for bar ${best + 1} set to ${now.toFixed(2)}s.`);
  }

  // The existing sync map stays until Done replaces it, so Cancel loses nothing.
  function startTapSync() {
    tapsRef.current = [];
    setTapCount(0);
    media().seek(0);
    void media().play();
  }

  function tap() {
    const player = playerRef.current;
    if (!player || tapsRef.current.length >= barCount) return;
    tapsRef.current.push(media().position);
    if (tapsRef.current.length >= barCount) finishTapSync();
    else setTapCount(tapsRef.current.length);
  }

  // Advance the bar pointer without recording a tap; its time is interpolated.
  function skipTap() {
    if (tapsRef.current.length >= barCount) return;
    tapsRef.current.push(null);
    if (tapsRef.current.length >= barCount) finishTapSync();
    else setTapCount(tapsRef.current.length);
  }

  function finishTapSync() {
    const player = playerRef.current;
    media().pause();
    setTapCount(null);
    if (!player) return;
    const bars = player.barTicks;
    const taps = tapsRef.current;
    const anchors = taps
      .map((t, i) => ({ i, t }))
      .filter((a): a is { i: number; t: number } => a.t != null);
    if (anchors.length < 2) return;
    // Interpolate every bar's time by its tick position between the surrounding
    // tapped anchors (flat-extrapolate before the first / after the last).
    const points: SyncPoint[] = [];
    for (let i = 0; i < taps.length; i++) {
      let timeSeconds: number;
      if (taps[i] != null) {
        timeSeconds = taps[i]!;
      } else {
        const prev = [...anchors].reverse().find((a) => a.i < i);
        const next = anchors.find((a) => a.i > i);
        if (prev && next) {
          const tickI = bars[i]!.start;
          const tickP = bars[prev.i]!.start;
          const tickN = bars[next.i]!.start;
          const frac = tickN === tickP ? 0 : (tickI - tickP) / (tickN - tickP);
          timeSeconds = prev.t + (next.t - prev.t) * frac;
        } else if (prev) timeSeconds = prev.t;
        else if (next) timeSeconds = next.t;
        else continue;
      }
      points.push({ tick: bars[i]!.start, timeSeconds });
    }
    commitSync(points);
    setFollow(true);
  }

  function cancelTapSync() {
    media().pause();
    setTapCount(null);
  }

  function undoTap() {
    tapsRef.current.pop();
    setTapCount(tapsRef.current.length);
  }

  function clampSyncMove(points: SyncPoint[], index: number, timeSeconds: number): SyncPoint[] {
    // Bound against whatever is actually playing (the video for a YouTube take);
    // recording.duration is 0 for a video with no paired audio.
    return clampSyncMovePure(points, index, timeSeconds, media().duration);
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
  // Per-bar fix: pin one bar's anchor to the current playhead.
  function setSyncPointToPlayhead(index: number) {
    const points = syncPointsRef.current;
    if (!points || !points[index]) return;
    commitSync(clampSyncMove(points, index, media().position));
  }
  // Per-bar fix: recompute one bar's anchor from its two neighbours' times.
  function reinterpolateSyncPoint(index: number) {
    const points = syncPointsRef.current;
    const player = playerRef.current;
    if (!points || !player || index <= 0 || index >= points.length - 1) return;
    const bars = player.barTicks;
    const tickP = bars[index - 1]!.start;
    const tickI = bars[index]!.start;
    const tickN = bars[index + 1]!.start;
    const frac = tickN === tickP ? 0 : (tickI - tickP) / (tickN - tickP);
    const timeSeconds =
      points[index - 1]!.timeSeconds +
      (points[index + 1]!.timeSeconds - points[index - 1]!.timeSeconds) * frac;
    commitSync(clampSyncMove(points, index, timeSeconds));
  }

  const syncConfidence = useMemo(() => computeSyncConfidence(syncPoints), [syncPoints]);
  const flaggedCount = useMemo(
    () => (syncConfidence ? syncConfidence.filter((c) => c !== "good").length : 0),
    [syncConfidence],
  );
  // Auto-sync needs decoded audio: always present for an audio take, only when a
  // video has paired audio attached.
  const canAutoSync = activeMediaKind === "audio" || hasPairedAudio;

  // Seek to (and focus) the next bar whose sync looks off, wrapping around.
  function jumpToNextFlagged() {
    const conf = syncConfidence;
    const points = syncPointsRef.current;
    if (!conf || !points) return;
    const flagged = points.map((_, i) => i).filter((i) => conf[i] !== "good");
    if (flagged.length === 0) return;
    const now = media().position;
    const next = flagged.find((i) => points[i]!.timeSeconds > now + 0.05) ?? flagged[0]!;
    media().seek(points[next]!.timeSeconds);
    const marker = document.querySelector<HTMLElement>(`.sync-marker[data-index="${next}"]`);
    marker?.focus();
  }

  // Seek the active source to a fraction of the piece, so the transport's
  // position readout doubles as a scrubber (no need to open the media panel).
  function seekToFraction(fraction: number) {
    const total = position.total;
    if (!total) return;
    const t = Math.max(0, Math.min(total, fraction * total));
    if (preferredSourceRef.current === "recording" && activeRecIdRef.current !== null) {
      media().seek(t);
    } else {
      playerRef.current?.seekSeconds(t);
    }
  }
  function onScrubPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const at = (clientX: number) => seekToFraction((clientX - rect.left) / rect.width);
    track.setPointerCapture(e.pointerId);
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => {
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", up);
    };
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up);
  }

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
      if (media().playing) media().pause();
      else startWithCountIn(() => void media().play());
    } else {
      media().pause();
      synthPlayPause();
    }
  };

  function transportStop() {
    media().pause();
    media().seek(0);
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

  // The wordmark is a "home" escape hatch (hallway test C16): return to the
  // clean default view of the current piece. Non-destructive; edits are
  // autosaved, so this only exits edit mode and closes transient UI.
  function goHome() {
    setEditMode(false);
    setNoteInputMode(false);
    setMoreOpen(false);
    setScorePanelOpen(false);
    const pane = document.querySelector<HTMLElement>(".score-surface")?.parentElement;
    pane?.scrollTo?.({ top: 0, left: 0 });
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
  // Beats per bar at the current position, from the score's time signature.
  function beatsPerBar(): number {
    const ed = v1EditorRef.current;
    const player = playerRef.current;
    if (!ed || !player) return 4;
    const barIndex = player.barIndexAtTick(player.cursorTick);
    // The v1 time signature lives on Measure.attributes.time (not on the bar) and
    // carries forward until the next change, so scan up to this bar for the meter
    // in force. Reading bar.timeSignature always missed and fell back to 4.
    const measures = ed.doc.parts[0]?.measures ?? [];
    let beats = 4;
    for (let i = 0; i <= barIndex && i < measures.length; i++) {
      const b = measures[i]?.attributes?.time?.beats;
      if (b) beats = b;
    }
    return beats;
  }

  // A count-in that matches the meter (beats per bar x count-in bars), runs at
  // the current practice tempo (so it slows with the music), and precedes
  // whichever source you're about to play. Then runs `play`.
  function startWithCountIn(play: () => void) {
    const player = playerRef.current;
    if (!countIn || !player) {
      play();
      return;
    }
    const beatMs = ((60 / player.tempoBpm) * 1000) / (speedRef.current || 1);
    let n = beatsPerBar() * countInBars;
    setCountInNumber(n);
    playClick(true);
    const step = () => {
      n -= 1;
      if (n <= 0) {
        setCountInNumber(null);
        play();
        return;
      }
      setCountInNumber(n);
      // Accent each bar's downbeat.
      playClick(n % beatsPerBar() === 0);
      window.setTimeout(step, beatMs);
    };
    window.setTimeout(step, beatMs);
  }

  function synthPlayPause() {
    const player = playerRef.current;
    if (!player) return;
    if (player.playing) {
      player.playPause();
      return;
    }
    startWithCountIn(() => player.playPause());
  }

  const speedRef = useRef(1);
  // The single practice-tempo control drives whichever source is heard, so the
  // slowdown carries across an A/B switch between synth and recording.
  function setSynthSpeed(value: number) {
    if (playerRef.current) playerRef.current.speed = value;
    media().speed = value;
    // YouTube only offers discrete rates, so show what it actually plays.
    const shown = activeMediaKind === "youtube" ? media().speed : value;
    speedRef.current = shown;
    setSpeed(shown);
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
  const pendingLoopBarRef = useRef<number | null>(null);
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
        case "KeyG": {
          if (editModeRef.current) return;
          e.preventDefault();
          document.querySelector<HTMLInputElement>(".navigate input")?.focus();
          return;
        }
        case "Home": {
          if (editModeRef.current) return;
          e.preventDefault();
          jumpToBarIndex(0);
          return;
        }
        case "PageUp":
        case "PageDown": {
          if (editModeRef.current || sortedSectionsRef.current.length === 0) return;
          e.preventDefault();
          stepSectionRef.current(e.code === "PageUp" ? -1 : 1);
          return;
        }
        case "Minus":
        case "Equal": {
          e.preventDefault();
          const base = e.shiftKey ? 0.25 : 0.05;
          const delta = e.code === "Minus" ? -base : base;
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
          e.preventDefault();
          if (onRecording && preferredSourceRef.current === "recording") {
            pendingLoopStartRef.current = media().position;
          } else {
            const player = playerRef.current;
            if (player) pendingLoopBarRef.current = player.barIndexAtTick(player.cursorTick);
          }
          return;
        }
        case "BracketRight": {
          e.preventDefault();
          const player = playerRef.current;
          if (onRecording && preferredSourceRef.current === "recording") {
            const start = pendingLoopStartRef.current ?? 0;
            const end = media().position;
            if (end > start + 0.1) {
              media().setLoopRegion({ start, end });
              pendingLoopStartRef.current = null;
            }
          } else if (player) {
            // Synth source: loop the bar range between the two cursor marks.
            const from = (pendingLoopBarRef.current ?? player.barIndexAtTick(player.cursorTick)) + 1;
            const to = player.barIndexAtTick(player.cursorTick) + 1;
            const lo = Math.min(from, to);
            const hi = Math.max(from, to);
            setBarsInput(`${lo}-${hi}`);
            setLoopBars({ from: lo, to: hi });
            setLoop(true);
            pendingLoopBarRef.current = null;
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
      // Number keys recall named passages (bar ranges), for any source; outside
      // edit mode, where the digits set note durations instead.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && !editModeRef.current) {
        const passage = passagesRef.current[Number(digit[1]) - 1];
        if (passage) {
          e.preventDefault();
          applyBarRange(passage.fromBar, passage.toBar);
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
  const [loopFrom, setLoopFrom] = useState(1);
  const [loopTo, setLoopTo] = useState(1);
  // Set while we push the loop onto the recording, so its loopChanged echo is
  // not mistaken for a fresh user drag.
  const applyingLoopRef = useRef(false);

  function toggleLoop() {
    setLoop((v) => !v);
  }

  // Loop an explicit bar range from the from/to steppers (no text parsing).
  function applyBarRange(fromRaw: number, toRaw: number) {
    const player = playerRef.current;
    if (!player || player.barTicks.length === 0) return;
    const n = player.barTicks.length;
    const from = Math.max(1, Math.min(n, Math.min(fromRaw, toRaw)));
    const to = Math.max(from, Math.min(n, Math.max(fromRaw, toRaw)));
    setLoopFrom(from);
    setLoopTo(to);
    setBarsInput(`${from}-${to}`);
    setLoopBars({ from, to });
    setLoop(true);
    player.cursorTick = player.barTicks[from - 1]!.start;
    player.scrollBarIntoView(from - 1);
  }

  // Save the current bar-range loop as a named passage on the piece. Because it
  // is stored as bars, one list drives the synth and every recording (converted
  // to seconds per take by the loop-apply effect at recall).
  function saveCurrentPassage() {
    if (!loopBars) return;
    const { from, to } = loopBars;
    askText({
      label: "Passage name",
      initial: `Bars ${from}–${to}`,
      submit: (name) => {
        if (!name.trim()) return;
        setPassages((ps) => [...ps, { id: newRecordingId(), name: name.trim(), fromBar: from, toBar: to }]);
      },
    });
  }
  function recallPassage(p: BundlePassage) {
    applyBarRange(p.fromBar, p.toBar);
  }
  function deletePassage(id: string) {
    setPassages((ps) => ps.filter((p) => p.id !== id));
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
        media().setLoopRegion({
          start: mediaTimeAtTick(sp, region.startTick),
          end: mediaTimeAtTick(sp, region.endTick),
        });
      } else if (loop && !loopBars && media().duration > 0) {
        media().setLoopRegion({ start: 0, end: media().duration });
      } else {
        media().setLoopRegion(null);
      }
      applyingLoopRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop, loopBars, activeRecId, syncPoints, barCount, recording, activeMediaKind]);

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
    const manifestRecordings: BundleRecording[] = [];
    for (const meta of recordings) {
      const sync =
        meta.id === activeRecId
          ? syncPoints
          : ((await storage.get<SyncPoint[]>(`sync:${meta.id}`)) ?? null);
      const loops =
        meta.id === activeRecId
          ? savedLoops
          : ((await storage.get<SavedLoop[]>(`loops:${meta.id}`)) ?? []);
      const syncLoops = {
        ...(sync?.length ? { syncPoints: sync } : {}),
        ...(loops.length ? { loops } : {}),
      };
      // A YouTube recording references a video; pack its paired audio (if any),
      // rewriting audioPath from a marker to a real archive path.
      if (meta.media?.kind === "youtube") {
        let ytMedia: RecordingMedia = { ...meta.media, audioPath: undefined };
        if (meta.media.audioPath) {
          const rec = await storage.get<StoredFile>(`recording:${meta.id}`);
          if (rec) {
            const audioPath = `recordings/${meta.id}/${sanitizeName(rec.name)}`;
            files.set(audioPath, new Uint8Array(rec.data));
            ytMedia = { ...meta.media, audioPath };
          }
        }
        manifestRecordings.push({ id: meta.id, name: meta.name, media: ytMedia, ...syncLoops });
        continue;
      }
      const rec = await storage.get<StoredFile>(`recording:${meta.id}`);
      if (!rec) continue;
      const recPath = `recordings/${meta.id}/${sanitizeName(rec.name)}`;
      files.set(recPath, new Uint8Array(rec.data));
      manifestRecordings.push({
        id: meta.id,
        name: rec.name,
        media: { kind: "audio", path: recPath },
        ...syncLoops,
      });
    }
    return createBundle({
      manifest: {
        format: BUNDLE_FORMAT,
        formatVersion: BUNDLE_FORMAT_VERSION,
        title: scoreTitle || "Untitled",
        ...(scoreArtist ? { attribution: { artist: scoreArtist } } : {}),
        ...(assignment ? { assignment } : {}),
        ...(sections.length ? { sections } : {}),
        ...(notebook.trim() ? { notebook } : {}),
        ...(passages.length ? { passages } : {}),
        score: { path: scorePath, type: source.type },
        recordings: manifestRecordings,
      },
      files,
    });
  }

  async function exportBundle() {
    const bytes = await buildBundleBytes();
    if (!bytes) return;
    downloadBlob(new Blob([bytes as BlobPart], { type: "application/zip" }), "ovb");
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

  function openFromUrl() {
    askText({
      label: "Bundle or MusicXML URL",
      placeholder: "https://…/piece.ovb",
      submit: (url) => {
        if (url.trim()) void loadFromUrl(url.trim());
      },
    });
  }
  async function loadFromUrl(url: string) {
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
      // The section map + practice notebook travel with the piece.
      const importedSections = manifest.sections ?? [];
      setSections(importedSections);
      void storage.set("sections", importedSections);
      setNotebook(manifest.notebook ?? "");
      const importedPassages = manifest.passages ?? [];
      setPassages(importedPassages);
      void storage.set("passages", importedPassages);

      // Opening a bundle replaces the session's recordings. Clear all three
      // per-recording keys (matching removeRecording) so saved loops are not
      // orphaned in storage.
      for (const meta of recordings) {
        void storage.delete(`recording:${meta.id}`);
        void storage.delete(`sync:${meta.id}`);
        void storage.delete(`loops:${meta.id}`);
      }

      const list: RecordingMeta[] = [];
      let firstEntry: BundleRecording | null = null;
      let firstId: string | null = null;
      for (const entry of manifest.recordings) {
        const id = list.some((r) => r.id === entry.id) ? newRecordingId() : entry.id;
        if (entry.media.kind === "youtube") {
          // Unpack paired audio (if any) to storage and keep a marker on the meta.
          let media: RecordingMedia = { ...entry.media, audioPath: undefined };
          const audioBytes = entry.media.audioPath && bundle.files.get(entry.media.audioPath);
          if (entry.media.audioPath && audioBytes) {
            const fileName = entry.media.audioPath.split("/").pop() ?? "audio";
            void storage.set(`recording:${id}`, {
              name: fileName,
              data: audioBytes.slice().buffer as ArrayBuffer,
            } satisfies StoredFile);
            media = { ...entry.media, audioPath: fileName };
          }
          list.push({ id, name: entry.name, media });
        } else {
          const audioPath = recordingAudioPath(entry.media);
          if (!audioPath) continue;
          const bytes = bundle.files.get(audioPath)!;
          void storage.set(`recording:${id}`, {
            name: entry.name,
            data: bytes.slice().buffer as ArrayBuffer,
          } satisfies StoredFile);
          list.push({ id, name: entry.name });
        }
        if (entry.syncPoints?.length) void storage.set(`sync:${id}`, entry.syncPoints);
        else void storage.delete(`sync:${id}`);
        if (entry.loops?.length) void storage.set(`loops:${id}`, entry.loops);
        else void storage.delete(`loops:${id}`);
        if (!firstEntry) {
          firstEntry = entry;
          firstId = id;
        }
      }
      saveRecordingsList(list);

      media().pause();
      if (firstEntry && firstId) {
        setActiveRecId(firstId);
        setSavedLoops(firstEntry.loops ?? []);
        if (firstEntry.media.kind === "youtube") {
          setActiveMediaKind("youtube");
          setHasPairedAudio(false);
          applyPreferred("recording");
          if (firstEntry.media.audioPath) await loadPairedAudioFor(firstId);
        } else {
          setActiveMediaKind("audio");
          const bytes = bundle.files.get(recordingAudioPath(firstEntry.media)!)!;
          await recording.load(bytes.slice().buffer as ArrayBuffer);
        }
        if (firstEntry.syncPoints?.length) {
          setSyncPoints(firstEntry.syncPoints);
          setFollow(true);
        } else {
          setSyncPoints(null);
          setFollow(false);
        }
      } else {
        setActiveMediaKind("audio");
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
      setSaveState("saving");
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
      void storage.set("score", { name: "score.musicxml", type: "musicxml", data }).then(() => setSaveState("saved"));
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
    if (ed && noteId && ed.deleteNote(noteId)) {
      v1Rerender();
      // Reassure on scope + reversibility (hallway test: users feared the
      // trash wiped the whole piece with no undo).
      showToast("Note cleared to a rest", () => v1Undo());
    }
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

    // Chord entry (lead sheets): a symbol + optional fingering diagram.
    if (e.code === "KeyK" && beatId) {
      e.preventDefault();
      editChord(beatId);
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
        setAnnouncement(sel ? "This is a rest; type A-G to make it a note" : "Click a note to select it first");
        return;
      }
      if (e.code === "ArrowUp") {
        if (ed.transposeNote(sel.noteId, e.shiftKey ? 12 : 1)) v1Rerender();
      } else if (e.code === "ArrowDown") {
        if (ed.transposeNote(sel.noteId, e.shiftKey ? -12 : -1)) v1Rerender();
      } else if (ed.deleteNote(sel.noteId)) {
        v1Rerender();
        showToast("Note cleared to a rest", () => v1Undo());
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
    askText({
      label: "Title",
      initial: ed.doc.work.title,
      submit: (title) => {
        askText({
          label: "Composer",
          initial: ed.doc.work.composer ?? "",
          submit: (composer) => {
            if (ed.setWork({ title, composer: composer || undefined })) {
              v1Rerender();
              setScoreTitle(title);
              setScoreArtist(composer ?? "");
            }
          },
        });
      },
    });
  }
  function v1EditTempo() {
    const ed = v1EditorRef.current;
    if (!ed) return;
    const bar = v1SelectedBarIndex();
    askText({
      label: "Tempo (bpm)",
      initial: String(ed.doc.bars[bar]?.tempoBpm ?? 120),
      placeholder: "120",
      submit: (value) => {
        if (ed.setTempo(bar, Number(value) || null)) v1Rerender();
      },
    });
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
  const toolbarTier = useToolbarTier(editToolbarRef, editMode && hasV1Editor);

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
    // One findNote for the selected note, reused below (was scanned twice).
    const noteLoc = selectedV1.noteId ? ed.findNote(selectedV1.noteId) : undefined;
    const beatId = noteLoc?.beat.id ?? selectedV1.restBeatId;
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
      const note = noteLoc?.note;
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
    const b = v1SelectedBeatId();
    if (b) editChord(b);
  };
  function editChord(beatId: string) {
    const ed = v1EditorRef.current;
    if (!ed) return;
    const beat = ed.findBeat(beatId)?.beat;
    setChordEdit({ beatId, symbol: beat?.chordSymbol ?? "", diagram: beat?.chordDiagram ?? null });
  }
  function saveChord() {
    const ed = v1EditorRef.current;
    const c = chordEdit;
    if (!ed || !c) return;
    ed.setChordSymbol(c.beatId, c.symbol || null);
    ed.setChordDiagram(c.beatId, c.diagram);
    v1Rerender();
    setChordEdit(null);
  }
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

  // The editing toolbar as a fixed-grammar list of atomic groups with a
  // priority+ overflow: pinned groups (history/mode/voice/value/pitch) always
  // show; the rest collapse into a "More" menu in tier order as width shrinks.
  function renderEditToolbar(): ReactNode {
    const note = v1Sel.kind === "note";
    const noteOrRest = v1Sel.kind !== "none";

    const historyGroup = (
      <div className="etb-group" role="group" aria-label="History" key="history">
        <button className="etb-btn" onClick={v1Undo} disabled={!v1EditorRef.current?.canUndo} title="Undo (Cmd+Z)" aria-label="Undo">↶</button>
        <button className="etb-btn" onClick={v1Redo} disabled={!v1EditorRef.current?.canRedo} title="Redo (Shift+Cmd+Z)" aria-label="Redo">↷</button>
        <button className="etb-btn" onClick={v1Delete} disabled={!note} title="Delete note: clears the selected note to a rest (Del; undo with Cmd+Z)" aria-label="Delete note"><TrashIcon /></button>
      </div>
    );
    const modeGroup = (
      <div className="etb-group" role="group" aria-label="Input mode" key="mode">
        <button className={"etb-btn wide" + (noteInputMode ? " active" : "")} aria-pressed={noteInputMode} title="Note-input mode (N): notes advance as you type" onClick={() => setNoteInputMode((m) => !m)}>
          {noteInputMode ? "✎ Input" : "Select"}
        </button>
      </div>
    );
    const voiceGroup = v1Sel.voiceCount > 1 && (
      <div className="etb-group" role="group" aria-label="Voice" key="voice">
        <span className="etb-label">Voice</span>
        {Array.from({ length: v1Sel.voiceCount }, (_, i) => (
          <button key={i} className={"etb-btn voice-pill v" + (i + 1) + (v1Sel.voiceIndex === i ? " active" : "")} aria-pressed={v1Sel.voiceIndex === i} aria-label={`Voice ${i + 1}`} title={`Select voice ${i + 1} (v cycles)`} onClick={() => v1SelectVoice(i)}>
            {i + 1}
          </button>
        ))}
      </div>
    );
    const valueGroup = noteOrRest && (
      <div className="etb-group" role="group" aria-label="Note value" key="value">
        <span className="etb-label">Value</span>
        {DURATION_PALETTE.map((d) => (
          <button key={d.type} className={"etb-btn etb-note" + (v1Sel.noteType === d.type ? " active" : "")} aria-pressed={v1Sel.noteType === d.type} aria-label={`${d.label} (${d.key})`} title={`${d.label} (key ${d.key})`} onClick={() => v1SetDurationType(d.type)}>
            <span className="note-glyph" aria-hidden="true">{d.glyph}</span>
            <span className="keycap" aria-hidden="true">{d.key}</span>
          </button>
        ))}
        <button className={"etb-btn" + (v1Sel.dotted ? " active" : "")} aria-pressed={v1Sel.dotted} aria-label="Dotted" title="Dotted (.)" onClick={v1ToggleDotBtn}>・</button>
      </div>
    );
    const pitchGroup = noteOrRest && !v1Sel.tab && (
      <div className="etb-group" role="group" aria-label="Pitch" key="pitch">
        <span className="etb-label">Pitch</span>
        {(["C", "D", "E", "F", "G", "A", "B"] as v1.NoteStep[]).map((s) => (
          <button key={s} className="etb-btn etb-note" aria-label={`Pitch ${s}`} title={`Pitch ${s} (${s.toLowerCase()})`} onClick={() => v1SetPitchLetter(s)}>{s}<span className="keycap" aria-hidden="true">{s.toLowerCase()}</span></button>
        ))}
      </div>
    );
    const fretGroup = note && v1Sel.tab && (
      <div className="etb-group" role="group" aria-label="Fret" key="fret">
        <span className="etb-label">Fret</span>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((f) => (
          <button key={f} className="etb-btn" aria-label={`Fret ${f}`} title={`Fret ${f}`} onClick={() => v1SetFretBtn(f)}>{f}</button>
        ))}
      </div>
    );
    const accidentalGroup = (
      <div className="etb-group" role="group" aria-label="Accidental and octave" key="accidental">
        <span className="etb-label">Accidental</span>
        <button className="etb-btn" aria-label="Flat" title="Flat (−)" onClick={() => v1SetAlter(-1)}>♭</button>
        <button className="etb-btn" aria-label="Natural" title="Natural" onClick={() => v1SetAlter(0)}>♮</button>
        <button className="etb-btn" aria-label="Sharp" title="Sharp (+)" onClick={() => v1SetAlter(1)}>♯</button>
        <button className="etb-btn" aria-label="Octave up" title="Octave up (Shift+Up)" onClick={() => v1Transpose(12)}>8va</button>
        <button className="etb-btn" aria-label="Octave down" title="Octave down (Shift+Down)" onClick={() => v1Transpose(-12)}>8vb</button>
      </div>
    );
    const marksGroup = (
      <div className="etb-group" role="group" aria-label="Articulations and slurs" key="marks">
        <span className="etb-label">Marks</span>
        {MARK_PALETTE.map((m) => (
          <button key={m.type} className={"etb-btn" + (v1Sel.marks.has(m.type) ? " active" : "")} aria-pressed={v1Sel.marks.has(m.type)} aria-label={m.label} title={m.label} onClick={() => v1Articulate(m.type)}>{m.glyph}</button>
        ))}
        <button className={"etb-btn wide" + (v1Sel.marks.has("fermata") ? " active" : "")} aria-pressed={v1Sel.marks.has("fermata")} aria-label="Fermata" title="Fermata" onClick={v1Fermata}>Hold</button>
        <button className={"etb-btn" + (v1Sel.marks.has("tie") ? " active" : "")} aria-pressed={v1Sel.marks.has("tie")} aria-label="Tie" title="Tie (t)" onClick={v1Tie}>‿</button>
        <button className={"etb-btn" + (v1Sel.marks.has("slur") ? " active" : "")} aria-pressed={v1Sel.marks.has("slur")} aria-label="Slur" title="Slur (s)" onClick={v1Slur}>⌒</button>
      </div>
    );
    const ornamentsGroup = (
      <div className="etb-group" role="group" aria-label="Ornaments and grace" key="ornaments">
        <span className="etb-label">Orn</span>
        <button className={"etb-btn wide" + (v1Sel.marks.has("trill-mark") ? " active" : "")} aria-pressed={v1Sel.marks.has("trill-mark")} aria-label="Trill" title="Trill" onClick={() => v1Ornament("trill-mark")}>tr</button>
        <button className={"etb-btn wide" + (v1Sel.marks.has("mordent") ? " active" : "")} aria-pressed={v1Sel.marks.has("mordent")} aria-label="Mordent" title="Mordent" onClick={() => v1Ornament("mordent")}>Mord</button>
        <button className={"etb-btn wide" + (v1Sel.marks.has("turn") ? " active" : "")} aria-pressed={v1Sel.marks.has("turn")} aria-label="Turn" title="Turn" onClick={() => v1Ornament("turn")}>Turn</button>
        <button className={"etb-btn wide" + (v1Sel.marks.has("grace") ? " active" : "")} aria-label="Add grace note" title="Grace note before this beat (/)" onClick={v1AddGrace}>Grace</button>
      </div>
    );
    const dynamicsGroup = (
      <div className="etb-group" role="group" aria-label="Dynamics and chord" key="dynamics">
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
    );

    // Overflow-eligible groups collapse into "More" in this tier order (highest
    // minTier collapses first): ornaments/dynamics, then marks, then accidental.
    const eligible: Array<{ minTier: number; node: ReactNode; label: string }> = [];
    if (note && !v1Sel.tab)
      eligible.push({ minTier: 1, node: accidentalGroup, label: "Pitch & accidentals" });
    if (note) eligible.push({ minTier: 2, node: marksGroup, label: "Articulation" });
    if (note) eligible.push({ minTier: 3, node: ornamentsGroup, label: "Ornaments" });
    if (note) eligible.push({ minTier: 3, node: dynamicsGroup, label: "Dynamics & harmony" });
    const inline = eligible.filter((g) => toolbarTier >= g.minTier).map((g) => g.node);
    const overflowItems = eligible.filter((g) => toolbarTier < g.minTier);

    const scoreGroup = (
      <div className="etb-group etb-right" role="group" aria-label="Score settings" key="score">
        <button className={"etb-btn wide" + (scorePanelOpen ? " active" : "")} aria-expanded={scorePanelOpen} aria-haspopup="dialog" title="Bars, time, key, tempo, title" onClick={() => setScorePanelOpen((o) => !o)}>⚙ Score</button>
        {scorePanelOpen && (
          <div className="etb-popover etb-sheet" role="dialog" aria-label="Score settings">
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
    );

    return (
      <div className="edit-toolbar" role="toolbar" aria-label="Editing tools" ref={editToolbarRef}>
        <div className="etb-pinned">
          {historyGroup}
          {modeGroup}
          {voiceGroup}
          {valueGroup}
          {pitchGroup}
          {fretGroup}
        </div>
        {inline}
        <div className="etb-trailing">
          {overflowItems.length > 0 && (
            <div className="etb-group etb-more" role="group" aria-label="More">
              <button className={"etb-btn wide" + (moreOpen ? " active" : "")} aria-expanded={moreOpen} aria-haspopup="menu" aria-label={`More editing tools (${overflowItems.length} groups)`} title="More editing tools" onClick={() => setMoreOpen((o) => !o)}>
                More ▾
              </button>
              {moreOpen && (
                <div className="etb-popover etb-more-popover etb-sheet" role="menu" aria-label="More editing tools">
                  {overflowItems.map((g) => (
                    <div className="etb-more-section" key={g.label}>
                      <span className="menu-heading">{g.label}</span>
                      {g.node}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {scoreGroup}
        </div>
      </div>
    );
  }

  // Every action, for the command palette (Cmd-K) and, where sensible, menus.
  const commands: Command[] = [
    { id: "play", label: playing || mediaPlaying ? "Pause" : "Play", group: "Transport", shortcut: "Space", run: () => togglePlayRef.current() },
    { id: "stop", label: "Stop", group: "Transport", run: () => playerRef.current?.stop(), enabled: ready },
    { id: "half", label: "Toggle half speed", group: "Transport", shortcut: "H", run: () => setSynthSpeed(speedRef.current === 0.5 ? 1 : 0.5) },
    { id: "loop", label: loop ? "Turn loop off" : "Turn loop on", group: "Transport", run: toggleLoop },
    { id: "metro", label: metronome ? "Metronome off" : "Metronome on", group: "Practice", run: toggleMetronome },
    { id: "countin", label: countIn ? "Count-in off" : "Count-in on", group: "Practice", run: toggleCountIn },
    { id: "addsection", label: "Add section here", group: "Navigate", run: addSection, enabled: !locked },
    { id: "record", label: micRecording ? "Stop recording my take" : "Record my take", group: "Capture", run: () => void toggleMicRecording() },
    { id: "ab", label: "A/B notes and performance", group: "Capture", shortcut: "V", run: toggleSynthRecording, enabled: activeRecId !== null },
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
    { id: "advanced", label: advanced ? "Switch to Listen view" : "Switch to Practice view", group: "View", run: () => setMode(advanced ? "basic" : "advanced") },
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
    { label: "Practice notebook…", onSelect: () => setNotebookOpen(true) },
    { divider: true },
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

  const isPlaying = playing || mediaPlaying;

  return (
    <div className={`app${advanced ? " advanced" : ""}${standMode ? " stand-mode" : ""}${closed ? " closed" : ""}${noteInputMode ? " note-input" : ""}`}>
      <header className="header" role="banner">
        <h1><button type="button" className="wordmark-home" onClick={goHome} title="Back to the start (exit edit mode and return to the clean view)">OpenVoicing</button></h1>
        {scoreTitle && <span className="tagline">{scoreTitle}</span>}
        {hasV1Editor && (
          <span className={"save-status" + (saveState === "saving" ? " saving" : "")} aria-live="polite" title="Your work is saved automatically in this browser.">
            {saveState === "saving" ? "Saving…" : "All changes saved"}
          </span>
        )}
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
          <span className="menubar-full">
            {!locked && <Menu label="File" icon={<FileIcon />} items={fileMenu} />}
            <Menu label="View" icon={<ViewIcon />} items={viewMenu} />
            {!locked && <Menu label="Share" icon={<ShareIcon />} items={shareMenu} />}
            <Menu label="Help" icon={<HelpIcon />} items={helpMenu} />
          </span>
          {/* On phones the four labels don't fit and bare icons are unguessable,
              so collapse them into one labeled "Menu" (a conventional hamburger). */}
          <span className="menubar-compact">
            <Menu
              label="Menu"
              items={[
                ...(!locked ? [{ label: "File", heading: true }, ...fileMenu] : []),
                { label: "View", heading: true },
                ...viewMenu,
                ...(!locked ? [{ label: "Share", heading: true }, ...shareMenu] : []),
                { label: "Help", heading: true },
                ...helpMenu,
              ]}
            />
          </span>
          {!locked && library.length > 0 && (
            <Menu
              label="My pieces"
              icon={<BookmarkIcon />}
              items={library.map((p) => ({ label: p.title, onSelect: () => void openFromLibrary(p.id) }))}
            />
          )}
          {!locked && (
            <div className="mode-toggle" role="group" aria-label="Mode">
              <button className={advanced ? "" : "on"} aria-pressed={!advanced} onClick={() => setMode("basic")} title="Just view and play">
                Listen
              </button>
              <button className={advanced ? "on" : ""} aria-pressed={advanced} onClick={() => setMode("advanced")} title="Practice, sync and record tools">
                Practice
              </button>
            </div>
          )}
        </nav>
      </header>

      {standMode && (
        <div className="stand-controls">
          <button onClick={() => togglePlayRef.current()} className="stand-play">
            {playing || mediaPlaying ? "Pause" : "Play"}
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
            <p className="tour-lede">OpenVoicing turns sheet music into an interactive practice tool. There are three things you can do with a piece:</p>
            <ul className="tour-verbs">
              <li><strong>Play</strong> it at any tempo: slow down without changing pitch.</li>
              <li><strong>Practice</strong> it: loop a passage, or play along with a recording or a YouTube video, the notation following as it plays.</li>
              <li><strong>Edit</strong> it: change the notes yourself.</li>
            </ul>
            <p className="tour-demo">A demo piece is loaded, so you can try everything right now.</p>
            <p className="tour-ethos">Every piece is a single <code>.ovb</code> file you own. Host it anywhere, no account.</p>
            <div className="tour-actions">
              <button className="tour-dismiss" onClick={dismissTour}>Explore the demo</button>
              <button className="btn-sm" onClick={() => { scoreInputRef.current?.click(); dismissTour(); }}>Load a file</button>
              <button className="btn-sm" onClick={() => { dismissTour(); newScore(); }}>Start a new score</button>
            </div>
          </div>
        </div>
      )}
      {textPrompt && <TextPrompt request={textPrompt} onClose={() => setTextPrompt(null)} />}
      {notebookOpen && (
        <div className="prompt-backdrop" role="dialog" aria-modal="true" aria-label="Practice notebook" onMouseDown={() => setNotebookOpen(false)}>
          <div className="prompt-card notebook-card" onMouseDown={(e) => e.stopPropagation()}>
            <label className="prompt-label">
              Practice notebook
              <textarea
                className="notebook-input"
                autoFocus
                rows={8}
                value={notebook}
                placeholder="What to work on, fingerings, reminders…"
                onChange={(e) => setNotebook(e.target.value)}
              />
            </label>
            <p className="hint">Saved with this piece and travels inside the .ovb file.</p>
            <div className="prompt-actions">
              <button className="btn-primary" onClick={() => setNotebookOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
      {chordEdit && (
        <div className="prompt-backdrop" role="dialog" aria-modal="true" aria-label="Chord" onMouseDown={() => setChordEdit(null)}>
          <div className="prompt-card chord-card" onMouseDown={(e) => e.stopPropagation()}>
            <label className="prompt-label">
              Chord symbol
              <input
                className="prompt-input"
                autoFocus
                value={chordEdit.symbol}
                placeholder="Cmaj7"
                onChange={(e) => setChordEdit({ ...chordEdit, symbol: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveChord();
                }}
              />
            </label>
            <div className="chord-diagram-edit">
              <ChordEditor
                value={chordEdit.diagram ?? EMPTY_CHORD}
                onChange={(d) => setChordEdit({ ...chordEdit, diagram: d })}
              />
              <div className="chord-fret-control">
                <span className="fret-stepper">
                  First fret
                  <span className="seg-stepper">
                  <button
                    aria-label="Lower first fret"
                    onClick={() => {
                      const d = chordEdit.diagram ?? EMPTY_CHORD;
                      setChordEdit({ ...chordEdit, diagram: { ...d, firstFret: Math.max(1, d.firstFret - 1) } });
                    }}
                  >
                    −
                  </button>
                  <span className="seg-value">{(chordEdit.diagram ?? EMPTY_CHORD).firstFret}</span>
                  <button
                    aria-label="Raise first fret"
                    onClick={() => {
                      const d = chordEdit.diagram ?? EMPTY_CHORD;
                      setChordEdit({ ...chordEdit, diagram: { ...d, firstFret: Math.min(20, d.firstFret + 1) } });
                    }}
                  >
                    +
                  </button>
                  </span>
                </span>
                <span className="hint">Click cells to fret; markers above the nut = open or mute.</span>
              </div>
            </div>
            <div className="prompt-actions">
              {chordEdit.diagram && (
                <button onClick={() => setChordEdit({ ...chordEdit, diagram: null })}>Remove diagram</button>
              )}
              <button onClick={() => setChordEdit(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveChord}>
                OK
              </button>
            </div>
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
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            className="btn-icon"
            onClick={transportStop}
            disabled={!ready}
            aria-label="Stop"
            title="Stop and return to start (Home)"
          >
            <StopIcon />
          </button>
          <SpeedControl value={speed} onChange={setSynthSpeed} />
          <Popover
            label="Loop"
            icon={<LoopIcon />}
            active={loop}
            title="Loop these bars ([ and ])"
          >
            <label className="control">
              <input type="checkbox" checked={loop} onChange={toggleLoop} /> Loop playback
            </label>
            <span className="control">
              Bars
              <input
                className="num-input"
                type="number"
                min={1}
                max={barCount}
                aria-label="Loop from bar"
                value={loopFrom}
                onChange={(e) => setLoopFrom(Number(e.target.value))}
              />
              to
              <input
                className="num-input"
                type="number"
                min={1}
                max={barCount}
                aria-label="Loop to bar"
                value={loopTo}
                onChange={(e) => setLoopTo(Number(e.target.value))}
              />
              <button className="btn-icon" onClick={() => applyBarRange(loopFrom, loopTo)} title="Loop these bars" aria-label="Loop these bars">
                ↵
              </button>
              {loopBars && (
                <button className="btn-icon" onClick={clearBarLoop} title="Clear bar loop" aria-label="Clear bar loop">
                  ×
                </button>
              )}
            </span>
            <div className="loop-divider" />
            <div className="passages">
              <div className="passages-head">
                <span className="subgroup-label">Passages</span>
                <button onClick={saveCurrentPassage} disabled={!loopBars} title="Save the current loop as a named passage">
                  Save passage
                </button>
              </div>
              {passages.map((p, i) => (
                <div key={p.id} className="passage-row">
                  <button
                    className="passage-recall"
                    onClick={() => recallPassage(p)}
                    title={`Loop bars ${p.fromBar}–${p.toBar}${i < 9 ? ` (key ${i + 1})` : ""}`}
                  >
                    {i < 9 ? `${i + 1}. ` : ""}
                    {p.name}
                  </button>
                  <button className="btn-icon" onClick={() => deletePassage(p.id)} aria-label={`Delete ${p.name}`}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="loop-divider" />
            <label className="control">
              <input type="checkbox" checked={rampOn} onChange={(e) => setRampOn(e.target.checked)} />
              Speed trainer
            </label>
            {rampOn && (
              <div className="ramp-config">
                <label className="control">
                  Start
                  <input
                    className="num-input"
                    type="number"
                    min={25}
                    max={150}
                    step={5}
                    value={rampStart}
                    onChange={(e) => setRampStart(Number(e.target.value))}
                  />
                  %
                </label>
                <label className="control">
                  +
                  <input
                    className="num-input"
                    type="number"
                    min={1}
                    max={25}
                    value={rampStep}
                    onChange={(e) => setRampStep(Number(e.target.value))}
                  />
                  % every
                  <input
                    className="num-input"
                    type="number"
                    min={1}
                    max={9}
                    value={rampEvery}
                    onChange={(e) => setRampEvery(Number(e.target.value))}
                  />
                  loops
                </label>
                <label className="control">
                  up to
                  <input
                    className="num-input"
                    type="number"
                    min={25}
                    max={150}
                    step={5}
                    value={rampTarget}
                    onChange={(e) => setRampTarget(Number(e.target.value))}
                  />
                  %
                </label>
                <span className="hint">
                  now {Math.round(speed * 100)}% &rarr; {rampTarget}%
                </span>
              </div>
            )}
          </Popover>
          {activeRecId !== null && (
            <>
            <div className="mode-toggle source-toggle" role="group" aria-label="Sound source">
              <button
                className={preferredSource === "recording" ? "on" : ""}
                aria-pressed={preferredSource === "recording"}
                onClick={() => switchSource("recording")}
                title={
                  activeMediaKind === "youtube"
                    ? "Play the synced YouTube video (V to switch)"
                    : "Play the reference recording of this piece (V to switch)"
                }
              >
                {activeMediaKind === "youtube" ? "Video" : "Recording"}
              </button>
              <button
                className={preferredSource === "synth" ? "on" : ""}
                aria-pressed={preferredSource === "synth"}
                onClick={() => switchSource("synth")}
                title="Play the written notes, computer sound (V to switch)"
              >
                Notes
              </button>
            </div>
            </>
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
            {countIn && (
              <select
                value={countInBars}
                onChange={(e) => setCountInBars(Number(e.target.value))}
                title="Count-in length"
                aria-label="Count-in length in bars"
              >
                <option value={1}>1 bar</option>
                <option value={2}>2 bars</option>
                <option value={4}>4 bars</option>
              </select>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="tb-zone tb-nav" role="group" aria-label="Navigation">
          <span className="tb-zone-label" title="Jump to a bar or section">Jump</span>
          <NavigateControl
            barCount={barCount}
            sections={sections}
            locked={locked}
            currentSection={currentSectionIndex() + 1}
            onJumpBar={(n) => {
              const player = playerRef.current;
              if (player && n >= 1 && n <= player.barTicks.length) jumpToBarIndex(n - 1);
            }}
            onJumpSection={jumpToSection}
            onStepSection={stepSection}
            onAddSection={addSection}
            onRenameSection={renameSection}
            onDeleteSection={deleteSection}
            onTogglePracticed={toggleSectionPracticed}
          />
        </div>

        {/* Capture (advanced) */}
        {advanced && (
          <div className="tb-zone">
            <span className="tb-zone-label" title="Record my take from the microphone">Record</span>
            <button
              className={micRecording ? "btn-icon on" : "btn-icon"}
              onClick={() => void toggleMicRecording()}
              aria-label={micRecording ? "Stop recording my take" : "Record my take from the microphone"}
              title="Record your own take from the microphone. Nothing is recorded until you press this."
            >
              <RecordIcon />
            </button>
          </div>
        )}

        <div className="tb-zone tb-right">
          <div
            className="transport-scrubber"
            role="slider"
            tabIndex={0}
            aria-label="Playback position, click or drag to seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(position.total)}
            aria-valuenow={Math.round(position.current)}
            aria-valuetext={`${formatTime(position.current)} of ${formatTime(position.total)}`}
            title="Click or drag to seek"
            onPointerDown={onScrubPointerDown}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const delta = e.key === "ArrowLeft" ? -5 : 5;
                seekToFraction((position.current + delta) / (position.total || 1));
              }
            }}
          >
            <span
              className="scrub-fill"
              style={{ width: `${position.total ? (position.current / position.total) * 100 : 0}%` }}
            />
            <span className="position">
              {formatTime(position.current)} / {formatTime(position.total)}
            </span>
          </div>
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
          {renderEditToolbar()}

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
                <strong>This score is empty.</strong> The squiggles are silent <strong>rests</strong>, one per beat;
                the highlighted one is where your next note goes. Tap a <strong>Pitch</strong> button (or press{" "}
                <kbd>A</kbd>–<kbd>G</kbd>) to place it, set its <strong>value</strong> (how long it lasts) with{" "}
                <kbd>1</kbd>–<kbd>9</kbd>, and <kbd>→</kbd> moves to the next beat.
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
          {/* The YouTube iframe mounts here when a video take is active. Kept
              mounted (only resized/moved off-screen) so playback and the synced
              cursor survive hiding the video or collapsing the panel. */}
          <div
            className={
              "video-wrap" +
              (videoLarge ? " large" : "") +
              (videoHidden ? " video-off" : "")
            }
            style={activeMediaKind === "youtube" ? undefined : { display: "none" }}
          >
            <div className="video-controls">
              <button
                className="btn-icon"
                onClick={() => setVideoHidden((v) => !v)}
                title={videoHidden ? "Show the video" : "Hide the video (audio keeps playing)"}
                aria-pressed={videoHidden}
              >
                {videoHidden ? "Show video" : "Hide"}
              </button>
              {!videoHidden && (
                <button
                  className="btn-icon"
                  onClick={() => setVideoLarge((v) => !v)}
                  title={videoLarge ? "Smaller video" : "Larger video"}
                  aria-pressed={videoLarge}
                >
                  {videoLarge ? "Smaller" : "Larger"}
                </button>
              )}
            </div>
            <div className="video-host" ref={videoHostRef} />
          </div>
          <RecordingPanel
            player={recording}
            isVideo={activeMediaKind === "youtube"}
            playbackMedia={
              activeMediaKind === "youtube" && hasPairedAudio ? youtubeInstance : null
            }
            recordings={recordings}
            activeId={activeRecId}
            onSelect={(id) => void selectRecording(id)}
            onAddFile={addRecordingFile}
            onAddYouTube={() => {
              askText({
                label: "Paste a YouTube link or video id",
                placeholder: "https://youtu.be/…",
                submit: (url) => {
                  if (url.trim()) void addYouTubeRecording(url.trim());
                },
              });
            }}
            onAddPairedAudio={(file) => void addPairedAudio(file)}
            onRemove={(id) => void removeRecording(id)}
            syncPoints={syncPoints}
            onMoveSyncPoint={moveSyncPoint}
            onNudgeSyncPoint={nudgeSyncPoint}
            onEndSyncDrag={endSyncDrag}
            onSetToPlayhead={setSyncPointToPlayhead}
            onReinterpolate={reinterpolateSyncPoint}
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
                  {/* Mini-transport: play/speed/position by the waveform so your
                      gaze stays here while syncing. Mirrors the main transport. */}
                  <span className="mini-transport">
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => togglePlayRef.current()}
                      aria-label={isPlaying ? "Pause" : "Play"}
                      title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                    >
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <SpeedControl value={speed} onChange={setSynthSpeed} />
                    <span className="position">
                      {formatTime(position.current)} / {formatTime(position.total)}
                    </span>
                  </span>
                  <span className="subgroup-label">Sync</span>
                  <button
                    onClick={autoSync}
                    disabled={!canAutoSync}
                    title={
                      canAutoSync
                        ? "Detect bar times from the audio"
                        : "Add an audio file (Add → Audio for waveform & auto-sync) to enable Auto sync"
                    }
                  >
                    Auto sync
                  </button>
                  <button onClick={startTapSync}>Start tap sync</button>
                  {syncPoints ? (
                    <>
                      <span className="sync-subgroup" role="group" aria-label="Playback">
                        <span className="subgroup-label">Playback</span>
                        <label className="control">
                          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                          Follow
                        </label>
                        <label className="control" title="Play a click on each bar of the recording">
                          <input type="checkbox" checked={syncedClick} onChange={(e) => setSyncedClick(e.target.checked)} />
                          Click track
                        </label>
                      </span>
                      <button onClick={undoSync} disabled={!syncCanUndo} title="Undo sync edit (Cmd+Z)">
                        Undo sync
                      </button>
                      {flaggedCount > 0 && (
                        <button
                          className="btn-primary"
                          onClick={jumpToNextFlagged}
                          title={`Seek to the next of ${flaggedCount} bars that need checking`}
                        >
                          Next flagged ({flaggedCount})
                        </button>
                      )}
                      <span className="hint sync-status-cluster" role="status">
                        {syncPoints.length} of {barCount} bars synced
                        {syncConfidence && flaggedCount === 0 ? ", all look aligned" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="hint">not synced yet; Auto sync or tap each bar&rsquo;s downbeat</span>
                  )}
                </>
              ) : (
                <>
                  <button className="tap-button" onClick={tap}>
                    Tap bar {tapCount + 1} of {barCount} (or press Space)
                  </button>
                  <button onClick={skipTap} disabled={tapCount >= barCount} title="Skip this bar; its time is interpolated">
                    Skip
                  </button>
                  <button onClick={undoTap} disabled={tapCount === 0}>
                    Undo tap
                  </button>
                  <button
                    onClick={finishTapSync}
                    disabled={tapsRef.current.filter((t) => t != null).length < 2}
                  >
                    Done
                  </button>
                  <button onClick={cancelTapSync}>Cancel</button>
                  <span className="hint">
                    tap each bar&rsquo;s downbeat, or Skip steady bars and let them interpolate
                  </span>
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
      <main className="score" aria-label="Score" aria-describedby="score-summary" tabIndex={0}>
        <div ref={containerRef} className="score-surface" role="img" aria-label="Musical notation" />
      </main>

      <footer className="footer">
        <span className="footer-tip">
          {editMode
            ? coarsePointer
              ? "Tip: tap a note to select it, then use the toolbar to change or delete it."
              : "Tip: click a note to select it, then ↑/↓ transpose or Del delete."
            : coarsePointer
              ? "Tip: tap a note to jump there; drag across notes to loop a passage."
              : "Tip: click a note to jump there, drag across notes to loop a passage."}
        </span>
        <span className="footer-colophon">Engraving by alphaTab</span>
      </footer>
    </div>
  );
}

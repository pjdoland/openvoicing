import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Player, type TrackInfo } from "@openvoicing/player";
import { alignBarsToOnsets, detectOnsets, RecordingPlayer } from "@openvoicing/audio-engine";
import {
  createEmptyScore,
  importMusicXml,
  mediaTimeAtTick,
  neighborBeatAddress,
  ScoreEditor,
  tickAtMediaTime,
  toAlphaTex,
  toMidi,
  toMusicXml,
  type Beat,
  type BeatAddress,
  type ScoreDocument,
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
import soundFontUrl from "@coderline/alphatab/soundfont/sonivox.sf3?url";
import { DEMO_TEX } from "./demo";
import { RecordingPanel } from "./RecordingPanel";
import { SpeedControl, clampSpeed } from "./SpeedControl";
import { CheatSheet, SettingsControls, useAppSettings } from "./Settings";
import { MicRecorder } from "./mic";
import { storage, type RecordingMeta, type StoredFile } from "./storage";

const INSTRUMENTS: Array<{ program: number; name: string }> = [
  { program: 0, name: "Piano" },
  { program: 24, name: "Nylon guitar" },
  { program: 25, name: "Steel guitar" },
  { program: 40, name: "Violin" },
  { program: 42, name: "Cello" },
  { program: 52, name: "Choir aah" },
  { program: 56, name: "Trumpet" },
  { program: 65, name: "Alto sax" },
  { program: 73, name: "Flute" },
];

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
function loadScoreIntoPlayer(player: Player, source: ScoreSource): ScoreEditor | null {
  if (source.type === "alphatex") {
    player.loadTex(new TextDecoder().decode(source.data));
    return null;
  }
  if (source.type === "musicxml") {
    try {
      const doc = importMusicXml(new TextDecoder().decode(source.data));
      player.loadTex(toAlphaTex(doc));
      return new ScoreEditor(doc);
    } catch {
      // Binary containers (.mxl) and files the v0 importer cannot handle
      // fall back to alphaTab's native parser, read-only.
    }
  }
  player.load(new Uint8Array(source.data));
  return null;
}

function newRecordingId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

function structuredCloneBeat(beat: Beat): Beat {
  return structuredClone(beat);
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

  const editorRef = useRef<ScoreEditor | null>(null);
  const [hasEditor, setHasEditor] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const editModeRef = useRef(false);
  const selectedBeatRef = useRef<BeatAddress | null>(null);
  const [selectedBeat, setSelectedBeat] = useState<BeatAddress | null>(null);
  const clipboardRef = useRef<Beat[] | null>(null);
  // Range anchor for Shift+Arrow selection within a bar; null when single-beat.
  const rangeAnchorRef = useRef<number | null>(null);
  const rangeEndRef = useRef<number | null>(null);
  const [, setRangeEnd] = useState<number | null>(null);
  function updateRangeEnd(value: number | null) {
    rangeEndRef.current = value;
    setRangeEnd(value);
  }

  useEffect(() => {
    editModeRef.current = editMode;
    setAnnouncement(editMode ? "Edit mode on" : "Edit mode off");
    if (!editMode) {
      selectedBeatRef.current = null;
      setSelectedBeat(null);
    }
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
    selectedBeatRef.current = selectedBeat;
  }, [selectedBeat]);

  function adoptEditor(editor: ScoreEditor | null): void {
    editorRef.current = editor;
    setHasEditor(editor !== null);
    setEditMode(false);
    if (editor) void storage.set("scoreDoc", editor.doc);
    else void storage.delete("scoreDoc");
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
      setPosition((prev) => {
        const next = { current: Math.floor(current), total: Math.floor(total) };
        return prev.current === next.current && prev.total === next.total ? prev : next;
      });
    });
    player.on("beatClicked", (tick, location) => {
      if (editModeRef.current) {
        setSelectedBeat({
          partIndex: location.trackIndex,
          barIndex: location.barIndex,
          voiceIndex: location.voiceIndex,
          beatIndex: location.beatIndex,
        });
        return;
      }
      const points = syncPointsRef.current;
      if (points) recording.seek(mediaTimeAtTick(points, tick));
    });
    player.on("error", (error) => console.error("[openvoicing]", error));
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__ovPlayer = player;
      w.__ovRecording = recording;
      w.__ovEditor = () => editorRef.current;
      w.__ovSelected = () => selectedBeatRef.current;
    }
    let disposed = false;
    void (async () => {
      let doc: ScoreDocument | undefined;
      let stored: (StoredFile & { type?: ScoreType }) | undefined;
      try {
        doc = await storage.get<ScoreDocument>("scoreDoc");
        stored = await storage.get<StoredFile & { type?: ScoreType }>("score");
      } catch {
        doc = undefined;
        stored = undefined;
      }
      if (disposed) return;
      if (doc) {
        // An editing session in progress restores from the canonical document.
        const tex = toAlphaTex(doc);
        player.loadTex(tex);
        editorRef.current = new ScoreEditor(doc);
        setHasEditor(true);
        if (stored) {
          scoreSourceRef.current = {
            name: stored.name,
            type: stored.type ?? scoreTypeFromFileName(stored.name),
            data: stored.data,
          };
        }
      } else if (stored) {
        const source: ScoreSource = {
          name: stored.name,
          type: stored.type ?? scoreTypeFromFileName(stored.name),
          data: stored.data,
        };
        scoreSourceRef.current = source;
        const editor = loadScoreIntoPlayer(player, source);
        editorRef.current = editor;
        setHasEditor(editor !== null);
        if (editor) void storage.set("scoreDoc", editor.doc);
      } else {
        const data = new TextEncoder().encode(DEMO_TEX).buffer as ArrayBuffer;
        scoreSourceRef.current = { name: "demo.alphatex", type: "alphatex", data };
        player.loadTex(DEMO_TEX);
      }
    })();
    return () => {
      disposed = true;
      playerRef.current = null;
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
          synthSpeed?: number;
          recordingSpeed?: number;
          loop?: { start: number; end: number } | null;
          position?: number;
        }>("practice");
        if (cancelled || !practice) return;
        if (practice.synthSpeed) setSynthSpeed(practice.synthSpeed);
        if (practice.recordingSpeed) recording.speed = practice.recordingSpeed;
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
        synthSpeed: speedRef.current,
        recordingSpeed: recording.speed,
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
      setActiveRecId(null);
      setSyncPoints(null);
      setFollow(false);
    }
  }

  useEffect(() => {
    if (!follow || !syncPoints) return;
    return recording.on("positionChanged", (seconds) => {
      const player = playerRef.current;
      if (!player) return;
      player.cursorTick = Math.max(0, Math.round(tickAtMediaTime(syncPoints, seconds)));
    });
  }, [follow, syncPoints, recording]);

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

  // A/B: jump between synth and recording at the same musical position.
  function toggleSynthRecording() {
    const player = playerRef.current;
    if (!player || !activeRecId) return;
    const points = syncPointsRef.current;
    if (recording.playing) {
      // Switch to synth at the mapped tick.
      const tick = points ? Math.round(tickAtMediaTime(points, recording.position)) : 0;
      recording.pause();
      player.playFromTick(Math.max(0, tick));
      setAnnouncement("Synth");
    } else {
      // Switch to recording at the mapped time.
      const tick = player.cursorTick;
      const time = points ? mediaTimeAtTick(points, tick) : 0;
      if (player.playing) player.playPause();
      recording.seek(time);
      void recording.play();
      setAnnouncement("Recording");
    }
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
    if (bars.length === 0) return;
    const secondsPerTick = 60 / (player.tempoBpm * 960);
    const expected = bars.map((b) => b.start * secondsPerTick);
    const onsets = detectOnsets(audio.channels, audio.sampleRate);
    const times = alignBarsToOnsets(expected, onsets);
    commitSync(bars.map((b, i) => ({ tick: b.start, timeSeconds: times[i]! })));
    setFollow(true);
    showToast(`Auto-synced ${bars.length} bars.`, undoSync);
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
    const gap = 0.05;
    const min = index > 0 ? points[index - 1]!.timeSeconds + gap : 0;
    const max =
      index < points.length - 1
        ? points[index + 1]!.timeSeconds - gap
        : recording.duration || points[index]!.timeSeconds + 1;
    const clamped = Math.min(Math.max(timeSeconds, min), Math.max(min, max));
    return points.map((p, i) => (i === index ? { ...p, timeSeconds: clamped } : p));
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

  // Per-bar confidence from spacing regularity: a bar whose interval to the next
  // deviates sharply from the median interval is a likely bad anchor.
  const syncConfidence = useMemo(() => {
    if (!syncPoints || syncPoints.length < 3) return null;
    const gaps = syncPoints.slice(1).map((p, i) => p.timeSeconds - syncPoints[i]!.timeSeconds);
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    return syncPoints.map((_, i) => {
      const before = i > 0 ? gaps[i - 1]! : median;
      const after = i < gaps.length ? gaps[i]! : median;
      const dev = Math.max(Math.abs(before - median), Math.abs(after - median)) / (median || 1);
      return dev < 0.15 ? "good" : dev < 0.4 ? "fair" : "poor";
    });
  }, [syncPoints]);

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

  function rerenderScore() {
    const editor = editorRef.current;
    const player = playerRef.current;
    if (!editor || !player) return;
    player.loadTex(toAlphaTex(editor.doc));
    void storage.set("scoreDoc", editor.doc);
    // Bundles must carry the edited score, re-importable as MusicXML.
    const xml = toMusicXml(editor.doc);
    const data = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    scoreSourceRef.current = { name: "score.musicxml", type: "musicxml", data };
    void storage.set("score", { name: "score.musicxml", type: "musicxml", data });
  }

  function newScore() {
    const player = playerRef.current;
    if (!player) return;
    const doc = createEmptyScore();
    const editor = new ScoreEditor(doc);
    editorRef.current = editor;
    setHasEditor(true);
    player.loadTex(toAlphaTex(doc));
    void storage.set("scoreDoc", doc);
    const xml = toMusicXml(doc);
    const data = new TextEncoder().encode(xml).buffer as ArrayBuffer;
    scoreSourceRef.current = { name: "score.musicxml", type: "musicxml", data };
    void storage.set("score", { name: "score.musicxml", type: "musicxml", data });
    for (const meta of recordings) void storage.delete(`sync:${meta.id}`);
    setSyncPoints(null);
    setFollow(false);
    setEditMode(true);
    const first: BeatAddress = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    selectedBeatRef.current = first;
    setSelectedBeat(first);
  }

  function downloadBlob(blob: Blob, extension: string) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(scoreTitle || "score").replace(/[^\w-]+/g, "-").toLowerCase() || "score"}.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function exportMusicXml() {
    const editor = editorRef.current;
    if (!editor) return;
    downloadBlob(
      new Blob([toMusicXml(editor.doc)], { type: "application/vnd.recordare.musicxml+xml" }),
      "musicxml",
    );
  }

  function exportMidi() {
    const editor = editorRef.current;
    if (!editor) return;
    downloadBlob(new Blob([toMidi(editor.doc) as BlobPart], { type: "audio/midi" }), "mid");
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
      const editor = editorRef.current;
      if (!editor) return;
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        const changed = e.shiftKey ? editor.redo() : editor.undo();
        if (changed) rerenderScore();
        return;
      }
      const selectedForClip = selectedBeatRef.current;
      if ((e.metaKey || e.ctrlKey) && (e.code === "KeyC" || e.code === "KeyX") && selectedForClip) {
        e.preventDefault();
        const beats =
          editor.doc.parts[selectedForClip.partIndex]?.measures[selectedForClip.barIndex]?.voices[
            selectedForClip.voiceIndex
          ]?.beats ?? [];
        const anchor = rangeAnchorRef.current;
        const lo = anchor === null ? selectedForClip.beatIndex : Math.min(anchor, rangeEndRef.current ?? anchor);
        const hi = anchor === null ? selectedForClip.beatIndex : Math.max(anchor, rangeEndRef.current ?? anchor);
        clipboardRef.current = beats.slice(lo, hi + 1).map(structuredCloneBeat);
        if (e.code === "KeyX") {
          // Delete from the end so indices stay valid.
          let changed = false;
          for (let i = hi; i >= lo; i--) {
            changed = editor.deleteBeat({ ...selectedForClip, beatIndex: i }) || changed;
          }
          if (changed) {
            const remaining =
              editor.doc.parts[selectedForClip.partIndex]?.measures[selectedForClip.barIndex]
                ?.voices[selectedForClip.voiceIndex]?.beats ?? [];
            const sel =
              remaining.length === 0
                ? null
                : { ...selectedForClip, beatIndex: Math.min(lo, remaining.length - 1) };
            selectedBeatRef.current = sel;
            setSelectedBeat(sel);
            rerenderScore();
          }
        }
        rangeAnchorRef.current = null;
        updateRangeEnd(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyV" && selectedForClip && clipboardRef.current) {
        e.preventDefault();
        if (editor.insertBeatsAfter(selectedForClip, clipboardRef.current)) {
          const next = { ...selectedForClip, beatIndex: selectedForClip.beatIndex + 1 };
          selectedBeatRef.current = next;
          setSelectedBeat(next);
          rerenderScore();
        }
        return;
      }
      const selected = selectedBeatRef.current;
      if (!selected || e.metaKey || e.ctrlKey || e.altKey) return;
      // Shift+Arrow extends a selection range within the current bar.
      if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && e.shiftKey) {
        e.preventDefault();
        const beats =
          editor.doc.parts[selected.partIndex]?.measures[selected.barIndex]?.voices[
            selected.voiceIndex
          ]?.beats ?? [];
        if (rangeAnchorRef.current === null) rangeAnchorRef.current = selected.beatIndex;
        const delta = e.code === "ArrowRight" ? 1 : -1;
        const nextEnd = Math.min(
          beats.length - 1,
          Math.max(0, (rangeEndRef.current ?? selected.beatIndex) + delta),
        );
        updateRangeEnd(nextEnd);
        return;
      }
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
        rangeAnchorRef.current = null;
        updateRangeEnd(null);
        const next = neighborBeatAddress(
          editor.doc,
          selected,
          e.code === "ArrowRight" ? 1 : -1,
        );
        if (next) {
          selectedBeatRef.current = next;
          setSelectedBeat(next);
          const player = playerRef.current;
          const beat =
            editor.doc.parts[next.partIndex]?.measures[next.barIndex]?.voices[next.voiceIndex]
              ?.beats[next.beatIndex];
          const barStart = player?.barTicks[next.barIndex]?.start;
          if (player && beat && barStart !== undefined) {
            player.cursorTick = barStart + beat.startTick;
          }
        }
        return;
      }
      if (e.code === "KeyJ") {
        e.preventDefault();
        if (editor.respellBeat(selected)) rerenderScore();
        return;
      }
      if (e.code === "KeyT") {
        e.preventDefault();
        if (editor.toggleTie(selected)) rerenderScore();
        return;
      }
      if (e.code === "Period") {
        e.preventDefault();
        if (editor.toggleDotted(selected)) rerenderScore();
        return;
      }
      if (e.code === "Equal" || e.code === "Minus") {
        e.preventDefault();
        if (editor.cycleAccidental(selected, e.code === "Equal" ? 1 : -1)) rerenderScore();
        return;
      }
      if (e.code === "KeyB") {
        e.preventDefault();
        if (editor.repeatPreviousBar(selected)) rerenderScore();
        return;
      }
      // Shift + a-g adds a note to the chord.
      const chordMatch = e.shiftKey ? /^Key([A-G])$/.exec(e.code) : null;
      if (chordMatch) {
        e.preventDefault();
        if (editor.addNoteToChord(selected, chordMatch[1] as "A")) rerenderScore();
        return;
      }
      if (e.code === "Digit3" && e.shiftKey) {
        e.preventDefault();
        const beat =
          editor.doc.parts[selected.partIndex]?.measures[selected.barIndex]?.voices[
            selected.voiceIndex
          ]?.beats[selected.beatIndex];
        if (editor.setTuplet(selected, beat?.tuplet ? null : 3)) rerenderScore();
        return;
      }
      if (e.code === "KeyL") {
        e.preventDefault();
        const beat =
          editor.doc.parts[selected.partIndex]?.measures[selected.barIndex]?.voices[
            selected.voiceIndex
          ]?.beats[selected.beatIndex];
        const lyric = window.prompt("Lyric syllable", beat?.lyric ?? "");
        if (lyric !== null && editor.setLyric(selected, lyric)) rerenderScore();
        return;
      }
      if (e.code === "Escape") {
        e.preventDefault();
        selectedBeatRef.current = null;
        setSelectedBeat(null);
        return;
      }
      if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        e.preventDefault();
        const delta = (e.code === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1);
        if (editor.transposeBeat(selected, delta)) rerenderScore();
        return;
      }
      const pitchMatch = /^Key([A-G])$/.exec(e.code);
      if (pitchMatch) {
        e.preventDefault();
        if (editor.setBeatPitch(selected, pitchMatch[1] as "A")) rerenderScore();
        return;
      }
      const DURATIONS: Record<string, number> = {
        Digit1: 3840,
        Digit2: 1920,
        Digit4: 960,
        Digit8: 480,
        Digit6: 240,
        Digit3: 120,
      };
      if (e.code in DURATIONS) {
        e.preventDefault();
        if (editor.setBeatDuration(selected, DURATIONS[e.code]!)) rerenderScore();
        return;
      }
      if (e.code === "KeyR") {
        e.preventDefault();
        if (editor.setBeatRest(selected)) rerenderScore();
        return;
      }
      if (e.code === "KeyI" || e.code === "Enter") {
        e.preventDefault();
        const inserted = editor.insertBeatAfter(selected);
        if (inserted) {
          selectedBeatRef.current = inserted;
          setSelectedBeat(inserted);
          rerenderScore();
        }
        return;
      }
      if (e.code === "KeyX" || e.code === "Delete") {
        e.preventDefault();
        if (editor.deleteBeat(selected)) {
          const beats =
            editor.doc.parts[selected.partIndex]?.measures[selected.barIndex]?.voices[
              selected.voiceIndex
            ]?.beats ?? [];
          const nextSelection =
            beats.length === 0
              ? null
              : { ...selected, beatIndex: Math.min(selected.beatIndex, beats.length - 1) };
          selectedBeatRef.current = nextSelection;
          setSelectedBeat(nextSelection);
          rerenderScore();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode]);

  // Unified play/pause for external transport (media keys, MIDI pedal).
  const togglePlayRef = useRef(() => {});
  togglePlayRef.current = () => {
    if (activeRecIdRef.current !== null) {
      if (recording.playing) recording.pause();
      else void recording.play();
    } else {
      playerRef.current?.playPause();
    }
  };

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
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  function setSynthSpeed(value: number) {
    speedRef.current = value;
    setSpeed(value);
    if (playerRef.current) playerRef.current.speed = value;
    savePracticeRef.current?.();
  }

  const activeRecIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeRecIdRef.current = activeRecId;
  }, [activeRecId]);
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
          if (onRecording) {
            if (recording.playing) recording.pause();
            else void recording.play();
          } else {
            playerRef.current?.playPause();
          }
          return;
        }
        case "Minus":
        case "Equal": {
          e.preventDefault();
          const delta = e.code === "Minus" ? -0.05 : 0.05;
          if (onRecording) recording.speed = clampSpeed(recording.speed + delta);
          else setSynthSpeed(clampSpeed(speedRef.current + delta));
          return;
        }
        case "KeyH": {
          if (editModeRef.current) return;
          e.preventDefault();
          const transport = onRecording ? "recording" : "synth";
          const current = onRecording ? recording.speed : speedRef.current;
          const held = halfSpeedReturnRef.current;
          if (current === 0.5 && held && held.transport === transport) {
            if (onRecording) recording.speed = held.speed;
            else setSynthSpeed(held.speed);
            halfSpeedReturnRef.current = null;
          } else {
            halfSpeedReturnRef.current = { transport, speed: current };
            if (onRecording) recording.speed = 0.5;
            else setSynthSpeed(0.5);
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

  function toggleLoop() {
    const value = !loop;
    setLoop(value);
    playerRef.current?.setLooping(value);
  }

  const [barsInput, setBarsInput] = useState("");
  const [barLoopActive, setBarLoopActive] = useState(false);

  function applyBarLoop() {
    const match = /^(\d+)\s*-\s*(\d+)$/.exec(barsInput.trim());
    const player = playerRef.current;
    if (!match || !player) return;
    const bars = player.barTicks;
    if (bars.length === 0) return;
    const from = Math.max(1, Math.min(bars.length, parseInt(match[1]!, 10)));
    const to = Math.max(from, Math.min(bars.length, parseInt(match[2]!, 10)));
    const startTick = bars[from - 1]!.start;
    const endTick = bars[to - 1]!.start + bars[to - 1]!.duration;
    if (activeRecId && syncPoints?.length) {
      recording.setLoopRegion({
        start: mediaTimeAtTick(syncPoints, startTick),
        end: mediaTimeAtTick(syncPoints, endTick),
      });
      recording.seek(mediaTimeAtTick(syncPoints, startTick));
    } else {
      player.setPlaybackRange({ startTick, endTick });
      setLoop(true);
    }
    setBarLoopActive(true);
  }

  function clearBarLoop() {
    setBarLoopActive(false);
    setBarsInput("");
    playerRef.current?.setPlaybackRange(null);
    if (activeRecId) recording.setLoopRegion(null);
  }

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
    const player = playerRef.current;
    if (!player) return;
    const buffer = await file.arrayBuffer();
    const type = scoreTypeFromFileName(file.name);
    const source: ScoreSource = { name: file.name, type, data: buffer };
    const editor = loadScoreIntoPlayer(player, source);
    adoptEditor(editor);
    scoreSourceRef.current = source;
    void storage.set("score", { name: file.name, type, data: buffer });
    // Sync maps anchor to the old score's ticks; they do not carry over.
    for (const meta of recordings) void storage.delete(`sync:${meta.id}`);
    setSyncPoints(null);
    setFollow(false);
    e.target.value = "";
  }

  async function exportBundle() {
    const source = scoreSourceRef.current;
    if (!source) return;
    const scorePath = `score/score.${scoreFileExtension(source.type)}`;
    const files = new Map<string, Uint8Array>([[scorePath, new Uint8Array(source.data)]]);
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
    const bytes = createBundle({
      manifest: {
        format: BUNDLE_FORMAT,
        formatVersion: BUNDLE_FORMAT_VERSION,
        title: scoreTitle || "Untitled",
        ...(scoreArtist ? { attribution: { artist: scoreArtist } } : {}),
        score: { path: scorePath, type: source.type },
        recordings: manifestRecordings,
      },
      files,
    });
    const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(scoreTitle || "score").replace(/[^\w-]+/g, "-").toLowerCase() || "score"}.ovb`;
    link.click();
    URL.revokeObjectURL(link.href);
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

  return (
    <div className={standMode ? "app stand-mode" : "app"}>
      <header className="header">
        <h1>OpenVoicing</h1>
        <span className="tagline">open source living sheet music</span>
        <span className="header-actions">
          <SettingsControls {...settings} />
          <button
            className="header-button"
            onClick={() => setStandMode(true)}
            title="Music-stand mode (full-screen, screen stays on)"
          >
            Stand
          </button>
          <button
            className="header-button"
            onClick={() => setCheatSheetOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
          <label className="header-button">
            Open bundle…
            <input type="file" accept=".ovb" onChange={openBundle} />
          </label>
          <button className="header-button" onClick={() => void openFromUrl()}>
            Open URL…
          </button>
          <button className="header-button" onClick={() => void exportBundle()}>
            Export bundle
          </button>
          <button className="header-button" onClick={copyEmbedCode} title="Copy an embed snippet">
            Copy embed
          </button>
        </span>
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
      {countInNumber !== null && (
        <div className="countin-overlay" aria-hidden="true">
          <span className="countin-number">{countInNumber}</span>
        </div>
      )}

      <div className="toolbar">
        <button onClick={synthPlayPause} disabled={!ready}>
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => playerRef.current?.stop()} disabled={!ready}>
          Stop
        </button>

        <SpeedControl value={speed} onChange={setSynthSpeed} />

        <label className="control">
          <input type="checkbox" checked={loop} onChange={toggleLoop} /> Loop
        </label>

        <span className="control">
          <input
            className="bars-input"
            placeholder="bars 3-6"
            aria-label="Loop bar range"
            value={barsInput}
            size={7}
            onChange={(e) => setBarsInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyBarLoop();
            }}
          />
          {barLoopActive && (
            <button onClick={clearBarLoop} title="Clear bar loop">
              ×
            </button>
          )}
        </span>
        <label className="control">
          <input type="checkbox" checked={metronome} onChange={toggleMetronome} /> Metronome
        </label>
        <label className="control">
          <input type="checkbox" checked={countIn} onChange={toggleCountIn} /> Count-in
        </label>

        {hasEditor && (
          <label className="control">
            <input
              type="checkbox"
              checked={editMode}
              onChange={(e) => {
                setEditMode(e.target.checked);
                e.target.blur();
              }}
            />
            Edit
          </label>
        )}
        {editMode && (
          <span className="hint">
            {selectedBeat
              ? `bar ${selectedBeat.barIndex + 1}: a-g pitch, Shift+a-g chord, ←→ move, ↑↓ transpose, 1-8 dur, . dot, +/− accidental, Shift+3 triplet, r rest, b repeat bar, l lyric, t tie, i insert, x delete`
              : "click a note to select it, or press Esc to deselect"}
          </span>
        )}

        <span className="position">
          {formatTime(position.current)} / {formatTime(position.total)}
        </span>

        <span className="control" title="Jump to a bar number">
          <input
            className="bars-input"
            placeholder="go to bar"
            aria-label="Go to bar"
            size={7}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const n = parseInt((e.target as HTMLInputElement).value, 10);
              const player = playerRef.current;
              if (player && n >= 1 && n <= player.barTicks.length) {
                player.cursorTick = player.barTicks[n - 1]!.start;
              }
            }}
          />
        </span>

        {editMode && (
          <>
            <button
              onClick={() => {
                if (editorRef.current?.undo()) rerenderScore();
              }}
              disabled={!editorRef.current?.canUndo}
              title="Undo edit (Cmd+Z)"
            >
              ↶ Undo
            </button>
            <button
              onClick={() => {
                if (editorRef.current?.redo()) rerenderScore();
              }}
              disabled={!editorRef.current?.canRedo}
              title="Redo edit (Shift+Cmd+Z)"
            >
              ↷ Redo
            </button>
            <button
              onClick={() => {
                if (editorRef.current?.transposeScore(1)) rerenderScore();
              }}
              title="Transpose whole score up a semitone"
            >
              Transpose +
            </button>
            <button
              onClick={() => {
                if (editorRef.current?.transposeScore(-1)) rerenderScore();
              }}
              title="Transpose whole score down a semitone"
            >
              Transpose −
            </button>
          </>
        )}

        {editMode && (
          <label className="control" title="Playback instrument for this part">
            <span className="sr-only">Instrument</span>
            <select
              value={editorRef.current?.doc.parts[0]?.midiProgram ?? 0}
              onChange={(e) => {
                if (editorRef.current?.setInstrument(0, Number(e.target.value))) rerenderScore();
              }}
            >
              {INSTRUMENTS.map((inst) => (
                <option key={inst.program} value={inst.program}>
                  {inst.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          onClick={() => void toggleMicRecording()}
          title="Record yourself with the microphone"
          style={micRecording ? { color: "#dc2626", fontWeight: 600 } : undefined}
        >
          {micRecording ? "● Stop rec" : "● Record"}
        </button>
        {activeRecId !== null && (
          <button onClick={toggleSynthRecording} title="Toggle synth / recording (v)">
            A/B
          </button>
        )}

        <button onClick={newScore}>New score</button>
        {hasEditor && (
          <>
            <button onClick={exportMusicXml}>Export MusicXML</button>
            <button onClick={exportMidi}>Export MIDI</button>
          </>
        )}
        <label className="control open-file">
          Open file…
          <input
            type="file"
            accept=".musicxml,.xml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx"
            onChange={openFile}
          />
        </label>
      </div>

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

      {activeRecId !== null && (
        <div className="sync-bar">
          <strong>Sync</strong>
          {tapCount === null ? (
            <>
              <button onClick={autoSync}>Auto sync</button>
              <button onClick={startTapSync}>Start tap sync</button>
              {syncPoints ? (
                <>
                  <label className="control">
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => setFollow(e.target.checked)}
                    />
                    Follow recording
                  </label>
                  <label className="control" title="Click on each bar of the recording">
                    <input
                      type="checkbox"
                      checked={syncedClick}
                      onChange={(e) => setSyncedClick(e.target.checked)}
                    />
                    Click
                  </label>
                  <button onClick={undoSync} disabled={!syncCanUndo} title="Undo sync edit (Cmd+Z)">
                    Undo sync
                  </button>
                  <span className="hint">
                    {syncPoints.length} bars synced; play and tap P to fix a bar, drag or
                    arrow-nudge a marker, click a note to jump
                  </span>
                </>
              ) : (
                <span className="hint">
                  plays the recording from the start; tap at each bar's downbeat
                </span>
              )}
            </>
          ) : (
            <>
              <button className="tap-button" onClick={tap}>
                Tap bar {tapCount + 1} of {barCount} (or press Space)
              </button>
              <button onClick={undoTap} disabled={tapCount === 0}>
                Undo tap (Backspace)
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

      <main className="score" ref={containerRef} />

      <footer className="footer">
        Tip: click a note to jump there, drag across notes to loop a passage.
      </footer>
    </div>
  );
}

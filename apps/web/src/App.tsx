import { useEffect, useRef, useState, type ChangeEvent } from "react";
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
  type ScoreType,
} from "@openvoicing/bundle";
import soundFontUrl from "@coderline/alphatab/soundfont/sonivox.sf3?url";
import { DEMO_TEX } from "./demo";
import { RecordingPanel } from "./RecordingPanel";
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

function sanitizeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_");
}

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function App() {
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

  useEffect(() => {
    editModeRef.current = editMode;
    if (!editMode) {
      selectedBeatRef.current = null;
      setSelectedBeat(null);
    }
  }, [editMode]);

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
    player.on("playerStateChanged", setPlaying);
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
        const sync = await storage.get<SyncPoint[]>(`sync:${meta.id}`);
        if (cancelled || !sync?.length) return;
        setSyncPoints(sync);
        setFollow((await storage.get<boolean>("follow")) ?? true);
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
  }

  async function selectRecording(id: string) {
    if (id === activeRecId) return;
    const stored = await storage.get<StoredFile>(`recording:${id}`);
    if (!stored) return;
    await recording.load(stored.data);
    setActiveRecId(id);
    const sync = await storage.get<SyncPoint[]>(`sync:${id}`);
    if (sync?.length) {
      setSyncPoints(sync);
      setFollow(true);
    }
  }

  async function removeRecording(id: string) {
    void storage.delete(`recording:${id}`);
    void storage.delete(`sync:${id}`);
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
    setSyncPoints(bars.map((b, i) => ({ tick: b.start, timeSeconds: times[i]! })));
    setFollow(true);
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
    setSyncPoints(points);
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

  function moveSyncPoint(index: number, timeSeconds: number) {
    setSyncPoints((points) => {
      if (!points) return points;
      const gap = 0.05;
      const min = index > 0 ? points[index - 1]!.timeSeconds + gap : 0;
      const max =
        index < points.length - 1
          ? points[index + 1]!.timeSeconds - gap
          : recording.duration;
      const clamped = Math.min(Math.max(timeSeconds, min), Math.max(min, max));
      return points.map((p, i) => (i === index ? { ...p, timeSeconds: clamped } : p));
    });
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
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      const editor = editorRef.current;
      if (!editor) return;
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        const changed = e.shiftKey ? editor.redo() : editor.undo();
        if (changed) rerenderScore();
        return;
      }
      const selected = selectedBeatRef.current;
      if (!selected || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();
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

  function changeSpeed(e: ChangeEvent<HTMLSelectElement>) {
    const value = Number(e.target.value);
    setSpeed(value);
    if (playerRef.current) playerRef.current.speed = value;
  }

  function toggleLoop() {
    const value = !loop;
    setLoop(value);
    playerRef.current?.setLooping(value);
  }

  function toggleMetronome() {
    const value = !metronome;
    setMetronome(value);
    playerRef.current?.setMetronome(value);
  }

  function toggleCountIn() {
    const value = !countIn;
    setCountIn(value);
    playerRef.current?.setCountIn(value);
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
      const recPath = `recordings/${meta.id}/${sanitizeName(rec.name)}`;
      files.set(recPath, new Uint8Array(rec.data));
      manifestRecordings.push({
        id: meta.id,
        name: rec.name,
        path: recPath,
        ...(sync?.length ? { syncPoints: sync } : {}),
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

  async function openBundle(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const bundle = readBundle(new Uint8Array(await file.arrayBuffer()));
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
        list.push({ id, name: entry.name });
      }
      saveRecordingsList(list);

      const first = manifest.recordings[0];
      if (first) {
        const bytes = bundle.files.get(first.path)!;
        await recording.load(bytes.slice().buffer as ArrayBuffer);
        setActiveRecId(list[0]!.id);
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
    } catch (error) {
      console.error("[openvoicing] failed to open bundle", error);
      window.alert(error instanceof Error ? error.message : "Failed to open bundle");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>OpenVoicing</h1>
        <span className="tagline">open source living sheet music</span>
        <span className="header-actions">
          <label className="header-button">
            Open bundle…
            <input type="file" accept=".ovb" onChange={openBundle} />
          </label>
          <button className="header-button" onClick={() => void exportBundle()}>
            Export bundle
          </button>
        </span>
      </header>

      <div className="toolbar">
        <button onClick={() => playerRef.current?.playPause()} disabled={!ready}>
          {playing ? "Pause" : "Play"}
        </button>
        <button onClick={() => playerRef.current?.stop()} disabled={!ready}>
          Stop
        </button>

        <label className="control">
          Speed
          <select value={speed} onChange={changeSpeed}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </label>

        <label className="control">
          <input type="checkbox" checked={loop} onChange={toggleLoop} /> Loop
        </label>
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
              ? "a-g pitch, ←→ select, ↑↓ transpose, 1/2/4/8/6/3 duration, r rest, i insert, x delete, t tie, j respell, Cmd+Z undo"
              : "click a note to select it"}
          </span>
        )}

        <span className="position">
          {formatTime(position.current)} / {formatTime(position.total)}
        </span>

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
                  <span className="hint">
                    synced at {syncPoints.length} bars; click a note to jump the recording there
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

      <main className="score" ref={containerRef} />

      <footer className="footer">
        Tip: click a note to jump there, drag across notes to loop a passage.
      </footer>
    </div>
  );
}

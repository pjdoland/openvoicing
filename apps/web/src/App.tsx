import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Player, type TrackInfo } from "@openvoicing/player";
import { RecordingPlayer } from "@openvoicing/audio-engine";
import { mediaTimeAtTick, tickAtMediaTime, type SyncPoint } from "@openvoicing/score-model";
import soundFontUrl from "@coderline/alphatab/soundfont/sonivox.sf3?url";
import { DEMO_TEX } from "./demo";
import { RecordingPanel } from "./RecordingPanel";
import { storage, type StoredFile } from "./storage";

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
  const [position, setPosition] = useState({ current: 0, total: 0 });

  const [recordingLoaded, setRecordingLoaded] = useState(false);
  const [recordingFileName, setRecordingFileName] = useState<string | null>(null);
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
    });
    player.on("playerReady", () => setReady(true));
    player.on("playerStateChanged", setPlaying);
    player.on("positionChanged", (current, total) => {
      setPosition((prev) => {
        const next = { current: Math.floor(current), total: Math.floor(total) };
        return prev.current === next.current && prev.total === next.total ? prev : next;
      });
    });
    player.on("beatClicked", (tick) => {
      const points = syncPointsRef.current;
      if (points) recording.seek(mediaTimeAtTick(points, tick));
    });
    player.on("error", (error) => console.error("[openvoicing]", error));
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__ovPlayer = player;
      (window as unknown as Record<string, unknown>).__ovRecording = recording;
    }
    let disposed = false;
    void (async () => {
      let stored: StoredFile | undefined;
      try {
        stored = await storage.get<StoredFile>("score");
      } catch {
        stored = undefined;
      }
      if (disposed) return;
      if (stored) {
        player.load(new Uint8Array(stored.data));
      } else {
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

  useEffect(() => {
    return recording.on("loaded", () => {
      setRecordingLoaded(true);
      setSyncPoints(null);
      setFollow(false);
      setTapCount(null);
    });
  }, [recording]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await storage.get<StoredFile>("recording");
        if (cancelled || !stored) return;
        await recording.load(stored.data);
        if (cancelled) return;
        setRecordingFileName(stored.name);
        const sync = await storage.get<SyncPoint[]>("sync");
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
    if (!hydratedRef.current) return;
    const timer = setTimeout(() => {
      if (syncPoints?.length) void storage.set("sync", syncPoints);
      else void storage.delete("sync");
    }, 300);
    return () => clearTimeout(timer);
  }, [syncPoints]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void storage.set("follow", follow);
  }, [follow]);

  async function openRecordingFile(file: File) {
    const buffer = await file.arrayBuffer();
    // decodeAudioData detaches the buffer, so persist a copy.
    const copy = buffer.slice(0);
    await recording.load(buffer);
    setRecordingFileName(file.name);
    void storage.set("recording", { name: file.name, data: copy } satisfies StoredFile);
    void storage.delete("sync");
  }

  useEffect(() => {
    if (!follow || !syncPoints) return;
    return recording.on("positionChanged", (seconds) => {
      const player = playerRef.current;
      if (!player) return;
      player.cursorTick = Math.max(0, Math.round(tickAtMediaTime(syncPoints, seconds)));
    });
  }, [follow, syncPoints, recording]);

  function startTapSync() {
    tapsRef.current = [];
    setTapCount(0);
    setFollow(false);
    setSyncPoints(null);
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    const buffer = await file.arrayBuffer();
    const loaded = playerRef.current?.load(new Uint8Array(buffer));
    if (loaded) {
      void storage.set("score", { name: file.name, data: buffer } satisfies StoredFile);
      void storage.delete("sync");
      setSyncPoints(null);
      setFollow(false);
    }
    e.target.value = "";
  }

  return (
    <div className="app">
      <header className="header">
        <h1>OpenVoicing</h1>
        <span className="tagline">open source living sheet music</span>
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

        <span className="position">
          {formatTime(position.current)} / {formatTime(position.total)}
        </span>

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
        fileName={recordingFileName}
        onOpenFile={openRecordingFile}
        syncPoints={syncPoints}
        onMoveSyncPoint={moveSyncPoint}
      />

      {recordingLoaded && (
        <div className="sync-bar">
          <strong>Sync</strong>
          {tapCount === null ? (
            <>
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
              <button onClick={finishTapSync} disabled={tapsRef.current.length < 2}>
                Done
              </button>
              <button onClick={cancelTapSync}>Cancel</button>
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

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@openvoicing/player";
import { RecordingPlayer } from "@openvoicing/audio-engine";
import { mediaTimeAtTick, tickAtMediaTime, type SyncPoint } from "@openvoicing/score-model";
import { readBundle, type Bundle } from "@openvoicing/bundle";
import soundFontUrl from "@coderline/alphatab/soundfont/sonivox.sf3?url";
import "./embed.css";

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function applyDeepLink(
  params: URLSearchParams,
  player: Player,
  recording: RecordingPlayer,
  syncPoints: SyncPoint[] | undefined,
): { speed?: number } {
  const applied: { speed?: number } = {};
  const speed = Number(params.get("speed"));
  if (speed >= 0.25 && speed <= 1.5) {
    if (recording.duration > 0) recording.speed = speed;
    else player.speed = speed;
    applied.speed = speed;
  }
  const loop = params.get("loop");
  if (loop && recording.duration > 0) {
    const bars = /^b(\d+)-(\d+)$/.exec(loop);
    const secs = /^([\d.]+)-([\d.]+)$/.exec(loop);
    if (bars && syncPoints?.length) {
      const ticks = player.barTicks;
      const from = ticks[Number(bars[1]) - 1]?.start;
      const toBar = ticks[Number(bars[2]) - 1];
      if (from !== undefined && toBar) {
        recording.setLoopRegion({
          start: mediaTimeAtTick(syncPoints, from),
          end: mediaTimeAtTick(syncPoints, toBar.start + toBar.duration),
        });
      }
    } else if (secs) {
      recording.setLoopRegion({ start: Number(secs[1]), end: Number(secs[2]) });
    }
  }
  const start = Number(params.get("t"));
  if (start > 0) {
    if (recording.duration > 0) recording.seek(start);
    else player.seekSeconds(start);
  }
  return applied;
}

function EmbedApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const recordingRef = useRef<RecordingPlayer | null>(null);
  const syncRef = useRef<SyncPoint[] | null>(null);
  const hasRecordingRef = useRef(false);
  const bundleRef = useRef<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [ready, setReady] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [recordingIds, setRecordingIds] = useState<Array<{ id: string; name: string }>>([]);
  const [activeRecording, setActiveRecording] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState({ current: 0, total: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const params = new URLSearchParams(window.location.search);
    const url = params.get("bundle");
    if (!url) {
      setError("No bundle specified. Use embed.html?bundle=<url>.");
      return;
    }

    const player = new Player(container, {
      soundFontUrl,
      fontDirectory: "/alphatab/font/",
    });
    playerRef.current = player;
    const recording = new RecordingPlayer();
    recordingRef.current = recording;

    player.on("scoreLoaded", (info) => setTitle(info.title));
    player.on("playerReady", () => setReady(true));
    player.on("playerStateChanged", (p) => {
      if (!hasRecordingRef.current) setPlaying(p);
    });
    player.on("positionChanged", (current, total) => {
      if (!hasRecordingRef.current) setPosition({ current, total });
    });
    player.on("beatClicked", (tick) => {
      const points = syncRef.current;
      if (points) recordingRef.current?.seek(mediaTimeAtTick(points, tick));
    });
    recording.on("stateChanged", setPlaying);
    recording.on("positionChanged", (current, total) => {
      setPosition({ current, total });
      const points = syncRef.current;
      if (points) {
        player.cursorTick = Math.max(0, Math.round(tickAtMediaTime(points, current)));
      }
    });

    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not fetch bundle (HTTP ${response.status})`);
        const bundle = readBundle(new Uint8Array(await response.arrayBuffer()));
        const { manifest } = bundle;

        const scoreBytes = bundle.files.get(manifest.score.path)!;
        if (manifest.score.type === "alphatex") {
          player.loadTex(new TextDecoder().decode(scoreBytes));
        } else {
          player.load(scoreBytes.slice());
        }

        bundleRef.current = bundle;
        setRecordingIds(manifest.recordings.map((r) => ({ id: r.id, name: r.name })));
        const rec = manifest.recordings[0];
        if (rec) {
          const bytes = bundle.files.get(rec.path)!;
          await recording.load(bytes.slice().buffer as ArrayBuffer);
          hasRecordingRef.current = true;
          setHasRecording(true);
          setActiveRecording(rec.id);
          syncRef.current = rec.syncPoints?.length ? rec.syncPoints : null;
        }

        // Deep-link presets: ?speed=0.75&loop=2-6&t=1.5 (loop/t in seconds,
        // or loop=b3-6 for bar numbers when the recording is synced).
        const applied = applyDeepLink(params, player, recording, rec?.syncPoints);
        if (applied.speed) setSpeed(applied.speed);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      playerRef.current = null;
      recordingRef.current = null;
      player.destroy();
      recording.destroy();
    };
  }, []);

  function isPlaying(): boolean {
    if (hasRecordingRef.current) return recordingRef.current?.playing ?? false;
    return playerRef.current?.playing ?? false;
  }

  function togglePlay() {
    if (hasRecordingRef.current) {
      const recording = recordingRef.current;
      if (!recording) return;
      if (recording.playing) recording.pause();
      else void recording.play();
    } else {
      playerRef.current?.playPause();
    }
  }

  function seek(seconds: number) {
    if (hasRecordingRef.current) recordingRef.current?.seek(seconds);
    else playerRef.current?.seekSeconds(seconds);
  }

  function applySpeed(value: number) {
    setSpeed(value);
    if (hasRecordingRef.current && recordingRef.current) {
      recordingRef.current.speed = value;
    } else if (playerRef.current) {
      playerRef.current.speed = value;
    }
  }

  function changeSpeed(e: ChangeEvent<HTMLSelectElement>) {
    applySpeed(Number(e.target.value));
  }

  async function selectRecording(id: string) {
    const bundle = bundleRef.current;
    const recorder = recordingRef.current;
    if (!bundle || !recorder || id === activeRecording) return;
    const entry = bundle.manifest.recordings.find((r) => r.id === id);
    if (!entry) return;
    const bytes = bundle.files.get(entry.path)!;
    await recorder.load(bytes.slice().buffer as ArrayBuffer);
    syncRef.current = entry.syncPoints?.length ? entry.syncPoints : null;
    setActiveRecording(id);
  }

  // Cross-frame control protocol for the embed SDK. Messages are marked with
  // ov: true in both directions; the child never assumes a specific parent origin
  // because bundles are public content.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data as { ov?: boolean; type?: string; seconds?: number; value?: number };
      if (!msg || msg.ov !== true) return;
      switch (msg.type) {
        case "toggle":
          togglePlay();
          break;
        case "play":
          if (!isPlaying()) togglePlay();
          break;
        case "pause":
          if (isPlaying()) togglePlay();
          break;
        case "seek":
          if (typeof msg.seconds === "number") seek(msg.seconds);
          break;
        case "setSpeed":
          if (typeof msg.value === "number") applySpeed(msg.value);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  const embedded = window.parent !== window;

  useEffect(() => {
    if (!embedded || !title) return;
    window.parent.postMessage(
      { ov: true, type: "ready", title, hasRecording, duration: position.total },
      "*",
    );
    // position.total intentionally omitted from deps: ready fires on title/recording
    // changes, not on every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, title, hasRecording]);

  useEffect(() => {
    if (embedded) window.parent.postMessage({ ov: true, type: "state", playing }, "*");
  }, [embedded, playing]);

  useEffect(() => {
    if (embedded) {
      window.parent.postMessage(
        { ov: true, type: "position", current: position.current, total: position.total },
        "*",
      );
    }
  }, [embedded, position]);

  if (error) {
    return (
      <div className="embed-error" role="alert">
        <p>This OpenVoicing player could not load.</p>
        <p className="embed-error-detail">{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="embed">
      <div className="embed-toolbar">
        <button onClick={togglePlay} disabled={!ready && !hasRecording}>
          {playing ? "Pause" : "Play"}
        </button>
        <label>
          Speed
          <select value={speed} onChange={changeSpeed}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </label>
        <span className="embed-position">
          {formatTime(position.current)} / {formatTime(position.total)}
        </span>
        <span className="embed-title">{title}</span>
        {recordingIds.length > 1 && (
          <select
            value={activeRecording ?? ""}
            onChange={(e) => void selectRecording(e.target.value)}
            title="Switch recording"
          >
            {recordingIds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {hasRecording && <span className="embed-badge">recording{syncRef.current ? " + sync" : ""}</span>}
        <a className="embed-brand" href="https://github.com/openvoicing" target="_blank" rel="noreferrer">
          OpenVoicing
        </a>
      </div>
      <div className="embed-score" ref={containerRef} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<EmbedApp />);

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Player, type TrackInfo } from "@openvoicing/player";
import soundFontUrl from "@coderline/alphatab/soundfont/sonivox.sf3?url";
import { DEMO_TEX } from "./demo";

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [position, setPosition] = useState({ current: 0, total: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const player = new Player(container, {
      soundFontUrl,
      fontDirectory: "/alphatab/font/",
    });
    playerRef.current = player;
    player.on("scoreLoaded", (info) => setTracks(info.tracks));
    player.on("playerReady", () => setReady(true));
    player.on("playerStateChanged", setPlaying);
    player.on("positionChanged", (current, total) => {
      setPosition((prev) => {
        const next = { current: Math.floor(current), total: Math.floor(total) };
        return prev.current === next.current && prev.total === next.total ? prev : next;
      });
    });
    player.on("error", (error) => console.error("[openvoicing]", error));
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__ovPlayer = player;
    }
    player.loadTex(DEMO_TEX);
    return () => {
      playerRef.current = null;
      player.destroy();
    };
  }, []);

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
    playerRef.current?.load(new Uint8Array(buffer));
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

      <main className="score" ref={containerRef} />

      <footer className="footer">
        Tip: click a note to jump there, drag across notes to loop a passage.
      </footer>
    </div>
  );
}

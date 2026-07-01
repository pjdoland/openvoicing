import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import {
  RecordingPlayer,
  computePeaks,
  type LoopRegion,
  type WaveformPeaks,
} from "@openvoicing/audio-engine";
import type { SyncPoint } from "@openvoicing/score-model";

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25];
const WAVE_WIDTH = 1200;
const WAVE_HEIGHT = 96;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface DragState {
  startX: number;
  currentX: number;
}

interface RecordingPanelProps {
  player: RecordingPlayer;
  /** Sync anchors to render as draggable markers, or null when unsynced. */
  syncPoints: SyncPoint[] | null;
  onMoveSyncPoint: (index: number, timeSeconds: number) => void;
}

export function RecordingPanel({ player, syncPoints, onMoveSyncPoint }: RecordingPanelProps) {
  const playerRef = useRef<RecordingPlayer | null>(player);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef<WaveformPeaks | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [markerDrag, setMarkerDrag] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    playerRef.current = player;
    const unsubs = [
      player.on("stateChanged", setPlaying),
      player.on("positionChanged", (seconds, total) => {
        setPosition(seconds);
        setDuration(total);
      }),
      player.on("loaded", ({ channels }) => {
        peaksRef.current = computePeaks(channels, WAVE_WIDTH);
        setLoop(null);
      }),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [player]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, WAVE_WIDTH, WAVE_HEIGHT);
    ctx.fillStyle = "#f0f2f5";
    ctx.fillRect(0, 0, WAVE_WIDTH, WAVE_HEIGHT);

    const selection = drag
      ? {
          start: (Math.min(drag.startX, drag.currentX) / WAVE_WIDTH) * duration,
          end: (Math.max(drag.startX, drag.currentX) / WAVE_WIDTH) * duration,
        }
      : loop;
    if (selection && duration > 0) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
      const x = (selection.start / duration) * WAVE_WIDTH;
      const w = ((selection.end - selection.start) / duration) * WAVE_WIDTH;
      ctx.fillRect(x, 0, w, WAVE_HEIGHT);
    }

    const peaks = peaksRef.current;
    if (peaks) {
      ctx.fillStyle = "#4a5568";
      const mid = WAVE_HEIGHT / 2;
      for (let x = 0; x < peaks.length; x++) {
        const top = mid - peaks.max[x]! * mid;
        const bottom = mid - peaks.min[x]! * mid;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    }

    if (syncPoints && duration > 0) {
      ctx.fillStyle = "rgba(37, 99, 235, 0.7)";
      for (const p of syncPoints) {
        ctx.fillRect((p.timeSeconds / duration) * WAVE_WIDTH - 0.5, 0, 1, WAVE_HEIGHT);
      }
    }

    if (duration > 0) {
      ctx.fillStyle = "#e53e3e";
      ctx.fillRect((position / duration) * WAVE_WIDTH - 1, 0, 2, WAVE_HEIGHT);
    }
  }, [position, duration, loop, drag, playing, fileName, syncPoints]);

  function canvasX(e: PointerEvent<HTMLCanvasElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * WAVE_WIDTH;
  }

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (!fileName) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = canvasX(e);
    setDrag({ startX: x, currentX: x });
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    setDrag({ ...drag, currentX: canvasX(e) });
  }

  function onPointerUp() {
    const player = playerRef.current;
    setDrag(null);
    if (!drag || !player || duration === 0) return;
    const from = (Math.min(drag.startX, drag.currentX) / WAVE_WIDTH) * duration;
    const to = (Math.max(drag.startX, drag.currentX) / WAVE_WIDTH) * duration;
    if (Math.abs(drag.currentX - drag.startX) < 4) {
      player.seek(from);
      return;
    }
    const region = { start: from, end: to };
    setLoop(region);
    player.setLoopRegion(region);
  }

  function onMarkerPointerDown(e: PointerEvent<HTMLDivElement>, index: number) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setMarkerDrag(index);
  }

  function onMarkerPointerMove(e: PointerEvent<HTMLDivElement>, index: number) {
    if (markerDrag !== index || duration === 0) return;
    const lane = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!lane) return;
    const timeSeconds = ((e.clientX - lane.left) / lane.width) * duration;
    onMoveSyncPoint(index, timeSeconds);
  }

  function clearLoop() {
    setLoop(null);
    playerRef.current?.setLoopRegion(null);
  }

  async function openFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    await playerRef.current?.load(buffer);
    setFileName(file.name);
    e.target.value = "";
  }

  function changeSpeed(e: ChangeEvent<HTMLSelectElement>) {
    const value = Number(e.target.value);
    setSpeed(value);
    if (playerRef.current) playerRef.current.speed = value;
  }

  return (
    <section className="recording">
      <div className="recording-toolbar">
        <strong>Recording</strong>
        <label className="control open-file">
          {fileName ?? "Open audio…"}
          <input type="file" accept="audio/*" onChange={openFile} />
        </label>
        {fileName && (
          <>
            <button onClick={() => (playing ? playerRef.current?.pause() : playerRef.current?.play())}>
              {playing ? "Pause" : "Play"}
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
            {loop && (
              <button onClick={clearLoop}>
                Clear loop ({formatTime(loop.start)} to {formatTime(loop.end)})
              </button>
            )}
            <span className="position">
              {formatTime(position)} / {formatTime(duration)}
            </span>
            <span className="hint">drag on the waveform to loop, click to seek</span>
          </>
        )}
      </div>
      {fileName && syncPoints && duration > 0 && (
        <div className="sync-lane">
          {syncPoints.map((p, i) => (
            <div
              key={i}
              className={markerDrag === i ? "sync-marker dragging" : "sync-marker"}
              style={{ left: `${(p.timeSeconds / duration) * 100}%` }}
              title={`Bar ${i + 1}: ${p.timeSeconds.toFixed(2)}s. Drag to adjust.`}
              onPointerDown={(e) => onMarkerPointerDown(e, i)}
              onPointerMove={(e) => onMarkerPointerMove(e, i)}
              onPointerUp={() => setMarkerDrag(null)}
            >
              {i + 1}
            </div>
          ))}
        </div>
      )}
      {fileName && (
        <canvas
          ref={canvasRef}
          className="waveform"
          width={WAVE_WIDTH}
          height={WAVE_HEIGHT}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
    </section>
  );
}

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
const MAX_ZOOM = 16;

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
  fileName: string | null;
  onOpenFile: (file: File) => Promise<void>;
  /** Sync anchors to render as draggable markers, or null when unsynced. */
  syncPoints: SyncPoint[] | null;
  onMoveSyncPoint: (index: number, timeSeconds: number) => void;
}

export function RecordingPanel({
  player,
  fileName,
  onOpenFile,
  syncPoints,
  onMoveSyncPoint,
}: RecordingPanelProps) {
  const playerRef = useRef<RecordingPlayer | null>(player);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelsRef = useRef<Float32Array[] | null>(null);
  const peaksRef = useRef<WaveformPeaks | null>(null);
  const pendingCenterRef = useRef<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Ref, not state: pointermove events can arrive before a state update from
  // pointerdown commits, which would silently drop the start of a drag.
  const markerDragRef = useRef<number | null>(null);
  const [markerDrag, setMarkerDrag] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loop, setLoop] = useState<LoopRegion | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const contentWidth = WAVE_WIDTH * zoom;

  useEffect(() => {
    playerRef.current = player;
    const unsubs = [
      player.on("stateChanged", setPlaying),
      player.on("positionChanged", (seconds, total) => {
        setPosition(seconds);
        setDuration(total);
      }),
      player.on("loaded", ({ channels }) => {
        channelsRef.current = channels;
        peaksRef.current = computePeaks(channels, WAVE_WIDTH);
        setZoom(1);
        setLoop(null);
      }),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [player]);

  // Peaks are cached per zoom level; recompute when the resolution changes.
  useEffect(() => {
    const channels = channelsRef.current;
    if (!channels) return;
    if (peaksRef.current?.length !== WAVE_WIDTH * zoom) {
      peaksRef.current = computePeaks(channels, WAVE_WIDTH * zoom);
    }
    const el = scrollRef.current;
    const centerFraction = pendingCenterRef.current;
    if (el && centerFraction !== null) {
      el.scrollLeft = centerFraction * el.scrollWidth - el.clientWidth / 2;
      pendingCenterRef.current = null;
    }
  }, [zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, contentWidth, WAVE_HEIGHT);
    ctx.fillStyle = "#f0f2f5";
    ctx.fillRect(0, 0, contentWidth, WAVE_HEIGHT);

    const selection = drag
      ? {
          start: (Math.min(drag.startX, drag.currentX) / contentWidth) * duration,
          end: (Math.max(drag.startX, drag.currentX) / contentWidth) * duration,
        }
      : loop;
    if (selection && duration > 0) {
      ctx.fillStyle = "rgba(59, 130, 246, 0.18)";
      const x = (selection.start / duration) * contentWidth;
      const w = ((selection.end - selection.start) / duration) * contentWidth;
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
        ctx.fillRect((p.timeSeconds / duration) * contentWidth - 0.5, 0, 1, WAVE_HEIGHT);
      }
    }

    if (duration > 0) {
      ctx.fillStyle = "#e53e3e";
      ctx.fillRect((position / duration) * contentWidth - 1, 0, 2, WAVE_HEIGHT);
    }
  }, [position, duration, loop, drag, playing, fileName, syncPoints, zoom, contentWidth]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing || duration === 0) return;
    const playheadX = (position / duration) * el.scrollWidth;
    const margin = el.clientWidth * 0.1;
    if (playheadX < el.scrollLeft + margin || playheadX > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = playheadX - el.clientWidth / 2;
    }
  }, [position, playing, duration, zoom]);

  function changeZoom(next: number) {
    const el = scrollRef.current;
    if (el && el.scrollWidth > 0) {
      pendingCenterRef.current = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
    }
    setZoom(next);
  }

  function canvasX(e: PointerEvent<HTMLCanvasElement>): number {
    const rect = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * contentWidth;
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
    const from = (Math.min(drag.startX, drag.currentX) / contentWidth) * duration;
    const to = (Math.max(drag.startX, drag.currentX) / contentWidth) * duration;
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
    markerDragRef.current = index;
    setMarkerDrag(index);
  }

  function onMarkerPointerMove(e: PointerEvent<HTMLDivElement>, index: number) {
    if (markerDragRef.current !== index || duration === 0) return;
    const lane = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!lane) return;
    const timeSeconds = ((e.clientX - lane.left) / lane.width) * duration;
    onMoveSyncPoint(index, timeSeconds);
  }

  function onMarkerPointerUp() {
    markerDragRef.current = null;
    setMarkerDrag(null);
  }

  function clearLoop() {
    setLoop(null);
    playerRef.current?.setLoopRegion(null);
  }

  async function openFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await onOpenFile(file);
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
            <span className="control zoom-controls">
              <button onClick={() => changeZoom(Math.max(1, zoom / 2))} disabled={zoom <= 1}>
                −
              </button>
              {zoom}×
              <button
                onClick={() => changeZoom(Math.min(MAX_ZOOM, zoom * 2))}
                disabled={zoom >= MAX_ZOOM}
              >
                +
              </button>
            </span>
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
      {fileName && (
        <div className="wave-scroll" ref={scrollRef}>
          <div className="wave-content" style={{ width: `${zoom * 100}%` }}>
            {syncPoints && duration > 0 && (
              <div className="sync-lane">
                {syncPoints.map((p, i) => (
                  <div
                    key={i}
                    className={markerDrag === i ? "sync-marker dragging" : "sync-marker"}
                    style={{ left: `${(p.timeSeconds / duration) * 100}%` }}
                    title={`Bar ${i + 1}: ${p.timeSeconds.toFixed(2)}s. Drag to adjust.`}
                    onPointerDown={(e) => onMarkerPointerDown(e, i)}
                    onPointerMove={(e) => onMarkerPointerMove(e, i)}
                    onPointerUp={onMarkerPointerUp}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            <canvas
              ref={canvasRef}
              className="waveform"
              width={contentWidth}
              height={WAVE_HEIGHT}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </div>
        </div>
      )}
    </section>
  );
}

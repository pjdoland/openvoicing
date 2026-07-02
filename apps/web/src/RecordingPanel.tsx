import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from "react";
import {
  RecordingPlayer,
  computePeaks,
  type LoopRegion,
  type WaveformPeaks,
} from "@openvoicing/audio-engine";
import type { SyncPoint } from "@openvoicing/score-model";
import type { SavedLoop } from "@openvoicing/bundle";
import type { RecordingMeta } from "./storage";
import { SpeedControl } from "./SpeedControl";

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
  recordings: RecordingMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddFile: (file: File) => Promise<void>;
  onRemove: (id: string) => void;
  /** Sync anchors to render as draggable markers, or null when unsynced. */
  syncPoints: SyncPoint[] | null;
  onMoveSyncPoint: (index: number, timeSeconds: number) => void;
  onNudgeSyncPoint: (index: number, deltaSeconds: number) => void;
  onEndSyncDrag: () => void;
  syncConfidence: Array<"good" | "fair" | "poor"> | null;
  /** Bar boundary times (seconds) when synced; drag loops snap to these. */
  barTimes: number[] | null;
  savedLoops: SavedLoop[];
  onSaveLoop: () => void;
  onRecallLoop: (loop: SavedLoop) => void;
  onDeleteLoop: (id: string) => void;
}

export function RecordingPanel({
  player,
  recordings,
  activeId,
  onSelect,
  onAddFile,
  onRemove,
  syncPoints,
  onMoveSyncPoint,
  onNudgeSyncPoint,
  onEndSyncDrag,
  syncConfidence,
  barTimes,
  savedLoops,
  onSaveLoop,
  onRecallLoop,
  onDeleteLoop,
}: RecordingPanelProps) {
  const hasActive = activeId !== null;
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
  const [repeats, setRepeats] = useState(0);
  const [gap, setGap] = useState(0);
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
      player.on("speedChanged", setSpeed),
      player.on("loopChanged", (region) => {
        setLoop(region);
        setRepeats(0);
      }),
      player.on("looped", () => setRepeats((n) => n + 1)),
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
  }, [position, duration, loop, drag, playing, activeId, syncPoints, zoom, contentWidth]);

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
    if (!hasActive) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = canvasX(e);
    setDrag({ startX: x, currentX: x });
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    setDrag({ ...drag, currentX: canvasX(e) });
  }

  function snapToBar(seconds: number): number {
    if (!barTimes || barTimes.length === 0) return seconds;
    let best = barTimes[0]!;
    for (const t of barTimes) {
      if (Math.abs(t - seconds) < Math.abs(best - seconds)) best = t;
    }
    return best;
  }

  function onPointerUp(e: PointerEvent<HTMLCanvasElement>) {
    const player = playerRef.current;
    setDrag(null);
    if (!drag || !player || duration === 0) return;
    let from = (Math.min(drag.startX, drag.currentX) / contentWidth) * duration;
    let to = (Math.max(drag.startX, drag.currentX) / contentWidth) * duration;
    if (Math.abs(drag.currentX - drag.startX) < 4) {
      player.seek(from);
      return;
    }
    // Synced loops snap to bar boundaries; hold Alt for exact placement.
    if (!e.altKey) {
      const snappedFrom = snapToBar(from);
      const snappedTo = snapToBar(to);
      if (snappedTo > snappedFrom) {
        from = snappedFrom;
        to = snappedTo;
      }
    }
    player.setLoopRegion({ start: from, end: to });
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
    onEndSyncDrag();
  }

  function onMarkerKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, index: number) {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const base = e.shiftKey ? 0.05 : 0.01;
      onNudgeSyncPoint(index, e.key === "ArrowRight" ? base : -base);
      onEndSyncDrag();
    }
  }

  function clearLoop() {
    playerRef.current?.setLoopRegion(null);
  }

  async function openFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await onAddFile(file);
    e.target.value = "";
  }

  function changeSpeed(value: number) {
    if (playerRef.current) playerRef.current.speed = value;
  }

  return (
    <section className="recording">
      <div className="recording-toolbar">
        <strong>Recording</strong>
        {recordings.length > 0 && (
          <select
            value={activeId ?? ""}
            onChange={(e) => onSelect(e.target.value)}
            title="Switch recording"
          >
            {recordings.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {hasActive && (
          <button
            title="Remove this recording"
            onClick={() => activeId && onRemove(activeId)}
          >
            ✕
          </button>
        )}
        <label className="control open-file">
          Add audio…
          <input type="file" accept="audio/*" onChange={openFile} />
        </label>
        {hasActive && (
          <>
            <button onClick={() => (playing ? playerRef.current?.pause() : playerRef.current?.play())}>
              {playing ? "Pause" : "Play"}
            </button>
            <SpeedControl value={speed} onChange={changeSpeed} />
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
              <>
                <button onClick={clearLoop}>
                  Clear loop ({formatTime(loop.start)} to {formatTime(loop.end)})
                </button>
                <span className="position" title="Loop repetitions">
                  ×{repeats}
                </span>
                <button onClick={onSaveLoop} title="Save this loop with a name">
                  Save loop
                </button>
                <label className="control" title="Silence with count-in between loop repeats">
                  Gap
                  <select
                    value={gap}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setGap(value);
                      if (playerRef.current) playerRef.current.loopGapSeconds = value;
                    }}
                  >
                    <option value={0}>off</option>
                    <option value={1}>1s</option>
                    <option value={2}>2s</option>
                    <option value={3}>3s</option>
                  </select>
                </label>
              </>
            )}
            {savedLoops.length > 0 && (
              <span className="control">
                <select
                  value=""
                  title="Recall a saved loop (keys 1-9)"
                  aria-label="Saved loops"
                  onChange={(e) => {
                    const found = savedLoops.find((l) => l.id === e.target.value);
                    if (found) onRecallLoop(found);
                  }}
                >
                  <option value="" disabled>
                    Loops ({savedLoops.length})
                  </option>
                  {savedLoops.map((l, i) => (
                    <option key={l.id} value={l.id}>
                      {i + 1}. {l.name} ({formatTime(l.start)} to {formatTime(l.end)})
                    </option>
                  ))}
                </select>
                {loop && savedLoops.some((l) => l.start === loop.start && l.end === loop.end) && (
                  <button
                    title="Delete the saved loop matching the current region"
                    onClick={() => {
                      const match = savedLoops.find(
                        (l) => l.start === loop.start && l.end === loop.end,
                      );
                      if (match) onDeleteLoop(match.id);
                    }}
                  >
                    🗑
                  </button>
                )}
              </span>
            )}
            <span className="position">
              {formatTime(position)} / {formatTime(duration)}
            </span>
            <span className="hint">drag on the waveform to loop, click to seek</span>
          </>
        )}
      </div>
      {hasActive && (
        <div className="wave-scroll" ref={scrollRef}>
          <div className="wave-content" style={{ width: `${zoom * 100}%` }}>
            {syncPoints && duration > 0 && (
              <div className="sync-lane">
                {syncPoints.map((p, i) => {
                  const confidence = syncConfidence?.[i];
                  const cls = [
                    "sync-marker",
                    markerDrag === i ? "dragging" : "",
                    confidence ? `conf-${confidence}` : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div
                      key={i}
                      className={cls}
                      style={{ left: `${(p.timeSeconds / duration) * 100}%` }}
                      tabIndex={0}
                      role="slider"
                      aria-label={`Bar ${i + 1} sync point`}
                      aria-valuenow={Number(p.timeSeconds.toFixed(2))}
                      aria-valuetext={`${p.timeSeconds.toFixed(2)} seconds${confidence ? `, ${confidence} confidence` : ""}`}
                      title={`Bar ${i + 1}: ${p.timeSeconds.toFixed(2)}s${confidence ? ` (${confidence})` : ""}. Drag or arrow-nudge.`}
                      onPointerDown={(e) => onMarkerPointerDown(e, i)}
                      onPointerMove={(e) => onMarkerPointerMove(e, i)}
                      onPointerUp={onMarkerPointerUp}
                      onKeyDown={(e) => onMarkerKeyDown(e, i)}
                    >
                      {i + 1}
                    </div>
                  );
                })}
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

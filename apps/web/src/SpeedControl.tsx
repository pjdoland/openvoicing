import { useEffect, useRef, useState, type WheelEvent } from "react";

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 1.5;
export const SPEED_STEP = 0.05;
/** Coarse step for Shift-click / Shift-arrow, so 100%->50% isn't ten presses. */
export const SPEED_COARSE = 0.25;

const PRESETS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1];

export function clampSpeed(value: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(value * 100) / 100));
}

export function SpeedControl({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const step = (dir: number, coarse: boolean) =>
    onChange(clampSpeed(value + dir * (coarse ? SPEED_COARSE : SPEED_STEP)));
  const pct = Math.round(value * 100);
  const onWheel = (e: WheelEvent) => step(e.deltaY < 0 ? 1 : -1, e.shiftKey);

  return (
    <span
      className="control zoom-controls speed-control"
      role="group"
      aria-label={label ?? "Playback speed"}
      ref={rootRef}
      onWheel={onWheel}
    >
      {label ?? "Speed"}
      <button
        title="Slower (−, 5%; Shift for 25%)"
        aria-label="Slower"
        onClick={(e) => step(-1, e.shiftKey)}
        disabled={value <= SPEED_MIN}
      >
        −
      </button>
      <button
        className="speed-value"
        title="Set tempo"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {pct}%
      </button>
      <button
        title="Faster (=, 5%; Shift for 25%)"
        aria-label="Faster"
        onClick={(e) => step(1, e.shiftKey)}
        disabled={value >= SPEED_MAX}
      >
        +
      </button>
      {open && (
        <div className="popover-panel speed-menu" role="menu">
          <div className="speed-presets">
            {PRESETS.map((p) => (
              <button
                key={p}
                className={"speed-preset" + (pct === Math.round(p * 100) ? " on" : "")}
                role="menuitemradio"
                aria-checked={pct === Math.round(p * 100)}
                onClick={() => {
                  onChange(clampSpeed(p));
                  setOpen(false);
                }}
              >
                {Math.round(p * 100)}%
              </button>
            ))}
          </div>
          <label className="speed-numeric">
            Set
            <input
              type="number"
              min={25}
              max={150}
              step={5}
              defaultValue={pct}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onChange(clampSpeed(Number(e.currentTarget.value) / 100));
                  setOpen(false);
                }
              }}
            />
            %
          </label>
        </div>
      )}
    </span>
  );
}

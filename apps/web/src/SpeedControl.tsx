export const SPEED_MIN = 0.25;
export const SPEED_MAX = 1.5;
export const SPEED_STEP = 0.05;

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
  return (
    <span
      className="control zoom-controls"
      role="group"
      aria-label={label ?? "Playback speed"}
    >
      {label ?? "Speed"}
      <button
        title="Slower (-5%)"
        aria-label="Slower"
        onClick={() => onChange(clampSpeed(value - SPEED_STEP))}
        disabled={value <= SPEED_MIN}
      >
        −
      </button>
      <span className="speed-value">{Math.round(value * 100)}%</span>
      <button
        title="Faster (+5%)"
        aria-label="Faster"
        onClick={() => onChange(clampSpeed(value + SPEED_STEP))}
        disabled={value >= SPEED_MAX}
      >
        +
      </button>
    </span>
  );
}

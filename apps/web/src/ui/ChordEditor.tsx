import type { v1 } from "@openvoicing/score-model";

type ChordDiagram = v1.ChordDiagram;

const STRINGS = 6;
const FRETS = 4;

/**
 * A small click-to-draw fretboard diagram. Click a cell to fret that string,
 * click the marker above the nut to cycle open (o) / muted (x). Read-only when
 * no onChange is given, so the same component renders and edits.
 */
export function ChordEditor({
  value,
  onChange,
}: {
  value: ChordDiagram;
  onChange?: (next: ChordDiagram) => void;
}) {
  const { firstFret, strings } = value;
  const W = 132;
  const H = 168;
  const padX = 16;
  const padTop = 34;
  const gridW = W - padX * 2;
  const gridH = H - padTop - 14;
  const colW = gridW / (STRINGS - 1);
  const rowH = gridH / FRETS;

  const setString = (s: number, fret: number) => {
    if (!onChange) return;
    const next = [...strings];
    next[s] = fret;
    onChange({ ...value, strings: next });
  };
  const cycleTop = (s: number) => {
    // open (0) -> muted (-1) -> unset back to open
    const cur = strings[s] ?? 0;
    setString(s, cur === 0 ? -1 : 0);
  };

  return (
    <svg
      className="chord-editor"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label="Chord fingering"
    >
      {/* nut / first-fret label */}
      {firstFret > 1 && (
        <text x={padX - 6} y={padTop + rowH / 2 + 4} textAnchor="end" className="chord-fretlabel">
          {firstFret}
        </text>
      )}
      <rect
        x={padX}
        y={padTop - (firstFret <= 1 ? 3 : 0)}
        width={gridW}
        height={firstFret <= 1 ? 3 : 1}
        className="chord-nut"
      />
      {/* fret lines */}
      {Array.from({ length: FRETS + 1 }, (_, r) => (
        <line
          key={`f${r}`}
          x1={padX}
          y1={padTop + r * rowH}
          x2={padX + gridW}
          y2={padTop + r * rowH}
          className="chord-line"
        />
      ))}
      {/* strings + top markers + click targets */}
      {Array.from({ length: STRINGS }, (_, s) => {
        const x = padX + s * colW;
        const fret = strings[s] ?? 0;
        return (
          <g key={`s${s}`}>
            <line x1={x} y1={padTop} x2={x} y2={padTop + gridH} className="chord-line" />
            {/* top open/muted marker */}
            <text
              x={x}
              y={padTop - 8}
              textAnchor="middle"
              className={"chord-topmark" + (onChange ? " editable" : "")}
              onClick={() => cycleTop(s)}
            >
              {fret < 0 ? "×" : fret === 0 ? "○" : ""}
            </text>
            {/* fret cells */}
            {Array.from({ length: FRETS }, (_, r) => {
              const cellFret = firstFret + r;
              const cy = padTop + r * rowH + rowH / 2;
              const on = fret === cellFret;
              return (
                <g key={`c${s}-${r}`}>
                  {onChange && (
                    <rect
                      x={x - colW / 2}
                      y={padTop + r * rowH}
                      width={colW}
                      height={rowH}
                      fill="transparent"
                      className="chord-cell"
                      onClick={() => setString(s, on ? 0 : cellFret)}
                    />
                  )}
                  {on && <circle cx={x} cy={cy} r={7} className="chord-dot" />}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

export const EMPTY_CHORD: ChordDiagram = {
  firstFret: 1,
  strings: [0, 0, 0, 0, 0, 0],
};

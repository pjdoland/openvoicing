import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "contrast";

const THEME_KEY = "ov-theme";
const SCALE_KEY = "ov-scale";

export function useAppSettings() {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || "light",
  );
  const [scale, setScaleState] = useState<number>(
    () => Number(localStorage.getItem(SCALE_KEY)) || 16,
  );

  useEffect(() => {
    if (theme === "light") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--base-font", `${scale}px`);
    localStorage.setItem(SCALE_KEY, String(scale));
  }, [scale]);

  return { theme, setTheme: setThemeState, scale, setScale: setScaleState };
}

export function SettingsControls({
  theme,
  setTheme,
  scale,
  setScale,
}: ReturnType<typeof useAppSettings>) {
  return (
    <>
      <label className="control" style={{ color: "var(--header-btn-fg)" }}>
        <span className="sr-only">Theme</span>
        <select
          className="header-select"
          value={theme}
          aria-label="Color theme"
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="contrast">High contrast</option>
        </select>
      </label>
      <span className="control" style={{ color: "var(--header-btn-fg)" }}>
        <button
          className="header-button"
          aria-label="Decrease text size"
          onClick={() => setScale(Math.max(12, scale - 1))}
        >
          A−
        </button>
        <button
          className="header-button"
          aria-label="Increase text size"
          onClick={() => setScale(Math.min(22, scale + 1))}
        >
          A+
        </button>
      </span>
    </>
  );
}

const SHORTCUTS: Array<[string, string] | { section: string }> = [
  { section: "Transport" },
  ["Space", "Play / pause"],
  ["− / +", "Speed down / up 5%"],
  ["h", "Toggle half speed"],
  ["[ / ]", "Set loop start / end during playback"],
  ["1-9", "Recall saved loop"],
  { section: "Sync" },
  ["p", "Plant sync point at playhead"],
  ["Cmd/Ctrl+Z", "Undo sync edit"],
  ["← →", "Nudge a focused sync marker"],
  { section: "Editor (Edit mode)" },
  ["a-g", "Set pitch"],
  ["Shift+a-g", "Add note to chord"],
  ["← →", "Move selection"],
  ["Shift+← →", "Extend selection"],
  ["↑ ↓", "Transpose note (Shift = octave)"],
  ["1 2 4 8 6 3", "Set duration"],
  [".", "Toggle dot"],
  ["+ / −", "Sharpen / flatten"],
  ["Shift+3", "Toggle triplet"],
  ["r", "Rest"],
  ["b", "Repeat previous bar"],
  ["t", "Tie to next"],
  ["j", "Respell enharmonic"],
  ["l", "Edit lyric"],
  ["i", "Insert beat"],
  ["x", "Delete beat"],
  ["Cmd/Ctrl+C/X/V", "Copy / cut / paste"],
  ["Cmd/Ctrl+Z", "Undo / redo (with Shift)"],
  ["Esc", "Deselect"],
  { section: "General" },
  ["?", "Show this cheat sheet"],
];

export function CheatSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="cheatsheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div className="cheatsheet" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <dl>
          {SHORTCUTS.map((row, i) =>
            "section" in row ? (
              <div key={i} className="cheatsheet-section">
                {row.section}
              </div>
            ) : (
              <div key={i} style={{ display: "contents" }}>
                <dt>{row[0]}</dt>
                <dd>{row[1]}</dd>
              </div>
            ),
          )}
        </dl>
      </div>
    </div>
  );
}

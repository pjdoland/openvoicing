import { useState } from "react";
import { Menu } from "./Menu";

export interface Section {
  barIndex: number;
  label: string;
}

/**
 * One navigation control that replaces the separate go-to-bar input, Sections
 * dropdown, and +Section button: type a bar number or a section name to jump,
 * and manage sections from an attached caret menu.
 */
export function NavigateControl({
  barCount,
  sections,
  locked,
  currentSection,
  onJumpBar,
  onJumpSection,
  onStepSection,
  onAddSection,
  onRenameSection,
  onDeleteSection,
}: {
  barCount: number;
  sections: Section[];
  locked: boolean;
  /** 1-based index of the section the playhead is in, or 0 for none/before. */
  currentSection: number;
  onJumpBar: (bar: number) => void;
  onJumpSection: (barIndex: number) => void;
  onStepSection: (dir: 1 | -1) => void;
  onAddSection: () => void;
  onRenameSection: (barIndex: number) => void;
  onDeleteSection: (barIndex: number) => void;
}) {
  const [value, setValue] = useState("");

  function go(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const asBar = Number(trimmed);
    if (Number.isInteger(asBar) && asBar >= 1 && asBar <= barCount) {
      onJumpBar(asBar);
    } else {
      const match = sections.find((s) => s.label.toLowerCase() === trimmed.toLowerCase());
      if (match) onJumpSection(match.barIndex);
    }
    setValue("");
  }

  const manageItems = [
    { label: "Add section here", onSelect: onAddSection },
    ...(sections.length
      ? ([{ divider: true }, { label: "Sections", heading: true }] as const)
      : []),
    ...sections.flatMap((s) => [
      { label: `Go to ${s.label} (bar ${s.barIndex + 1})`, onSelect: () => onJumpSection(s.barIndex) },
    ]),
    ...(sections.length && !locked ? [{ divider: true } as const] : []),
    ...(!locked
      ? sections.map((s) => ({
          label: `Rename "${s.label}"…`,
          onSelect: () => onRenameSection(s.barIndex),
        }))
      : []),
    ...(!locked
      ? sections.map((s) => ({
          label: `Delete "${s.label}"`,
          onSelect: () => onDeleteSection(s.barIndex),
        }))
      : []),
  ];

  return (
    <span className="navigate">
      <input
        className="bars-input"
        list="ov-sections"
        placeholder="Bar # or section"
        title="Type a bar number (e.g. 12) or a section name, then Enter"
        aria-label="Jump to a bar number or section name"
        value={value}
        size={14}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go((e.target as HTMLInputElement).value);
        }}
      />
      <datalist id="ov-sections">
        {sections.map((s) => (
          <option key={s.barIndex} value={s.label} />
        ))}
      </datalist>
      {sections.length > 0 && (
        <span className="section-stepper" role="group" aria-label="Step through sections">
          <button
            className="btn-icon"
            onClick={() => onStepSection(-1)}
            title="Previous section (Page Up)"
            aria-label="Previous section"
          >
            ‹
          </button>
          <span className="section-readout" aria-live="polite" title="Current section">
            {currentSection > 0 ? currentSection : "–"} / {sections.length}
          </span>
          <button
            className="btn-icon"
            onClick={() => onStepSection(1)}
            title="Next section (Page Down)"
            aria-label="Next section"
          >
            ›
          </button>
        </span>
      )}
      {!locked && <Menu label="Sections" items={manageItems} className="navigate-menu" />}
    </span>
  );
}

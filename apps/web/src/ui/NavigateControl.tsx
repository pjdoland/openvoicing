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
  onJumpBar,
  onJumpSection,
  onAddSection,
  onRenameSection,
  onDeleteSection,
}: {
  barCount: number;
  sections: Section[];
  locked: boolean;
  onJumpBar: (bar: number) => void;
  onJumpSection: (barIndex: number) => void;
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
        placeholder="bar or section"
        aria-label="Jump to bar or section"
        value={value}
        size={12}
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
      {!locked && <Menu label="Sections" items={manageItems} className="navigate-menu" />}
    </span>
  );
}

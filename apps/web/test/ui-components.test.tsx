import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Menu } from "../src/ui/Menu";
import { Popover } from "../src/ui/Popover";
import { CommandPalette } from "../src/ui/CommandPalette";
import { CollapsiblePanel, resetLayout } from "../src/ui/CollapsiblePanel";
import { NavigateControl } from "../src/ui/NavigateControl";
import type { Command } from "../src/ui/commands";

beforeEach(() => localStorage.clear());

describe("Menu", () => {
  it("opens, runs an item, and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu
        label="File"
        items={[
          { label: "Group", heading: true },
          { label: "New", onSelect },
          { divider: true },
          { label: "Disabled", disabled: true },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /File/ }));
    expect(screen.getByRole("menu", { name: "File" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Disabled" })).toBeDisabled();
    await user.click(screen.getByRole("menuitem", { name: "New" }));
    expect(onSelect).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Menu label="View" items={[{ label: "X" }]} />);
    await user.click(screen.getByRole("button", { name: /View/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("Popover", () => {
  it("toggles its panel", async () => {
    const user = userEvent.setup();
    render(
      <Popover label="Loop">
        <span>panel content</span>
      </Popover>,
    );
    expect(screen.queryByText("panel content")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Loop/ }));
    expect(screen.getByText("panel content")).toBeInTheDocument();
  });
});

describe("CommandPalette", () => {
  const commands: Command[] = [
    { id: "play", label: "Play", group: "Transport", run: vi.fn() },
    { id: "midi", label: "Export MIDI", group: "File", run: vi.fn() },
  ];

  it("filters and runs a command with keyboard", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} />);
    await user.type(screen.getByRole("combobox"), "export");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Export MIDI");
    await user.keyboard("{Enter}");
    expect(commands[1]!.run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty message and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} />);
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText("No matching commands")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CollapsiblePanel", () => {
  it("collapses, expands, and persists state", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <CollapsiblePanel id="rec" title="Recording">
        <span>body</span>
      </CollapsiblePanel>,
    );
    expect(screen.getByText("body")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Recording/ }));
    expect(screen.queryByText("body")).not.toBeInTheDocument();
    expect(localStorage.getItem("panel:rec")).toBe("0");

    unmount();
    render(
      <CollapsiblePanel id="rec" title="Recording">
        <span>body</span>
      </CollapsiblePanel>,
    );
    // Stays collapsed from persisted state.
    expect(screen.queryByText("body")).not.toBeInTheDocument();
    resetLayout();
    expect(localStorage.getItem("panel:rec")).toBeNull();
  });
});

describe("NavigateControl", () => {
  const base = {
    barCount: 8,
    sections: [{ barIndex: 2, label: "Chorus" }],
    locked: false,
    onJumpBar: vi.fn(),
    onJumpSection: vi.fn(),
    onAddSection: vi.fn(),
    onRenameSection: vi.fn(),
    onDeleteSection: vi.fn(),
  };

  it("jumps to a bar number on Enter", async () => {
    const user = userEvent.setup();
    const onJumpBar = vi.fn();
    render(<NavigateControl {...base} onJumpBar={onJumpBar} />);
    await user.type(screen.getByLabelText("Jump to a bar number or section name"), "5{Enter}");
    expect(onJumpBar).toHaveBeenCalledWith(5);
  });

  it("jumps to a section by name", async () => {
    const user = userEvent.setup();
    const onJumpSection = vi.fn();
    render(<NavigateControl {...base} onJumpSection={onJumpSection} />);
    await user.type(screen.getByLabelText("Jump to a bar number or section name"), "chorus{Enter}");
    expect(onJumpSection).toHaveBeenCalledWith(2);
  });

  it("ignores out-of-range bars", async () => {
    const user = userEvent.setup();
    const onJumpBar = vi.fn();
    render(<NavigateControl {...base} onJumpBar={onJumpBar} />);
    await user.type(screen.getByLabelText("Jump to a bar number or section name"), "99{Enter}");
    expect(onJumpBar).not.toHaveBeenCalled();
  });
});

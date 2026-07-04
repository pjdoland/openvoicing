import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RecordingPlayer } from "@openvoicing/audio-engine";
import { RecordingPanel } from "../src/RecordingPanel";

/** A minimal stand-in for RecordingPlayer: RecordingPanel only subscribes and
 *  reads a few fields in these tests. */
function fakePlayer(): RecordingPlayer {
  return {
    // Emit an initial position so the panel's duration state is set (>0),
    // which the waveform/sync lane render depends on.
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "positionChanged") handler(0, 16);
      return () => {};
    }),
    setLoopRegion: vi.fn(),
    seek: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    loopRegion: null,
    duration: 16,
    position: 0,
    playing: false,
    speed: 1,
    pitchSemitones: 0,
  } as unknown as RecordingPlayer;
}

const baseProps = {
  player: fakePlayer(),
  recordings: [
    { id: "r1", name: "take-one.mp3" },
    { id: "r2", name: "take-two.wav" },
  ],
  activeId: "r1",
  onSelect: vi.fn(),
  onAddFile: vi.fn(async () => {}),
  onRemove: vi.fn(),
  syncPoints: null,
  onMoveSyncPoint: vi.fn(),
  onNudgeSyncPoint: vi.fn(),
  onEndSyncDrag: vi.fn(),
  syncConfidence: null,
  barTimes: null,
  savedLoops: [],
  onSaveLoop: vi.fn(),
  onRecallLoop: vi.fn(),
  onDeleteLoop: vi.fn(),
  pitchSemitones: 0,
  onPitchChange: vi.fn(),
};

describe("RecordingPanel", () => {
  it("lists recordings and switches on select", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<RecordingPanel {...baseProps} onSelect={onSelect} />);
    const selector = screen.getByRole("combobox", { name: "Switch recording" });
    expect(within(selector).getByText("take-one.mp3")).toBeInTheDocument();
    await user.selectOptions(selector, "r2");
    expect(onSelect).toHaveBeenCalledWith("r2");
  });

  it("steps pitch via the pitch controls", async () => {
    const user = userEvent.setup();
    const onPitchChange = vi.fn();
    render(<RecordingPanel {...baseProps} pitchSemitones={0} onPitchChange={onPitchChange} />);
    await user.click(screen.getByRole("button", { name: "Pitch up" }));
    expect(onPitchChange).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: "Pitch down" }));
    expect(onPitchChange).toHaveBeenCalledWith(-1);
  });

  it("renders sync markers with confidence colors and accessible names", () => {
    render(
      <RecordingPanel
        {...baseProps}
        syncPoints={[
          { tick: 0, timeSeconds: 0 },
          { tick: 3840, timeSeconds: 2 },
          { tick: 7680, timeSeconds: 4 },
        ]}
        syncConfidence={["good", "fair", "poor"]}
      />,
    );
    const markers = screen.getAllByRole("slider");
    expect(markers).toHaveLength(3);
    expect(markers[1]).toHaveClass("conf-fair");
    expect(markers[0]).toHaveAttribute("aria-label", "Bar 1 sync point");
  });

  it("lists saved loops and recalls them", async () => {
    const user = userEvent.setup();
    const onRecallLoop = vi.fn();
    const loops = [{ id: "l1", name: "solo", start: 2, end: 6 }];
    render(<RecordingPanel {...baseProps} savedLoops={loops} onRecallLoop={onRecallLoop} />);
    const picker = screen.getByRole("combobox", { name: "Saved loops" });
    await user.selectOptions(picker, "l1");
    expect(onRecallLoop).toHaveBeenCalledWith(loops[0]);
  });

  it("adds a file through the input", async () => {
    const user = userEvent.setup();
    const onAddFile = vi.fn(async () => {});
    render(<RecordingPanel {...baseProps} onAddFile={onAddFile} />);
    const file = new File([new Uint8Array([1, 2])], "new.mp3", { type: "audio/mpeg" });
    // The file input lives in the "Add…" menu; open it, then grab the input.
    await user.click(screen.getByRole("button", { name: /Add…/ }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    expect(onAddFile).toHaveBeenCalledWith(file);
  });
});

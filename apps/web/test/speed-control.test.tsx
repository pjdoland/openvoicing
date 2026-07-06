import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SpeedControl, clampSpeed, SPEED_MAX, SPEED_MIN } from "../src/SpeedControl";

describe("clampSpeed", () => {
  it("clamps to the 25%-150% range", () => {
    expect(clampSpeed(0.1)).toBe(SPEED_MIN);
    expect(clampSpeed(3)).toBe(SPEED_MAX);
    expect(clampSpeed(1)).toBe(1);
  });

  it("rounds to whole percents", () => {
    expect(clampSpeed(0.834)).toBe(0.83);
    expect(clampSpeed(0.876)).toBe(0.88);
  });
});

describe("SpeedControl component", () => {
  it("nudges tempo with arrow keys on the readout", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SpeedControl value={1} onChange={onChange} />);

    const readout = screen.getByRole("button", { name: /100%/ });
    expect(readout).toBeInTheDocument();
    readout.focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenCalledWith(0.95);
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenCalledWith(1.05);
    // Shift makes the step coarse (25%).
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(onChange).toHaveBeenCalledWith(1.25);
  });

  it("opens a popover with presets and a tempo slider", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SpeedControl value={1} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /100%/ }));
    expect(screen.getByRole("slider", { name: "Tempo" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitemradio", { name: "50%" }));
    expect(onChange).toHaveBeenCalledWith(0.5);
  });

  it("uses a custom label", () => {
    render(<SpeedControl value={0.5} onChange={() => {}} label="Tempo" />);
    expect(screen.getByRole("group", { name: "Tempo" })).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});

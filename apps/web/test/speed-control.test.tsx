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
  it("shows the current speed and steps within bounds", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<SpeedControl value={1} onChange={onChange} />);

    expect(screen.getByText("100%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Slower" }));
    expect(onChange).toHaveBeenCalledWith(0.95);

    await user.click(screen.getByRole("button", { name: "Faster" }));
    expect(onChange).toHaveBeenCalledWith(1.05);

    // At the floor, Slower is disabled.
    rerender(<SpeedControl value={SPEED_MIN} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Slower" })).toBeDisabled();
  });

  it("uses a custom label", () => {
    render(<SpeedControl value={0.5} onChange={() => {}} label="Tempo" />);
    expect(screen.getByRole("group", { name: "Tempo" })).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});

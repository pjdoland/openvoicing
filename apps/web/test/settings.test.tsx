import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { CheatSheet, SettingsControls, useAppSettings } from "../src/Settings";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--base-font");
});

describe("useAppSettings", () => {
  it("defaults to light theme and 16px", () => {
    const { result } = renderHook(() => useAppSettings());
    expect(result.current.theme).toBe("light");
    expect(result.current.scale).toBe(16);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applies and persists theme changes", () => {
    const { result } = renderHook(() => useAppSettings());
    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("ov-theme")).toBe("dark");
  });

  it("applies and persists font scale", () => {
    const { result } = renderHook(() => useAppSettings());
    act(() => result.current.setScale(20));
    expect(document.documentElement.style.getPropertyValue("--base-font")).toBe("20px");
    expect(localStorage.getItem("ov-scale")).toBe("20");
  });

  it("restores persisted settings on init", () => {
    localStorage.setItem("ov-theme", "contrast");
    localStorage.setItem("ov-scale", "18");
    const { result } = renderHook(() => useAppSettings());
    expect(result.current.theme).toBe("contrast");
    expect(result.current.scale).toBe(18);
  });
});

describe("SettingsControls", () => {
  it("changes theme and scale from the UI", async () => {
    const user = userEvent.setup();
    function Harness() {
      return <SettingsControls {...useAppSettings()} />;
    }
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText("Color theme"), "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await user.click(screen.getByLabelText("Increase text size"));
    expect(document.documentElement.style.getPropertyValue("--base-font")).toBe("17px");
  });
});

describe("CheatSheet", () => {
  it("renders shortcuts and closes on Escape and backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<CheatSheet onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    // A couple of known shortcuts are listed.
    expect(screen.getByText("Play / pause")).toBeInTheDocument();
    expect(screen.getByText("Toggle triplet")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<CheatSheet onClose={onClose} />);
    await user.click(screen.getByRole("dialog", { name: "Keyboard shortcuts" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

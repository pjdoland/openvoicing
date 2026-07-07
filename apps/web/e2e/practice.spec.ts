import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

test.describe("practice tools", () => {
  test("plays the synth and reflects state in the UI", async ({ page }) => {
    await freshApp(page);
    // The default demo loads with a recording as the active source, so pick the
    // written notes (synth) before asserting the synth player is running.
    await page.locator(".source-toggle button", { hasText: "Notes" }).click();
    const play = page.locator(".btn-primary", { hasText: "Play" });
    await expect(play).toBeEnabled();
    await play.click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as any).__ovPlayer.playing)).toBe(true);
    await page.locator(".btn-primary", { hasText: "Pause" }).click();
  });

  test("nudges speed with the keyboard and clamps at the floor", async ({ page }) => {
    await freshApp(page);
    const value = page.locator(".speed-value").first();
    await expect(value).toHaveText("100%▾");
    // Focus the speed button and nudge down with Arrow keys (5% each).
    await value.focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowDown");
    await expect(value).toHaveText("25%▾"); // clamps at the 25% floor
    await page.keyboard.press("ArrowDown"); // further nudges stay clamped
    await expect(value).toHaveText("25%▾");
  });

  test("loops a bar range from the Loop popover", async ({ page }) => {
    await freshApp(page);
    await page.locator(".popover-trigger", { hasText: "Loop" }).click();
    const panel = page.locator(".popover-panel");
    await panel.locator('input[aria-label="Loop from bar"]').fill("1");
    await panel.locator('input[aria-label="Loop to bar"]').fill("2");
    await panel.locator('button[aria-label="Loop these bars"]').click();
    await page.waitForTimeout(300);
    const range = await page.evaluate(() => (window as any).__ovPlayer.api.playbackRange);
    expect(range).not.toBeNull();
  });

  test("opens the command palette and runs a command", async ({ page }) => {
    await freshApp(page);
    await page.keyboard.press("Meta+KeyK");
    await expect(page.locator(".palette")).toBeVisible();
    await page.locator(".palette-input").fill("dark");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

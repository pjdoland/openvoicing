import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

test.describe("practice tools", () => {
  test("plays the synth and reflects state in the UI", async ({ page }) => {
    await freshApp(page);
    const play = page.locator(".btn-primary", { hasText: "Play" });
    await expect(play).toBeEnabled();
    await play.click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as any).__ovPlayer.playing)).toBe(true);
    await page.locator(".btn-primary", { hasText: "Pause" }).click();
  });

  test("nudges speed with the stepper and clamps at the floor", async ({ page }) => {
    await freshApp(page);
    const value = page.locator(".speed-value").first();
    await expect(value).toHaveText("100%");
    const slower = page.locator('button[aria-label="Slower"]').first();
    for (let i = 0; i < 20 && (await slower.isEnabled()); i++) await slower.click();
    await expect(value).toHaveText("25%");
    await expect(slower).toBeDisabled();
  });

  test("loops a bar range from the Loop popover", async ({ page }) => {
    await freshApp(page);
    await page.locator(".popover-trigger", { hasText: "Loop" }).click();
    const input = page.locator(".popover-panel .bars-input");
    await input.fill("1-2");
    await input.press("Enter");
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

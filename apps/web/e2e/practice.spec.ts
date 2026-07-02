import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

test.describe("practice tools", () => {
  test("plays the synth and reflects state in the UI", async ({ page }) => {
    await freshApp(page);
    const play = page.locator(".toolbar button", { hasText: "Play" }).first();
    await expect(play).toBeEnabled();
    await play.click();
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => (window as any).__ovPlayer.playing)).toBe(true);
    await page.locator(".toolbar button", { hasText: "Pause" }).first().click();
  });

  test("nudges speed with the stepper and clamps at the floor", async ({ page }) => {
    await freshApp(page);
    const value = page.locator(".toolbar .speed-value").first();
    await expect(value).toHaveText("100%");
    // Click Slower until it disables itself at the 25% floor.
    const slower = page.locator('.toolbar button[aria-label="Slower"]').first();
    for (let i = 0; i < 20 && (await slower.isEnabled()); i++) await slower.click();
    await expect(value).toHaveText("25%");
    await expect(slower).toBeDisabled();
  });

  test("loops a bar range typed into the bar input", async ({ page }) => {
    await freshApp(page);
    await page.locator(".bars-input").first().fill("1-2");
    await page.locator(".bars-input").first().press("Enter");
    await page.waitForTimeout(300);
    const range = await page.evaluate(() => (window as any).__ovPlayer.api.playbackRange);
    expect(range).not.toBeNull();
  });
});

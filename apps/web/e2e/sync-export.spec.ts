import { expect, test } from "@playwright/test";
import { freshApp, repoPath } from "./helpers";

test.describe("sync and export", () => {
  test("opens the demo bundle and auto-syncs the recording", async ({ page }) => {
    await freshApp(page);
    // The File menu's Open bundle triggers the hidden .ovb input.
    await page.locator('input[accept=".ovb"]').setInputFiles(repoPath("public/demo.ovb"));
    await page.waitForTimeout(1500);

    // The recording panel appears; auto-sync lives inside it.
    await page.locator(".sync-bar button", { hasText: "Auto sync" }).click();
    await page.waitForTimeout(1500);
    expect(await page.locator(".sync-marker").count()).toBeGreaterThanOrEqual(8);
    await expect(page.locator(".toast")).toContainText("Auto-synced");
  });

  test("exports MusicXML from the File menu", async ({ page }) => {
    await freshApp(page);
    await page
      .locator('input[accept*="musicxml"]')
      .setInputFiles(repoPath("../../packages/score-model/test/fixtures/two-bars.musicxml"));
    await page.waitForTimeout(1200);

    const download = page.waitForEvent("download");
    await page.locator(".menu-trigger", { hasText: "File" }).click();
    await page.locator(".menu-item-label", { hasText: "Export MusicXML" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.musicxml$/);
  });

  test("exports a bundle from the File menu", async ({ page }) => {
    await freshApp(page);
    const download = page.waitForEvent("download");
    await page.locator(".menu-trigger", { hasText: "File" }).click();
    await page.locator(".menu-item-label", { hasText: "Export bundle" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.ovb$/);
  });
});

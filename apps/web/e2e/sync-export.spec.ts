import { expect, test } from "@playwright/test";
import { freshApp, repoPath } from "./helpers";

test.describe("sync and export", () => {
  test("opens the demo bundle and auto-syncs the recording", async ({ page }) => {
    await freshApp(page);
    // Open the bundled demo (score + real recording with sync).
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".header-actions label", { hasText: "Open bundle" }).click();
    await (await chooser).setFiles(repoPath("public/demo.ovb"));
    await page.waitForTimeout(1500);

    // Re-run auto sync from scratch and expect one marker per bar.
    await page.locator(".sync-bar button", { hasText: "Auto sync" }).click();
    await page.waitForTimeout(1500);
    const markers = await page.locator(".sync-marker").count();
    expect(markers).toBeGreaterThanOrEqual(8);

    // A confirm/undo toast appears.
    await expect(page.locator(".toast")).toContainText("Auto-synced");
  });

  test("exports MusicXML as a download", async ({ page }) => {
    await freshApp(page);
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".toolbar .open-file").click();
    await (await chooser).setFiles(
      repoPath("../../packages/score-model/test/fixtures/two-bars.musicxml"),
    );
    await page.waitForTimeout(1200);

    const download = page.waitForEvent("download");
    await page.locator(".toolbar button", { hasText: "Export MusicXML" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.musicxml$/);
  });

  test("exports a bundle as a download", async ({ page }) => {
    await freshApp(page);
    const download = page.waitForEvent("download");
    await page.locator(".header-actions button", { hasText: "Export bundle" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.ovb$/);
  });
});

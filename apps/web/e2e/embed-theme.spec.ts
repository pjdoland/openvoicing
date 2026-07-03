import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

test.describe("embed player", () => {
  test("plays a bundle from a URL with deep-link presets", async ({ page }) => {
    await page.goto("/embed.html?bundle=/demo.ovb&speed=0.7&t=2");
    await page.waitForTimeout(3000);
    await expect(page.locator(".embed-title")).toContainText("OpenVoicing Demo");
    await expect(page.locator(".embed-badge")).toContainText("recording");
    await expect(page.locator(".embed-position")).toContainText("0:02");
    expect(await page.locator(".embed-toolbar select").inputValue()).toBe("0.7");
  });

  test("shows a graceful error with retry for a bad bundle URL", async ({ page }) => {
    await page.goto("/embed.html?bundle=/nope.ovb");
    await page.waitForTimeout(2000);
    await expect(page.locator('.embed-error[role="alert"]')).toBeVisible();
    await expect(page.locator(".embed-error button", { hasText: "Retry" })).toBeVisible();
  });
});

test.describe("menus, themes, and shortcuts", () => {
  test("switches theme from the View menu", async ({ page }) => {
    await freshApp(page);
    await page.locator(".menu-trigger", { hasText: "View" }).click();
    await page.locator(".menu-item-label", { hasText: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("opens the cheat sheet and filters it", async ({ page }) => {
    await freshApp(page);
    await page.keyboard.press("Shift+Slash"); // "?"
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.locator(".cheatsheet-search").fill("loop");
    expect(await page.locator(".cheatsheet dt").count()).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  });

  test("reveals advanced zones and hides them in Basic", async ({ page }) => {
    await freshApp(page);
    // Basic default: no Practice/Capture zones.
    await expect(page.locator(".tb-zone-label", { hasText: "Practice" })).toHaveCount(0);
    await page.locator(".mode-toggle button", { hasText: "Practice" }).click();
    await expect(page.locator(".tb-zone-label", { hasText: "Practice" })).toBeVisible();
    await expect(page.locator(".tb-zone-label", { hasText: "Record my take" })).toBeVisible();
  });

  test("locked mode hides the File menu and editing", async ({ page }) => {
    await freshApp(page, "/?lock=1");
    await expect(page.locator(".menu-trigger", { hasText: "File" })).toHaveCount(0);
    await expect(page.locator(".mode-toggle")).toHaveCount(0);
    // Playback and the score remain.
    await expect(page.locator(".btn-primary", { hasText: "Play" })).toBeVisible();
    await expect(page.locator("main.score")).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

test.describe("embed player", () => {
  test("plays a bundle from a URL with deep-link presets", async ({ page }) => {
    await page.goto("/embed.html?bundle=/demo.ovb&speed=0.7&t=2");
    await page.waitForTimeout(3000);
    await expect(page.locator(".embed-title")).toContainText("OpenVoicing Demo");
    await expect(page.locator(".embed-badge")).toContainText("recording");
    // Start time applied.
    await expect(page.locator(".embed-position")).toContainText("0:02");
    // Speed preset reflected in the dropdown.
    expect(await page.locator(".embed-toolbar select").inputValue()).toBe("0.7");
  });

  test("shows a graceful error with retry for a bad bundle URL", async ({ page }) => {
    await page.goto("/embed.html?bundle=/nope.ovb");
    await page.waitForTimeout(2000);
    await expect(page.locator('.embed-error[role="alert"]')).toBeVisible();
    await expect(page.locator(".embed-error button", { hasText: "Retry" })).toBeVisible();
  });
});

test.describe("themes and shortcuts", () => {
  test("switches theme and opens the cheat sheet", async ({ page }) => {
    await freshApp(page);
    await page.locator('select[aria-label="Color theme"]').selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("Shift+Slash"); // "?"
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  });

  test("locked mode hides editing and export", async ({ page }) => {
    await freshApp(page, "/?lock=1");
    await expect(page.locator(".toolbar button", { hasText: "New score" })).toHaveCount(0);
    await expect(page.locator(".toolbar button", { hasText: "Print" })).toBeVisible();
  });
});

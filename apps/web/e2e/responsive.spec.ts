import { expect, test } from "@playwright/test";
import { freshApp, repoPath } from "./helpers";

const widths = [1440, 1024, 768, 480, 360];

test.describe("responsive layout", () => {
  test("no horizontal page overflow at any width (with a recording)", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ov-mode", "advanced"));
    await freshApp(page);
    await page.locator('input[accept*=".ovb"]').setInputFiles(repoPath("public/demo.ovb"));
    await page.waitForTimeout(1500);

    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `overflow at ${w}px`).toBeLessThanOrEqual(1);
    }
  });

  test("collapses the header menus on narrow screens", async ({ page }) => {
    await freshApp(page);
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.waitForTimeout(300);
    const labelWide = page.locator(".menubar .menu-trigger-label", { hasText: "File" });
    await expect(labelWide).toBeVisible();
    // On wide screens the four labeled menus show; the compact hamburger is hidden.
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();

    // Labels stay visible on tablets and only collapse on true phones (<=600px),
    // where the four menus fold into one labeled "Menu" hamburger.
    await page.setViewportSize({ width: 500, height: 800 });
    await page.waitForTimeout(300);
    await expect(labelWide).toBeHidden();
    // The menus are still operable via the single labeled "Menu" button.
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeVisible();
  });

  test("reflows the score to the container width", async ({ page }) => {
    await freshApp(page);
    await page.setViewportSize({ width: 640, height: 800 });
    await page.waitForTimeout(1600);
    const fits = await page.evaluate(() => {
      const score = document.querySelector(".score") as HTMLElement;
      return score.scrollWidth <= score.clientWidth + 1;
    });
    expect(fits).toBe(true);
  });
});

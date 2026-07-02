import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

const firstBeatMidis = () =>
  `() => window.__ovPlayer.api.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.map(n => n.realValue).sort((a,b)=>a-b)`;

async function newScore(page: import("@playwright/test").Page) {
  await page.locator(".menu-trigger", { hasText: "File" }).click();
  await page.locator(".menu-item-label", { hasText: "New score" }).click();
  await page.waitForTimeout(1000);
}

test.describe("score editor", () => {
  test("creates a score and enters notes with the keyboard", async ({ page }) => {
    await freshApp(page);
    await newScore(page);

    // New score enters edit mode with the first beat selected.
    await page.keyboard.press("KeyC");
    await page.keyboard.press("Digit4");
    await page.waitForTimeout(500);
    let midis = await page.evaluate(eval(firstBeatMidis()) as () => number[]);
    expect(midis).toEqual([60]);

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(500);
    midis = await page.evaluate(eval(firstBeatMidis()) as () => number[]);
    expect(midis).toEqual([62]);

    // Undo from the editing band returns toward C.
    await page.locator('.edit-band button[aria-label="Undo"]').click();
    await page.waitForTimeout(400);
    midis = await page.evaluate(eval(firstBeatMidis()) as () => number[]);
    expect(midis).toEqual([61]);
  });

  test("persists an edited score across reload", async ({ page }) => {
    await freshApp(page);
    await newScore(page);
    await page.keyboard.press("KeyE");
    await page.keyboard.press("Digit2");
    await page.waitForTimeout(500);

    await page.reload();
    await page.waitForFunction(() => (window as any).__ovPlayer);
    await page.waitForTimeout(1500);
    const midis = await page.evaluate(eval(firstBeatMidis()) as () => number[]);
    expect(midis).toEqual([64]);
  });
});

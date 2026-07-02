import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

const firstBeatMidis = () =>
  `() => window.__ovPlayer.api.score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes.map(n => n.realValue).sort((a,b)=>a-b)`;

test.describe("score editor", () => {
  test("creates a score and enters notes with the keyboard", async ({ page }) => {
    await freshApp(page);
    await page.locator(".toolbar button", { hasText: "New score" }).click();
    await page.waitForTimeout(1000);

    // New score enters edit mode with the first beat selected.
    await page.keyboard.press("KeyC");
    await page.keyboard.press("Digit4");
    await page.waitForTimeout(500);
    let midis = await page.evaluate(eval(firstBeatMidis()) as () => number[]);
    expect(midis).toEqual([60]);

    // Transpose up a whole tone.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(500);
    midis = await page.evaluate(eval(firstBeatMidis()) as () => number[]);
    expect(midis).toEqual([62]);

    // Undo via the labelled button returns to C.
    await page.locator(".toolbar button", { hasText: "Undo" }).first().click();
    await page.waitForTimeout(400);
    midis = await page.evaluate(eval(firstBeatMidis()) as () => number[]);
    expect(midis).toEqual([61]);
  });

  test("persists an edited score across reload", async ({ page }) => {
    await freshApp(page);
    await page.locator(".toolbar button", { hasText: "New score" }).click();
    await page.waitForTimeout(1000);
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

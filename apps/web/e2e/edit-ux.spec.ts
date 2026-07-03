import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

async function newScore(page: import("@playwright/test").Page) {
  await page.locator(".menu-trigger", { hasText: "File" }).click();
  await page.locator(".menu-item-label", { hasText: "New score" }).click();
  await page.waitForTimeout(1000);
}

const groupLabels = () =>
  `() => [...document.querySelectorAll('.edit-toolbar .etb-group')].map(g => g.getAttribute('aria-label'))`;

test.describe("edit mode UX (redesigned toolbar)", () => {
  test("toolbar is selection-aware: rest shows fewer groups than a note", async ({ page }) => {
    await freshApp(page);
    await newScore(page);

    // A rest is selected on a new score: Value + Pitch, but no Marks/Accidental.
    const restGroups = (await page.evaluate(eval(groupLabels()) as () => string[])) as string[];
    expect(restGroups).toContain("Note value");
    expect(restGroups).toContain("Pitch");
    expect(restGroups).not.toContain("Articulations and slurs");
    await expect(page.locator(".edit-status-what")).toContainText("rest");
    await expect(page.locator(".edit-coach")).toBeVisible();

    // Turn the rest into a note using the on-screen Pitch palette (touch parity).
    await page.locator('.edit-toolbar button[aria-label="Pitch C"]').click();
    await page.waitForTimeout(300);
    const noteGroups = (await page.evaluate(eval(groupLabels()) as () => string[])) as string[];
    expect(noteGroups).toContain("Articulations and slurs");
    expect(noteGroups).toContain("Accidental and octave");
    await expect(page.locator(".edit-status-what")).toContainText("note");
  });

  test("note-input mode advances automatically as pitches are typed", async ({ page }) => {
    await freshApp(page);
    await newScore(page);
    await page.keyboard.press("n"); // enter note-input mode
    await expect(page.locator(".app")).toHaveClass(/note-input/);
    for (const k of ["C", "D", "E", "F"]) await page.keyboard.press(k);
    await page.waitForTimeout(300);
    const steps = await page.evaluate(() => {
      const ed = (window as unknown as { __ovV1Editor: () => any }).__ovV1Editor();
      return ed.doc.parts[0].measures[0].voices[0].beats
        .slice(0, 4)
        .map((b: any) => (b.rest ? "rest" : b.notes.map((n: any) => n.step).join("")));
    });
    expect(steps).toEqual(["C", "D", "E", "F"]);
  });

  test("right-click a note opens a context menu that applies actions", async ({ page }) => {
    await freshApp(page);
    await newScore(page);
    await page.locator('.edit-toolbar button[aria-label="Pitch C"]').click();
    await page.waitForTimeout(300);
    // Right-click the note head.
    const pos = await page.evaluate(() => {
      const bl = (window as unknown as { __ovPlayer: any }).__ovPlayer.api.renderer.boundsLookup;
      const r = document.querySelector(".score-surface")!.getBoundingClientRect();
      const nb = bl.staffSystems[0].bars[0].bars[0].beats[0].notes[0];
      return { x: r.left + nb.noteHeadBounds.x + 4, y: r.top + nb.noteHeadBounds.y + 4 };
    });
    await page.mouse.click(pos.x, pos.y, { button: "right" });
    await expect(page.locator(".ctx-menu")).toBeVisible();
    await page.locator(".ctx-menu button", { hasText: "Staccato" }).click();
    await expect(page.locator(".ctx-menu")).toHaveCount(0);
    const hasStaccato = await page.evaluate(() => {
      const ed = (window as unknown as { __ovV1Editor: () => any }).__ovV1Editor();
      return ed.doc.parts[0].measures[0].voices[0].beats[0].articulations?.includes("staccato");
    });
    expect(hasStaccato).toBe(true);
  });
});

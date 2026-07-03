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

  test("can enter grace notes, ornaments, and a second voice", async ({ page }) => {
    await freshApp(page);
    await newScore(page);
    await page.locator('.edit-toolbar button[aria-label="Pitch C"]').click();
    await page.waitForTimeout(200);

    // Ornament + grace note via the toolbar.
    await page.locator('.edit-toolbar button[aria-label="Mordent"]').click();
    await page.locator('.edit-toolbar button[aria-label="Add grace note"]').click();
    await page.waitForTimeout(300);

    // Add a second voice from the Score popover and type into it.
    await page.locator(".edit-toolbar button", { hasText: "Score" }).click();
    await page.locator(".etb-popover button", { hasText: "Voice" }).first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press("E");
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => {
      const ed = (window as unknown as { __ovV1Editor: () => any }).__ovV1Editor();
      const m = ed.doc.parts[0].measures[0];
      const v0 = m.voices[0];
      return {
        hasMordent: v0.beats.some((b: any) => b.ornaments?.includes("mordent")),
        graceCount: v0.beats.filter((b: any) => b.grace).length,
        voices: m.voices.length,
        secondVoiceHasNote: m.voices[1]?.beats.some((b: any) => !b.rest),
      };
    });
    expect(state.hasMordent).toBe(true);
    expect(state.graceCount).toBe(1);
    expect(state.voices).toBe(2);
    expect(state.secondVoiceHasNote).toBe(true);
  });

  test("stacked voices are addressable: pills, v-cycle, and the status indicator", async ({ page }) => {
    await freshApp(page);
    await newScore(page);
    await page.locator('.edit-toolbar button[aria-label="Pitch C"]').click();
    await page.locator(".edit-toolbar button", { hasText: "Score" }).click();
    await page.locator(".etb-popover button", { hasText: "Voice" }).first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press("E"); // into the new voice
    await page.waitForTimeout(200);

    // Voice pills appear and the status names the voice.
    await expect(page.locator(".voice-pill")).toHaveCount(2);
    await expect(page.locator(".edit-status-what")).toContainText("voice 2 of 2");

    // "v" cycles back to voice 1 without a precise click.
    await page.keyboard.press("v");
    await expect(page.locator(".edit-status-what")).toContainText("voice 1 of 2");

    // Clicking a pill selects that voice.
    await page.locator('.voice-pill[aria-label="Voice 2"]').click();
    await expect(page.locator(".edit-status-what")).toContainText("voice 2 of 2");

    // The second voice is color-styled on the score (edit-mode disambiguation).
    const colored = await page.evaluate(() => {
      const sc = (window as unknown as { __ovPlayer: any }).__ovPlayer.api.score;
      const b = sc.tracks[0].staves[0].bars[0].voices[1]?.beats?.find((x: any) => x.notes?.length);
      return !!b?.style && !!b?.notes?.[0]?.style;
    });
    expect(colored).toBe(true);
  });
});

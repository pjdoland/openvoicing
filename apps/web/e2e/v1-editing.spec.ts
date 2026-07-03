import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

// A grand-staff MusicXML: multi-staff scores route through the full-fidelity v1
// model and are editable in the app (select a note, transpose, undo).
const GRAND_STAFF = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

test.describe("v1 editing (multi-staff)", () => {
  test("routes a multi-staff score through v1 and edits a note", async ({ page }) => {
    await freshApp(page);
    await page.locator('input[accept*=".musicxml"]').setInputFiles({
      name: "grand.musicxml",
      mimeType: "application/vnd.recordare.musicxml+xml",
      buffer: Buffer.from(GRAND_STAFF),
    });
    await page.waitForTimeout(2500);

    // The score is v1-backed (multi-staff), not the v0 editor.
    expect(await page.evaluate(() => !!(window as any).__ovV1Editor?.())).toBe(true);
    expect(await page.evaluate(() => (window as any).__ovPlayer.api.score.tracks[0].staves.length)).toBe(2);

    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".edit-band")).toBeVisible();

    // Select the first note (nearest-note click selection is coordinate-based
    // and covered manually; here we select the note id via the model so the
    // keyboard-edit pipeline is tested deterministically).
    await page.evaluate(() => {
      const ed = (window as any).__ovV1Editor();
      const noteId = ed.doc.parts[0].measures[0].voices[0].beats[0].notes[0].id;
      (window as any).__ovSelectV1(noteId);
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).__ovSelectedV1())).toBeTruthy();

    const pitch = () =>
      page.evaluate(() => {
        const ed = (window as any).__ovV1Editor();
        const loc = ed.findNote((window as any).__ovSelectedV1());
        return loc ? `${loc.note.step}${loc.note.alter}/${loc.note.octave}` : null;
      });
    const before = await pitch();
    await page.locator("body").press("ArrowUp");
    await page.waitForTimeout(800);
    expect(await pitch()).not.toBe(before);

    await page.locator("body").press("Meta+z");
    await page.waitForTimeout(800);
    expect(await pitch()).toBe(before);
  });
});

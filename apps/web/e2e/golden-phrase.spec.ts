import { expect, test, type Page } from "@playwright/test";
import { freshApp } from "./helpers";

/**
 * The golden-phrase test: build one score from a blank canvas that exercises
 * EVERY user-facing editing capability, asserting each takes effect, and then
 * verify the whole thing renders, exports, and survives a reload. This is the
 * top-of-pyramid guarantee that all editing functionality works for real users.
 *
 * Editing actions go through the real surface (keyboard shortcuts, palette
 * buttons, the Score popover, context menu). The caret is positioned between
 * checks with a small test hook so the flow does not depend on pixel-perfect
 * clicks; the selection MECHANISMS (click, arrows, right-click, voice pills, v)
 * are each tested explicitly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any;

async function newScore(page: Page) {
  await page.locator(".menu-trigger", { hasText: "File" }).click();
  await page.locator(".menu-item-label", { hasText: "New score" }).click();
  await page.waitForTimeout(1000);
}

/** Position the caret on a specific beat (test hook, not a user action). */
async function selectBeat(page: Page, bar: number, voice: number, beatIndex: number) {
  await page.evaluate(
    ([bar, voice, beatIndex]) => {
      const ed = (window as Win).__ovV1Editor();
      const vs = ed.doc.parts[0].measures[bar].voices;
      const v = vs.find((x: Win) => x.index === voice) ?? vs[voice] ?? vs[0];
      (window as Win).__ovSelectBeat(v.beats[beatIndex].id);
    },
    [bar, voice, beatIndex],
  );
  await page.waitForTimeout(50);
}

async function readBeat(page: Page, bar: number, voice: number, beatIndex: number) {
  return page.evaluate(
    ([bar, voice, beatIndex]) => {
      const ed = (window as Win).__ovV1Editor();
      const vs = ed.doc.parts[0].measures[bar].voices;
      const v = vs.find((x: Win) => x.index === voice) ?? vs[voice] ?? vs[0];
      const b = v?.beats[beatIndex];
      if (!b) return null;
      return {
        rest: b.rest,
        noteType: b.duration.noteType,
        dots: b.duration.dots,
        grace: b.grace?.kind ?? null,
        notes: b.notes.map((n: Win) => ({ step: n.step, alter: n.alter, octave: n.octave })),
        articulations: b.articulations ?? [],
        ornaments: b.ornaments ?? [],
        fermata: !!b.fermata,
        chordSymbol: b.chordSymbol ?? null,
      };
    },
    [bar, voice, beatIndex],
  );
}

const summary = (page: Page) =>
  page.evaluate(() => {
    const ed = (window as Win).__ovV1Editor();
    const d = ed.doc;
    return {
      title: d.work.title,
      composer: d.work.composer ?? null,
      bars: d.bars.length,
      tempo0: d.bars[0].tempoBpm ?? null,
      time0: d.parts[0].measures[0].attributes?.time ?? null,
      key0: d.parts[0].measures[0].attributes?.key ?? null,
      voices0: d.parts[0].measures[0].voices.length,
      ties: d.spanners.filter((s: Win) => s.kind === "tie").length,
      slurs: d.spanners.filter((s: Win) => s.kind === "slur").length,
      dynamics: d.directions.filter((x: Win) => x.content.kind === "dynamics").length,
      graceNotes: d.parts[0].measures.flatMap((m: Win) => m.voices).flatMap((v: Win) => v.beats).filter((b: Win) => b.grace).length,
      ornaments: d.parts[0].measures.flatMap((m: Win) => m.voices).flatMap((v: Win) => v.beats).filter((b: Win) => b.ornaments?.length).length,
      chordSymbols: d.parts[0].measures.flatMap((m: Win) => m.voices).flatMap((v: Win) => v.beats).filter((b: Win) => b.chordSymbol).length,
    };
  });

async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test.describe("golden phrase", () => {
  test("constructs a score from scratch exercising every editing feature", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    // Answer every prompt (chord symbol, tempo, title, composer) deterministically.
    page.on("dialog", (d) => {
      const msg = d.message();
      const value = /chord/i.test(msg)
        ? "Cmaj7"
        : /tempo/i.test(msg)
          ? "132"
          : /title/i.test(msg)
            ? "Golden Phrase"
            : /composer/i.test(msg)
              ? "J.S. Test"
              : "";
      void d.accept(value);
    });

    await freshApp(page);
    await newScore(page);

    // ---- 1. Note-input mode + A-G entry with auto-advance ----
    await page.keyboard.press("n");
    await expect(page.locator(".app")).toHaveClass(/note-input/);
    await selectBeat(page, 0, 0, 0);
    for (const k of ["C", "D", "E", "F"]) await page.keyboard.press(k);
    await page.waitForTimeout(150);
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.step, "note entry").toBe("C");
    expect((await readBeat(page, 0, 0, 3))?.notes[0]?.step, "auto-advance filled 4 beats").toBe("F");
    await page.keyboard.press("n"); // leave note-input mode

    // ---- 2. Duration (key + palette), dot, accidentals, octave, transpose ----
    await selectBeat(page, 0, 0, 0);
    await page.keyboard.press("4"); // eighth via number key
    expect((await readBeat(page, 0, 0, 0))?.noteType, "duration via key").toBe("eighth");
    await page.locator('.edit-toolbar button[aria-label="Half note (2)"]').click(); // via palette
    expect((await readBeat(page, 0, 0, 0))?.noteType, "duration via palette").toBe("half");
    await page.keyboard.press("."); // dot
    expect((await readBeat(page, 0, 0, 0))?.dots, "dot").toBe(1);
    await page.keyboard.press("="); // sharp
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.alter, "sharp").toBe(1);
    await page.locator('.edit-toolbar button[aria-label="Flat"]').click();
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.alter, "flat via palette").toBe(-1);
    await page.locator('.edit-toolbar button[aria-label="Natural"]').click();
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.alter, "natural via palette").toBe(0);
    await page.locator('.edit-toolbar button[aria-label="Octave up"]').click();
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.octave, "octave up").toBe(6);
    await page.locator('.edit-toolbar button[aria-label="Octave down"]').click();
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.octave, "octave down").toBe(5);
    await page.keyboard.press("ArrowUp"); // transpose up a semitone -> C#5
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.alter, "transpose up").toBe(1);
    await page.keyboard.press("ArrowDown");
    expect((await readBeat(page, 0, 0, 0))?.notes[0]?.alter, "transpose down").toBe(0);

    // ---- 3. Chord stacking ----
    await selectBeat(page, 0, 0, 2); // E
    await page.keyboard.press("Shift+G");
    expect((await readBeat(page, 0, 0, 2))?.notes.length, "chord stack").toBe(2);

    // ---- 4. Articulations, fermata, ornaments (all on beat 0) ----
    await selectBeat(page, 0, 0, 0);
    await page.locator('.edit-toolbar button[aria-label="Staccato"]').click();
    await page.locator('.edit-toolbar button[aria-label="Accent"]').click();
    await page.locator('.edit-toolbar button[aria-label="Tenuto"]').click();
    expect((await readBeat(page, 0, 0, 0))?.articulations.sort(), "articulations").toEqual(["accent", "staccato", "tenuto"]);
    await page.locator('.edit-toolbar button[aria-label="Fermata"]').click();
    expect((await readBeat(page, 0, 0, 0))?.fermata, "fermata").toBe(true);
    await page.locator('.edit-toolbar button[aria-label="Mordent"]').click();
    await page.locator('.edit-toolbar button[aria-label="Turn"]').click();
    await page.locator('.edit-toolbar button[aria-label="Trill"]').click();
    expect((await readBeat(page, 0, 0, 0))?.ornaments.sort(), "ornaments").toEqual(["mordent", "trill-mark", "turn"]);

    // ---- 5. Dynamics + chord symbol ----
    await selectBeat(page, 0, 0, 0);
    await page.locator(".etb-select select").selectOption("mf");
    await blur(page);
    await selectBeat(page, 0, 0, 0);
    await page.keyboard.press("k"); // chord symbol prompt -> "Cmaj7"
    await page.waitForTimeout(150);
    expect((await readBeat(page, 0, 0, 0))?.chordSymbol, "chord symbol").toBe("Cmaj7");

    // ---- 6. Tie + slur ----
    await selectBeat(page, 0, 0, 1); // D
    await page.keyboard.press("t");
    await page.keyboard.press("s");
    let sum = await summary(page);
    expect(sum.ties, "tie created").toBeGreaterThanOrEqual(1);
    expect(sum.slurs, "slur created").toBeGreaterThanOrEqual(1);

    // ---- 7. Rest <-> note ----
    await selectBeat(page, 0, 0, 3); // F
    await page.keyboard.press("r");
    expect((await readBeat(page, 0, 0, 3))?.rest, "note -> rest").toBe(true);
    await page.keyboard.press("A"); // rest -> note
    expect((await readBeat(page, 0, 0, 3))?.rest, "rest -> note").toBe(false);

    // ---- 8. Grace note (shifts voice-0 indices by one) ----
    await selectBeat(page, 0, 0, 0);
    await page.keyboard.press("/");
    await page.waitForTimeout(150);
    expect((await readBeat(page, 0, 0, 0))?.grace, "grace inserted before beat 0").toBe("appoggiatura");

    // ---- 9. Structure via the Score popover: time, key, add bar, tempo, metadata ----
    await selectBeat(page, 0, 0, 1);
    await page.locator(".edit-toolbar button", { hasText: "Score" }).click();
    await page.locator(".etb-popover select").nth(0).selectOption("3/4"); // Time
    await page.locator(".etb-popover select").nth(1).selectOption("2"); // Key: 2 sharps
    await page.locator(".etb-popover button", { hasText: "Bar" }).first().click(); // + Bar
    await page.locator(".etb-popover button", { hasText: "Tempo" }).click(); // prompt -> 132
    await page.waitForTimeout(100);
    await page.locator(".etb-popover button", { hasText: "Title" }).click(); // prompts -> title + composer
    await page.waitForTimeout(150);
    await blur(page);
    sum = await summary(page);
    expect(sum.time0, "time signature").toEqual({ beats: 3, beatUnit: 4 });
    expect(sum.key0, "key signature").toEqual({ fifths: 2 });
    expect(sum.bars, "measure added").toBe(9);
    expect(sum.tempo0, "tempo").toBe(132);
    expect(sum.title, "title").toBe("Golden Phrase");
    expect(sum.composer, "composer").toBe("J.S. Test");
    // Close the popover.
    await page.locator(".edit-toolbar button", { hasText: "Score" }).click();

    // ---- 10. Voices: add, enter, pills, v-cycle ----
    await selectBeat(page, 0, 0, 1);
    await page.locator(".edit-toolbar button", { hasText: "Score" }).click();
    await page.locator(".etb-popover button", { hasText: "Voice" }).first().click(); // + Voice
    await page.waitForTimeout(150);
    await page.locator(".edit-toolbar button", { hasText: "Score" }).click(); // close popover
    await page.keyboard.press("G"); // into the new voice
    await page.waitForTimeout(150);
    expect(sum.voices0, "bar had one voice before").toBe(1);
    expect((await summary(page)).voices0, "voice added").toBe(2);
    await expect(page.locator(".voice-pill")).toHaveCount(2);
    await expect(page.locator(".edit-status-what")).toContainText("voice 2 of 2");
    await page.keyboard.press("v"); // cycle voices
    await expect(page.locator(".edit-status-what")).toContainText("voice 1 of 2");
    await page.locator('.voice-pill[aria-label="Voice 2"]').click();
    await expect(page.locator(".edit-status-what")).toContainText("voice 2 of 2");

    // ---- 11. Copy / paste ----
    await selectBeat(page, 0, 0, 2); // a chord beat in voice 0
    const copied = await readBeat(page, 0, 0, 2);
    await page.keyboard.press("Control+c");
    await selectBeat(page, 1, 0, 0); // bar 2, voice 0, beat 0
    await page.keyboard.press("Control+v");
    await page.waitForTimeout(100);
    const pasted = await readBeat(page, 1, 0, 0);
    expect(pasted?.notes.length, "paste copied the chord").toBe(copied?.notes.length);

    // ---- 12. Delete + undo + redo ----
    await selectBeat(page, 1, 0, 0);
    await page.keyboard.press("Delete");
    expect((await readBeat(page, 1, 0, 0))?.rest, "delete -> rest").toBe(true);
    await page.keyboard.press("Control+z");
    expect((await readBeat(page, 1, 0, 0))?.rest, "undo restored the note").toBe(false);
    await page.keyboard.press("Control+Shift+z");
    expect((await readBeat(page, 1, 0, 0))?.rest, "redo re-applied the delete").toBe(true);
    await page.keyboard.press("Control+z"); // leave it restored

    // ---- 13. Selection mechanisms: arrows, click, right-click context menu ----
    await selectBeat(page, 0, 0, 0);
    const before = await page.evaluate(() => (window as Win).__ovSelectedV1());
    await page.keyboard.press("ArrowRight");
    const after = await page.evaluate(() => (window as Win).__ovSelectedV1());
    expect(after, "arrow navigation moved the selection").not.toBe(before);

    // Real click on a rendered notehead.
    const clicked = await page.evaluate(() => {
      const bl = (window as Win).__ovPlayer.api.renderer.boundsLookup;
      const rect = document.querySelector(".score-surface")!.getBoundingClientRect();
      for (const sys of bl.staffSystems)
        for (const mb of sys.bars)
          for (const bar of mb.bars)
            for (const bb of bar.beats)
              if (bb.notes?.length)
                return { x: rect.left + bb.notes[0].noteHeadBounds.x + 3, y: rect.top + bb.notes[0].noteHeadBounds.y + 3, id: bb.notes[0].note.ovNoteId };
      return null;
    });
    expect(clicked, "found a rendered notehead to click").toBeTruthy();
    await page.mouse.click(clicked!.x, clicked!.y);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as Win).__ovSelectedV1()), "click selected a note").toBe(clicked!.id);
    // Right-click the same note -> context menu -> apply.
    await page.mouse.click(clicked!.x, clicked!.y, { button: "right" });
    await expect(page.locator(".ctx-menu")).toBeVisible();
    await page.locator(".ctx-menu button", { hasText: "Accent" }).first().click();
    await expect(page.locator(".ctx-menu")).toHaveCount(0);

    // ---- 14. It renders, has no errors, and exports ----
    const noteBounds = await page.evaluate(() => {
      let c = 0;
      for (const sys of (window as Win).__ovPlayer.api.renderer.boundsLookup.staffSystems)
        for (const mb of sys.bars) for (const bar of mb.bars) for (const bb of bar.beats) c += bb.notes?.length ?? 0;
      return c;
    });
    expect(noteBounds, "score renders note heads").toBeGreaterThan(0);

    const xml = (await page.evaluate(() => (window as Win).__ovExportMusicXml())) as string;
    for (const marker of ["<grace", "mordent", "<harmony", "<dynamics", 'type="start"']) {
      expect(xml, `export contains ${marker}`).toContain(marker);
    }

    expect(errors, `no runtime errors: ${errors.join(" | ")}`).toEqual([]);

    // ---- 15. It survives a reload (full export -> storage -> import round-trip) ----
    await page.waitForTimeout(500); // let the debounced persist flush
    await page.reload();
    await page.waitForFunction(() => (window as Win).__ovPlayer);
    await page.waitForTimeout(1500);
    const restored = await summary(page);
    expect(restored.title, "title survives reload").toBe("Golden Phrase");
    expect(restored.time0, "time signature survives reload").toEqual({ beats: 3, beatUnit: 4 });
    expect(restored.key0, "key signature survives reload").toEqual({ fifths: 2 });
    expect(restored.bars, "bar count survives reload").toBe(9);
    expect(restored.graceNotes, "grace notes survive reload").toBeGreaterThanOrEqual(1);
    expect(restored.ornaments, "ornaments survive reload").toBeGreaterThanOrEqual(1);
    expect(restored.chordSymbols, "chord symbols survive reload").toBeGreaterThanOrEqual(1);
    expect(restored.dynamics, "dynamics survive reload").toBeGreaterThanOrEqual(1);
    expect(restored.voices0, "voices survive reload").toBe(2);
  });

  // Tab fret entry is the one editing feature a blank treble score cannot
  // produce (no "add tab staff"), so it is covered from a loaded tab score.
  test("enters frets on a tablature staff (keyboard and palette)", async ({ page }) => {
    const TAB = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Guitar</part-name>
    <midi-instrument id="P1-I1"><midi-program>25</midi-program></midi-instrument></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>TAB</sign><line>5</line></clef>
      <staff-details><staff-lines>6</staff-lines>
        <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
        <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
        <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
        <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
        <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
        <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
      </staff-details></attributes>
    <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type>
      <notations><technical><string>5</string><fret>3</fret></technical></notations></note>
  </measure></part>
</score-partwise>`;
    await freshApp(page);
    await page.locator('input[accept*=".musicxml"]').setInputFiles({
      name: "guitar.musicxml",
      mimeType: "application/vnd.recordare.musicxml+xml",
      buffer: Buffer.from(TAB),
    });
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() => !!(window as Win).__ovV1Editor?.())).toBe(true);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".edit-toolbar")).toBeVisible();

    // Select the tab note; a tab staff shows the Fret group (not Pitch).
    await page.evaluate(() => {
      const ed = (window as Win).__ovV1Editor();
      (window as Win).__ovSelectBeat(ed.doc.parts[0].measures[0].voices[0].beats[0].id);
    });
    await page.waitForTimeout(100);
    await expect(page.locator('.edit-toolbar [role="group"][aria-label="Fret"]')).toBeVisible();

    const fret = () =>
      page.evaluate(() => (window as Win).__ovV1Editor().doc.parts[0].measures[0].voices[0].beats[0].notes[0].fret);
    expect(await fret(), "imported fret").toBe(3);

    // Digit key types a fret on a tab staff (routes to setFret, not duration).
    await page.keyboard.press("7");
    await page.waitForTimeout(100);
    expect(await fret(), "fret via keyboard").toBe(7);

    // Fret palette button also works.
    await page.locator('.edit-toolbar button[aria-label="Fret 5"]').click();
    await page.waitForTimeout(100);
    expect(await fret(), "fret via palette").toBe(5);
  });
});

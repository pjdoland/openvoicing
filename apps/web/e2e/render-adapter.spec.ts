import { expect, test } from "@playwright/test";
import { freshApp } from "./helpers";

// P0 keystone: Option C renders scores by constructing alphaTab Score objects
// programmatically (not via lossy alphaTex text). This guards that path:
// a from-scratch Score, once finished, renders with correct display AND
// playback ticks and a working cursor/sync (barTicks) layer.
test.describe("programmatic render adapter", () => {
  test("renders a from-scratch Score with valid display and playback ticks", async ({ page }) => {
    await freshApp(page);
    await page.waitForFunction(() => (window as any).__ovPlayer?.spikeRenderMinimal);
    await page.evaluate(() => (window as any).__ovPlayer.spikeRenderMinimal());
    await page.waitForTimeout(1500);

    const r = await page.evaluate(() => {
      const api = (window as any).__ovPlayer.api;
      const beats = api.score.tracks[0].staves[0].bars[0].voices[0].beats;
      return {
        title: api.score.title,
        masterBarStarts: api.score.masterBars.map((m: any) => m.start),
        playbackStarts: beats.map((b: any) => b.playbackStart),
        playbackDurations: beats.map((b: any) => b.playbackDuration),
        barTicks: (window as any).__ovPlayer.barTicks.map((b: any) => b.start),
        rendered: document.querySelectorAll(".score-surface svg").length > 0,
      };
    });

    expect(r.title).toBe("spike");
    // 4/4 at 960 PPQ => bar length 3840.
    expect(r.masterBarStarts).toEqual([0, 3840]);
    // Playback ticks must be computed by finish() (they are 0 without it).
    expect(r.playbackStarts).toEqual([0, 960, 1920, 2880]);
    expect(r.playbackDurations.every((d: number) => d === 960)).toBe(true);
    // The cursor/sync layer reads these bar ticks.
    expect(r.barTicks).toEqual([0, 3840]);
    expect(r.rendered).toBe(true);
  });

  test("renders a multi-staff score through the v1 model->alphaTab adapter", async ({ page }) => {
    await freshApp(page);
    await page.waitForFunction(() => (window as any).__ovRenderV1);
    const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;
    await page.evaluate((x) => (window as any).__ovRenderV1(x), xml);
    await page.waitForTimeout(1500);

    const r = await page.evaluate(() => {
      const api = (window as any).__ovPlayer.api;
      const staves = api.score.tracks[0].staves;
      return {
        staffCount: staves.length,
        // Every bar of the bass staff keeps the F clef (the carry-forward fix).
        bassClefs: staves[1].bars.map((b: any) => b.clef),
        isReady: api.isReadyForPlayback,
        rendered: document.querySelectorAll(".score-surface svg").length > 0,
      };
    });
    expect(r.staffCount).toBe(2);
    // alphaTab Clef.F4 === 3.
    expect(r.bassClefs).toEqual([3, 3]);
    expect(r.isReady).toBe(true);
    expect(r.rendered).toBe(true);
  });
});

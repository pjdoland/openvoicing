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
});

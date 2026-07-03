import { expect, test, type Page } from "@playwright/test";
import { freshApp } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = any;

async function newScoreWithNote(page: Page) {
  await page.locator(".menu-trigger", { hasText: "File" }).click();
  await page.locator(".menu-item-label", { hasText: "New score" }).click();
  await page.waitForTimeout(1000);
  await page.keyboard.press("C"); // select a note so the full toolbar shows
  await page.waitForTimeout(200);
}

const metrics = (page: Page) =>
  page.evaluate(() => {
    const tb = document.querySelector(".edit-toolbar")!;
    const pinned = tb.querySelector(".etb-pinned")!;
    const groups = (el: Element) => [...el.querySelectorAll(".etb-group")].map((g) => g.getAttribute("aria-label"));
    return {
      toolbarHeight: Math.round(tb.getBoundingClientRect().height),
      inlineGroups: groups(tb).filter((g) => g !== "More"),
      pinnedGroups: groups(pinned),
      hasMore: !!document.querySelector('[aria-label^="More editing tools"]'),
      // The page must never require two-dimensional scrolling (WCAG 1.4.10).
      pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });

test.describe("responsive edit toolbar", () => {
  test("stays a single row and never forces horizontal page scroll (320-1440)", async ({ page }) => {
    await freshApp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await newScoreWithNote(page);

    // Wide: everything inline, no overflow, one short row.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    let m = await metrics(page);
    expect(m.hasMore, "wide: no overflow needed").toBe(false);
    expect(m.toolbarHeight, "wide: single row").toBeLessThan(72);
    expect(m.pageScrollsX, "wide: no horizontal page scroll").toBe(false);
    expect(m.inlineGroups).toContain("Ornaments and grace");

    // Tablet width: still one row, but low-priority groups overflow to More.
    await page.setViewportSize({ width: 768, height: 800 });
    await page.waitForTimeout(300);
    m = await metrics(page);
    expect(m.hasMore, "tablet: overflow appears").toBe(true);
    expect(m.toolbarHeight, "tablet: still single row").toBeLessThan(72);
    expect(m.pageScrollsX, "tablet: no horizontal page scroll").toBe(false);
    expect(m.inlineGroups, "tablet: ornaments collapsed").not.toContain("Ornaments and grace");

    // Phone width: single row, no 2D scroll trap, note-core still pinned.
    await page.setViewportSize({ width: 320, height: 720 });
    await page.waitForTimeout(300);
    m = await metrics(page);
    expect(m.toolbarHeight, "phone: single row").toBeLessThan(72);
    expect(m.pageScrollsX, "phone: no horizontal page scroll (WCAG 1.4.10)").toBe(false);
    expect(m.pinnedGroups, "phone: value pinned").toContain("Note value");
    expect(m.pinnedGroups, "phone: pitch pinned").toContain("Pitch");
  });

  test("every overflowed feature stays reachable and functional via More (bottom sheet)", async ({ page }) => {
    await freshApp(page);
    await page.setViewportSize({ width: 700, height: 800 });
    await newScoreWithNote(page);
    await page.waitForTimeout(300);

    // Marks/Ornaments/Dynamics are overflowed here; open the bottom-sheet menu.
    await page.locator('[aria-label^="More editing tools"]').click();
    const sheet = page.locator(".etb-more-popover");
    await expect(sheet).toBeVisible();
    // Nothing is removed: the collapsed groups live here, fully on-screen.
    const onScreen = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0 && r.bottom <= window.innerHeight + 1;
    });
    expect(onScreen, "More menu never clips off-screen").toBe(true);

    // An overflowed control still works: apply Mordent from the More menu.
    await sheet.locator('button[aria-label="Mordent"]').click();
    await page.waitForTimeout(200);
    const hasMordent = await page.evaluate(
      () => (window as Win).__ovV1Editor().doc.parts[0].measures[0].voices[0].beats[0].ornaments?.includes("mordent"),
    );
    expect(hasMordent, "overflowed Mordent applied").toBe(true);
  });
});

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to a repo file, regardless of the runner's cwd. */
export function repoPath(relativeToAppWeb: string): string {
  return resolve(here, "..", relativeToAppWeb);
}

/** Start each test from a clean slate (no persisted session). */
export async function freshApp(page: Page, path = "/") {
  // Clear persisted state once per tab, not on every navigation, so that
  // reload-persistence tests still work. Resets localStorage (theme, mode,
  // panel collapse) to defaults so tests do not pollute each other.
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("ov-e2e-cleared")) {
        sessionStorage.setItem("ov-e2e-cleared", "1");
        localStorage.clear();
        indexedDB.deleteDatabase("openvoicing");
      }
      localStorage.setItem("ov-toured", "1"); // skip the first-run tour
    } catch {
      /* ignore */
    }
  });
  // Default to a wide viewport so the full edit toolbar fits inline (feature
  // groups only collapse into "More" when the screen can't hold them). Tests
  // that care about responsive behaviour set their own viewport after this.
  await page.setViewportSize({ width: 2300, height: 1000 });
  await page.goto(path);
  // The player boots asynchronously; wait for the score to render.
  await page.waitForFunction(() => (window as unknown as { __ovPlayer?: unknown }).__ovPlayer, {
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function player(page: Page): Promise<any> {
  return page.evaluate(() => (window as unknown as { __ovPlayer: unknown }).__ovPlayer);
}

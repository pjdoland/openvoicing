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

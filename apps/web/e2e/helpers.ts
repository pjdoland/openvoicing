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
  // reload-persistence tests still work.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ov-toured", "1"); // skip the first-run tour
      if (!sessionStorage.getItem("ov-e2e-cleared")) {
        sessionStorage.setItem("ov-e2e-cleared", "1");
        indexedDB.deleteDatabase("openvoicing");
      }
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

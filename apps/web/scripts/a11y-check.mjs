// Automated accessibility regression check. Loads the app and the embed
// player and fails on serious/critical axe violations.
//
//   pnpm --filter @openvoicing/web preview &   # or: pnpm dev
//   node apps/web/scripts/a11y-check.mjs http://localhost:4173
//
// Requires (installed on demand in CI): playwright, @axe-core/playwright.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

const base = process.argv[2] || "http://localhost:4173";
// goldberg-aria.ovb ships in the built app (from public/); use it so the embed
// page actually renders a player rather than an error state.
const pages = ["/", "/embed.html?bundle=/goldberg-aria.ovb"];

const browser = await chromium.launch();
// @axe-core/playwright requires a page from an explicit context, not the
// implicit one created by browser.newPage().
const context = await browser.newContext();
let failed = false;

for (const path of pages) {
  const page = await context.newPage();
  // "networkidle" never settles under Vite's dev HMR socket and is flaky under
  // a service worker; wait for load, then give rendering a moment.
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(3500);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  if (serious.length > 0) {
    failed = true;
    console.error(`\n${path}: ${serious.length} serious/critical violations`);
    for (const v of serious) {
      console.error(`  [${v.impact}] ${v.id}: ${v.help}`);
      for (const node of v.nodes.slice(0, 4)) {
        console.error(`      ${node.target.join(" ")}`);
        if (node.failureSummary) console.error(`      -> ${node.failureSummary.replace(/\n/g, " ")}`.slice(0, 200));
      }
    }
  } else {
    console.log(`${path}: no serious/critical violations`);
  }
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);

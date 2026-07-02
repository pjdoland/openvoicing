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
const pages = ["/", "/embed.html?bundle=/demo.ovb"];

const browser = await chromium.launch();
let failed = false;

for (const path of pages) {
  const page = await browser.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  if (serious.length > 0) {
    failed = true;
    console.error(`\n${path}: ${serious.length} serious/critical violations`);
    for (const v of serious) console.error(`  [${v.impact}] ${v.id}: ${v.help}`);
  } else {
    console.log(`${path}: no serious/critical violations`);
  }
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);

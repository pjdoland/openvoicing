import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalizeMusicXml, exportMusicXmlV1, importMusicXmlV1, validationErrors } from "../src/v1";

const GOLDBERG =
  "/private/tmp/claude-502/-Users-pjdoland-Repos-openvoicing/e5f08c59-576d-4230-a4bd-5fc892ae1c51/scratchpad/gold/score/aria.musicxml";

// Real-world proof: the Goldberg aria (two-staff, 64 bars, ties, ornaments,
// multiple voices) is exactly the kind of score the v0 model could not edit.
// This asserts v1 imports it soundly and round-trips its tier-0 structure.
describe("v1 on the Goldberg aria", () => {
  const xml = readFileSync(GOLDBERG, "utf8");

  it("imports without structural violations", () => {
    const doc = importMusicXmlV1(xml);
    expect(doc.parts.length).toBeGreaterThanOrEqual(1);
    expect(doc.bars.length).toBeGreaterThan(30);
    expect(doc.parts[0]!.staves.length).toBe(2);
    // Warnings are tolerated (this freedots-generated source has some over-full
    // voices); there must be no error-severity structural defects.
    const errors = validationErrors(doc);
    if (errors.length) console.error("first errors:", errors.slice(0, 5));
    expect(errors).toEqual([]);
  });

  it("captures tier-1 notation (slurs, ornaments, fermatas)", () => {
    const doc = importMusicXmlV1(xml);
    expect(doc.spanners.filter((s) => s.kind === "slur").length).toBeGreaterThan(30);
    const beats = doc.parts.flatMap((p) => p.measures.flatMap((me) => me.voices.flatMap((v) => v.beats)));
    expect(beats.some((b) => b.ornaments?.includes("mordent"))).toBe(true);
    expect(beats.some((b) => b.fermata)).toBe(true);
  });

  it("round-trips its structure AND notation through export (tier-1)", () => {
    const source = canonicalizeMusicXml(xml);
    const roundtrip = canonicalizeMusicXml(exportMusicXmlV1(importMusicXmlV1(xml)));
    expect(roundtrip).toEqual(source);
  });
});

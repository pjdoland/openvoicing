import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importMusicXml, toMusicXml, type ScoreDocument } from "../src/index";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".musicxml"));

/** The musical shape that a round-trip must preserve exactly. */
function shape(doc: ScoreDocument) {
  return {
    title: doc.title,
    bars: doc.bars.map((b) => ({ ts: b.timeSignature, key: b.keyFifths })),
    parts: doc.parts.map((p) =>
      p.measures.map((m) =>
        m.voices.map((v) =>
          v.beats.map((beat) => ({
            dur: beat.durationTicks,
            rest: beat.rest,
            notes: beat.notes.map(
              (n) => `${n.step}/${n.alter}/${n.octave}/${n.tieStart ? "s" : ""}${n.tieStop ? "t" : ""}`,
            ),
          })),
        ),
      ),
    ),
  };
}

describe("MusicXML import/export corpus", () => {
  it("has fixtures to test", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`round-trips ${file}`, () => {
      const xml = readFileSync(join(fixturesDir, file), "utf8");
      const original = importMusicXml(xml);
      const reimported = importMusicXml(toMusicXml(original));
      expect(shape(reimported)).toEqual(shape(original));
    });
  }
});

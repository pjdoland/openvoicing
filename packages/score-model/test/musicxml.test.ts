import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importMusicXml, PPQ } from "../src/index";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "two-bars.musicxml"),
  "utf8",
);

describe("importMusicXml", () => {
  const doc = importMusicXml(fixture);

  it("imports metadata", () => {
    expect(doc.title).toBe("Two Bars");
    expect(doc.composer).toBe("Trad.");
    expect(doc.parts).toHaveLength(1);
    expect(doc.parts[0]!.name).toBe("Guitar");
  });

  it("builds global bars with effective attributes", () => {
    expect(doc.bars).toHaveLength(2);
    expect(doc.bars[0]!.timeSignature).toEqual({ beats: 4, beatUnit: 4 });
    expect(doc.bars[0]!.tempoBpm).toBe(90);
    expect(doc.bars[1]!.timeSignature).toEqual({ beats: 4, beatUnit: 4 });
    expect(doc.bars[1]!.tempoBpm).toBeUndefined();
  });

  it("groups chords into a single beat and tracks tick offsets", () => {
    const beats = doc.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(3);

    const [chord, single, rest] = beats;
    expect(chord!.startTick).toBe(0);
    expect(chord!.durationTicks).toBe(PPQ);
    expect(chord!.notes.map((n) => `${n.step}${n.octave}`)).toEqual(["C4", "E4"]);

    expect(single!.startTick).toBe(PPQ);
    expect(single!.notes.map((n) => `${n.step}${n.octave}`)).toEqual(["G4"]);

    expect(rest!.rest).toBe(true);
    expect(rest!.startTick).toBe(2 * PPQ);
    expect(rest!.durationTicks).toBe(2 * PPQ);
  });

  it("imports alterations", () => {
    const note = doc.parts[0]!.measures[1]!.voices[0]!.beats[0]!.notes[0]!;
    expect(note.step).toBe("D");
    expect(note.alter).toBe(1);
    expect(note.octave).toBe(4);
  });

  it("assigns unique stable ids", () => {
    const ids = new Set<string>();
    for (const bar of doc.bars) ids.add(bar.id);
    for (const part of doc.parts) {
      ids.add(part.id);
      for (const m of part.measures) {
        ids.add(m.id);
        for (const v of m.voices) {
          ids.add(v.id);
          for (const b of v.beats) {
            ids.add(b.id);
            for (const n of b.notes) ids.add(n.id);
          }
        }
      }
    }
    expect(ids.size).toBe(2 + 1 + 2 + 2 + 4 + 4);
  });
});

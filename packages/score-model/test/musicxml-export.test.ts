import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  importMusicXml,
  neighborBeatAddress,
  ScoreEditor,
  toMusicXml,
  type BeatAddress,
  type ScoreDocument,
} from "../src/index";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "two-bars.musicxml"),
  "utf8",
);

function shape(doc: ScoreDocument) {
  return {
    title: doc.title,
    bars: doc.bars.map((b) => ({
      ts: b.timeSignature,
      key: b.keyFifths,
      tempo: b.tempoBpm,
    })),
    parts: doc.parts.map((p) => ({
      name: p.name,
      measures: p.measures.map((m) =>
        m.voices.map((v) =>
          v.beats.map((beat) => ({
            start: beat.startTick,
            duration: beat.durationTicks,
            rest: beat.rest,
            notes: beat.notes.map((n) => `${n.step}/${n.alter}/${n.octave}`),
          })),
        ),
      ),
    })),
  };
}

describe("toMusicXml", () => {
  it("round-trips through the importer", () => {
    const original = importMusicXml(fixture);
    const reimported = importMusicXml(toMusicXml(original));
    expect(shape(reimported)).toEqual(shape(original));
  });

  it("round-trips after edits", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    const first: BeatAddress = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    editor.transposeBeat(first, 1);
    editor.setBeatDuration(first, 480);
    editor.insertBeatAfter(first);
    const reimported = importMusicXml(toMusicXml(editor.doc));
    expect(shape(reimported)).toEqual(shape(editor.doc));
  });

  it("escapes XML entities", () => {
    const doc = importMusicXml(fixture);
    doc.title = 'A & B <"quoted">';
    expect(toMusicXml(doc)).toContain("A &amp; B &lt;&quot;quoted&quot;&gt;");
  });
});

describe("neighborBeatAddress", () => {
  const doc = importMusicXml(fixture);
  const first: BeatAddress = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };

  it("moves within a bar", () => {
    expect(neighborBeatAddress(doc, first, 1)).toEqual({ ...first, beatIndex: 1 });
  });

  it("crosses bar boundaries", () => {
    const lastOfBar1 = { ...first, beatIndex: 2 };
    expect(neighborBeatAddress(doc, lastOfBar1, 1)).toEqual({ ...first, barIndex: 1 });
    expect(neighborBeatAddress(doc, { ...first, barIndex: 1 }, -1)).toEqual(lastOfBar1);
  });

  it("returns null at the ends", () => {
    expect(neighborBeatAddress(doc, first, -1)).toBeNull();
    expect(neighborBeatAddress(doc, { ...first, barIndex: 1, beatIndex: 0 }, 1)).toBeNull();
  });
});

describe("respellBeat", () => {
  it("toggles enharmonic spelling both ways", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    // Bar 2 holds D#4.
    const address: BeatAddress = { partIndex: 0, barIndex: 1, voiceIndex: 0, beatIndex: 0 };
    expect(editor.respellBeat(address)).toBe(true);
    const note = () => editor.doc.parts[0]!.measures[1]!.voices[0]!.beats[0]!.notes[0]!;
    expect(`${note().step}${note().alter}${note().octave}`).toBe("E-14");
    expect(editor.respellBeat(address)).toBe(true);
    expect(`${note().step}${note().alter}${note().octave}`).toBe("D14");
  });

  it("does nothing for naturals", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    expect(
      editor.respellBeat({ partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 1 }),
    ).toBe(false);
  });
});

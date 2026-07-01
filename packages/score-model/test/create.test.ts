import { describe, expect, it } from "vitest";
import {
  createEmptyScore,
  importMusicXml,
  PPQ,
  ScoreEditor,
  toAlphaTex,
  toMusicXml,
} from "../src/index";

describe("createEmptyScore", () => {
  it("creates whole-bar rests with defaults", () => {
    const doc = createEmptyScore();
    expect(doc.title).toBe("Untitled");
    expect(doc.bars).toHaveLength(8);
    expect(doc.bars[0]!.tempoBpm).toBe(120);
    expect(doc.parts).toHaveLength(1);
    const beat = doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!;
    expect(beat.rest).toBe(true);
    expect(beat.durationTicks).toBe(4 * PPQ);
  });

  it("honors options", () => {
    const doc = createEmptyScore({
      title: "Waltz",
      bars: 16,
      timeSignature: { beats: 3, beatUnit: 4 },
      tempoBpm: 90,
    });
    expect(doc.bars).toHaveLength(16);
    expect(doc.bars[5]!.timeSignature).toEqual({ beats: 3, beatUnit: 4 });
    expect(doc.parts[0]!.measures[3]!.voices[0]!.beats[0]!.durationTicks).toBe(3 * PPQ);
  });

  it("is editable and renders both ways", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 2 }));
    const first = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    expect(editor.setBeatPitch(first, "C")).toBe(true);
    expect(editor.setBeatDuration(first, PPQ)).toBe(true);
    expect(editor.insertBeatAfter(first)).not.toBeNull();

    const tex = toAlphaTex(editor.doc);
    expect(tex).toContain("c4.4 c4.4");

    const reimported = importMusicXml(toMusicXml(editor.doc));
    const beats = reimported.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(2);
    expect(beats[0]!.notes[0]!.step).toBe("C");
  });
});

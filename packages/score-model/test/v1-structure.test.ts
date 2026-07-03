import { describe, expect, it } from "vitest";
import { createEmptyScoreV1, ScoreEditorV1, validationErrors } from "../src/v1";

describe("v1 blank canvas + structural editing", () => {
  it("creates a valid empty score with per-beat rest slots", () => {
    const doc = createEmptyScoreV1({ title: "Exercise", bars: 3, beats: 3, beatUnit: 4 });
    expect(validationErrors(doc)).toEqual([]);
    expect(doc.bars).toHaveLength(3);
    // 3/4 => three quarter-rest slots per bar to type into.
    const beats = doc.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(3);
    expect(beats.every((b) => b.rest && b.duration.noteType === "quarter")).toBe(true);
  });

  it("inserts and removes measures kept synced across parts", () => {
    const doc = createEmptyScoreV1({ bars: 2 });
    const editor = new ScoreEditorV1(doc);
    editor.insertMeasure(0, "after");
    expect(editor.doc.bars).toHaveLength(3);
    expect(editor.doc.parts[0]!.measures).toHaveLength(3);
    expect(editor.doc.bars.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(validationErrors(editor.doc)).toEqual([]);

    editor.removeMeasure(1);
    expect(editor.doc.bars).toHaveLength(2);
    expect(validationErrors(editor.doc)).toEqual([]);

    // A one-bar score can't drop its last bar.
    editor.removeMeasure(0);
    expect(editor.doc.bars.length).toBeGreaterThanOrEqual(1);
  });

  it("sets time and key signatures", () => {
    const doc = createEmptyScoreV1({ bars: 1 });
    const editor = new ScoreEditorV1(doc);
    editor.setTimeSignature(0, 6, 8);
    expect(editor.doc.parts[0]!.measures[0]!.attributes!.time).toEqual({ beats: 6, beatUnit: 8 });
    expect(editor.doc.bars[0]!.durationTicks).toBe(Math.round(6 * (4 / 8) * 960));

    editor.setKeySignature(0, -3);
    expect(editor.doc.parts[0]!.measures[0]!.attributes!.key).toEqual({ fifths: -3 });
  });

  it("edits metadata", () => {
    const editor = new ScoreEditorV1(createEmptyScoreV1());
    editor.setWork({ title: "My Piece", composer: "Me" });
    expect(editor.doc.work.title).toBe("My Piece");
    expect(editor.doc.work.composer).toBe("Me");
  });
});

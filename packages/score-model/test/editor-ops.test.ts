import { describe, expect, it } from "vitest";
import { createEmptyScore, PPQ, ScoreEditor, toAlphaTex, type BeatAddress } from "../src/index";

const FIRST: BeatAddress = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };

function fresh() {
  const editor = new ScoreEditor(createEmptyScore({ bars: 2 }));
  editor.setBeatPitch(FIRST, "C");
  editor.setBeatDuration(FIRST, PPQ);
  return editor;
}

describe("editor operations (batch D)", () => {
  it("toggles augmentation dots", () => {
    const editor = fresh();
    expect(editor.toggleDotted(FIRST)).toBe(true);
    expect(editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.durationTicks).toBe(PPQ * 1.5);
    expect(editor.toggleDotted(FIRST)).toBe(true);
    expect(editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.durationTicks).toBe(PPQ);
  });

  it("cycles accidentals keeping the step", () => {
    const editor = fresh();
    expect(editor.cycleAccidental(FIRST, 1)).toBe(true);
    const note = () => editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!;
    expect(note().step).toBe("C");
    expect(note().alter).toBe(1);
    expect(editor.cycleAccidental(FIRST, -1)).toBe(true);
    expect(note().alter).toBe(0);
  });

  it("adds notes to a chord without duplicates", () => {
    const editor = fresh();
    expect(editor.addNoteToChord(FIRST, "E")).toBe(true);
    expect(editor.addNoteToChord(FIRST, "G")).toBe(true);
    const notes = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes;
    expect(notes.map((n) => n.step).sort()).toEqual(["C", "E", "G"]);
    expect(editor.addNoteToChord(FIRST, "C")).toBe(false);
  });

  it("repeats the previous bar", () => {
    const editor = fresh();
    editor.insertBeatAfter(FIRST);
    const second: BeatAddress = { ...FIRST, barIndex: 1 };
    expect(editor.repeatPreviousBar(second)).toBe(true);
    const bar2 = editor.doc.parts[0]!.measures[1]!.voices[0]!.beats;
    expect(bar2).toHaveLength(2);
    expect(bar2[0]!.notes[0]!.step).toBe("C");
    // Fresh ids, not shared with bar 1.
    expect(bar2[0]!.id).not.toBe(editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.id);
  });

  it("sets triplets and renders them in alphaTex", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 1 }));
    editor.setBeatPitch(FIRST, "C");
    editor.setBeatDuration(FIRST, PPQ / 3);
    expect(editor.setTuplet(FIRST, 3)).toBe(true);
    expect(toAlphaTex(editor.doc)).toContain("{tu 3}");
  });

  it("attaches lyrics and renders them", () => {
    const editor = fresh();
    expect(editor.setLyric(FIRST, "la")).toBe(true);
    expect(toAlphaTex(editor.doc)).toContain('lyrics "la"');
  });

  it("changes time signature from a bar onward", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 4 }));
    expect(editor.setTimeSignatureFrom(2, 3, 4)).toBe(true);
    expect(editor.doc.bars[1]!.timeSignature).toEqual({ beats: 4, beatUnit: 4 });
    expect(editor.doc.bars[2]!.timeSignature).toEqual({ beats: 3, beatUnit: 4 });
    expect(editor.doc.bars[3]!.timeSignature).toEqual({ beats: 3, beatUnit: 4 });
  });

  it("changes key from a bar onward", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 3 }));
    expect(editor.setKeyFrom(1, 2)).toBe(true);
    expect(editor.doc.bars[0]!.keyFifths).toBe(0);
    expect(editor.doc.bars[1]!.keyFifths).toBe(2);
    expect(editor.doc.bars[2]!.keyFifths).toBe(2);
  });

  it("transposes the whole score", () => {
    const editor = fresh();
    editor.addNoteToChord(FIRST, "E");
    expect(editor.transposeScore(2)).toBe(true);
    const notes = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes;
    expect(notes.map((n) => `${n.step}${n.alter > 0 ? "#" : ""}${n.octave}`).sort()).toEqual([
      "D4",
      "F#4",
    ]);
  });

  it("sets an exact pitch spelling (used by MIDI step entry)", () => {
    const editor = fresh();
    expect(editor.setBeatPitchExact(FIRST, "E", -1, 5)).toBe(true);
    const note = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!;
    expect(note).toMatchObject({ step: "E", alter: -1, octave: 5 });
  });

  it("sets a part instrument", () => {
    const editor = fresh();
    expect(editor.setInstrument(0, 52)).toBe(true);
    expect(editor.doc.parts[0]!.midiProgram).toBe(52);
    expect(editor.setInstrument(9, 0)).toBe(false);
  });

  it("inserts multiple beats with fresh ids and repacked ticks", () => {
    const editor = fresh();
    editor.setBeatDuration(FIRST, PPQ);
    const clip = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats.slice(0, 1);
    expect(editor.insertBeatsAfter(FIRST, clip)).toBe(true);
    const beats = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(2);
    expect(beats[1]!.id).not.toBe(beats[0]!.id);
    expect(beats[1]!.startTick).toBe(PPQ);
    expect(editor.insertBeatsAfter(FIRST, [])).toBe(false);
  });

  it("rejects operations on missing addresses without touching history", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 1 }));
    const bad = { partIndex: 5, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    expect(editor.toggleDotted(bad)).toBe(false);
    expect(editor.setTuplet(bad, 3)).toBe(false);
    expect(editor.setLyric(bad, "x")).toBe(false);
    expect(editor.setBeatPitchExact(bad, "C", 0, 4)).toBe(false);
    // No successful edit means nothing to undo.
    expect(editor.canUndo).toBe(false);
  });

  it("keeps all operations undoable", () => {
    const editor = fresh();
    editor.toggleDotted(FIRST);
    editor.cycleAccidental(FIRST, 1);
    editor.transposeScore(1);
    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.durationTicks).toBe(PPQ);
  });
});

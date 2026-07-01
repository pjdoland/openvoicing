import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  importMusicXml,
  midiToPitch,
  pitchToMidi,
  ScoreEditor,
  type BeatAddress,
} from "../src/index";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "two-bars.musicxml"),
  "utf8",
);

const FIRST_BEAT: BeatAddress = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };

function firstBeatPitches(editor: ScoreEditor): string[] {
  return editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes.map(
    (n) => `${n.step}${n.alter > 0 ? "#" : n.alter < 0 ? "b" : ""}${n.octave}`,
  );
}

describe("pitch math", () => {
  it("converts pitches to midi and back", () => {
    expect(pitchToMidi("C", 0, 4)).toBe(60);
    expect(pitchToMidi("A", 0, 4)).toBe(69);
    expect(pitchToMidi("C", 1, 4)).toBe(61);
    expect(midiToPitch(61)).toEqual({ step: "C", alter: 1, octave: 4 });
    expect(midiToPitch(59)).toEqual({ step: "B", alter: 0, octave: 3 });
  });
});

describe("ScoreEditor", () => {
  it("transposes a chord up a semitone", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    expect(firstBeatPitches(editor)).toEqual(["C4", "E4"]);
    expect(editor.transposeBeat(FIRST_BEAT, 1)).toBe(true);
    expect(firstBeatPitches(editor)).toEqual(["C#4", "F4"]);
  });

  it("crosses octave boundaries", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    expect(editor.transposeBeat(FIRST_BEAT, -1)).toBe(true);
    expect(firstBeatPitches(editor)).toEqual(["B3", "D#4"]);
  });

  it("supports undo and redo", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    editor.transposeBeat(FIRST_BEAT, 2);
    expect(firstBeatPitches(editor)).toEqual(["D4", "F#4"]);
    expect(editor.undo()).toBe(true);
    expect(firstBeatPitches(editor)).toEqual(["C4", "E4"]);
    expect(editor.redo()).toBe(true);
    expect(firstBeatPitches(editor)).toEqual(["D4", "F#4"]);
    expect(editor.canRedo).toBe(false);
  });

  it("preserves stable note ids across edits", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    const before = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes.map((n) => n.id);
    editor.transposeBeat(FIRST_BEAT, 1);
    const after = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes.map((n) => n.id);
    expect(after).toEqual(before);
  });

  it("rejects addresses without notes", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    // Beat 2 of bar 1 is a rest.
    expect(editor.transposeBeat({ ...FIRST_BEAT, beatIndex: 2 }, 1)).toBe(false);
    expect(editor.canUndo).toBe(false);
  });
});

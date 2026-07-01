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

  it("sets a pitch in the nearest octave", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    // First beat is C4/E4; B should land at B3 (nearest to C4), not B4.
    expect(editor.setBeatPitch(FIRST_BEAT, "B")).toBe(true);
    expect(firstBeatPitches(editor)).toEqual(["B3"]);
    expect(editor.setBeatPitch(FIRST_BEAT, "C")).toBe(true);
    expect(firstBeatPitches(editor)).toEqual(["C4"]);
  });

  it("turns a rest into a note", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    const restAddress = { ...FIRST_BEAT, beatIndex: 2 };
    expect(editor.setBeatPitch(restAddress, "G")).toBe(true);
    const beat = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[2]!;
    expect(beat.rest).toBe(false);
    // Nearest G to the middle-C reference is G3 (5 semitones vs 7 up to G4).
    expect(beat.notes.map((n) => `${n.step}${n.octave}`)).toEqual(["G3"]);
  });

  it("changes durations and repacks tick offsets", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    expect(editor.setBeatDuration(FIRST_BEAT, 480)).toBe(true);
    const beats = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(beats[0]!.durationTicks).toBe(480);
    expect(beats[1]!.startTick).toBe(480);
    expect(beats[2]!.startTick).toBe(480 + 960);
  });

  it("turns a note into a rest", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    expect(editor.setBeatRest(FIRST_BEAT)).toBe(true);
    const beat = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!;
    expect(beat.rest).toBe(true);
    expect(beat.notes).toEqual([]);
    expect(editor.setBeatRest(FIRST_BEAT)).toBe(false);
  });

  it("inserts a copy after a beat with fresh ids", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    const inserted = editor.insertBeatAfter(FIRST_BEAT);
    expect(inserted).toEqual({ ...FIRST_BEAT, beatIndex: 1 });
    const beats = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(4);
    expect(beats[1]!.notes.map((n) => `${n.step}${n.octave}`)).toEqual(["C4", "E4"]);
    expect(beats[1]!.id).not.toBe(beats[0]!.id);
    expect(beats[1]!.startTick).toBe(960);
    expect(beats[2]!.startTick).toBe(1920);
  });

  it("deletes a beat and repacks", () => {
    const editor = new ScoreEditor(importMusicXml(fixture));
    expect(editor.deleteBeat(FIRST_BEAT)).toBe(true);
    const beats = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(beats).toHaveLength(2);
    expect(beats[0]!.startTick).toBe(0);
    expect(editor.undo()).toBe(true);
    expect(editor.doc.parts[0]!.measures[0]!.voices[0]!.beats).toHaveLength(3);
  });
});

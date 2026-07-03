import { describe, expect, it } from "vitest";
import {
  createEmptyScoreV1,
  exportMusicXmlV1,
  importMusicXmlV1,
  ScoreEditorV1,
  validationErrors,
} from "../src/v1";

describe("grace notes, ornaments, and voices (entry)", () => {
  it("inserts a grace note before a beat", () => {
    const doc = createEmptyScoreV1({ bars: 1, beats: 4 });
    const editor = new ScoreEditorV1(doc);
    const beats = doc.parts[0]!.measures[0]!.voices[0]!.beats;
    editor.restToNoteByName(beats[1]!.id, "C");
    const before = editor.findBeat(beats[1]!.id)!.beatIndex;
    const graceId = editor.insertGraceBefore(beats[1]!.id, "D");
    expect(graceId).toBeTruthy();
    const voice = editor.doc.parts[0]!.measures[0]!.voices[0]!;
    const grace = voice.beats.find((b) => b.notes.some((n) => n.id === graceId))!;
    expect(grace.grace?.kind).toBe("appoggiatura");
    expect(grace.notes[0]!.step).toBe("D");
    // It sits immediately before the target beat.
    expect(voice.beats.indexOf(grace)).toBe(before);
    expect(validationErrors(editor.doc)).toEqual([]);
  });

  it("toggles ornaments on a beat", () => {
    const doc = createEmptyScoreV1({ bars: 1 });
    const editor = new ScoreEditorV1(doc);
    const beatId = doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.id;
    editor.restToNoteByName(beatId, "C");
    editor.toggleOrnament(beatId, "mordent");
    expect(editor.findBeat(beatId)!.beat.ornaments).toEqual(["mordent"]);
    editor.toggleOrnament(beatId, "mordent");
    expect(editor.findBeat(beatId)!.beat.ornaments).toBeUndefined();
  });

  it("adds and removes an independent voice on a bar", () => {
    const doc = createEmptyScoreV1({ bars: 2, beats: 4 });
    const editor = new ScoreEditorV1(doc);
    const firstBeat = editor.addVoice(0);
    expect(firstBeat).toBeTruthy();
    expect(editor.doc.parts[0]!.measures[0]!.voices).toHaveLength(2);
    // The new voice is editable: enter a note into it.
    editor.restToNoteByName(firstBeat!, "G");
    expect(editor.findBeat(firstBeat!)!.beat.notes[0]!.step).toBe("G");
    expect(validationErrors(editor.doc)).toEqual([]);

    const newVoiceIndex = editor.doc.parts[0]!.measures[0]!.voices[1]!.index;
    editor.removeVoice(0, newVoiceIndex);
    expect(editor.doc.parts[0]!.measures[0]!.voices).toHaveLength(1);
    // The sole remaining voice cannot be removed.
    expect(editor.removeVoice(0, editor.doc.parts[0]!.measures[0]!.voices[0]!.index)).toBe(false);
  });

  it("round-trips grace notes and ornaments through MusicXML", () => {
    const doc = createEmptyScoreV1({ bars: 1, beats: 4 });
    const editor = new ScoreEditorV1(doc);
    const beats = doc.parts[0]!.measures[0]!.voices[0]!.beats;
    editor.restToNoteByName(beats[0]!.id, "C");
    editor.toggleOrnament(beats[0]!.id, "mordent");
    editor.insertGraceBefore(beats[0]!.id, "D");

    const re = importMusicXmlV1(exportMusicXmlV1(editor.doc));
    const rebeats = re.parts[0]!.measures[0]!.voices[0]!.beats;
    expect(rebeats.some((b) => b.grace && b.notes[0]?.step === "D")).toBe(true);
    expect(rebeats.some((b) => b.ornaments?.includes("mordent"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { createEmptyScoreV1, ScoreEditorV1, validationErrors } from "../src/v1";

function twoNoteScore() {
  const doc = createEmptyScoreV1({ bars: 1, beats: 4 });
  const editor = new ScoreEditorV1(doc);
  const beats = doc.parts[0]!.measures[0]!.voices[0]!.beats;
  editor.restToNoteByName(beats[0]!.id, "C");
  editor.restToNoteByName(beats[1]!.id, "C");
  return { editor, beat0: beats[0]!.id, beat1: beats[1]!.id };
}

describe("v1 notation editing", () => {
  it("toggles articulations, ornaments, and fermata on a beat", () => {
    const { editor, beat0 } = twoNoteScore();
    editor.toggleArticulation(beat0, "staccato");
    expect(editor.findBeat(beat0)!.beat.articulations).toEqual(["staccato"]);
    editor.toggleArticulation(beat0, "accent");
    expect(editor.findBeat(beat0)!.beat.articulations).toEqual(["staccato", "accent"]);
    editor.toggleArticulation(beat0, "staccato"); // remove
    expect(editor.findBeat(beat0)!.beat.articulations).toEqual(["accent"]);
    editor.toggleFermata(beat0);
    expect(editor.findBeat(beat0)!.beat.fermata).toBe(true);
    editor.toggleOrnament(beat0, "mordent");
    expect(editor.findBeat(beat0)!.beat.ornaments).toEqual(["mordent"]);
  });

  it("ties a note to the next beat and unties, staying valid", () => {
    const { editor, beat0 } = twoNoteScore();
    const noteId = editor.findBeat(beat0)!.beat.notes[0]!.id;
    editor.toggleTie(noteId);
    expect(editor.doc.spanners.filter((s) => s.kind === "tie")).toHaveLength(1);
    expect(validationErrors(editor.doc)).toEqual([]);
    editor.toggleTie(noteId);
    expect(editor.doc.spanners.filter((s) => s.kind === "tie")).toHaveLength(0);
  });

  it("slurs a beat to the next and removes it", () => {
    const { editor, beat0 } = twoNoteScore();
    editor.toggleSlur(beat0);
    expect(editor.doc.spanners.filter((s) => s.kind === "slur")).toHaveLength(1);
    expect(validationErrors(editor.doc)).toEqual([]);
    editor.toggleSlur(beat0);
    expect(editor.doc.spanners.filter((s) => s.kind === "slur")).toHaveLength(0);
  });

  it("sets and clears a dynamic marking as a direction", () => {
    const { editor, beat1 } = twoNoteScore();
    editor.setDynamic(beat1, "mf");
    const dir = editor.doc.directions.find((d) => d.content.kind === "dynamics");
    expect(dir?.content).toEqual({ kind: "dynamics", value: "mf" });
    expect(validationErrors(editor.doc)).toEqual([]);
    editor.setDynamic(beat1, null);
    expect(editor.doc.directions.some((d) => d.content.kind === "dynamics")).toBe(false);
  });
});

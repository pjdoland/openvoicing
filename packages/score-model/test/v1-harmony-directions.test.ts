import { describe, expect, it } from "vitest";
import { createEmptyScoreV1, exportMusicXmlV1, importMusicXmlV1, ScoreEditorV1 } from "../src/v1";

/** Build a small score with chord symbols and directions, then round-trip it. */
function authored() {
  const doc = createEmptyScoreV1({ bars: 2, beats: 4 });
  const editor = new ScoreEditorV1(doc);
  const beats = doc.parts[0]!.measures[0]!.voices[0]!.beats;
  editor.restToNoteByName(beats[0]!.id, "C");
  editor.restToNoteByName(beats[2]!.id, "G");
  editor.setChordSymbol(beats[0]!.id, "Cmaj7");
  editor.setChordSymbol(beats[2]!.id, "G/B");
  editor.setDynamic(beats[0]!.id, "mf");
  editor.addText(beats[2]!.id, "rit.", "words");
  return editor.doc;
}

describe("harmony + direction round-trip", () => {
  it("survives export -> import", () => {
    const before = authored();
    const reimported = importMusicXmlV1(exportMusicXmlV1(before));

    const beats = reimported.parts[0]!.measures[0]!.voices[0]!.beats;
    const chords = beats.map((b) => b.chordSymbol).filter(Boolean);
    expect(chords).toEqual(["Cmaj7", "G/B"]);

    const dyn = reimported.directions.find((d) => d.content.kind === "dynamics");
    expect(dyn?.content).toEqual({ kind: "dynamics", value: "mf" });
    const words = reimported.directions.find((d) => d.content.kind === "words");
    expect((words?.content as { text: string } | undefined)?.text).toBe("rit.");
  });

  it("exports a flat chord root with its accidental", () => {
    const doc = createEmptyScoreV1({ bars: 1, beats: 4 });
    const editor = new ScoreEditorV1(doc);
    const beats = doc.parts[0]!.measures[0]!.voices[0]!.beats;
    editor.restToNoteByName(beats[0]!.id, "E");
    editor.setChordSymbol(beats[0]!.id, "Ebm7");
    const xml = exportMusicXmlV1(editor.doc);
    expect(xml).toContain("<root-step>E</root-step>");
    expect(xml).toContain("<root-alter>-1</root-alter>");
    // The flat must not be swallowed into the kind text (the old regex bug).
    expect(xml).not.toContain('text="bm7"');
  });

  it("round-trips a metronome mark and is idempotent on a second pass", () => {
    const doc = createEmptyScoreV1({ bars: 1 });
    doc.directions.push({
      id: "d1",
      barIndex: 0,
      tick: 0,
      placement: "above",
      content: { kind: "metronome", noteType: "quarter", dots: 0, perMinute: 96 },
    });
    const once = importMusicXmlV1(exportMusicXmlV1(doc));
    const twice = importMusicXmlV1(exportMusicXmlV1(once));
    const metro = twice.directions.find((d) => d.content.kind === "metronome");
    expect(metro?.content).toEqual({ kind: "metronome", noteType: "quarter", dots: 0, perMinute: 96 });
  });
});

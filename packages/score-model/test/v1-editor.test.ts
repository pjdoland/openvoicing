import { describe, expect, it } from "vitest";
import { canonicalizeV1, chromaticValue, importMusicXmlV1, ScoreEditorV1 } from "../src/v1";

const GRAND_STAFF = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

function firstNoteId(doc: ReturnType<typeof importMusicXmlV1>): string {
  return doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!.id;
}
function bassNoteId(doc: ReturnType<typeof importMusicXmlV1>): string {
  const bassVoice = doc.parts[0]!.measures[0]!.voices.find((v) => v.staff === 1)!;
  return bassVoice.beats[0]!.notes[0]!.id;
}

describe("ScoreEditorV1", () => {
  it("addresses and edits a note on any staff by id", () => {
    const doc = importMusicXmlV1(GRAND_STAFF);
    const editor = new ScoreEditorV1(doc);
    const bass = bassNoteId(doc);
    expect(editor.findNote(bass)!.voice.staff).toBe(1);
    editor.setPitch(bass, { step: "G", alter: 0, octave: 2 });
    const loc = editor.findNote(bass)!;
    expect([loc.note.step, loc.note.octave]).toEqual(["G", 2]);
  });

  it("transposes with sharp-preferring spelling", () => {
    const doc = importMusicXmlV1(GRAND_STAFF);
    const editor = new ScoreEditorV1(doc);
    const id = firstNoteId(doc); // C5
    editor.transposeNote(id, 1); // -> C#5
    const n = editor.findNote(id)!.note;
    expect([n.step, n.alter, n.octave]).toEqual(["C", 1, 5]);
    editor.transposeNote(id, 1); // C#5 -> D5
    const n2 = editor.findNote(id)!.note;
    expect([n2.step, n2.alter, n2.octave]).toEqual(["D", 0, 5]);
  });

  it("undo/redo returns the document to an identical state", () => {
    const doc = importMusicXmlV1(GRAND_STAFF);
    const before = JSON.stringify(canonicalizeV1(doc));
    const editor = new ScoreEditorV1(doc);
    const id = firstNoteId(doc);
    editor.transposeNote(id, 5);
    editor.transposeNote(id, 2);
    expect(JSON.stringify(canonicalizeV1(doc))).not.toBe(before);
    editor.undo();
    editor.undo();
    expect(JSON.stringify(canonicalizeV1(doc))).toBe(before);
    editor.redo();
    editor.redo();
    const n = editor.findNote(id)!.note;
    expect([n.step, n.alter, n.octave]).toEqual(["G", 0, 5]); // C5 + 7 semitones = G5
  });

  it("deleting the only note turns the beat into a rest, and undo restores it", () => {
    const doc = importMusicXmlV1(GRAND_STAFF);
    const editor = new ScoreEditorV1(doc);
    const id = firstNoteId(doc);
    const beatId = editor.findNote(id)!.beat.id;
    editor.deleteNote(id);
    // Re-query after each op: undo restores document contents, so held nested
    // references go stale (the app reads editor.doc fresh each render).
    expect(editor.findBeat(beatId)!.beat.rest).toBe(true);
    editor.undo();
    expect(editor.findBeat(beatId)!.beat.notes).toHaveLength(1);
    expect(editor.findBeat(beatId)!.beat.rest).toBe(false);
  });

  it("note entry: set pitch by name, set duration, add chord, rest<->note", () => {
    const doc = importMusicXmlV1(GRAND_STAFF);
    const editor = new ScoreEditorV1(doc);
    const beatId = doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.id; // C5 half
    const noteId = editor.findBeat(beatId)!.beat.notes[0]!.id;

    // Set by name -> nearest octave to C5 is C5.
    editor.setPitchByName(noteId, "F");
    expect(editor.findNote(noteId)!.note.step).toBe("F");

    // Duration change.
    editor.setDuration(beatId, "quarter", 1);
    expect(editor.findBeat(beatId)!.beat.duration).toEqual({ noteType: "quarter", dots: 1 });

    // Chord: add a third above; notes stay ordered high-to-low.
    editor.addInterval(beatId, 4);
    const beat = editor.findBeat(beatId)!.beat;
    expect(beat.notes.length).toBe(2);
    expect(chromaticValue(beat.notes[0]!)).toBeGreaterThan(chromaticValue(beat.notes[1]!));

    // Make it a rest, then bring it back as a note by name.
    editor.makeRest(beatId);
    expect(editor.findBeat(beatId)!.beat.rest).toBe(true);
    editor.restToNoteByName(beatId, "G");
    expect(editor.findBeat(beatId)!.beat.rest).toBe(false);
    expect(editor.findBeat(beatId)!.beat.notes[0]!.step).toBe("G");
  });

  it("accidental cycling and key-aware transpose spelling", () => {
    const doc = importMusicXmlV1(GRAND_STAFF);
    const editor = new ScoreEditorV1(doc);
    const noteId = doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!.id; // C5

    editor.cycleAccidental(noteId, 1); // C#5
    expect(editor.findNote(noteId)!.note.alter).toBe(1);
    expect(editor.findNote(noteId)!.note.accidental?.kind).toBe("sharp");

    // Reset and transpose in a flat key -> flat spelling.
    editor.cycleAccidental(noteId, -1); // back to natural
    doc.parts[0]!.measures[0]!.attributes!.key = { fifths: -3 }; // Eb major
    editor.transposeNote(noteId, 1); // C -> Db (flat key), not C#
    expect(editor.findNote(noteId)!.note.step).toBe("D");
    expect(editor.findNote(noteId)!.note.alter).toBe(-1);
  });
});

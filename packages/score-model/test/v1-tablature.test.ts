import { describe, expect, it } from "vitest";
import { importMusicXmlV1, exportMusicXmlV1, ScoreEditorV1 } from "../src/v1";

// A guitar tab part: standard 6-string tuning, TAB clef, and a note carrying
// string/fret (5th string / 3rd fret = C3).
const TAB = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Guitar</part-name>
    <midi-instrument id="P1-I1"><midi-program>25</midi-program></midi-instrument></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>TAB</sign><line>5</line></clef>
        <staff-details>
          <staff-lines>6</staff-lines>
          <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type>
        <notations><technical><string>5</string><fret>3</fret></technical></notations></note>
    </measure>
  </part>
</score-partwise>`;

describe("v1 tablature", () => {
  it("imports tab clef, tuning, and string/fret", () => {
    const staff = importMusicXmlV1(TAB).parts[0]!.staves[0]!;
    expect(staff.showTablature).toBe(true);
    expect(staff.lines).toBe(6);
    // Standard guitar, string 1 (highest) first: E4 B3 G3 D3 A2 E2.
    expect(staff.tuning).toEqual([64, 59, 55, 50, 45, 40]);
    const note = importMusicXmlV1(TAB).parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!;
    expect([note.string, note.fret]).toEqual([5, 3]);
  });

  it("exports tab staff-details, TAB clef, and technical, and round-trips them", () => {
    const xml = exportMusicXmlV1(importMusicXmlV1(TAB));
    expect(xml).toContain('<sign>TAB</sign>');
    expect(xml).toContain("<staff-tuning");
    expect(xml).toContain("<string>5</string>");
    expect(xml).toContain("<fret>3</fret>");

    const reimported = importMusicXmlV1(xml);
    expect(reimported.parts[0]!.staves[0]!.tuning).toEqual([64, 59, 55, 50, 45, 40]);
    const note = reimported.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!;
    expect([note.string, note.fret]).toEqual([5, 3]);
  });

  it("setFret spells the pitch from the MIDI tuning without an octave shift", () => {
    const editor = new ScoreEditorV1(importMusicXmlV1(TAB));
    const noteId = editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!.id;
    const noteAt = () => editor.doc.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!;
    // String 5 is A2 (MIDI 45); fret 3 is C3, fret 0 the open A2. A missing MIDI
    // -> octave*12 conversion would spell these an octave high (C4 / A3).
    editor.setFret(noteId, 3);
    expect([noteAt().step, noteAt().octave]).toEqual(["C", 3]);
    editor.setFret(noteId, 0);
    expect([noteAt().step, noteAt().octave]).toEqual(["A", 2]);
  });
});

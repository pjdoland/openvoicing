import { describe, expect, it } from "vitest";
import {
  canonicalizeMusicXml,
  canonicalizeV1,
  exportMusicXmlV1,
  importMusicXmlV1,
  validateScoreV1,
} from "../src/v1";

// A grand-staff measure: staff 1 / voice 1 has two half notes, staff 2 / voice 2
// has a whole note, joined by a <backup>. Divisions=4 (quarter=4). This is the
// exact shape (multi-staff, multi-voice, backup) that forced complex scores to
// be read-only under the v0 model.
const GRAND_STAFF = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Grand Staff</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
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

// A tie across two half notes plus a two-note chord.
const TIES_AND_CHORDS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>2</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><voice>1</voice><type>half</type><notations><tied type="start"/></notations></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><type>quarter</type><notations><tied type="stop"/></notations></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

describe("v1 MusicXML round-trip", () => {
  it("imports multi-staff/backup writing into distinct voices and staves", () => {
    const doc = importMusicXmlV1(GRAND_STAFF);
    expect(doc.parts).toHaveLength(1);
    expect(doc.parts[0]!.staves.map((s) => s.clef.sign)).toEqual(["G", "F"]);
    const voices = doc.parts[0]!.measures[0]!.voices;
    expect(voices).toHaveLength(2);
    expect(voices[0]!.staff).toBe(0); // treble
    expect(voices[1]!.staff).toBe(1); // bass
    expect(voices[0]!.beats.map((b) => b.duration.noteType)).toEqual(["half", "half"]);
    expect(voices[1]!.beats[0]!.duration.noteType).toBe("whole");
  });

  it("produces a document that passes structural validation", () => {
    expect(validateScoreV1(importMusicXmlV1(GRAND_STAFF))).toEqual([]);
    expect(validateScoreV1(importMusicXmlV1(TIES_AND_CHORDS))).toEqual([]);
  });

  it("round-trips grand-staff structure through export (canonical equality)", () => {
    const source = canonicalizeMusicXml(GRAND_STAFF);
    const roundtrip = canonicalizeMusicXml(exportMusicXmlV1(importMusicXmlV1(GRAND_STAFF)));
    expect(roundtrip).toEqual(source);
  });

  it("round-trips ties and chords", () => {
    const doc = importMusicXmlV1(TIES_AND_CHORDS);
    // The tie became a note->note spanner.
    expect(doc.spanners.filter((s) => s.kind === "tie")).toHaveLength(1);
    // The chord became one beat with two notes.
    const chordBeat = doc.parts[0]!.measures[0]!.voices[0]!.beats.at(-1)!;
    expect(chordBeat.notes.map((n) => n.step).sort()).toEqual(["C", "E"]);

    const source = canonicalizeMusicXml(TIES_AND_CHORDS);
    const roundtrip = canonicalizeMusicXml(exportMusicXmlV1(doc));
    expect(roundtrip).toEqual(source);
  });

  it("the model and the source agree (canonicalizeV1 == canonicalizeMusicXml)", () => {
    for (const xml of [GRAND_STAFF, TIES_AND_CHORDS]) {
      expect(canonicalizeV1(importMusicXmlV1(xml))).toEqual(canonicalizeMusicXml(xml));
    }
  });
});

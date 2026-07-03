import { describe, expect, it } from "vitest";
import { canonicalizeMusicXml, exportMusicXmlV1, importMusicXmlV1 } from "../src/v1";

// Two parts: a concert-pitch flute and a Bb clarinet (transpose chromatic -2),
// with distinct MIDI programs, exercising multi-instrument + transposition.
const ENSEMBLE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Flute</part-name><part-abbreviation>Fl.</part-abbreviation>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>74</midi-program><volume>80</volume><pan>-30</pan></midi-instrument>
    </score-part>
    <score-part id="P2"><part-name>Clarinet in Bb</part-name><part-abbreviation>Cl.</part-abbreviation>
      <midi-instrument id="P2-I1"><midi-channel>2</midi-channel><midi-program>72</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>2</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>
        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>
      </attributes>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

describe("v1 multi-instrument", () => {
  it("imports parts with abbreviations, midi, and transposition", () => {
    const doc = importMusicXmlV1(ENSEMBLE);
    expect(doc.parts).toHaveLength(2);
    expect(doc.parts[0]!.abbreviation).toBe("Fl.");
    expect(doc.parts[0]!.instruments[0]!.midiProgram).toBe(73); // 74 - 1
    expect(doc.parts[0]!.instruments[0]!.volume).toBe(Math.round((80 / 100) * 127));
    // Bb clarinet: written pitch sounds a major second lower.
    expect(doc.parts[1]!.transpose).toEqual({ diatonic: -1, chromatic: -2 });
  });

  it("round-trips written pitch and transposition through export", () => {
    const source = canonicalizeMusicXml(ENSEMBLE);
    const roundtrip = canonicalizeMusicXml(exportMusicXmlV1(importMusicXmlV1(ENSEMBLE)));
    expect(roundtrip).toEqual(source);
    // The transpose element survives so a re-import re-derives sounding pitch.
    expect(exportMusicXmlV1(importMusicXmlV1(ENSEMBLE))).toContain("<chromatic>-2</chromatic>");
  });
});

import { describe, expect, it } from "vitest";
import { importMusicXmlV1, exportMusicXmlV1 } from "../src/v1";

// Bars: [1] |: A  [2] B (1st ending) :|  [3] C (2nd ending, final barline).
const REPEATS = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <barline location="left"><ending number="1" type="start"/></barline>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
      <barline location="right"><ending number="1" type="stop"/><repeat direction="backward" times="2"/></barline>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="2" type="start"/></barline>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
      <barline location="right"><ending number="2" type="stop"/><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>`;

describe("v1 repeats & voltas", () => {
  it("imports repeat markers, endings, and barline style", () => {
    const bars = importMusicXmlV1(REPEATS).bars;
    expect(bars[0]!.repeat).toEqual({ start: true });
    expect(bars[1]!.repeat).toEqual({ end: true, times: 2 });
    expect(bars[1]!.ending).toEqual([1]);
    expect(bars[2]!.ending).toEqual([2]);
    expect(bars[2]!.barlineStyleRight).toBe("light-heavy");
  });

  it("round-trips repeats and endings through export", () => {
    const bars = importMusicXmlV1(exportMusicXmlV1(importMusicXmlV1(REPEATS))).bars;
    expect(bars[0]!.repeat).toEqual({ start: true });
    expect(bars[1]!.repeat).toEqual({ end: true, times: 2 });
    expect(bars[1]!.ending).toEqual([1]);
    expect(bars[2]!.ending).toEqual([2]);
    expect(bars[2]!.barlineStyleRight).toBe("light-heavy");
  });
});

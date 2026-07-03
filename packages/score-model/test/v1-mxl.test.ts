import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { canonicalizeV1, importMusicXmlV1, isMxl, unwrapMxl } from "../src/v1";

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;

function makeMxl(): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(CONTAINER),
    "score.musicxml": strToU8(SCORE),
  });
}

describe("v1 .mxl container import", () => {
  it("detects the zip magic", () => {
    expect(isMxl(makeMxl())).toBe(true);
    expect(isMxl(strToU8(SCORE))).toBe(false);
  });

  it("unwraps the rootfile and imports identically to the raw XML", () => {
    const fromMxl = importMusicXmlV1(unwrapMxl(makeMxl()));
    const fromXml = importMusicXmlV1(SCORE);
    expect(canonicalizeV1(fromMxl)).toEqual(canonicalizeV1(fromXml));
  });

  it("falls back to the first score entry when container.xml is absent", () => {
    const mxl = zipSync({ "whatever.musicxml": strToU8(SCORE) });
    expect(() => importMusicXmlV1(unwrapMxl(mxl))).not.toThrow();
  });
});

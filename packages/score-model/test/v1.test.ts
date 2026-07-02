import { describe, expect, it } from "vitest";
import {
  beatStartTicks,
  playedTicks,
  PPQ,
  tupletIndex,
  validateScoreV1,
  writtenTicks,
  type Beat,
  type ScoreV1,
  type Tuplet,
} from "../src/v1";

const beat = (id: string, noteType: Beat["duration"]["noteType"], dots = 0, extra: Partial<Beat> = {}): Beat => ({
  id,
  duration: { noteType, dots },
  rest: false,
  notes: [{ id: `${id}n`, step: "C", alter: 0, octave: 4 }],
  ...extra,
});

describe("writtenTicks", () => {
  it("derives plain values from the note type", () => {
    expect(writtenTicks({ noteType: "whole", dots: 0 })).toBe(4 * PPQ);
    expect(writtenTicks({ noteType: "quarter", dots: 0 })).toBe(PPQ);
    expect(writtenTicks({ noteType: "eighth", dots: 0 })).toBe(PPQ / 2);
  });

  it("applies augmentation dots", () => {
    expect(writtenTicks({ noteType: "quarter", dots: 1 })).toBe(PPQ * 1.5);
    expect(writtenTicks({ noteType: "quarter", dots: 2 })).toBe(PPQ * 1.75);
    expect(writtenTicks({ noteType: "half", dots: 2 })).toBe(PPQ * 2 * 1.75);
  });
});

describe("tuplets & beat starts", () => {
  it("scales tuplet members and lays out starts", () => {
    // A triplet of eighths (3 in the time of 2) fills one quarter... no: 3
    // eighths in the time of 2 eighths = 3 * (480 * 2/3) = 3 * 320 = 960 = a quarter.
    const beats = [beat("t1", "eighth"), beat("t2", "eighth"), beat("t3", "eighth")];
    const tuplet: Tuplet = { id: "tp", kind: "tuplet", beatIds: ["t1", "t2", "t3"], actual: 3, normal: 2 };
    const of = tupletIndex([tuplet]);
    expect(playedTicks(beats[0]!, of)).toBe(320);
    expect(beatStartTicks(beats, of)).toEqual([0, 320, 640]);
    // The three together fill a quarter note.
    const total = beats.reduce((s, b) => s + playedTicks(b, of), 0);
    expect(total).toBe(PPQ);
  });

  it("gives grace notes zero metrical time", () => {
    const g = beat("g", "eighth", 0, { grace: { kind: "acciaccatura" } });
    expect(playedTicks(g)).toBe(0);
  });
});

function minimalDoc(overrides: Partial<ScoreV1> = {}): ScoreV1 {
  // One 4/4 bar (3840 ticks), one part, one staff, one voice = four quarters.
  return {
    format: "openvoicing-score",
    formatVersion: 1,
    id: "s1",
    work: { title: "T" },
    bars: [{ id: "b0", index: 0, durationTicks: 4 * PPQ }],
    parts: [
      {
        id: "p1",
        name: "Piano",
        instruments: [{ id: "i1", midiProgram: 0 }],
        staves: [{ id: "st1", index: 0, lines: 5, clef: { sign: "G", line: 2 } }],
        measures: [
          {
            id: "m0",
            barIndex: 0,
            voices: [
              {
                id: "v0",
                index: 0,
                staff: 0,
                beats: [beat("q1", "quarter"), beat("q2", "quarter"), beat("q3", "quarter"), beat("q4", "quarter")],
              },
            ],
          },
        ],
      },
    ],
    spanners: [],
    directions: [],
    unknown: [],
    ...overrides,
  };
}

describe("validateScoreV1", () => {
  it("accepts a well-formed document", () => {
    expect(validateScoreV1(minimalDoc())).toEqual([]);
  });

  it("flags a voice that does not fill the bar", () => {
    const doc = minimalDoc();
    doc.parts[0]!.measures[0]!.voices[0]!.beats.pop(); // only 3 quarters
    const issues = validateScoreV1(doc);
    expect(issues.some((i) => i.code === "bar-fill")).toBe(true);
  });

  it("allows an incomplete pickup bar", () => {
    const doc = minimalDoc();
    doc.bars[0]!.implicit = true;
    doc.parts[0]!.measures[0]!.voices[0]!.beats = [beat("p", "quarter")];
    expect(validateScoreV1(doc)).toEqual([]);
  });

  it("flags an unresolved spanner endpoint", () => {
    const doc = minimalDoc();
    doc.spanners.push({ id: "sl", kind: "slur", number: 1, fromBeat: "q1", toBeat: "nope" });
    expect(validateScoreV1(doc).some((i) => i.code === "spanner-ref")).toBe(true);
  });

  it("flags duplicate ids and measure/bar count mismatch", () => {
    const doc = minimalDoc();
    doc.parts[0]!.measures[0]!.voices[0]!.beats[1]!.id = "q1"; // dup
    doc.parts[0]!.measures.push({ id: "extra", barIndex: 1, voices: [] }); // count mismatch
    const codes = validateScoreV1(doc).map((i) => i.code);
    expect(codes).toContain("dup-id");
    expect(codes).toContain("measure-count");
  });
});

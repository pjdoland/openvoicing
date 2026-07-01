import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { durationName, importMusicXml, PPQ, toAlphaTex } from "../src/index";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "two-bars.musicxml"),
  "utf8",
);

describe("toAlphaTex", () => {
  const tex = toAlphaTex(importMusicXml(fixture));

  it("emits metadata", () => {
    expect(tex).toContain('\\title "Two Bars"');
    expect(tex).toContain('\\artist "Trad."');
    expect(tex).toContain("\\tempo 90");
    expect(tex).toContain('\\track "Guitar"');
  });

  it("emits chords, notes, rests, and accidentals", () => {
    expect(tex).toContain("(c4 e4).4");
    expect(tex).toContain("g4.4");
    expect(tex).toContain("r.2");
    expect(tex).toContain("d#4.1");
  });

  it("emits the time signature once until it changes", () => {
    expect(tex.match(/\\ts 4 4/g)).toHaveLength(1);
  });

  it("separates bars", () => {
    expect(tex).toContain("|");
  });
});

describe("durationName", () => {
  it("maps plain durations", () => {
    expect(durationName(PPQ * 4)).toBe("1");
    expect(durationName(PPQ)).toBe("4");
    expect(durationName(PPQ / 2)).toBe("8");
  });

  it("maps dotted durations", () => {
    expect(durationName(PPQ * 1.5)).toBe("4{d}");
    expect(durationName(PPQ * 3)).toBe("2{d}");
  });

  it("snaps odd values to the nearest duration", () => {
    expect(durationName(PPQ + 10)).toBe("4");
  });
});

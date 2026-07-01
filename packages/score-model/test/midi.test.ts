import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEmptyScore,
  importMusicXml,
  PPQ,
  ScoreEditor,
  toAlphaTex,
  toMidi,
  toMusicXml,
} from "../src/index";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "two-bars.musicxml"),
  "utf8",
);

interface ParsedEvent {
  tick: number;
  type: "on" | "off" | "tempo" | "other";
  key?: number;
  usPerQuarter?: number;
}

/** Minimal SMF reader sufficient to check our own writer. */
function parseMidi(data: Uint8Array) {
  const text = (o: number, n: number) => String.fromCharCode(...data.slice(o, o + n));
  expect(text(0, 4)).toBe("MThd");
  const division = (data[12]! << 8) | data[13]!;
  const trackCount = (data[10]! << 8) | data[11]!;
  const tracks: ParsedEvent[][] = [];
  let offset = 14;
  for (let t = 0; t < trackCount; t++) {
    expect(text(offset, 4)).toBe("MTrk");
    const length = (data[offset + 4]! << 24) | (data[offset + 5]! << 16) | (data[offset + 6]! << 8) | data[offset + 7]!;
    let p = offset + 8;
    const end = p + length;
    const events: ParsedEvent[] = [];
    let tick = 0;
    while (p < end) {
      let delta = 0;
      for (;;) {
        const byte = data[p++]!;
        delta = (delta << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) break;
      }
      tick += delta;
      const status = data[p++]!;
      if (status === 0xff) {
        const metaType = data[p++]!;
        const metaLength = data[p++]!;
        if (metaType === 0x51) {
          events.push({
            tick,
            type: "tempo",
            usPerQuarter: (data[p]! << 16) | (data[p + 1]! << 8) | data[p + 2]!,
          });
        } else {
          events.push({ tick, type: "other" });
        }
        p += metaLength;
      } else if ((status & 0xf0) === 0x90) {
        const key = data[p++]!;
        const velocity = data[p++]!;
        events.push({ tick, type: velocity > 0 ? "on" : "off", key });
      } else if ((status & 0xf0) === 0x80) {
        const key = data[p++]!;
        p++;
        events.push({ tick, type: "off", key });
      } else {
        throw new Error(`unexpected status 0x${status.toString(16)} in test parser`);
      }
    }
    tracks.push(events);
    offset = end;
  }
  return { division, trackCount, tracks };
}

describe("toMidi", () => {
  it("writes tempo, notes, and durations", () => {
    const doc = importMusicXml(fixture);
    const midi = parseMidi(toMidi(doc));
    expect(midi.division).toBe(PPQ);
    expect(midi.trackCount).toBe(2);

    const tempo = midi.tracks[0]!.find((e) => e.type === "tempo");
    expect(tempo?.usPerQuarter).toBe(Math.round(60_000_000 / 90));

    const ons = midi.tracks[1]!.filter((e) => e.type === "on");
    expect(ons.map((e) => e.key)).toEqual([60, 64, 67, 63]);
    expect(ons[0]!.tick).toBe(0);
    expect(ons[2]!.tick).toBe(PPQ);

    const wholeNoteOff = midi.tracks[1]!.find((e) => e.type === "off" && e.key === 63);
    expect(wholeNoteOff?.tick).toBe(4 * PPQ + 4 * PPQ);
  });

  it("merges tied notes into one sustained note", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 2 }));
    const first = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    editor.setBeatPitch(first, "C");
    // Tie the whole-bar C into an identical whole-bar C in bar 2.
    editor.setBeatPitch({ ...first, barIndex: 1 }, "C");
    expect(editor.toggleTie(first)).toBe(true);

    const midi = parseMidi(toMidi(editor.doc));
    const notes = midi.tracks[1]!.filter((e) => e.type === "on" || e.type === "off");
    expect(notes).toEqual([
      { tick: 0, type: "on", key: 60 },
      { tick: 8 * PPQ, type: "off", key: 60 },
    ]);
  });
});

describe("ties across formats", () => {
  it("survives the MusicXML round-trip and renders in alphaTex", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 2 }));
    const first = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    editor.setBeatPitch(first, "E");
    editor.setBeatPitch({ ...first, barIndex: 1 }, "E");
    editor.toggleTie(first);

    const tex = toAlphaTex(editor.doc);
    expect(tex).toContain("e4.1 |");
    expect(tex).toContain("(-).1");

    const reimported = importMusicXml(toMusicXml(editor.doc));
    expect(reimported.parts[0]!.measures[0]!.voices[0]!.beats[0]!.notes[0]!.tieStart).toBe(true);
    expect(reimported.parts[0]!.measures[1]!.voices[0]!.beats[0]!.notes[0]!.tieStop).toBe(true);

    // Toggling again removes the tie.
    editor.toggleTie(first);
    expect(toAlphaTex(editor.doc)).not.toContain("(-)");
  });

  it("refuses ties between different pitches", () => {
    const editor = new ScoreEditor(createEmptyScore({ bars: 2 }));
    const first = { partIndex: 0, barIndex: 0, voiceIndex: 0, beatIndex: 0 };
    editor.setBeatPitch(first, "C");
    editor.setBeatPitch({ ...first, barIndex: 1 }, "D");
    expect(editor.toggleTie(first)).toBe(false);
  });
});

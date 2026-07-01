import { absoluteTick } from "./syncmap";
import { pitchToMidi } from "./edits";
import { PPQ, type ScoreDocument } from "./types";

/**
 * Serialize a ScoreDocument as a Standard MIDI File (format 1). The division
 * equals PPQ so document ticks map to MIDI ticks one to one. Notes tied
 * together sound as a single sustained note.
 */
export function toMidi(doc: ScoreDocument): Uint8Array {
  const tracks: Uint8Array[] = [];

  // Conductor track: tempo and time signature changes.
  const conductor: MidiEvent[] = [];
  let previousTs = "";
  for (const bar of doc.bars) {
    const tick = absoluteTick(doc.bars, bar.index, 0);
    if (bar.tempoBpm !== undefined) {
      const usPerQuarter = Math.round(60_000_000 / bar.tempoBpm);
      conductor.push({
        tick,
        bytes: [
          0xff, 0x51, 0x03,
          (usPerQuarter >> 16) & 0xff,
          (usPerQuarter >> 8) & 0xff,
          usPerQuarter & 0xff,
        ],
      });
    }
    const ts = bar.timeSignature;
    const key = `${ts.beats}/${ts.beatUnit}`;
    if (key !== previousTs) {
      conductor.push({
        tick,
        bytes: [0xff, 0x58, 0x04, ts.beats, Math.log2(ts.beatUnit), 24, 8],
      });
      previousTs = key;
    }
  }
  tracks.push(encodeTrack(conductor));

  doc.parts.forEach((part, partIndex) => {
    const channel = partIndex < 9 ? partIndex : partIndex + 1;
    const events: MidiEvent[] = [];
    // Pending tied notes: midi key -> start tick.
    const pending = new Map<number, number>();

    for (const measure of part.measures) {
      for (const beat of measure.voices[0]?.beats ?? []) {
        const startTick = absoluteTick(doc.bars, measure.barIndex, beat.startTick);
        const endTick = startTick + beat.durationTicks;
        for (const note of beat.notes) {
          const key = pitchToMidi(note.step, note.alter, note.octave);
          const continues = note.tieStop && pending.has(key);
          if (!continues) {
            events.push({ tick: startTick, bytes: [0x90 | channel, key, 80] });
            pending.set(key, startTick);
          }
          if (!note.tieStart) {
            events.push({ tick: endTick, bytes: [0x80 | channel, key, 0] });
            pending.delete(key);
          }
        }
      }
    }
    // Close any ties left dangling at the end of the piece.
    const lastTick = doc.bars.length
      ? absoluteTick(doc.bars, doc.bars.length - 1, 0)
      : 0;
    for (const [key] of pending) {
      events.push({ tick: lastTick, bytes: [0x80 | channel, key, 0] });
    }
    tracks.push(encodeTrack(events));
  });

  const header = new Uint8Array(14);
  writeAscii(header, 0, "MThd");
  writeU32(header, 4, 6);
  writeU16(header, 8, 1);
  writeU16(header, 10, tracks.length);
  writeU16(header, 12, PPQ);

  const total = 14 + tracks.reduce((sum, t) => sum + t.length, 0);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = 14;
  for (const track of tracks) {
    out.set(track, offset);
    offset += track.length;
  }
  return out;
}

interface MidiEvent {
  tick: number;
  bytes: number[];
}

function encodeTrack(events: MidiEvent[]): Uint8Array {
  // Stable sort by tick with note-offs before note-ons at the same tick, so
  // repeated pitches retrigger instead of sticking.
  const sorted = [...events].sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const offA = (a.bytes[0]! & 0xf0) === 0x80 ? 0 : 1;
    const offB = (b.bytes[0]! & 0xf0) === 0x80 ? 0 : 1;
    return offA - offB;
  });

  const body: number[] = [];
  let lastTick = 0;
  for (const event of sorted) {
    writeVlq(body, Math.max(0, event.tick - lastTick));
    body.push(...event.bytes);
    lastTick = event.tick;
  }
  writeVlq(body, 0);
  body.push(0xff, 0x2f, 0x00);

  const track = new Uint8Array(8 + body.length);
  writeAscii(track, 0, "MTrk");
  writeU32(track, 4, body.length);
  track.set(body, 8);
  return track;
}

function writeVlq(out: number[], value: number): void {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  out.push(...bytes);
}

function writeAscii(target: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function writeU16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 8) & 0xff;
  target[offset + 1] = value & 0xff;
}

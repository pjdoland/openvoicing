import { PPQ, type Beat, type DurationSpec, type NoteType, type Tuplet } from "./types";

/** Base ticks for a note type relative to PPQ (quarter = PPQ). */
const NOTE_TYPE_WHOLES: Record<NoteType, number> = {
  maxima: 8,
  long: 4,
  breve: 2,
  whole: 1,
  half: 1 / 2,
  quarter: 1 / 4,
  eighth: 1 / 8,
  "16th": 1 / 16,
  "32nd": 1 / 32,
  "64th": 1 / 64,
  "128th": 1 / 128,
  "256th": 1 / 256,
};

/** Ticks of a plain (untupleted) written value, dots included. */
export function writtenTicks(d: DurationSpec): number {
  const base = NOTE_TYPE_WHOLES[d.noteType] * 4 * PPQ;
  // Each dot adds half of the previous augmentation: factor = 2 - 2^-dots.
  const dotFactor = 2 - Math.pow(2, -Math.max(0, d.dots));
  return base * dotFactor;
}

/** Scale a written duration by a tuplet ratio (actual in the time of normal). */
export function tupletScaled(ticks: number, tuplet: Tuplet | undefined): number {
  if (!tuplet) return ticks;
  return (ticks * tuplet.normal) / tuplet.actual;
}

/**
 * Played (sounding) ticks of a beat: grace notes take no metrical time, and a
 * beat inside a tuplet is scaled by that tuplet's ratio. `tupletOf` resolves a
 * beat id to the tuplet it belongs to (or undefined).
 */
export function playedTicks(beat: Beat, tupletOf?: (beatId: string) => Tuplet | undefined): number {
  if (beat.grace) return 0;
  return tupletScaled(writtenTicks(beat.duration), tupletOf?.(beat.id));
}

/**
 * Start ticks (offset from the measure start) for each beat in a voice, using
 * played durations so tuplets and grace notes land correctly.
 */
export function beatStartTicks(
  beats: Beat[],
  tupletOf?: (beatId: string) => Tuplet | undefined,
): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const beat of beats) {
    starts.push(t);
    t += playedTicks(beat, tupletOf);
  }
  return starts;
}

/** Index tuplets by member beat id for O(1) lookup. */
export function tupletIndex(tuplets: Tuplet[]): (beatId: string) => Tuplet | undefined {
  const map = new Map<string, Tuplet>();
  for (const t of tuplets) for (const id of t.beatIds) map.set(id, t);
  return (id) => map.get(id);
}

import { newId } from "../ids";
import { PPQ, SCORE_V1_FORMAT, type BarSpec, type Beat, type Measure, type NoteType, type ScoreV1 } from "./types";

/** Note-type name for a time-signature beat-unit denominator (2 -> half, ...). */
export const BEAT_UNIT_TYPE: Record<number, NoteType> = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th" };

export interface CreateScoreV1Options {
  title?: string;
  composer?: string;
  bars?: number;
  beats?: number;
  beatUnit?: number;
  keyFifths?: number;
}

/** A blank rest beat one beat-unit long. */
function restBeat(beatUnit: number): Beat {
  return { id: newId("beat"), duration: { noteType: BEAT_UNIT_TYPE[beatUnit] ?? "quarter", dots: 0 }, rest: true, notes: [] };
}

/**
 * Create an empty, editable full-fidelity (v1) score: one treble-clef part with
 * a few bars, each filled with per-beat rests you can type notes into. This is
 * the from-scratch entry point that replaces the old v0 empty-score path.
 */
export function createEmptyScoreV1(options: CreateScoreV1Options = {}): ScoreV1 {
  const barCount = Math.max(1, options.bars ?? 4);
  const beats = options.beats ?? 4;
  const beatUnit = options.beatUnit ?? 4;
  const durationTicks = Math.round(beats * (4 / beatUnit) * PPQ);

  const bars: BarSpec[] = Array.from({ length: barCount }, (_, i) => ({
    id: newId("bar"),
    index: i,
    durationTicks,
  }));

  const measures: Measure[] = bars.map((_, i) => ({
    id: newId("measure"),
    barIndex: i,
    ...(i === 0
      ? { attributes: { time: { beats, beatUnit }, key: { fifths: options.keyFifths ?? 0 } } }
      : {}),
    voices: [
      {
        id: newId("voice"),
        index: 0,
        staff: 0,
        beats: Array.from({ length: beats }, () => restBeat(beatUnit)),
      },
    ],
  }));

  return {
    format: SCORE_V1_FORMAT,
    formatVersion: 1,
    id: newId("score"),
    work: { title: options.title ?? "Untitled", ...(options.composer ? { composer: options.composer } : {}) },
    bars,
    parts: [
      {
        id: newId("part"),
        name: "Music",
        instruments: [{ id: newId("inst"), midiProgram: 0 }],
        staves: [{ id: newId("staff"), index: 0, lines: 5, clef: { sign: "G", line: 2 } }],
        measures,
      },
    ],
    spanners: [],
    directions: [],
    unknown: [],
  };
}

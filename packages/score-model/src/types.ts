export const SCORE_FORMAT = "openvoicing-score";
export const SCORE_FORMAT_VERSION = 0;

/** Ticks per quarter note. All durations and offsets in the document use this resolution. */
export const PPQ = 960;

export type NoteStep = "C" | "D" | "E" | "F" | "G" | "A" | "B";

export interface TimeSignature {
  beats: number;
  beatUnit: number;
}

/**
 * Global per-bar metadata shared by all parts. Time signature and key are the
 * effective values (carried forward from earlier bars), not just explicit changes.
 */
export interface BarSpec {
  id: string;
  index: number;
  timeSignature: TimeSignature;
  keyFifths: number;
  tempoBpm?: number;
}

export interface Note {
  id: string;
  step: NoteStep;
  /** Chromatic alteration in semitones (-1 flat, 1 sharp). */
  alter: number;
  /** Scientific pitch octave (middle C is C4). */
  octave: number;
  tieStart?: boolean;
  tieStop?: boolean;
  string?: number;
  fret?: number;
}

export interface Beat {
  id: string;
  /** Offset from the start of the measure, in PPQ ticks. */
  startTick: number;
  durationTicks: number;
  rest: boolean;
  notes: Note[];
  /** Tuplet grouping (e.g. 3 for a triplet), absent for plain beats. */
  tuplet?: number;
  /** Optional lyric syllable under the beat. */
  lyric?: string;
}

export interface Voice {
  id: string;
  beats: Beat[];
}

export interface Measure {
  id: string;
  barIndex: number;
  voices: Voice[];
}

export interface Part {
  id: string;
  name: string;
  /** General MIDI program (0 = piano), for voice-appropriate playback. */
  midiProgram?: number;
  measures: Measure[];
}

export interface ScoreDocument {
  format: typeof SCORE_FORMAT;
  formatVersion: number;
  id: string;
  title: string;
  composer?: string;
  bars: BarSpec[];
  parts: Part[];
}

/**
 * A musical position mapped to a media timestamp. Positions are addressed as
 * (bar, tick) rather than note references so sync maps survive re-layout and edits.
 */
export interface SyncAnchor {
  barIndex: number;
  tick: number;
  timeSeconds: number;
}

export interface SyncMap {
  id: string;
  scoreId: string;
  recordingId: string;
  anchors: SyncAnchor[];
}

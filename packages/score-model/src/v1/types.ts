/**
 * Full-fidelity semantic score model (format v1). Designed from the council
 * review of the v3 plan. Key decisions, and why:
 *
 * - **Symbolic rhythm.** Beats store a written value (note type + dots) and a
 *   tuplet ratio, NOT raw ticks. Ticks are *derived* (see durations.ts); a tick
 *   count can't distinguish a triplet-half from a dotted-quarter, and PPQ can't
 *   integer-represent prime tuplets.
 * - **Voice ⟂ staff.** A part declares its staves; voices live in the measure
 *   and carry a *default* staff; individual notes may override it (cross-staff).
 *   Voices are NOT nested under staves.
 * - **Global bar grid, per-part attributes.** One `bars[]` timeline gives a
 *   single sounding-tick axis (so sync/recording anchors stay valid); each part
 *   measure carries its own key / time / clef / transpose for display, enabling
 *   transposing instruments and polymeter.
 * - **Spanners are first-class, id-referenced.** Ties, slurs, beams, tuplets,
 *   hairpins, 8va, pedal, volta — anything that nests, overlaps, or spans
 *   deletable elements — is an object with endpoint refs, never a per-beat flag.
 * - **Lossless via preserved source.** Anything not modeled is kept verbatim in
 *   `unknown[]`, keyed to its owning element, so export round-trips.
 */

export const SCORE_V1_FORMAT = "openvoicing-score";
export const SCORE_V1_VERSION = 1;

/** Ticks per quarter note, for *derived* playback timing only. */
export const PPQ = 960;

export type EntityId = string;

// ---------- pitch & rhythm ----------

export type NoteStep = "C" | "D" | "E" | "F" | "G" | "A" | "B";

export type NoteType =
  | "maxima" | "long" | "breve" | "whole" | "half" | "quarter"
  | "eighth" | "16th" | "32nd" | "64th" | "128th" | "256th";

/** A written note value: base type plus augmentation dots (0..3). */
export interface DurationSpec {
  noteType: NoteType;
  dots: number;
}

/** Printed accidental, distinct from the chromatic `alter` that sets pitch. */
export type AccidentalKind =
  | "sharp" | "flat" | "natural" | "double-sharp" | "double-flat"
  | "natural-sharp" | "natural-flat" | "quarter-sharp" | "quarter-flat";

export interface Accidental {
  kind: AccidentalKind;
  cautionary?: boolean;
  editorial?: boolean;
  parentheses?: boolean;
  bracket?: boolean;
}

// ---------- global bar grid ----------

export interface TimeSignature {
  beats: number;
  beatUnit: number;
  symbol?: "common" | "cut" | "single-number" | "none";
  /** Additive meters, e.g. 3+2/8. When present, `beats` is the sum. */
  additive?: number[];
}

export interface KeySignature {
  /** Circle-of-fifths count: negative flats, positive sharps. */
  fifths: number;
  mode?: "major" | "minor" | "none" | string;
}

/**
 * One entry per sounding bar, shared by all parts. `durationTicks` is the
 * aligned real duration (parts may notate it in different meters). This is the
 * single tick axis the sync map and recording alignment use.
 */
export interface BarSpec {
  id: EntityId;
  index: number;
  durationTicks: number;
  /** Explicit tempo change at this bar's start (sounding, bpm). */
  tempoBpm?: number;
  /** Anacrusis / pickup: printed but shorter than the nominal meter. */
  implicit?: boolean;
  repeat?: RepeatSpec;
  barlineStyleRight?: BarlineStyle;
  /** Original printed measure number (may be non-numeric, e.g. "38a"). */
  printedNumber?: string;
}

export type BarlineStyle =
  | "regular" | "light-light" | "light-heavy" | "heavy-light"
  | "dashed" | "dotted" | "final" | "none";

export interface RepeatSpec {
  start?: boolean;
  end?: boolean;
  /** Times to play through when ending a repeat. */
  times?: number;
}

// ---------- parts / staves ----------

export interface Transpose {
  diatonic: number;
  chromatic: number;
  octaveChange?: number;
}

export interface Instrument {
  id: EntityId;
  name?: string;
  /** General MIDI program (0 = piano). */
  midiProgram?: number;
  midiChannel?: number;
  /** 0-127 playback volume and 0-127 pan (64 = center), from MusicXML. */
  volume?: number;
  pan?: number;
  unpitched?: boolean;
}

export type ClefSign = "G" | "F" | "C" | "percussion" | "TAB" | "none";

export interface Clef {
  sign: ClefSign;
  /** Staff line the clef sits on (1 = bottom). */
  line: number;
  /** Octave displacement, e.g. -1 for an ottava-bassa treble clef. */
  octaveChange?: number;
}

export interface Staff {
  id: EntityId;
  index: number;
  lines: number;
  /** Clef effective from bar 0; clef *changes* live in MeasureAttributes. */
  clef: Clef;
}

export interface Part {
  id: EntityId;
  name: string;
  abbreviation?: string;
  instruments: Instrument[];
  transpose?: Transpose;
  staves: Staff[];
  /** One per global bar, same length/order as `ScoreV1.bars`. */
  measures: Measure[];
}

// ---------- measures / voices / beats / notes ----------

/** Per-part, per-bar display attributes (changes only; absent = carried over). */
export interface MeasureAttributes {
  time?: TimeSignature;
  key?: KeySignature;
  /** Clef change per staff index, mid-score. */
  clefs?: Array<{ staffIndex: number; clef: Clef }>;
}

export interface Measure {
  id: EntityId;
  barIndex: number;
  attributes?: MeasureAttributes;
  voices: Voice[];
}

export interface Voice {
  id: EntityId;
  index: number;
  /** Default staff for this voice's notes; notes may override for cross-staff. */
  staff: number;
  beats: Beat[];
}

export type GraceKind = "acciaccatura" | "appoggiatura";

export type OrnamentType =
  | "trill-mark" | "mordent" | "inverted-mordent" | "turn" | "inverted-turn" | "schleifer" | "tremolo";

export type ArticulationType =
  | "staccato" | "staccatissimo" | "accent" | "strong-accent" | "tenuto" | "detached-legato";

export interface Beat {
  id: EntityId;
  duration: DurationSpec;
  rest: boolean;
  notes: Note[];
  /** Grace notes carry no metrical time; excluded from the bar-duration sum. */
  grace?: { kind: GraceKind; stealTime?: "previous" | "following" };
  lyrics?: Lyric[];
  /** Explicit staff for a whole-beat cross-staff move (notes may still override). */
  staff?: number;
  ornaments?: OrnamentType[];
  articulations?: ArticulationType[];
  fermata?: boolean;
}

export interface Lyric {
  verse: number;
  text: string;
  syllabic?: "single" | "begin" | "middle" | "end";
}

export interface Note {
  id: EntityId;
  step: NoteStep;
  /** Chromatic alteration in semitones; sets sounding pitch with step+octave. */
  alter: number;
  octave: number;
  /** Printed accidental, if any (independent of `alter`). */
  accidental?: Accidental;
  /** Cross-staff: render this note on a different staff than its voice. */
  staff?: number;
  notehead?: string;
  fingering?: string;
  /** Guitar tab. */
  string?: number;
  fret?: number;
}

// ---------- spanners (id-referenced) ----------

export interface NoteRef {
  beatId: EntityId;
  noteId: EntityId;
}

export type Spanner =
  | Tie
  | Slur
  | BeamGroup
  | Tuplet
  | Hairpin
  | OctaveShift;

export interface Tie {
  id: EntityId;
  kind: "tie";
  from: NoteRef;
  to: NoteRef;
}

export interface Slur {
  id: EntityId;
  kind: "slur";
  number: number;
  fromBeat: EntityId;
  toBeat: EntityId;
}

export interface BeamGroup {
  id: EntityId;
  kind: "beam";
  beatIds: EntityId[];
}

export interface Tuplet {
  id: EntityId;
  kind: "tuplet";
  beatIds: EntityId[];
  /** actualNotes-in-the-time-of normalNotes, e.g. 3 in the time of 2. */
  actual: number;
  normal: number;
  normalType?: NoteType;
  bracket?: boolean;
  showNumber?: boolean;
}

export interface Hairpin {
  id: EntityId;
  kind: "hairpin";
  hairpin: "crescendo" | "diminuendo";
  fromBeat: EntityId;
  toBeat: EntityId;
}

export interface OctaveShift {
  id: EntityId;
  kind: "octave-shift";
  size: 8 | 15;
  direction: "up" | "down";
  fromBeat: EntityId;
  toBeat: EntityId;
}

// ---------- directions (anchored to the grid) ----------

export interface Direction {
  id: EntityId;
  barIndex: number;
  tick: number;
  staff?: number;
  placement?: "above" | "below";
  /** Fractional offset in ticks from the anchor (may be negative). */
  offsetTicks?: number;
  content:
    | { kind: "words"; text: string }
    | { kind: "dynamics"; value: string }
    | { kind: "metronome"; noteType: NoteType; dots: number; perMinute: number }
    | { kind: "rehearsal"; text: string }
    | { kind: "pedal"; type: "start" | "stop" | "change" };
}

// ---------- lossless pass-through ----------

/**
 * Verbatim source data we don't model yet, keyed to its owner so it survives
 * edits and re-emits at export. `schemaEra` records the model version that
 * failed to parse it, so a later version can re-attempt (upgrading blobs into
 * real fields), which is what stops schema evolution from freezing.
 */
export interface UnknownData {
  id: EntityId;
  owner:
    | { kind: "score" }
    | { kind: "part"; partId: EntityId }
    | { kind: "measure"; partId: EntityId; barIndex: number }
    | { kind: "beat"; beatId: EntityId }
    | { kind: "note"; noteId: EntityId };
  /** Fallback anchor if the owner is deleted. */
  anchor?: { barIndex: number; tick: number };
  format: "musicxml-fragment";
  payload: string;
  schemaEra: number;
}

// ---------- document root ----------

export interface Work {
  title: string;
  composer?: string;
  lyricist?: string;
  copyright?: string;
}

export interface ScoreV1 {
  format: typeof SCORE_V1_FORMAT;
  formatVersion: 1;
  id: EntityId;
  work: Work;
  bars: BarSpec[];
  parts: Part[];
  spanners: Spanner[];
  directions: Direction[];
  unknown: UnknownData[];
}

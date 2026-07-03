import { newId } from "../ids";
import { playedTicks } from "./durations";
import { PPQ } from "./types";
import type {
  AccidentalKind,
  ArticulationType,
  Beat,
  DurationSpec,
  EntityId,
  GraceKind,
  Measure,
  Note,
  NoteStep,
  NoteType,
  OrnamentType,
  Part,
  ScoreV1,
  TimeSignature,
  Voice,
} from "./types";

export interface CopiedBeat {
  duration: DurationSpec;
  rest: boolean;
  notes: Note[];
  articulations?: ArticulationType[];
  ornaments?: OrnamentType[];
}

/** Offset ticks of a beat within its voice (sum of prior played durations). */
function beatTick(beats: Beat[], index: number): number {
  let t = 0;
  for (let i = 0; i < index; i++) t += Math.round(playedTicks(beats[i]!));
  return t;
}

const BEAT_UNIT_TYPE: Record<number, NoteType> = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth", 16: "16th" };

function effectiveTime(part: Part, barIndex: number): TimeSignature {
  let time: TimeSignature = { beats: 4, beatUnit: 4 };
  for (let i = 0; i <= barIndex && i < part.measures.length; i++) {
    const t = part.measures[i]?.attributes?.time;
    if (t) time = t;
  }
  return time;
}

function fillRests(time: TimeSignature): Beat[] {
  const noteType = BEAT_UNIT_TYPE[time.beatUnit] ?? "quarter";
  return Array.from({ length: time.beats }, () => ({
    id: newId("beat"),
    duration: { noteType, dots: 0 },
    rest: true,
    notes: [],
  }));
}

function reindexBars(doc: ScoreV1): void {
  doc.bars.forEach((bar, i) => (bar.index = i));
  for (const part of doc.parts) part.measures.forEach((m, i) => (m.barIndex = i));
}

/** Drop spanners whose referenced beats/notes no longer exist (after a delete). */
function pruneDanglingSpanners(doc: ScoreV1): void {
  const beatIds = new Set<string>();
  const noteIds = new Set<string>();
  for (const part of doc.parts)
    for (const m of part.measures)
      for (const v of m.voices)
        for (const b of v.beats) {
          beatIds.add(b.id);
          for (const n of b.notes) noteIds.add(n.id);
        }
  doc.spanners = doc.spanners.filter((s) => {
    switch (s.kind) {
      case "tie": return noteIds.has(s.from.noteId) && noteIds.has(s.to.noteId);
      case "slur":
      case "hairpin":
      case "octave-shift": return beatIds.has(s.fromBeat) && beatIds.has(s.toBeat);
      case "beam":
      case "tuplet": return s.beatIds.every((id) => beatIds.has(id));
      default: return true;
    }
  });
}

export interface NoteLocation {
  part: Part;
  measure: Measure;
  voice: Voice;
  beat: Beat;
  note: Note;
  noteIndex: number;
}

export interface BeatLocation {
  part: Part;
  measure: Measure;
  voice: Voice;
  beat: Beat;
  beatIndex: number;
}

const STEP_SEMITONE: Record<NoteStep, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Sharp-preferring and flat-preferring spellings of each pitch class.
const PC_SHARP: Array<{ step: NoteStep; alter: number }> = [
  { step: "C", alter: 0 }, { step: "C", alter: 1 }, { step: "D", alter: 0 }, { step: "D", alter: 1 },
  { step: "E", alter: 0 }, { step: "F", alter: 0 }, { step: "F", alter: 1 }, { step: "G", alter: 0 },
  { step: "G", alter: 1 }, { step: "A", alter: 0 }, { step: "A", alter: 1 }, { step: "B", alter: 0 },
];
const PC_FLAT: Array<{ step: NoteStep; alter: number }> = [
  { step: "C", alter: 0 }, { step: "D", alter: -1 }, { step: "D", alter: 0 }, { step: "E", alter: -1 },
  { step: "E", alter: 0 }, { step: "F", alter: 0 }, { step: "G", alter: -1 }, { step: "G", alter: 0 },
  { step: "A", alter: -1 }, { step: "A", alter: 0 }, { step: "B", alter: -1 }, { step: "B", alter: 0 },
];

export function chromaticValue(note: { step: NoteStep; alter: number; octave: number }): number {
  return note.octave * 12 + STEP_SEMITONE[note.step] + note.alter;
}

/** Spell a chromatic pitch, preferring flats in flat keys (fifths < 0). */
function spell(chromatic: number, keyFifths = 0): { step: NoteStep; alter: number; octave: number } {
  const octave = Math.floor(chromatic / 12);
  const pc = ((chromatic % 12) + 12) % 12;
  const s = (keyFifths < 0 ? PC_FLAT : PC_SHARP)[pc]!;
  // A flat-spelled C (Cb) or sharp-spelled B belongs to the neighbouring octave;
  // keep the simple table result, correcting octave for the boundary steps.
  return { step: s.step, alter: s.alter, octave };
}

/** The octave of `step` nearest to a reference chromatic value. */
function nearestOctave(step: NoteStep, referenceChromatic: number): number {
  const base = STEP_SEMITONE[step];
  const approxOctave = Math.round((referenceChromatic - base) / 12);
  let best = approxOctave;
  let bestDist = Infinity;
  for (const o of [approxOctave - 1, approxOctave, approxOctave + 1]) {
    const dist = Math.abs(o * 12 + base - referenceChromatic);
    if (dist < bestDist) {
      bestDist = dist;
      best = o;
    }
  }
  return best;
}

const NOTE_TYPES: NoteType[] = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th", "128th", "256th"];

/**
 * Editing layer over a v1 document. Ops are addressed by stable entity id and
 * mutate the document in place; undo/redo restore whole-document snapshots
 * (simple and exact across the full op set). `doc` is replaced on undo/redo, so
 * callers must read `editor.doc` fresh after each call.
 */
export class ScoreEditorV1 {
  private past: ScoreV1[] = [];
  private future: ScoreV1[] = [];

  constructor(public doc: ScoreV1) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Run a mutation; snapshot for undo only if it reports a change. */
  private edit(fn: (doc: ScoreV1) => boolean): boolean {
    const snapshot = structuredClone(this.doc);
    const changed = fn(this.doc);
    if (changed) {
      // Any edit that removed or replaced beats/notes can orphan a spanner;
      // self-heal so the document is never left referencing deleted elements.
      pruneDanglingSpanners(this.doc);
      this.past.push(snapshot);
      this.future.length = 0;
    }
    return changed;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(structuredClone(this.doc));
    replaceDocInPlace(this.doc, prev);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(structuredClone(this.doc));
    replaceDocInPlace(this.doc, next);
    return true;
  }

  // ---------- lookups ----------

  firstNoteId(beatId: EntityId): EntityId | undefined {
    return findBeat(this.doc, beatId)?.beat.notes[0]?.id;
  }

  findNote(noteId: EntityId): NoteLocation | undefined {
    for (const part of this.doc.parts)
      for (const measure of part.measures)
        for (const voice of measure.voices)
          for (const beat of voice.beats) {
            const noteIndex = beat.notes.findIndex((n) => n.id === noteId);
            if (noteIndex >= 0) return { part, measure, voice, beat, note: beat.notes[noteIndex]!, noteIndex };
          }
    return undefined;
  }

  findBeat(beatId: EntityId): BeatLocation | undefined {
    return findBeat(this.doc, beatId);
  }

  /** Which voice (index) of how many the selected beat is in, on its staff. */
  voiceInfo(beatId: EntityId): { index: number; count: number } | undefined {
    const loc = findBeat(this.doc, beatId);
    if (!loc) return undefined;
    const voices = loc.measure.voices.filter((v) => v.staff === loc.voice.staff);
    return { index: Math.max(0, voices.indexOf(loc.voice)), count: voices.length };
  }

  /** The beat at the same metric position in another voice on the same staff,
   * for switching which stacked voice is selected without a precise click. */
  voiceBeat(beatId: EntityId, voiceIndex: number): { beatId: EntityId; noteId?: EntityId } | undefined {
    const loc = findBeat(this.doc, beatId);
    if (!loc) return undefined;
    const voices = loc.measure.voices.filter((v) => v.staff === loc.voice.staff);
    const target = voices[((voiceIndex % voices.length) + voices.length) % voices.length];
    if (!target || target === loc.voice) return undefined;
    const tick = beatTick(loc.voice.beats, loc.beatIndex);
    let acc = 0;
    let best = target.beats[0];
    for (const b of target.beats) {
      if (acc <= tick) best = b;
      else break;
      acc += Math.round(playedTicks(b));
    }
    return best ? { beatId: best.id, noteId: best.notes[0]?.id } : undefined;
  }

  /** The previous/next beat in reading order within a voice (crossing bars). */
  neighbor(beatId: EntityId, direction: 1 | -1): { beatId: EntityId; noteId?: EntityId } | undefined {
    const loc = findBeat(this.doc, beatId);
    if (!loc) return undefined;
    let target = loc.voice.beats[loc.beatIndex + direction];
    if (!target) {
      const voiceIndex = loc.measure.voices.indexOf(loc.voice);
      const nextMeasure = loc.part.measures[loc.measure.barIndex + direction];
      const nextVoice = nextMeasure?.voices[voiceIndex] ?? nextMeasure?.voices[0];
      target = direction > 0 ? nextVoice?.beats[0] : nextVoice?.beats[(nextVoice?.beats.length ?? 0) - 1];
    }
    if (!target) return undefined;
    return { beatId: target.id, noteId: target.notes[0]?.id };
  }

  /** Effective key signature (fifths) at a bar, carried forward per part. */
  private keyFifthsAt(part: Part, barIndex: number): number {
    let fifths = 0;
    for (let i = 0; i <= barIndex; i++) {
      const k = part.measures[i]?.attributes?.key?.fifths;
      if (k !== undefined) fifths = k;
    }
    return fifths;
  }

  // ---------- pitch ----------

  setPitch(noteId: EntityId, pitch: { step: NoteStep; alter: number; octave: number }): boolean {
    return this.edit((doc) => {
      const note = findNote(doc, noteId)?.note;
      if (!note) return false;
      Object.assign(note, { step: pitch.step, alter: pitch.alter, octave: pitch.octave });
      syncFret(findNote(doc, noteId));
      return true;
    });
  }

  /** Set a note's letter name, choosing the octave nearest its current pitch. */
  setPitchByName(noteId: EntityId, step: NoteStep): boolean {
    const loc = this.findNote(noteId);
    if (!loc) return false;
    const octave = nearestOctave(step, chromaticValue(loc.note));
    return this.setPitch(noteId, { step, alter: 0, octave });
  }

  /** Transpose a note, respelling per the measure's key signature. */
  transposeNote(noteId: EntityId, semitones: number): boolean {
    const loc = this.findNote(noteId);
    if (!loc || semitones === 0) return !!loc;
    const barIndex = loc.measure.barIndex;
    const fifths = this.keyFifthsAt(loc.part, barIndex);
    return this.setPitch(noteId, spell(chromaticValue(loc.note) + semitones, fifths));
  }

  /** Cycle a note's accidental: natural -> sharp -> double-sharp | flat side. */
  cycleAccidental(noteId: EntityId, direction: 1 | -1): boolean {
    return this.edit((doc) => {
      const note = findNote(doc, noteId)?.note;
      if (!note) return false;
      const next = Math.max(-2, Math.min(2, note.alter + direction));
      if (next === note.alter) return false;
      note.alter = next;
      note.accidental = { kind: ALTER_ACCIDENTAL[next]! };
      syncFret(findNote(doc, noteId));
      return true;
    });
  }

  // ---------- rhythm ----------

  /** Set a beat's written duration (note type and dots). */
  setDuration(beatId: EntityId, noteType: NoteType, dots = 0): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      beat.duration = { noteType, dots };
      return true;
    });
  }

  /** Step a beat's duration one value shorter (+1) or longer (-1). */
  stepDuration(beatId: EntityId, direction: 1 | -1): boolean {
    const beat = findBeat(this.doc, beatId)?.beat;
    if (!beat) return false;
    const i = NOTE_TYPES.indexOf(beat.duration.noteType);
    const next = NOTE_TYPES[Math.max(0, Math.min(NOTE_TYPES.length - 1, i + direction))]!;
    return this.setDuration(beatId, next, beat.duration.dots);
  }

  toggleDot(beatId: EntityId): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      beat.duration = { noteType: beat.duration.noteType, dots: beat.duration.dots ? 0 : 1 };
      return true;
    });
  }

  // ---------- notes, chords, rests ----------

  private newNote(pitch: { step: NoteStep; alter: number; octave: number }): Note {
    return { id: newId("note"), step: pitch.step, alter: pitch.alter, octave: pitch.octave };
  }

  /** Turn a rest into a note (or replace the beat's notes) with a pitch. */
  restToNote(beatId: EntityId, pitch: { step: NoteStep; alter: number; octave: number }): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      beat.rest = false;
      beat.notes = [this.newNote(pitch)];
      return true;
    });
  }

  /** Set a rest's letter name, defaulting the octave (near the previous note). */
  restToNoteByName(beatId: EntityId, step: NoteStep): boolean {
    const loc = findBeat(this.doc, beatId);
    if (!loc) return false;
    const ref = previousPitchChromatic(loc.voice, loc.beatIndex) ?? 4 * 12 + STEP_SEMITONE.B; // ~B4
    return this.restToNote(beatId, { step, alter: 0, octave: nearestOctave(step, ref) });
  }

  /** Make a beat a rest (clear its notes). */
  makeRest(beatId: EntityId): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat || beat.rest) return false;
      beat.rest = true;
      beat.notes = [];
      return true;
    });
  }

  /** Add a note to a beat (build a chord), keeping notes ordered high-to-low. */
  addNoteToBeat(beatId: EntityId, pitch: { step: NoteStep; alter: number; octave: number }): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      beat.rest = false;
      const note = this.newNote(pitch);
      if (beat.notes.some((n) => chromaticValue(n) === chromaticValue(note))) return false;
      beat.notes.push(note);
      beat.notes.sort((a, b) => chromaticValue(b) - chromaticValue(a));
      return true;
    });
  }

  /** Add a note by letter name to a beat (chord), near the current top note. */
  addNoteToBeatByName(beatId: EntityId, step: NoteStep): boolean {
    const beat = findBeat(this.doc, beatId)?.beat;
    const ref = beat?.notes[0] ? chromaticValue(beat.notes[0]) : 4 * 12 + STEP_SEMITONE.B;
    return this.addNoteToBeat(beatId, { step, alter: 0, octave: nearestOctave(step, ref) });
  }

  /** Add a note a given interval (in semitones) above the beat's top note. */
  addInterval(beatId: EntityId, semitones: number): boolean {
    const beat = findBeat(this.doc, beatId)?.beat;
    const top = beat?.notes[0];
    if (!top) return false;
    const fifths = 0;
    return this.addNoteToBeat(beatId, spell(chromaticValue(top) + semitones, fifths));
  }

  /** Remove a note; a beat with no notes left becomes a rest. */
  deleteNote(noteId: EntityId): boolean {
    return this.edit((doc) => {
      const loc = findNote(doc, noteId);
      if (!loc) return false;
      loc.beat.notes.splice(loc.noteIndex, 1);
      if (loc.beat.notes.length === 0) loc.beat.rest = true;
      return true;
    });
  }

  // ---------- notation ----------

  /** Toggle an articulation (staccato/accent/...) on a beat. */
  toggleArticulation(beatId: EntityId, type: ArticulationType): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      const list = beat.articulations ?? [];
      beat.articulations = list.includes(type) ? list.filter((a) => a !== type) : [...list, type];
      if (beat.articulations.length === 0) delete beat.articulations;
      return true;
    });
  }

  /** Toggle an ornament (mordent/turn/trill...) on a beat. */
  toggleOrnament(beatId: EntityId, type: OrnamentType): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      const list = beat.ornaments ?? [];
      beat.ornaments = list.includes(type) ? list.filter((o) => o !== type) : [...list, type];
      if (beat.ornaments.length === 0) delete beat.ornaments;
      return true;
    });
  }

  toggleFermata(beatId: EntityId): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      if (beat.fermata) delete beat.fermata;
      else beat.fermata = true;
      return true;
    });
  }

  /** Tie a note to the next beat (creating/copying the target pitch), or untie. */
  toggleTie(noteId: EntityId): boolean {
    return this.edit((doc) => {
      const loc = findNote(doc, noteId);
      if (!loc) return false;
      const existing = doc.spanners.findIndex((s) => s.kind === "tie" && s.from.noteId === noteId);
      if (existing >= 0) {
        doc.spanners.splice(existing, 1);
        return true;
      }
      const nextBeat = loc.voice.beats[loc.voice.beats.indexOf(loc.beat) + 1];
      if (!nextBeat) return false;
      // Match a same-pitch note in the next beat, or copy this pitch into it.
      let target = nextBeat.notes.find((n) => chromaticValue(n) === chromaticValue(loc.note));
      if (!target) {
        target = { id: newId("note"), step: loc.note.step, alter: loc.note.alter, octave: loc.note.octave };
        nextBeat.rest = false;
        nextBeat.notes = [target];
      }
      doc.spanners.push({
        id: newId("tie"),
        kind: "tie",
        from: { beatId: loc.beat.id, noteId: loc.note.id },
        to: { beatId: nextBeat.id, noteId: target.id },
      });
      return true;
    });
  }

  /** Slur a beat to the next beat, or remove that slur. */
  toggleSlur(beatId: EntityId): boolean {
    return this.edit((doc) => {
      const loc = findBeat(doc, beatId);
      const nextBeat = loc?.voice.beats[loc.beatIndex + 1];
      if (!loc || !nextBeat) return false;
      const existing = doc.spanners.findIndex(
        (s) => s.kind === "slur" && s.fromBeat === beatId && s.toBeat === nextBeat.id,
      );
      if (existing >= 0) {
        doc.spanners.splice(existing, 1);
        return true;
      }
      const number = 1 + Math.max(0, ...doc.spanners.filter((s) => s.kind === "slur").map((s) => s.number));
      doc.spanners.push({ id: newId("slur"), kind: "slur", number, fromBeat: beatId, toBeat: nextBeat.id });
      return true;
    });
  }

  /** Attach a dynamic marking (p, mf, f, ...) at a beat, or clear it. */
  setDynamic(beatId: EntityId, value: string | null): boolean {
    return this.edit((doc) => {
      const loc = findBeat(doc, beatId);
      if (!loc) return false;
      const tick = beatTick(loc.voice.beats, loc.beatIndex);
      const staff = loc.voice.staff;
      const existing = doc.directions.findIndex(
        (d) => d.content.kind === "dynamics" && d.barIndex === loc.measure.barIndex && d.tick === tick && d.staff === staff,
      );
      if (existing >= 0) doc.directions.splice(existing, 1);
      if (value) {
        doc.directions.push({
          id: newId("dir"),
          barIndex: loc.measure.barIndex,
          tick,
          staff,
          placement: "below",
          content: { kind: "dynamics", value },
        });
      }
      return true;
    });
  }

  // ---------- grace notes & voices ----------

  /** Insert a grace note just before a beat. Pitch defaults to the beat's top
   * note (or the previous note); returns the new grace note's id. */
  insertGraceBefore(beatId: EntityId, step?: NoteStep, kind: GraceKind = "appoggiatura"): EntityId | undefined {
    let graceNoteId: EntityId | undefined;
    const ok = this.edit((doc) => {
      const loc = findBeat(doc, beatId);
      if (!loc) return false;
      const ref = loc.beat.notes[0] ?? { step: "B" as NoteStep, alter: 0, octave: 4 };
      const refChroma = previousPitchChromatic(loc.voice, loc.beatIndex) ?? chromaticValue(ref);
      const pitch = step
        ? { step, alter: 0, octave: nearestOctave(step, refChroma) }
        : { step: ref.step, alter: ref.alter, octave: ref.octave };
      const note: Note = { id: newId("note"), ...pitch };
      graceNoteId = note.id;
      loc.voice.beats.splice(loc.beatIndex, 0, {
        id: newId("beat"),
        duration: { noteType: "eighth", dots: 0 },
        rest: false,
        notes: [note],
        grace: { kind },
      });
      return true;
    });
    return ok ? graceNoteId : undefined;
  }

  /** Add an independent voice (filled with rests) to a bar, on a staff. Returns
   * the new voice's first beat id, so a caller can select it for entry. */
  addVoice(barIndex: number, partIndex = 0, staffIndex = 0): EntityId | undefined {
    let firstBeatId: EntityId | undefined;
    const ok = this.edit((doc) => {
      const part = doc.parts[partIndex];
      const measure = part?.measures[barIndex];
      if (!part || !measure) return false;
      const beats = fillRests(effectiveTime(part, barIndex));
      const index = Math.max(-1, ...measure.voices.map((v) => v.index)) + 1;
      measure.voices.push({ id: newId("voice"), index, staff: staffIndex, beats });
      firstBeatId = beats[0]?.id;
      return true;
    });
    return ok ? firstBeatId : undefined;
  }

  /** Remove a voice from a bar (a bar keeps at least one voice). */
  removeVoice(barIndex: number, voiceIndex: number, partIndex = 0): boolean {
    return this.edit((doc) => {
      const measure = doc.parts[partIndex]?.measures[barIndex];
      if (!measure || measure.voices.length <= 1) return false;
      const i = measure.voices.findIndex((v) => v.index === voiceIndex);
      if (i < 0) return false;
      measure.voices.splice(i, 1);
      return true;
    });
  }

  // ---------- structure ----------

  /** Insert an empty measure before/after a bar, kept synced across parts. */
  insertMeasure(barIndex: number, where: "before" | "after" = "after"): boolean {
    return this.edit((doc) => {
      const at = where === "after" ? barIndex + 1 : barIndex;
      if (at < 0 || at > doc.bars.length) return false;
      const ref = doc.bars[Math.min(Math.max(0, barIndex), doc.bars.length - 1)];
      doc.bars.splice(at, 0, { id: newId("bar"), index: at, durationTicks: ref?.durationTicks ?? 4 * PPQ });
      doc.directions = doc.directions.map((d) => (d.barIndex >= at ? { ...d, barIndex: d.barIndex + 1 } : d));
      for (const part of doc.parts) {
        const time = effectiveTime(part, at);
        part.measures.splice(at, 0, {
          id: newId("measure"),
          barIndex: at,
          voices: part.staves.map((staff) => ({
            id: newId("voice"),
            index: staff.index,
            staff: staff.index,
            beats: fillRests(time),
          })),
        });
      }
      reindexBars(doc);
      return true;
    });
  }

  /** Remove a measure across all parts (a score keeps at least one bar). */
  removeMeasure(barIndex: number): boolean {
    return this.edit((doc) => {
      if (doc.bars.length <= 1 || barIndex < 0 || barIndex >= doc.bars.length) return false;
      doc.bars.splice(barIndex, 1);
      for (const part of doc.parts) part.measures.splice(barIndex, 1);
      // Drop directions anchored to the removed bar; shift later ones down.
      doc.directions = doc.directions
        .filter((d) => d.barIndex !== barIndex)
        .map((d) => (d.barIndex > barIndex ? { ...d, barIndex: d.barIndex - 1 } : d));
      reindexBars(doc);
      return true;
    });
  }

  /** Set a bar's time signature (all parts) and its sounding duration. */
  setTimeSignature(barIndex: number, beats: number, beatUnit: number): boolean {
    return this.edit((doc) => {
      const bar = doc.bars[barIndex];
      if (!bar || beats < 1 || beatUnit < 1) return false;
      bar.durationTicks = Math.round(beats * (4 / beatUnit) * PPQ);
      for (const part of doc.parts) {
        const measure = part.measures[barIndex];
        if (measure) (measure.attributes ??= {}).time = { beats, beatUnit };
      }
      return true;
    });
  }

  /** Set a bar's key signature (all parts). */
  setKeySignature(barIndex: number, fifths: number): boolean {
    return this.edit((doc) => {
      if (!doc.bars[barIndex] || fifths < -7 || fifths > 7) return false;
      for (const part of doc.parts) {
        const measure = part.measures[barIndex];
        if (measure) (measure.attributes ??= {}).key = { fifths };
      }
      return true;
    });
  }

  /** Set a bar's tempo (bpm), or clear it. */
  setTempo(barIndex: number, bpm: number | null): boolean {
    return this.edit((doc) => {
      const bar = doc.bars[barIndex];
      if (!bar) return false;
      if (bpm && bpm > 0) bar.tempoBpm = bpm;
      else delete bar.tempoBpm;
      return true;
    });
  }

  /** Add a text direction (words / rehearsal mark) at a beat. */
  addText(beatId: EntityId, text: string, kind: "words" | "rehearsal" = "words"): boolean {
    return this.edit((doc) => {
      const loc = findBeat(doc, beatId);
      if (!loc || !text) return false;
      doc.directions.push({
        id: newId("dir"),
        barIndex: loc.measure.barIndex,
        tick: beatTick(loc.voice.beats, loc.beatIndex),
        placement: "above",
        content: kind === "rehearsal" ? { kind: "rehearsal", text } : { kind: "words", text },
      });
      return true;
    });
  }

  /** Set (or clear) a beat's chord symbol. */
  setChordSymbol(beatId: EntityId, text: string | null): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      if (text && text.trim()) beat.chordSymbol = text.trim();
      else delete beat.chordSymbol;
      return true;
    });
  }

  // ---------- clipboard ----------

  /** A detached copy of a beat's content (rhythm + pitches) for pasting. */
  copyBeat(beatId: EntityId): CopiedBeat | undefined {
    const beat = findBeat(this.doc, beatId)?.beat;
    if (!beat) return undefined;
    return structuredClone({
      duration: beat.duration,
      rest: beat.rest,
      notes: beat.notes,
      ...(beat.articulations ? { articulations: beat.articulations } : {}),
      ...(beat.ornaments ? { ornaments: beat.ornaments } : {}),
    });
  }

  /** Paste copied content onto a beat (fresh note ids). */
  pasteBeat(beatId: EntityId, source: CopiedBeat): boolean {
    return this.edit((doc) => {
      const beat = findBeat(doc, beatId)?.beat;
      if (!beat) return false;
      beat.duration = { ...source.duration };
      beat.rest = source.rest;
      beat.notes = source.notes.map((n) => ({ ...n, id: newId("note") }));
      if (source.articulations) beat.articulations = [...source.articulations];
      else delete beat.articulations;
      if (source.ornaments) beat.ornaments = [...source.ornaments];
      else delete beat.ornaments;
      return true;
    });
  }

  /** Edit document metadata (title/composer). */
  setWork(patch: { title?: string; composer?: string }): boolean {
    return this.edit((doc) => {
      if (patch.title !== undefined) doc.work.title = patch.title;
      if (patch.composer !== undefined) doc.work.composer = patch.composer || undefined;
      return true;
    });
  }

  // ---------- tab ----------

  /** Set the fret of a note on a tab staff, deriving pitch from the tuning. */
  setFret(noteId: EntityId, fret: number): boolean {
    return this.edit((doc) => {
      const loc = findNote(doc, noteId);
      if (!loc) return false;
      const tuning = tuningFor(loc);
      const string = loc.note.string;
      if (!tuning || string === undefined) return false;
      loc.note.fret = fret;
      const open = tuning[string - 1];
      if (open !== undefined) Object.assign(loc.note, spell(open + fret));
      return true;
    });
  }
}

const ALTER_ACCIDENTAL: Record<number, AccidentalKind> = {
  [-2]: "double-flat",
  [-1]: "flat",
  [0]: "natural",
  [1]: "sharp",
  [2]: "double-sharp",
};

/** Keep a tab note's fret consistent after a pitch change (avoid stale frets). */
function syncFret(loc: NoteLocation | undefined): void {
  if (!loc || loc.note.string === undefined) return;
  const tuning = tuningFor(loc);
  const open = tuning?.[loc.note.string - 1];
  if (open === undefined) return;
  const fret = chromaticValue(loc.note) - open;
  if (fret >= 0) loc.note.fret = fret;
}

function tuningFor(loc: NoteLocation): number[] | undefined {
  const staffIndex = loc.note.staff ?? loc.beat.staff ?? loc.voice.staff;
  return loc.part.staves[staffIndex]?.tuning;
}

function previousPitchChromatic(voice: Voice, beatIndex: number): number | undefined {
  for (let i = beatIndex - 1; i >= 0; i--) {
    const note = voice.beats[i]?.notes[0];
    if (note) return chromaticValue(note);
  }
  return undefined;
}

/** Restore a document's contents in place, keeping its object identity stable
 * so callers holding `editor.doc` see the restored state after undo/redo. */
function replaceDocInPlace(target: ScoreV1, source: ScoreV1): void {
  for (const key of Object.keys(target)) delete (target as unknown as Record<string, unknown>)[key];
  Object.assign(target, source);
}

function findNote(doc: ScoreV1, noteId: EntityId): NoteLocation | undefined {
  for (const part of doc.parts)
    for (const measure of part.measures)
      for (const voice of measure.voices)
        for (const beat of voice.beats) {
          const noteIndex = beat.notes.findIndex((n) => n.id === noteId);
          if (noteIndex >= 0) return { part, measure, voice, beat, note: beat.notes[noteIndex]!, noteIndex };
        }
  return undefined;
}

function findBeat(doc: ScoreV1, beatId: EntityId): BeatLocation | undefined {
  for (const part of doc.parts)
    for (const measure of part.measures)
      for (const voice of measure.voices) {
        const beatIndex = voice.beats.findIndex((b) => b.id === beatId);
        if (beatIndex >= 0) return { part, measure, voice, beat: voice.beats[beatIndex]!, beatIndex };
      }
  return undefined;
}

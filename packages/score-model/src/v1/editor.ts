import type { Beat, EntityId, Measure, Note, NoteStep, Part, ScoreV1, Voice } from "./types";

export interface NoteLocation {
  part: Part;
  measure: Measure;
  voice: Voice;
  beat: Beat;
  note: Note;
  noteIndex: number;
}

/** A reversible edit. Each op records the inverse so undo is exact. */
interface Command {
  label: string;
  apply(doc: ScoreV1): void;
  invert(doc: ScoreV1): void;
}

const STEP_SEMITONE: Record<NoteStep, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Sharp-preferring spelling of each pitch class.
const PC_SPELL: Array<{ step: NoteStep; alter: number }> = [
  { step: "C", alter: 0 }, { step: "C", alter: 1 }, { step: "D", alter: 0 }, { step: "D", alter: 1 },
  { step: "E", alter: 0 }, { step: "F", alter: 0 }, { step: "F", alter: 1 }, { step: "G", alter: 0 },
  { step: "G", alter: 1 }, { step: "A", alter: 0 }, { step: "A", alter: 1 }, { step: "B", alter: 0 },
];

export function chromaticValue(note: { step: NoteStep; alter: number; octave: number }): number {
  return note.octave * 12 + STEP_SEMITONE[note.step] + note.alter;
}

function spell(chromatic: number): { step: NoteStep; alter: number; octave: number } {
  const octave = Math.floor(chromatic / 12);
  const pc = ((chromatic % 12) + 12) % 12;
  const s = PC_SPELL[pc]!;
  return { step: s.step, alter: s.alter, octave };
}

/**
 * Editing layer over a v1 document. Selection and edits are addressed by stable
 * entity id (resolved to position at apply time), so edits survive re-layout,
 * and every op is reversible via an inverse command — no whole-document
 * snapshots. Scoped to the P1 edit subset (pitch, delete); richer notation edits
 * come later.
 */
export class ScoreEditorV1 {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(public doc: ScoreV1) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** The id of a beat's first note (selection is by beat; edits act on notes). */
  firstNoteId(beatId: EntityId): EntityId | undefined {
    const beat = findBeatById(this.doc, beatId);
    return beat?.notes[0]?.id;
  }

  findNote(noteId: EntityId): NoteLocation | undefined {
    for (const part of this.doc.parts) {
      for (const measure of part.measures) {
        for (const voice of measure.voices) {
          for (const beat of voice.beats) {
            const noteIndex = beat.notes.findIndex((n) => n.id === noteId);
            if (noteIndex >= 0) {
              return { part, measure, voice, beat, note: beat.notes[noteIndex]!, noteIndex };
            }
          }
        }
      }
    }
    return undefined;
  }

  private run(cmd: Command): void {
    cmd.apply(this.doc);
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
  }

  /** Set a note's exact pitch. */
  setPitch(noteId: EntityId, pitch: { step: NoteStep; alter: number; octave: number }): boolean {
    const loc = this.findNote(noteId);
    if (!loc) return false;
    const before = { step: loc.note.step, alter: loc.note.alter, octave: loc.note.octave };
    this.run({
      label: "set pitch",
      apply: (doc) => assignPitch(findNoteById(doc, noteId), pitch),
      invert: (doc) => assignPitch(findNoteById(doc, noteId), before),
    });
    return true;
  }

  /** Shift a note by a number of semitones (sharp-preferring spelling). */
  transposeNote(noteId: EntityId, semitones: number): boolean {
    const loc = this.findNote(noteId);
    if (!loc || semitones === 0) return !!loc;
    const next = spell(chromaticValue(loc.note) + semitones);
    return this.setPitch(noteId, next);
  }

  /** Remove a note; if its beat becomes empty, the beat turns into a rest. */
  deleteNote(noteId: EntityId): boolean {
    const loc = this.findNote(noteId);
    if (!loc) return false;
    const removed = loc.note;
    const index = loc.noteIndex;
    const beatId = loc.beat.id;
    const becameRest = loc.beat.notes.length === 1;
    this.run({
      label: "delete note",
      apply: (doc) => {
        const beat = findBeatById(doc, beatId);
        if (!beat) return;
        beat.notes.splice(index, 1);
        if (beat.notes.length === 0) beat.rest = true;
      },
      invert: (doc) => {
        const beat = findBeatById(doc, beatId);
        if (!beat) return;
        beat.notes.splice(index, 0, { ...removed });
        if (becameRest) beat.rest = false;
      },
    });
    return true;
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.invert(this.doc);
    this.redoStack.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.apply(this.doc);
    this.undoStack.push(cmd);
    return true;
  }
}

function assignPitch(note: Note | undefined, pitch: { step: NoteStep; alter: number; octave: number }): void {
  if (!note) return;
  note.step = pitch.step;
  note.alter = pitch.alter;
  note.octave = pitch.octave;
}

function findNoteById(doc: ScoreV1, noteId: EntityId): Note | undefined {
  for (const part of doc.parts)
    for (const measure of part.measures)
      for (const voice of measure.voices)
        for (const beat of voice.beats) {
          const note = beat.notes.find((n) => n.id === noteId);
          if (note) return note;
        }
  return undefined;
}

function findBeatById(doc: ScoreV1, beatId: EntityId): Beat | undefined {
  for (const part of doc.parts)
    for (const measure of part.measures)
      for (const voice of measure.voices) {
        const beat = voice.beats.find((b) => b.id === beatId);
        if (beat) return beat;
      }
  return undefined;
}

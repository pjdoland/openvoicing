import type { NoteStep, Note, ScoreDocument } from "./types";

const STEP_SEMITONES: Record<NoteStep, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SEMITONE_PITCHES: Array<{ step: NoteStep; alter: number }> = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "D", alter: 1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "G", alter: 1 },
  { step: "A", alter: 0 },
  { step: "A", alter: 1 },
  { step: "B", alter: 0 },
];

export function pitchToMidi(step: NoteStep, alter: number, octave: number): number {
  return (octave + 1) * 12 + STEP_SEMITONES[step] + alter;
}

/** Spell a midi note, preferring naturals and sharps. */
export function midiToPitch(midi: number): { step: NoteStep; alter: number; octave: number } {
  const octave = Math.floor(midi / 12) - 1;
  const pitch = SEMITONE_PITCHES[((midi % 12) + 12) % 12]!;
  return { step: pitch.step, alter: pitch.alter, octave };
}

export interface BeatAddress {
  partIndex: number;
  barIndex: number;
  voiceIndex: number;
  beatIndex: number;
}

/**
 * Edits over a ScoreDocument with undo/redo. History is snapshot-based:
 * documents are small, and structuredClone preserves the stable entity IDs
 * that annotations and sync maps reference.
 */
export class ScoreEditor {
  private past: ScoreDocument[] = [];
  private future: ScoreDocument[] = [];

  constructor(public doc: ScoreDocument) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.doc);
    this.doc = prev;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.doc);
    this.doc = next;
    return true;
  }

  private commit(next: ScoreDocument): void {
    this.past.push(this.doc);
    this.future = [];
    this.doc = next;
  }

  private locateNotes(doc: ScoreDocument, address: BeatAddress): Note[] | undefined {
    return doc.parts[address.partIndex]?.measures[address.barIndex]?.voices[address.voiceIndex]
      ?.beats[address.beatIndex]?.notes;
  }

  /** Transpose every note of a beat by the given number of semitones. */
  transposeBeat(address: BeatAddress, semitones: number): boolean {
    const notes = this.locateNotes(this.doc, address);
    if (!notes || notes.length === 0) return false;
    for (const note of notes) {
      const midi = pitchToMidi(note.step, note.alter, note.octave) + semitones;
      if (midi < 12 || midi > 127) return false;
    }
    const next = structuredClone(this.doc);
    for (const note of this.locateNotes(next, address)!) {
      const pitch = midiToPitch(pitchToMidi(note.step, note.alter, note.octave) + semitones);
      note.step = pitch.step;
      note.alter = pitch.alter;
      note.octave = pitch.octave;
    }
    this.commit(next);
    return true;
  }
}

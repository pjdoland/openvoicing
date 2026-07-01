import { newId } from "./ids";
import type { Beat, Note, NoteStep, ScoreDocument, Voice } from "./types";

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

  private locateVoice(doc: ScoreDocument, address: BeatAddress): Voice | undefined {
    return doc.parts[address.partIndex]?.measures[address.barIndex]?.voices[address.voiceIndex];
  }

  private locateBeat(doc: ScoreDocument, address: BeatAddress): Beat | undefined {
    return this.locateVoice(doc, address)?.beats[address.beatIndex];
  }

  private locateNotes(doc: ScoreDocument, address: BeatAddress): Note[] | undefined {
    return this.locateBeat(doc, address)?.notes;
  }

  private recomputeStartTicks(voice: Voice): void {
    let tick = 0;
    for (const beat of voice.beats) {
      beat.startTick = tick;
      tick += beat.durationTicks;
    }
  }

  /**
   * Replace the beat's content with a single natural note of the given step,
   * in the octave closest to the beat's previous pitch (or middle C for rests).
   */
  setBeatPitch(address: BeatAddress, step: NoteStep): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat) return false;
    const ref = beat.notes[0];
    const refMidi = ref ? pitchToMidi(ref.step, ref.alter, ref.octave) : 60;
    let octave = 4;
    let bestDistance = Infinity;
    for (let candidate = 0; candidate <= 8; candidate++) {
      const distance = Math.abs(pitchToMidi(step, 0, candidate) - refMidi);
      if (distance < bestDistance) {
        bestDistance = distance;
        octave = candidate;
      }
    }
    const next = structuredClone(this.doc);
    const target = this.locateBeat(next, address)!;
    target.rest = false;
    target.notes = [
      { id: target.notes[0]?.id ?? newId("note"), step, alter: 0, octave },
    ];
    this.commit(next);
    return true;
  }

  /** Change a beat's duration, repacking the voice's tick offsets. */
  setBeatDuration(address: BeatAddress, durationTicks: number): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat || durationTicks <= 0 || beat.durationTicks === durationTicks) return false;
    const next = structuredClone(this.doc);
    this.locateBeat(next, address)!.durationTicks = durationTicks;
    this.recomputeStartTicks(this.locateVoice(next, address)!);
    this.commit(next);
    return true;
  }

  /** Turn a beat into a rest. Use setBeatPitch to turn it back into a note. */
  setBeatRest(address: BeatAddress): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat || beat.rest) return false;
    const next = structuredClone(this.doc);
    const target = this.locateBeat(next, address)!;
    target.rest = true;
    target.notes = [];
    this.commit(next);
    return true;
  }

  /** Insert a copy of the beat right after it. Returns the new beat's address. */
  insertBeatAfter(address: BeatAddress): BeatAddress | null {
    const beat = this.locateBeat(this.doc, address);
    if (!beat) return null;
    const next = structuredClone(this.doc);
    const voice = this.locateVoice(next, address)!;
    const source = voice.beats[address.beatIndex]!;
    voice.beats.splice(address.beatIndex + 1, 0, {
      id: newId("beat"),
      startTick: 0,
      durationTicks: source.durationTicks,
      rest: source.rest,
      notes: source.notes.map((n) => ({ ...n, id: newId("note") })),
    });
    this.recomputeStartTicks(voice);
    this.commit(next);
    return { ...address, beatIndex: address.beatIndex + 1 };
  }

  /** Remove a beat, repacking the voice. */
  deleteBeat(address: BeatAddress): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat) return false;
    const next = structuredClone(this.doc);
    const voice = this.locateVoice(next, address)!;
    voice.beats.splice(address.beatIndex, 1);
    this.recomputeStartTicks(voice);
    this.commit(next);
    return true;
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

import { newId } from "./ids";
import { PPQ, type Beat, type Note, type NoteStep, type ScoreDocument, type Voice } from "./types";

/** True for whole..64th note lengths (powers of two of PPQ), not dotted or tuplet. */
function isPlainDuration(ticks: number): boolean {
  for (let d = PPQ * 4; d >= PPQ / 16; d /= 2) {
    if (ticks === d) return true;
  }
  return false;
}

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
 * The neighboring beat in reading order within the same part and voice,
 * crossing bar boundaries and skipping empty measures. Null at either end.
 */
export function neighborBeatAddress(
  doc: ScoreDocument,
  address: BeatAddress,
  direction: 1 | -1,
): BeatAddress | null {
  const part = doc.parts[address.partIndex];
  if (!part) return null;
  const beatsIn = (barIndex: number) =>
    part.measures[barIndex]?.voices[address.voiceIndex]?.beats ?? [];

  const within = address.beatIndex + direction;
  if (within >= 0 && within < beatsIn(address.barIndex).length) {
    return { ...address, beatIndex: within };
  }
  let barIndex = address.barIndex + direction;
  while (barIndex >= 0 && barIndex < part.measures.length) {
    const beats = beatsIn(barIndex);
    if (beats.length > 0) {
      return { ...address, barIndex, beatIndex: direction === 1 ? 0 : beats.length - 1 };
    }
    barIndex += direction;
  }
  return null;
}

const RESPELL: Record<string, { step: NoteStep; alter: number }> = {
  "C1": { step: "D", alter: -1 },
  "D-1": { step: "C", alter: 1 },
  "D1": { step: "E", alter: -1 },
  "E-1": { step: "D", alter: 1 },
  "F1": { step: "G", alter: -1 },
  "G-1": { step: "F", alter: 1 },
  "G1": { step: "A", alter: -1 },
  "A-1": { step: "G", alter: 1 },
  "A1": { step: "B", alter: -1 },
  "B-1": { step: "A", alter: 1 },
};

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

  /** Insert deep copies of beats (with fresh ids) after an address. */
  insertBeatsAfter(address: BeatAddress, beats: Beat[]): boolean {
    if (beats.length === 0) return false;
    const voice = this.locateVoice(this.doc, address);
    if (!voice) return false;
    const next = structuredClone(this.doc);
    const nextVoice = this.locateVoice(next, address)!;
    const clones = beats.map((b) => ({
      ...structuredClone(b),
      id: newId("beat"),
      notes: b.notes.map((n) => ({ ...n, id: newId("note") })),
    }));
    nextVoice.beats.splice(address.beatIndex + 1, 0, ...clones);
    this.recomputeStartTicks(nextVoice);
    this.commit(next);
    return true;
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

  /**
   * Toggle a tie between a beat and the next beat (crossing barlines) when
   * both hold the same pitches.
   */
  toggleTie(address: BeatAddress): boolean {
    const nextAddress = neighborBeatAddress(this.doc, address, 1);
    if (!nextAddress) return false;
    const from = this.locateBeat(this.doc, address);
    const to = this.locateBeat(this.doc, nextAddress);
    if (!from || !to || from.notes.length === 0 || from.notes.length !== to.notes.length) {
      return false;
    }
    const key = (n: Note) => `${n.step}/${n.alter}/${n.octave}`;
    const fromKeys = from.notes.map(key).sort();
    const toKeys = to.notes.map(key).sort();
    if (fromKeys.some((k, i) => k !== toKeys[i])) return false;

    const tied = from.notes.every((n) => n.tieStart) && to.notes.every((n) => n.tieStop);
    const next = structuredClone(this.doc);
    for (const note of this.locateBeat(next, address)!.notes) {
      if (tied) delete note.tieStart;
      else note.tieStart = true;
    }
    for (const note of this.locateBeat(next, nextAddress)!.notes) {
      if (tied) delete note.tieStop;
      else note.tieStop = true;
    }
    this.commit(next);
    return true;
  }

  /** Toggle enharmonic spelling (C# to Db and back) for every altered note. */
  respellBeat(address: BeatAddress): boolean {
    const notes = this.locateNotes(this.doc, address);
    if (!notes || !notes.some((n) => RESPELL[`${n.step}${n.alter}`])) return false;
    const next = structuredClone(this.doc);
    for (const note of this.locateNotes(next, address)!) {
      const spelling = RESPELL[`${note.step}${note.alter}`];
      if (spelling) {
        note.step = spelling.step;
        note.alter = spelling.alter;
      }
    }
    this.commit(next);
    return true;
  }

  /** Toggle an augmentation dot: dotted lengthens by half, undot restores. */
  toggleDotted(address: BeatAddress): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat) return false;
    // Dotted if the un-dotted length (duration / 1.5) is a plain power-of-two value.
    const base = (beat.durationTicks / 3) * 2;
    const dotted = Number.isInteger(base) && isPlainDuration(base);
    const next = structuredClone(this.doc);
    const target = this.locateBeat(next, address)!;
    target.durationTicks = dotted ? base : Math.round(beat.durationTicks * 1.5);
    this.recomputeStartTicks(this.locateVoice(next, address)!);
    this.commit(next);
    return true;
  }

  /** Shift the beat's notes chromatically by one semitone, keeping their steps. */
  cycleAccidental(address: BeatAddress, delta: 1 | -1): boolean {
    const notes = this.locateNotes(this.doc, address);
    if (!notes || notes.length === 0) return false;
    for (const note of notes) {
      if (note.alter + delta < -2 || note.alter + delta > 2) return false;
    }
    const next = structuredClone(this.doc);
    for (const note of this.locateNotes(next, address)!) note.alter += delta;
    this.commit(next);
    return true;
  }

  /** Add a note of the given step to the beat's chord (nearest octave). */
  addNoteToChord(address: BeatAddress, step: NoteStep): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat || beat.notes.length === 0) return false;
    const refMidi = pitchToMidi(beat.notes[0]!.step, beat.notes[0]!.alter, beat.notes[0]!.octave);
    let octave = 4;
    let bestDistance = Infinity;
    for (let candidate = 0; candidate <= 8; candidate++) {
      const distance = Math.abs(pitchToMidi(step, 0, candidate) - refMidi);
      if (distance < bestDistance) {
        bestDistance = distance;
        octave = candidate;
      }
    }
    const midi = pitchToMidi(step, 0, octave);
    if (beat.notes.some((n) => pitchToMidi(n.step, n.alter, n.octave) === midi)) return false;
    const next = structuredClone(this.doc);
    this.locateBeat(next, address)!.notes.push({ id: newId("note"), step, alter: 0, octave });
    this.commit(next);
    return true;
  }

  /** Copy the previous measure's content into this one. */
  repeatPreviousBar(address: BeatAddress): boolean {
    if (address.barIndex === 0) return false;
    const part = this.doc.parts[address.partIndex];
    const prev = part?.measures[address.barIndex - 1]?.voices[address.voiceIndex];
    if (!prev || prev.beats.length === 0) return false;
    const next = structuredClone(this.doc);
    const voice = this.locateVoice(next, address)!;
    voice.beats = prev.beats.map((b) => ({
      ...structuredClone(b),
      id: newId("beat"),
      notes: b.notes.map((n) => ({ ...n, id: newId("note") })),
    }));
    this.recomputeStartTicks(voice);
    this.commit(next);
    return true;
  }

  /** Set or clear a tuplet grouping on a beat (e.g. 3 for a triplet). */
  setTuplet(address: BeatAddress, tuplet: number | null): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat) return false;
    const next = structuredClone(this.doc);
    const target = this.locateBeat(next, address)!;
    if (tuplet) target.tuplet = tuplet;
    else delete target.tuplet;
    this.commit(next);
    return true;
  }

  /** Set or clear the lyric syllable under a beat. */
  setLyric(address: BeatAddress, lyric: string): boolean {
    const beat = this.locateBeat(this.doc, address);
    if (!beat) return false;
    const next = structuredClone(this.doc);
    const target = this.locateBeat(next, address)!;
    if (lyric) target.lyric = lyric;
    else delete target.lyric;
    this.commit(next);
    return true;
  }

  /** Change the time signature from a bar onward until the next explicit change. */
  setTimeSignatureFrom(barIndex: number, beats: number, beatUnit: number): boolean {
    if (!this.doc.bars[barIndex]) return false;
    const prior = this.doc.bars[barIndex]!.timeSignature;
    const next = structuredClone(this.doc);
    for (let i = barIndex; i < next.bars.length; i++) {
      const bar = next.bars[i]!;
      if (i > barIndex && (bar.timeSignature.beats !== prior.beats || bar.timeSignature.beatUnit !== prior.beatUnit)) {
        break;
      }
      bar.timeSignature = { beats, beatUnit };
    }
    this.commit(next);
    return true;
  }

  /** Change the key signature from a bar onward until the next explicit change. */
  setKeyFrom(barIndex: number, keyFifths: number): boolean {
    if (!this.doc.bars[barIndex]) return false;
    const prior = this.doc.bars[barIndex]!.keyFifths;
    const next = structuredClone(this.doc);
    for (let i = barIndex; i < next.bars.length; i++) {
      const bar = next.bars[i]!;
      if (i > barIndex && bar.keyFifths !== prior) break;
      bar.keyFifths = keyFifths;
    }
    this.commit(next);
    return true;
  }

  /** Set a part's General MIDI program for playback. */
  setInstrument(partIndex: number, midiProgram: number): boolean {
    if (!this.doc.parts[partIndex]) return false;
    const next = structuredClone(this.doc);
    next.parts[partIndex]!.midiProgram = midiProgram;
    this.commit(next);
    return true;
  }

  /** Transpose every note in the score by a number of semitones. */
  transposeScore(semitones: number): boolean {
    if (semitones === 0) return false;
    const next = structuredClone(this.doc);
    for (const part of next.parts) {
      for (const measure of part.measures) {
        for (const voice of measure.voices) {
          for (const beat of voice.beats) {
            for (const note of beat.notes) {
              const midi = pitchToMidi(note.step, note.alter, note.octave) + semitones;
              if (midi < 0 || midi > 127) return false;
              const pitch = midiToPitch(midi);
              note.step = pitch.step;
              note.alter = pitch.alter;
              note.octave = pitch.octave;
            }
          }
        }
      }
    }
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

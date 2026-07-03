import { describe, expect, it } from "vitest";
import {
  canonicalizeV1,
  createEmptyScoreV1,
  exportMusicXmlV1,
  importMusicXmlV1,
  ScoreEditorV1,
  validationErrors,
  type NoteStep,
  type NoteType,
} from "../src/v1";

// Deterministic PRNG (mulberry32) so any failure reproduces from its seed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

const STEPS: NoteStep[] = ["C", "D", "E", "F", "G", "A", "B"];
const TYPES: NoteType[] = ["whole", "half", "quarter", "eighth", "16th"];

/** All beat ids and note ids currently in a document. */
function ids(editor: ScoreEditorV1) {
  const beats: string[] = [];
  const notes: string[] = [];
  for (const part of editor.doc.parts)
    for (const m of part.measures)
      for (const v of m.voices)
        for (const b of v.beats) {
          beats.push(b.id);
          for (const n of b.notes) notes.push(n.id);
        }
  return { beats, notes };
}

/** Apply one random edit; return true if it changed the document. */
function randomOp(editor: ScoreEditorV1, r: () => number): boolean {
  const { beats, notes } = ids(editor);
  const beat = beats.length ? pick(r, beats) : undefined;
  const note = notes.length ? pick(r, notes) : undefined;
  const bars = editor.doc.bars.length;
  switch (Math.floor(r() * 14)) {
    case 0: return beat ? editor.restToNoteByName(beat, pick(r, STEPS)) : false;
    case 1: return note ? editor.setPitchByName(note, pick(r, STEPS)) : false;
    case 2: return beat ? editor.setDuration(beat, pick(r, TYPES), r() < 0.3 ? 1 : 0) : false;
    case 3: return beat ? editor.toggleDot(beat) : false;
    case 4: return beat ? editor.addNoteToBeatByName(beat, pick(r, STEPS)) : false;
    case 5: return note ? editor.deleteNote(note) : false;
    case 6: return beat ? editor.makeRest(beat) : false;
    case 7: return note ? editor.cycleAccidental(note, r() < 0.5 ? 1 : -1) : false;
    case 8: return note ? editor.transposeNote(note, pick(r, [-12, -2, -1, 1, 2, 12])) : false;
    case 9: return beat ? editor.toggleArticulation(beat, pick(r, ["staccato", "accent", "tenuto"] as const)) : false;
    case 10: return note ? editor.toggleTie(note) : false;
    case 11: return beat ? editor.toggleSlur(beat) : false;
    case 12: return editor.insertMeasure(Math.floor(r() * bars), r() < 0.5 ? "after" : "before");
    case 13: return editor.removeMeasure(Math.floor(r() * bars));
    default: return false;
  }
}

describe("v1 editor property tests (fuzz)", () => {
  it("keeps the document structurally valid after every random edit", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const editor = new ScoreEditorV1(createEmptyScoreV1({ bars: 3, beats: 4 }));
      for (let step = 0; step < 30; step++) {
        randomOp(editor, r);
        const errors = validationErrors(editor.doc);
        expect(errors, `seed ${seed} step ${step}: ${JSON.stringify(errors)}`).toEqual([]);
      }
    }
  });

  it("undo of a random op sequence returns to the exact starting document", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const editor = new ScoreEditorV1(createEmptyScoreV1({ bars: 3, beats: 4 }));
      const start = JSON.stringify(canonicalizeV1(editor.doc));
      let applied = 0;
      for (let step = 0; step < 25; step++) if (randomOp(editor, r)) applied++;
      const afterEdits = JSON.stringify(canonicalizeV1(editor.doc));
      for (let i = 0; i < applied; i++) expect(editor.undo()).toBe(true);
      expect(JSON.stringify(canonicalizeV1(editor.doc)), `seed ${seed} undo`).toBe(start);
      // Redo returns to the edited state.
      for (let i = 0; i < applied; i++) expect(editor.redo()).toBe(true);
      expect(JSON.stringify(canonicalizeV1(editor.doc)), `seed ${seed} redo`).toBe(afterEdits);
    }
  });

  it("round-trips a randomly edited score through MusicXML (canonical-equal)", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed);
      const editor = new ScoreEditorV1(createEmptyScoreV1({ bars: 2, beats: 4 }));
      // Pitches/durations/chords/articulations only: the tier-1 exported subset.
      for (let step = 0; step < 20; step++) {
        const { beats } = ids(editor);
        const beat = pick(r, beats);
        switch (Math.floor(r() * 5)) {
          case 0: editor.restToNoteByName(beat, pick(r, STEPS)); break;
          case 1: editor.setDuration(beat, pick(r, TYPES)); break;
          case 2: editor.addNoteToBeatByName(beat, pick(r, STEPS)); break;
          case 3: editor.toggleArticulation(beat, pick(r, ["staccato", "accent"] as const)); break;
          case 4: editor.setChordSymbol(beat, pick(r, ["C", "Am7", "G/B", "Fmaj7"])); break;
        }
      }
      const before = canonicalizeV1(editor.doc);
      const after = canonicalizeV1(importMusicXmlV1(exportMusicXmlV1(editor.doc)));
      expect(JSON.stringify(after), `seed ${seed} round-trip`).toBe(JSON.stringify(before));
    }
  });
});

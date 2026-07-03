import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalizeV1, importMusicXmlV1, ScoreEditorV1, validationErrors } from "../src/v1";

const GOLDBERG = readFileSync(fileURLToPath(new URL("./fixtures/v1/goldberg-aria.musicxml", import.meta.url)), "utf8");

describe("v1 persistence & determinism", () => {
  it("survives a JSON serialize/parse round-trip losslessly", () => {
    const doc = importMusicXmlV1(GOLDBERG);
    const reloaded = JSON.parse(JSON.stringify(doc));
    // The plain-JSON document must reload byte-identical, still validate, and
    // canonicalize the same, so persisting it (IndexedDB / bundle) is lossless.
    expect(reloaded).toEqual(doc);
    expect(validationErrors(reloaded)).toEqual([]);
    expect(canonicalizeV1(reloaded)).toEqual(canonicalizeV1(doc));
  });

  it("produces identical ids on deterministic re-import", () => {
    const a = importMusicXmlV1(GOLDBERG, { deterministic: true });
    const b = importMusicXmlV1(GOLDBERG, { deterministic: true });
    // Same source + deterministic ids => byte-identical documents, so id-keyed
    // state (sync anchors, comments) survives a reopen.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.parts[0]!.measures[0]!.voices[0]!.beats[0]!.id).toBe("beat_00000001");
  });

  it("returns to an identical document after a random edit sequence is undone", () => {
    const doc = importMusicXmlV1(GOLDBERG, { deterministic: true });
    const before = JSON.stringify(canonicalizeV1(doc));
    const editor = new ScoreEditorV1(doc);
    // Collect editable note ids up front.
    const noteIds: string[] = [];
    for (const part of doc.parts)
      for (const measure of part.measures)
        for (const voice of measure.voices)
          for (const beat of voice.beats)
            for (const note of beat.notes) noteIds.push(note.id);

    // Deterministic pseudo-random edit script (no Math.random / Date).
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let applied = 0;
    for (let i = 0; i < 40; i++) {
      const noteId = noteIds[Math.floor(rand() * noteIds.length)]!;
      const roll = rand();
      const ok = roll < 0.7 ? editor.transposeNote(noteId, roll < 0.35 ? 1 : -1) : editor.deleteNote(noteId);
      if (ok) applied++;
    }
    expect(applied).toBeGreaterThan(10);
    expect(JSON.stringify(canonicalizeV1(doc))).not.toBe(before);
    // Undo everything: the document must return to its exact starting point.
    while (editor.canUndo) editor.undo();
    expect(JSON.stringify(canonicalizeV1(doc))).toBe(before);
    expect(validationErrors(doc)).toEqual([]);
  });
});

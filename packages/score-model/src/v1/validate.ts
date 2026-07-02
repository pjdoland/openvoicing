import { beatStartTicks, playedTicks, tupletIndex } from "./durations";
import type { EntityId, ScoreV1, Tuplet } from "./types";

export interface ValidationIssue {
  code: string;
  message: string;
  where?: string;
  /** "error" (default) means a structural defect; "warning" means an
   * irregularity that occurs in real (often machine-generated) sources and must
   * not block import. */
  severity?: "error" | "warning";
}

/** Only the error-severity issues (warnings are tolerated on imported sources). */
export function validationErrors(doc: ScoreV1): ValidationIssue[] {
  return validateScoreV1(doc).filter((i) => (i.severity ?? "error") === "error");
}

/**
 * Structural invariants for a v1 document. Run after every edit and at
 * deserialization (the boundary where older/corrupt docs actually enter).
 * Returns [] when the document is sound.
 */
export function validateScoreV1(doc: ScoreV1): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<EntityId>();
  const dup = (id: EntityId, where: string) => {
    if (ids.has(id)) issues.push({ code: "dup-id", message: `duplicate id ${id}`, where });
    ids.add(id);
  };

  const tuplets = doc.spanners.filter((s): s is Tuplet => s.kind === "tuplet");
  const tupletOf = tupletIndex(tuplets);
  const beatIds = new Set<EntityId>();
  const noteIds = new Set<EntityId>();

  doc.bars.forEach((b, i) => {
    dup(b.id, `bar ${i}`);
    if (b.index !== i) issues.push({ code: "bar-index", message: `bar index ${b.index} != ${i}` });
    if (b.durationTicks <= 0) issues.push({ code: "bar-duration", message: `bar ${i} duration ${b.durationTicks}` });
  });

  for (const part of doc.parts) {
    dup(part.id, `part ${part.name}`);
    for (const staff of part.staves) dup(staff.id, `staff in ${part.name}`);
    if (part.measures.length !== doc.bars.length) {
      issues.push({
        code: "measure-count",
        message: `part ${part.name} has ${part.measures.length} measures, expected ${doc.bars.length}`,
      });
    }
    part.measures.forEach((measure, barIndex) => {
      dup(measure.id, `measure ${barIndex} of ${part.name}`);
      const barTicks = doc.bars[barIndex]?.durationTicks ?? 0;
      const implicit = doc.bars[barIndex]?.implicit ?? false;
      for (const voice of measure.voices) {
        dup(voice.id, `voice in ${part.name} bar ${barIndex}`);
        for (const beat of voice.beats) {
          dup(beat.id, `beat in ${part.name} bar ${barIndex}`);
          beatIds.add(beat.id);
          if (beat.grace && playedTicks(beat, tupletOf) !== 0) {
            issues.push({ code: "grace-time", message: `grace beat ${beat.id} has metrical time` });
          }
          for (const note of beat.notes) {
            dup(note.id, `note in beat ${beat.id}`);
            noteIds.add(note.id);
          }
        }
        // Voice duration should fill the bar (unless it's a pickup/incomplete bar).
        const starts = beatStartTicks(voice.beats, tupletOf);
        const last = voice.beats[voice.beats.length - 1];
        const filled = last ? starts[starts.length - 1]! + playedTicks(last, tupletOf) : 0;
        if (!implicit && voice.beats.length > 0 && Math.abs(filled - barTicks) > 1) {
          issues.push({
            code: "bar-fill",
            severity: "warning",
            message: `voice ${voice.id} fills ${filled} of ${barTicks} ticks (${part.name} bar ${barIndex})`,
          });
        }
      }
    });
  }

  // Spanner endpoints must resolve.
  for (const s of doc.spanners) {
    dup(s.id, `spanner ${s.kind}`);
    const missBeat = (id: EntityId) =>
      !beatIds.has(id) && issues.push({ code: "spanner-ref", message: `${s.kind} ${s.id} -> missing beat ${id}` });
    const missNote = (id: EntityId) =>
      !noteIds.has(id) && issues.push({ code: "spanner-ref", message: `${s.kind} ${s.id} -> missing note ${id}` });
    switch (s.kind) {
      case "tie":
        missNote(s.from.noteId);
        missNote(s.to.noteId);
        break;
      case "slur":
      case "hairpin":
      case "octave-shift":
        missBeat(s.fromBeat);
        missBeat(s.toBeat);
        break;
      case "beam":
      case "tuplet":
        for (const id of s.beatIds) missBeat(id);
        break;
    }
  }

  for (const d of doc.directions) {
    dup(d.id, "direction");
    if (d.barIndex < 0 || d.barIndex >= doc.bars.length) {
      issues.push({ code: "direction-bar", message: `direction ${d.id} bar ${d.barIndex} out of range` });
    }
  }

  return issues;
}

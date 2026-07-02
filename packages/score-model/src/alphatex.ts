import { PPQ, type Beat, type Note, type ScoreDocument, type TimeSignature } from "./types";

/**
 * Renders a ScoreDocument as alphaTex, the bridge that lets the canonical
 * model drive the alphaTab renderer.
 *
 * v0 limitations: only the first voice of each measure is emitted, ties and
 * tuplets are not yet written, and durations snap to the nearest plain or
 * dotted power-of-two value.
 */
export function toAlphaTex(doc: ScoreDocument): string {
  const lines: string[] = [];
  lines.push(`\\title ${quote(doc.title)}`);
  if (doc.composer) lines.push(`\\artist ${quote(doc.composer)}`);
  const tempo = doc.bars[0]?.tempoBpm;
  if (tempo) lines.push(`\\tempo ${tempo}`);
  lines.push(".");

  doc.parts.forEach((part, partIndex) => {
    lines.push(`\\track ${quote(part.name || `Part ${partIndex + 1}`)}`);
    if (part.midiProgram !== undefined) lines.push(`\\instrument ${part.midiProgram}`);
    lines.push("\\staff {score}");

    const barTexts: string[] = [];
    let currentTs: TimeSignature | null = null;
    for (const bar of doc.bars) {
      const measure = part.measures[bar.index];
      const beats = measure?.voices[0]?.beats ?? [];
      const parts: string[] = [];

      const ts = bar.timeSignature;
      if (!currentTs || ts.beats !== currentTs.beats || ts.beatUnit !== currentTs.beatUnit) {
        parts.push(`\\ts ${ts.beats} ${ts.beatUnit}`);
        currentTs = ts;
      }

      if (beats.length === 0) {
        parts.push(`r.${durationName(barTicks(ts))}`);
      } else {
        for (const beat of beats) parts.push(beatToTex(beat));
      }
      barTexts.push(parts.join(" "));
    }
    lines.push(barTexts.join(" |\n"));
  });

  return lines.join("\n");
}

function quote(value: string): string {
  return `"${value.replaceAll('"', "'")}"`;
}

function barTicks(ts: TimeSignature): number {
  return Math.round(ts.beats * (4 / ts.beatUnit) * PPQ);
}

function beatToTex(beat: Beat): string {
  const duration = durationName(beat.tuplet ? tupletBaseTicks(beat) : beat.durationTicks);
  const effects: string[] = [];
  if (beat.tuplet) effects.push(`tu ${beat.tuplet}`);
  if (beat.lyric) effects.push(`lyrics "${beat.lyric.replaceAll('"', "'")}"`);
  const suffix = effects.length ? `{${effects.join(" ")}}` : "";
  const core = (() => {
    if (beat.rest || beat.notes.length === 0) return `r.${duration}`;
    // A tie continuation is written as "-" placeholders: (-).4 or (- -).4.
    if (beat.notes.every((n) => n.tieStop)) {
      return `(${beat.notes.map(() => "-").join(" ")}).${duration}`;
    }
    if (beat.notes.length === 1) return `${noteToTex(beat.notes[0]!)}.${duration}`;
    return `(${beat.notes.map(noteToTex).join(" ")}).${duration}`;
  })();
  return suffix ? `${core}${suffix}` : core;
}

/** The written (pre-tuplet) duration whose N-in-time value equals the beat's actual ticks. */
function tupletBaseTicks(beat: Beat): number {
  const tuplet = beat.tuplet ?? 3;
  // A triplet eighth is written as an eighth; three fit where two would.
  const nearestPow2 = Math.pow(2, Math.round(Math.log2(tuplet)));
  return Math.round((beat.durationTicks * tuplet) / nearestPow2);
}

function noteToTex(note: Note): string {
  const accidental = note.alter > 0 ? "#".repeat(note.alter) : "b".repeat(-note.alter);
  return `${note.step.toLowerCase()}${accidental}${note.octave}`;
}

const PLAIN_DURATIONS: Array<[ticks: number, name: string]> = [
  [PPQ * 4, "1"],
  [PPQ * 2, "2"],
  [PPQ, "4"],
  [PPQ / 2, "8"],
  [PPQ / 4, "16"],
  [PPQ / 8, "32"],
  [PPQ / 16, "64"],
];

/** Nearest alphaTex duration for a tick length, preferring exact and dotted matches. */
export function durationName(ticks: number): string {
  for (const [t, name] of PLAIN_DURATIONS) {
    if (ticks === t) return name;
    if (ticks === t * 1.5) return `${name}{d}`;
  }
  let best = PLAIN_DURATIONS[0]!;
  for (const entry of PLAIN_DURATIONS) {
    if (Math.abs(entry[0] - ticks) < Math.abs(best[0] - ticks)) best = entry;
  }
  return best[1];
}

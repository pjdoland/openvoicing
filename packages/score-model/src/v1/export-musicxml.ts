import { playedTicks, tupletIndex, writtenTicks } from "./durations";
import {
  PPQ,
  type Beat,
  type Clef,
  type EntityId,
  type Measure,
  type Note,
  type Part,
  type ScoreV1,
  type Tie,
  type Tuplet,
} from "./types";

const NOTE_TYPE_XML: Record<string, string> = {
  maxima: "maxima", long: "long", breve: "breve", whole: "whole", half: "half",
  quarter: "quarter", eighth: "eighth", "16th": "16th", "32nd": "32nd",
  "64th": "64th", "128th": "128th", "256th": "256th",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Serialize a v1 document to score-partwise MusicXML at divisions=PPQ. This is
 * the export half of the round-trip contract; combined with importMusicXmlV1 it
 * lets the fidelity harness assert import→export preserves the structure.
 */
export function exportMusicXmlV1(doc: ScoreV1): string {
  const tieByNote = indexTies(doc.spanners.filter((s): s is Tie => s.kind === "tie"));
  const tuplets = doc.spanners.filter((s): s is Tuplet => s.kind === "tuplet");
  const tupletOf = tupletIndex(tuplets);
  const tupletEdge = tupletEdges(tuplets);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<score-partwise version="4.0">');
  lines.push("  <work>");
  lines.push(`    <work-title>${esc(doc.work.title)}</work-title>`);
  lines.push("  </work>");
  if (doc.work.composer) {
    lines.push("  <identification>");
    lines.push(`    <creator type="composer">${esc(doc.work.composer)}</creator>`);
    lines.push("  </identification>");
  }
  lines.push("  <part-list>");
  doc.parts.forEach((part, i) => {
    const pid = `P${i + 1}`;
    lines.push(`    <score-part id="${pid}">`);
    lines.push(`      <part-name>${esc(part.name)}</part-name>`);
    const program = part.instruments[0]?.midiProgram;
    if (program !== undefined) {
      lines.push(`      <midi-instrument id="${pid}-I1">`);
      lines.push(`        <midi-program>${program + 1}</midi-program>`);
      lines.push("      </midi-instrument>");
    }
    lines.push("    </score-part>");
  });
  lines.push("  </part-list>");

  doc.parts.forEach((part, i) => {
    lines.push(`  <part id="P${i + 1}">`);
    part.measures.forEach((measure, barIndex) => {
      lines.push(...exportMeasure(part, measure, doc, barIndex, { tieByNote, tupletOf, tupletEdge }));
    });
    lines.push("  </part>");
  });

  lines.push("</score-partwise>");
  return lines.join("\n") + "\n";
}

interface ExportCtx {
  tieByNote: Map<EntityId, { start: boolean; stop: boolean }>;
  tupletOf: (beatId: string) => Tuplet | undefined;
  tupletEdge: Map<EntityId, "start" | "stop">;
}

function exportMeasure(
  part: Part,
  measure: Measure,
  doc: ScoreV1,
  barIndex: number,
  ctx: ExportCtx,
): string[] {
  const out: string[] = [];
  const bar = doc.bars[barIndex]!;
  const numberAttr = bar.printedNumber ?? String(barIndex + 1);
  out.push(`    <measure number="${esc(numberAttr)}"${bar.implicit ? ' implicit="yes"' : ""}>`);

  const attrLines = attributeLines(part, measure, barIndex);
  if (attrLines.length) {
    out.push("      <attributes>");
    out.push(...attrLines.map((l) => "        " + l));
    out.push("      </attributes>");
  }

  if (barIndex === 0 && bar.tempoBpm) {
    out.push("      <direction placement=\"above\">");
    out.push(`        <sound tempo="${bar.tempoBpm}"/>`);
    out.push("      </direction>");
  }

  // Return the cursor to the measure start before each subsequent voice by
  // backing up exactly the previous voice's advance. A fixed bar-length backup
  // would misalign when a source voice is over- or under-full.
  let prevAdvance = 0;
  measure.voices.forEach((voice, vi) => {
    if (vi > 0 && prevAdvance > 0) {
      out.push("      <backup>");
      out.push(`        <duration>${prevAdvance}</duration>`);
      out.push("      </backup>");
    }
    let advance = 0;
    for (const beat of voice.beats) {
      out.push(...exportBeat(beat, voice.index + 1, voice.staff, ctx));
      if (!beat.grace) advance += Math.round(playedTicks(beat, ctx.tupletOf));
    }
    prevAdvance = advance;
  });

  out.push("    </measure>");
  return out;
}

function attributeLines(part: Part, measure: Measure, barIndex: number): string[] {
  const out: string[] = [];
  const a = measure.attributes;
  if (barIndex === 0) out.push(`<divisions>${PPQ}</divisions>`);
  if (a?.key) {
    out.push("<key>");
    out.push(`  <fifths>${a.key.fifths}</fifths>`);
    if (a.key.mode) out.push(`  <mode>${esc(a.key.mode)}</mode>`);
    out.push("</key>");
  }
  if (a?.time) {
    out.push(`<time${a.time.symbol ? ` symbol="${a.time.symbol}"` : ""}>`);
    out.push(`  <beats>${a.time.beats}</beats>`);
    out.push(`  <beat-type>${a.time.beatUnit}</beat-type>`);
    out.push("</time>");
  }
  if (barIndex === 0 && part.staves.length > 1) out.push(`<staves>${part.staves.length}</staves>`);
  if (barIndex === 0) {
    part.staves.forEach((staff, i) => out.push(...clefLines(staff.clef, part.staves.length > 1 ? i + 1 : undefined)));
  }
  for (const change of a?.clefs ?? []) {
    out.push(...clefLines(change.clef, part.staves.length > 1 ? change.staffIndex + 1 : undefined));
  }
  return out;
}

function clefLines(clef: Clef, staffNumber: number | undefined): string[] {
  const out: string[] = [];
  out.push(`<clef${staffNumber ? ` number="${staffNumber}"` : ""}>`);
  out.push(`  <sign>${clef.sign}</sign>`);
  out.push(`  <line>${clef.line}</line>`);
  if (clef.octaveChange) out.push(`  <clef-octave-change>${clef.octaveChange}</clef-octave-change>`);
  out.push("</clef>");
  return out;
}

function exportBeat(beat: Beat, voiceNumber: number, defaultStaff: number, ctx: ExportCtx): string[] {
  if (beat.notes.length === 0) {
    return exportNoteElement(beat, undefined, false, voiceNumber, defaultStaff, ctx);
  }
  const out: string[] = [];
  beat.notes.forEach((note, ni) => {
    out.push(...exportNoteElement(beat, note, ni > 0, voiceNumber, defaultStaff, ctx));
  });
  return out;
}

function exportNoteElement(
  beat: Beat,
  note: Note | undefined,
  isChord: boolean,
  voiceNumber: number,
  defaultStaff: number,
  ctx: ExportCtx,
): string[] {
  const out: string[] = [];
  const dur = Math.round(playedTicks(beat, ctx.tupletOf));
  const tie = note ? ctx.tieByNote.get(note.id) : undefined;
  out.push("      <note>");
  if (beat.grace) out.push(`        <grace${beat.grace.kind === "acciaccatura" ? ' slash="yes"' : ""}/>`);
  if (isChord) out.push("        <chord/>");
  if (!note) {
    out.push("        <rest/>");
  } else {
    out.push("        <pitch>");
    out.push(`          <step>${note.step}</step>`);
    if (note.alter) out.push(`          <alter>${note.alter}</alter>`);
    out.push(`          <octave>${note.octave}</octave>`);
    out.push("        </pitch>");
  }
  if (!beat.grace) out.push(`        <duration>${dur}</duration>`);
  if (tie?.stop) out.push('        <tie type="stop"/>');
  if (tie?.start) out.push('        <tie type="start"/>');
  out.push(`        <voice>${voiceNumber}</voice>`);
  out.push(`        <type>${NOTE_TYPE_XML[beat.duration.noteType]}</type>`);
  for (let d = 0; d < beat.duration.dots; d++) out.push("        <dot/>");
  const tuplet = ctx.tupletOf(beat.id);
  if (tuplet) {
    out.push("        <time-modification>");
    out.push(`          <actual-notes>${tuplet.actual}</actual-notes>`);
    out.push(`          <normal-notes>${tuplet.normal}</normal-notes>`);
    out.push("        </time-modification>");
  }
  const staff = note?.staff ?? beat.staff ?? defaultStaff;
  if (staff > 0) out.push(`        <staff>${staff + 1}</staff>`);
  const edge = ctx.tupletEdge.get(beat.id);
  if ((tie?.start || tie?.stop) || edge) {
    out.push("        <notations>");
    if (tie?.stop) out.push('          <tied type="stop"/>');
    if (tie?.start) out.push('          <tied type="start"/>');
    if (edge) out.push(`          <tuplet type="${edge}"/>`);
    out.push("        </notations>");
  }
  out.push("      </note>");
  return out;
}

function indexTies(ties: Tie[]): Map<EntityId, { start: boolean; stop: boolean }> {
  const map = new Map<EntityId, { start: boolean; stop: boolean }>();
  const get = (id: EntityId) => map.get(id) ?? { start: false, stop: false };
  for (const t of ties) {
    map.set(t.from.noteId, { ...get(t.from.noteId), start: true });
    map.set(t.to.noteId, { ...get(t.to.noteId), stop: true });
  }
  return map;
}

function tupletEdges(tuplets: Tuplet[]): Map<EntityId, "start" | "stop"> {
  const map = new Map<EntityId, "start" | "stop">();
  for (const t of tuplets) {
    const first = t.beatIds[0];
    const last = t.beatIds[t.beatIds.length - 1];
    if (first) map.set(first, "start");
    if (last) map.set(last, "stop");
  }
  return map;
}

// writtenTicks re-exported for callers that need pre-tuplet ticks.
export { writtenTicks };

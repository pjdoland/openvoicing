import { PPQ, type Beat, type ScoreDocument } from "./types";

/**
 * Serialize a ScoreDocument as MusicXML (score-partwise 4.0), the lossless
 * escape hatch for edited scores. Divisions are set to PPQ so durations map
 * to ticks one to one.
 */
export function toMusicXml(doc: ScoreDocument): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<score-partwise version="4.0">');
  out.push(`  <work><work-title>${escapeXml(doc.title)}</work-title></work>`);
  if (doc.composer) {
    out.push("  <identification>");
    out.push(`    <creator type="composer">${escapeXml(doc.composer)}</creator>`);
    out.push("  </identification>");
  }

  out.push("  <part-list>");
  doc.parts.forEach((part, i) => {
    out.push(`    <score-part id="P${i + 1}">`);
    out.push(`      <part-name>${escapeXml(part.name || `Part ${i + 1}`)}</part-name>`);
    out.push("    </score-part>");
  });
  out.push("  </part-list>");

  doc.parts.forEach((part, partIndex) => {
    out.push(`  <part id="P${partIndex + 1}">`);
    let previous: { beats: number; beatUnit: number; keyFifths: number } | null = null;
    for (const bar of doc.bars) {
      out.push(`    <measure number="${bar.index + 1}">`);
      const ts = bar.timeSignature;
      const changed =
        !previous ||
        previous.beats !== ts.beats ||
        previous.beatUnit !== ts.beatUnit ||
        previous.keyFifths !== bar.keyFifths;
      if (changed) {
        out.push("      <attributes>");
        if (!previous) out.push(`        <divisions>${PPQ}</divisions>`);
        out.push(`        <key><fifths>${bar.keyFifths}</fifths></key>`);
        out.push(
          `        <time><beats>${ts.beats}</beats><beat-type>${ts.beatUnit}</beat-type></time>`,
        );
        out.push("      </attributes>");
      }
      previous = { beats: ts.beats, beatUnit: ts.beatUnit, keyFifths: bar.keyFifths };
      if (bar.tempoBpm !== undefined) {
        out.push(`      <direction><sound tempo="${bar.tempoBpm}"/></direction>`);
      }

      const beats = part.measures[bar.index]?.voices[0]?.beats ?? [];
      for (const beat of beats) out.push(...beatToXml(beat));
      out.push("    </measure>");
    }
    out.push("  </part>");
  });

  out.push("</score-partwise>");
  return out.join("\n");
}

function beatToXml(beat: Beat): string[] {
  const out: string[] = [];
  const type = typeName(beat.durationTicks);
  if (beat.rest || beat.notes.length === 0) {
    out.push("      <note>");
    out.push("        <rest/>");
    out.push(`        <duration>${beat.durationTicks}</duration>`);
    out.push("        <voice>1</voice>");
    if (type) out.push(`        ${type}`);
    out.push("      </note>");
    return out;
  }
  beat.notes.forEach((note, i) => {
    out.push("      <note>");
    if (i > 0) out.push("        <chord/>");
    out.push("        <pitch>");
    out.push(`          <step>${note.step}</step>`);
    if (note.alter !== 0) out.push(`          <alter>${note.alter}</alter>`);
    out.push(`          <octave>${note.octave}</octave>`);
    out.push("        </pitch>");
    out.push(`        <duration>${beat.durationTicks}</duration>`);
    if (note.tieStop) out.push('        <tie type="stop"/>');
    if (note.tieStart) out.push('        <tie type="start"/>');
    out.push("        <voice>1</voice>");
    if (type) out.push(`        ${type}`);
    if (note.tieStart || note.tieStop) {
      const tied = [
        ...(note.tieStop ? ['<tied type="stop"/>'] : []),
        ...(note.tieStart ? ['<tied type="start"/>'] : []),
      ].join("");
      out.push(`        <notations>${tied}</notations>`);
    }
    out.push("      </note>");
  });
  return out;
}

const TYPE_NAMES: Array<[ticks: number, name: string]> = [
  [PPQ * 4, "whole"],
  [PPQ * 2, "half"],
  [PPQ, "quarter"],
  [PPQ / 2, "eighth"],
  [PPQ / 4, "16th"],
  [PPQ / 8, "32nd"],
  [PPQ / 16, "64th"],
];

function typeName(ticks: number): string | null {
  for (const [t, name] of TYPE_NAMES) {
    if (ticks === t) return `<type>${name}</type>`;
    if (ticks === t * 1.5) return `<type>${name}</type><dot/>`;
  }
  return null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

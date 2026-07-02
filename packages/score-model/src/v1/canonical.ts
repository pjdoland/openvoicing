import { playedTicks, tupletIndex } from "./durations";
import { PPQ, type ScoreV1, type Tuplet } from "./types";
import { attr, child, childText, children, childrenOf, parseXml, tagOf, textOf, type XmlNode } from "./xml";

/**
 * A normalized, layout-free semantic form of a score used for round-trip
 * comparison. Both the original MusicXML and our re-exported MusicXML are
 * reduced to this shape; equality means the round-trip preserved structure.
 *
 * Crucially, `canonicalizeMusicXml` parses the XML *independently* of our
 * importer (its own cursor replay). Comparing canonical(source) with
 * canonical(export(import(source))) therefore fails if the importer silently
 * dropped structure — the flaw the QA council flagged in the old harness.
 *
 * Tier-0 (structural): parts, per-bar time/key, per-voice events with sounding
 * ticks, rest flag, staff, and sorted pitches. Ornaments/dynamics are excluded.
 */
export interface CanonEvent {
  durTicks: number;
  rest: boolean;
  staff: number;
  pitches: string[];
}
export interface CanonVoice {
  voice: number;
  events: CanonEvent[];
}
export interface CanonMeasure {
  time?: { beats: number; beatUnit: number };
  key?: number;
  voices: CanonVoice[];
}
export interface CanonPart {
  measures: CanonMeasure[];
}
export interface CanonicalScore {
  title: string;
  parts: CanonPart[];
}

const pitchKey = (step: string, alter: number, octave: number) => `${step}${alter >= 0 ? "+" : ""}${alter}/${octave}`;

export function canonicalizeMusicXml(xml: string): CanonicalScore {
  const roots = parseXml(xml);
  const partwise = roots.find((n) => tagOf(n) === "score-partwise");
  if (!partwise) throw new Error("only score-partwise MusicXML is supported");
  const pw = childrenOf(partwise);
  const workNode = child(pw, "work");
  const title =
    (workNode && childText(childrenOf(workNode), "work-title")) || childText(pw, "movement-title") || "Untitled";

  const parts: CanonPart[] = children(pw, "part").map((part) => canonPart(part));
  return { title, parts };
}

function canonPart(part: XmlNode): CanonPart {
  let divisions = 1;
  let time: { beats: number; beatUnit: number } | undefined;
  let key: number | undefined;
  const measures: CanonMeasure[] = [];

  for (const xmlMeasure of children(childrenOf(part), "measure")) {
    const mc = childrenOf(xmlMeasure);
    const attrs = child(mc, "attributes");
    let measureTime: { beats: number; beatUnit: number } | undefined;
    let measureKey: number | undefined;
    if (attrs) {
      const ac = childrenOf(attrs);
      const d = childText(ac, "divisions");
      if (d) divisions = Number(d);
      const t = child(ac, "time");
      if (t) {
        const beats = Number(childText(childrenOf(t), "beats"));
        const beatUnit = Number(childText(childrenOf(t), "beat-type"));
        if (beats && beatUnit) measureTime = time = { beats, beatUnit };
      }
      const k = child(ac, "key");
      if (k) {
        const f = childText(childrenOf(k), "fifths");
        if (f !== undefined) measureKey = key = Number(f);
      }
    }
    // Emit the *effective* time/key on every measure so a carried-over value on
    // one side matches an explicit repeat on the other after normalization.
    void measureTime;
    void measureKey;

    const voiceEvents = new Map<number, CanonEvent[]>();
    const voiceEnd = new Map<number, number>(); // filled divisions per voice
    let cursor = 0;
    for (const node of mc) {
      const tag = tagOf(node);
      const nc = childrenOf(node);
      if (tag === "backup") cursor -= Number(childText(nc, "duration") ?? 0);
      else if (tag === "forward") cursor += Number(childText(nc, "duration") ?? 0);
      else if (tag === "note") cursor = canonNote(nc, cursor, divisions, voiceEvents, voiceEnd);
    }

    const voices: CanonVoice[] = [...voiceEvents.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([voice, events]) => ({ voice, events }));
    measures.push({ ...(time ? { time } : {}), ...(key !== undefined ? { key } : {}), voices });
  }
  return { measures };
}

function canonNote(
  nc: XmlNode[],
  cursor: number,
  divisions: number,
  voiceEvents: Map<number, CanonEvent[]>,
  voiceEnd: Map<number, number>,
): number {
  const isChord = !!child(nc, "chord");
  const isGrace = !!child(nc, "grace");
  const isRest = !!child(nc, "rest");
  const voice = Number(childText(nc, "voice") ?? 1);
  const staff = Number(childText(nc, "staff") ?? 1);
  const events = voiceEvents.get(voice) ?? (voiceEvents.set(voice, []).get(voice) as CanonEvent[]);

  const pitch = child(nc, "pitch");
  const pitchStr = pitch
    ? pitchKey(
        childText(childrenOf(pitch), "step") ?? "C",
        Number(childText(childrenOf(pitch), "alter") ?? 0),
        Number(childText(childrenOf(pitch), "octave") ?? 4),
      )
    : undefined;

  if (isChord) {
    const last = events[events.length - 1];
    if (last && pitchStr) {
      last.pitches.push(pitchStr);
      last.pitches.sort();
    }
    return cursor;
  }

  const durationDivs = Number(childText(nc, "duration") ?? 0);
  if (isGrace) return cursor; // grace notes carry no metrical time
  // Represent a cursor gap (from <forward> or a mid-measure voice entry) as a
  // rest, exactly as the importer does, so gappy sources compare equal.
  const filled = voiceEnd.get(voice) ?? 0;
  if (cursor > filled) {
    events.push({ durTicks: Math.round(((cursor - filled) * PPQ) / divisions), rest: true, staff, pitches: [] });
  }
  events.push({ durTicks: Math.round((durationDivs * PPQ) / divisions), rest: isRest, staff, pitches: pitchStr ? [pitchStr] : [] });
  voiceEnd.set(voice, cursor + durationDivs);
  return cursor + durationDivs;
}

/** Reduce a v1 document to the same canonical form (for testing the model). */
export function canonicalizeV1(doc: ScoreV1): CanonicalScore {
  const tupletOf = tupletIndex(doc.spanners.filter((s): s is Tuplet => s.kind === "tuplet"));
  let time: { beats: number; beatUnit: number } | undefined;
  let key: number | undefined;
  const parts: CanonPart[] = doc.parts.map((part) => {
    const measures: CanonMeasure[] = part.measures.map((measure) => {
      if (measure.attributes?.time) time = { beats: measure.attributes.time.beats, beatUnit: measure.attributes.time.beatUnit };
      if (measure.attributes?.key) key = measure.attributes.key.fifths;
      const voices: CanonVoice[] = measure.voices
        .map((voice) => ({
          voice: voice.index + 1,
          events: voice.beats.map((beat) => ({
            durTicks: Math.round(playedTicks(beat, tupletOf)),
            rest: beat.rest,
            staff: (beat.notes[0]?.staff ?? beat.staff ?? voice.staff) + 1,
            pitches: beat.notes.map((n) => pitchKey(n.step, n.alter, n.octave)).sort(),
          })),
        }))
        .sort((a, b) => a.voice - b.voice);
      return { ...(time ? { time } : {}), ...(key !== undefined ? { key } : {}), voices };
    });
    return { measures };
  });
  return { title: doc.work.title, parts };
}

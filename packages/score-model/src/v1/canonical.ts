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
  // Tier-1 notation (present only when non-empty, so tier-0 comparisons are
  // unaffected): ornaments, articulations, fermata, and slur edges.
  orn?: string[];
  art?: string[];
  fer?: true;
  slurStart?: number[];
  slurStop?: number[];
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
  pruneDanglingSlurs(measures);
  return { measures };
}

/**
 * Keep only matched slur start/stop pairs, mirroring how the importer builds
 * slur spanners. Malformed sources (e.g. freedots) can emit a stop with no
 * matching start; dropping it is correct, not a fidelity loss, so the oracle
 * must not record it either.
 */
function pruneDanglingSlurs(measures: CanonMeasure[]): void {
  const byVoice = new Map<number, CanonEvent[]>();
  for (const m of measures)
    for (const v of m.voices) {
      const arr = byVoice.get(v.voice) ?? [];
      arr.push(...v.events);
      byVoice.set(v.voice, arr);
    }
  for (const events of byVoice.values()) {
    const open = new Map<number, CanonEvent>();
    for (const e of events) {
      if (e.slurStart) for (const n of e.slurStart) open.set(n, e);
      if (e.slurStop) {
        const kept = e.slurStop.filter((n) => open.delete(n));
        if (kept.length) e.slurStop = kept;
        else delete e.slurStop;
      }
    }
    for (const [n, e] of open) {
      const kept = (e.slurStart ?? []).filter((x) => x !== n);
      if (kept.length) e.slurStart = kept;
      else delete e.slurStart;
    }
  }
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
  events.push({
    durTicks: Math.round((durationDivs * PPQ) / divisions),
    rest: isRest,
    staff,
    pitches: pitchStr ? [pitchStr] : [],
    ...readXmlNotations(nc),
  });
  voiceEnd.set(voice, cursor + durationDivs);
  return cursor + durationDivs;
}

/** Extract tier-1 notation from a note's <notations> for the canonical form. */
function readXmlNotations(nc: XmlNode[]): Partial<CanonEvent> {
  const notations = child(nc, "notations");
  if (!notations) return {};
  const nn = childrenOf(notations);
  const out: Partial<CanonEvent> = {};
  const orns = child(nn, "ornaments");
  if (orns) {
    const list = childrenOf(orns).map((o) => tagOf(o)).filter((t) => t !== "#text").sort();
    if (list.length) out.orn = list;
  }
  const arts = child(nn, "articulations");
  if (arts) {
    const list = childrenOf(arts).map((a) => tagOf(a)).filter((t) => t !== "#text").sort();
    if (list.length) out.art = list;
  }
  if (child(nn, "fermata")) out.fer = true;
  const starts: number[] = [];
  const stops: number[] = [];
  for (const s of children(nn, "slur")) {
    const num = Number(attr(s, "number") ?? 1) || 1;
    if (attr(s, "type") === "start") starts.push(num);
    else if (attr(s, "type") === "stop") stops.push(num);
  }
  if (starts.length) out.slurStart = starts.sort((a, b) => a - b);
  if (stops.length) out.slurStop = stops.sort((a, b) => a - b);
  return out;
}

/** Reduce a v1 document to the same canonical form (for testing the model). */
export function canonicalizeV1(doc: ScoreV1): CanonicalScore {
  const tupletOf = tupletIndex(doc.spanners.filter((s): s is Tuplet => s.kind === "tuplet"));
  const slurStarts = new Map<string, number[]>();
  const slurStops = new Map<string, number[]>();
  for (const s of doc.spanners) {
    if (s.kind !== "slur") continue;
    (slurStarts.get(s.fromBeat) ?? slurStarts.set(s.fromBeat, []).get(s.fromBeat)!).push(s.number);
    (slurStops.get(s.toBeat) ?? slurStops.set(s.toBeat, []).get(s.toBeat)!).push(s.number);
  }
  let time: { beats: number; beatUnit: number } | undefined;
  let key: number | undefined;
  const parts: CanonPart[] = doc.parts.map((part) => {
    const measures: CanonMeasure[] = part.measures.map((measure) => {
      if (measure.attributes?.time) time = { beats: measure.attributes.time.beats, beatUnit: measure.attributes.time.beatUnit };
      if (measure.attributes?.key) key = measure.attributes.key.fifths;
      const voices: CanonVoice[] = measure.voices
        .map((voice) => ({
          voice: voice.index + 1,
          events: voice.beats.map((beat): CanonEvent => {
            const starts = slurStarts.get(beat.id);
            const stops = slurStops.get(beat.id);
            return {
              durTicks: Math.round(playedTicks(beat, tupletOf)),
              rest: beat.rest,
              staff: (beat.notes[0]?.staff ?? beat.staff ?? voice.staff) + 1,
              pitches: beat.notes.map((n) => pitchKey(n.step, n.alter, n.octave)).sort(),
              ...(beat.ornaments?.length ? { orn: [...beat.ornaments].sort() } : {}),
              ...(beat.articulations?.length ? { art: [...beat.articulations].sort() } : {}),
              ...(beat.fermata ? { fer: true as const } : {}),
              ...(starts?.length ? { slurStart: [...starts].sort((a, b) => a - b) } : {}),
              ...(stops?.length ? { slurStop: [...stops].sort((a, b) => a - b) } : {}),
            };
          }),
        }))
        .sort((a, b) => a.voice - b.voice);
      return { ...(time ? { time } : {}), ...(key !== undefined ? { key } : {}), voices };
    });
    return { measures };
  });
  return { title: doc.work.title, parts };
}

import { newId, sequentialIdGenerator, withIdGenerator } from "../ids";
import {
  PPQ,
  SCORE_V1_FORMAT,
  type AccidentalKind,
  type BarSpec,
  type Beat,
  type Clef,
  type ClefSign,
  type Direction,
  type DurationSpec,
  type EntityId,
  type KeySignature,
  type Measure,
  type MeasureAttributes,
  type Note,
  type NoteStep,
  type NoteType,
  type Part,
  type ScoreV1,
  type Spanner,
  type Staff,
  type TimeSignature,
  type Transpose,
  type Tuplet,
  type Voice,
} from "./types";

interface PartMeta {
  name: string;
  abbreviation?: string;
  midiProgram?: number;
  midiChannel?: number;
  volume?: number;
  pan?: number;
}
import { attr, child, childText, children, childrenOf, parseXml, tagOf, textOf, type XmlNode } from "./xml";

const XML_TO_NOTE_TYPE: Record<string, NoteType> = {
  maxima: "maxima", long: "long", breve: "breve", whole: "whole", half: "half",
  quarter: "quarter", eighth: "eighth", "16th": "16th", "32nd": "32nd",
  "64th": "64th", "128th": "128th", "256th": "256th",
};

/**
 * Import score-partwise MusicXML into the full-fidelity v1 model. Unlike v0,
 * this replays the <note>/<backup>/<forward> cursor so multi-staff, multi-voice
 * writing (piano, a two-staff score) maps correctly, stores rhythm symbolically, and
 * records staves/clefs, ties, and tuplets. Notation not yet modeled (ornaments,
 * dynamics, articulations) is dropped at this tier and belongs to a later phase.
 */
export function importMusicXmlV1(xml: string, opts: { deterministic?: boolean } = {}): ScoreV1 {
  // Deterministic mode assigns counter-based ids, so re-importing the same
  // source reproduces identical ids and id-keyed state survives a reopen.
  if (opts.deterministic) return withIdGenerator(sequentialIdGenerator(), () => importMusicXmlV1(xml));
  const roots = parseXml(xml);
  const partwise = roots.find((n) => tagOf(n) === "score-partwise");
  if (!partwise) throw new Error("only score-partwise MusicXML is supported");
  const pw = childrenOf(partwise);

  const workNode = child(pw, "work");
  const title =
    (workNode && childText(childrenOf(workNode), "work-title")) ||
    childText(pw, "movement-title") ||
    "Untitled";
  const composer = findComposer(pw);

  const partMeta = new Map<string, PartMeta>();
  const partList = child(pw, "part-list");
  if (partList) {
    for (const sp of children(childrenOf(partList), "score-part")) {
      const id = attr(sp, "id") ?? "";
      const spc = childrenOf(sp);
      const name = childText(spc, "part-name") ?? id;
      const abbreviation = childText(spc, "part-abbreviation");
      const midi = child(spc, "midi-instrument");
      const mc = midi ? childrenOf(midi) : [];
      const program = Number(childText(mc, "midi-program"));
      const channel = Number(childText(mc, "midi-channel"));
      const volume = Number(childText(mc, "volume"));
      const pan = Number(childText(mc, "pan"));
      partMeta.set(id, {
        name,
        abbreviation,
        midiProgram: Number.isFinite(program) ? program - 1 : undefined,
        midiChannel: Number.isFinite(channel) ? channel - 1 : undefined,
        volume: Number.isFinite(volume) ? Math.round((volume / 100) * 127) : undefined,
        pan: Number.isFinite(pan) ? Math.round(((pan + 90) / 180) * 127) : undefined,
      });
    }
  }

  const xmlParts = children(pw, "part");
  const barCount = Math.max(0, ...xmlParts.map((p) => children(childrenOf(p), "measure").length));
  const bars = buildBarGrid(xmlParts[0], barCount);

  const parts: Part[] = [];
  const spanners: Spanner[] = [];
  const directions: Direction[] = [];
  for (const xmlPart of xmlParts) {
    const partId = attr(xmlPart, "id") ?? newId("part");
    const meta = partMeta.get(partId) ?? { name: partId };
    const { measures, staves, transpose } = importPart(xmlPart, spanners, directions);
    parts.push({
      id: newId("part"),
      name: meta.name,
      ...(meta.abbreviation ? { abbreviation: meta.abbreviation } : {}),
      instruments: [
        {
          id: newId("inst"),
          midiProgram: meta.midiProgram,
          ...(meta.midiChannel !== undefined ? { midiChannel: meta.midiChannel } : {}),
          ...(meta.volume !== undefined ? { volume: meta.volume } : {}),
          ...(meta.pan !== undefined ? { pan: meta.pan } : {}),
        },
      ],
      ...(transpose ? { transpose } : {}),
      staves,
      measures,
    });
  }

  return {
    format: SCORE_V1_FORMAT,
    formatVersion: 1,
    id: newId("score"),
    work: { title, composer },
    bars,
    parts,
    spanners,
    directions,
    unknown: [],
  };
}

function buildBarGrid(part0: XmlNode | undefined, barCount: number): BarSpec[] {
  const bars: BarSpec[] = [];
  let time: TimeSignature = { beats: 4, beatUnit: 4 };
  let divisions = 1;
  let openEnding: number[] | undefined;
  const measures = part0 ? children(childrenOf(part0), "measure") : [];
  for (let i = 0; i < barCount; i++) {
    const measureNode = measures[i];
    const mc = measureNode ? childrenOf(measureNode) : [];
    const attrs = child(mc, "attributes");
    if (attrs) {
      const ac = childrenOf(attrs);
      const d = childText(ac, "divisions");
      if (d) divisions = Number(d);
      const t = readTime(child(ac, "time"));
      if (t) time = t;
    }
    const nominal = Math.round(time.beats * (4 / time.beatUnit) * PPQ);
    const implicit = measureNode ? attr(measureNode, "implicit") === "yes" : false;
    const printedNumber = measureNode ? attr(measureNode, "number") : undefined;
    const bl = readBarlines(mc);
    if (bl.endingStart) openEnding = bl.endingStart;
    const ending = openEnding;
    if (bl.endingStop) openEnding = undefined;
    bars.push({
      id: newId("bar"),
      index: i,
      durationTicks: implicit ? measureSoundingTicks(mc, divisions) || nominal : nominal,
      tempoBpm: findTempo(mc),
      ...(implicit ? { implicit: true } : {}),
      ...(printedNumber ? { printedNumber } : {}),
      ...(bl.repeat ? { repeat: bl.repeat } : {}),
      ...(bl.barlineStyleRight ? { barlineStyleRight: bl.barlineStyleRight } : {}),
      ...(ending ? { ending } : {}),
    });
  }
  return bars;
}

const BAR_STYLES: ReadonlySet<string> = new Set([
  "regular", "dashed", "dotted", "heavy", "light-light", "light-heavy", "heavy-light", "heavy-heavy", "none", "final",
]);

/** Read <barline> repeats, endings, and bar-style from a measure. */
function readBarlines(mc: XmlNode[]): {
  repeat?: { start?: boolean; end?: boolean; times?: number };
  barlineStyleRight?: BarSpec["barlineStyleRight"];
  endingStart?: number[];
  endingStop?: boolean;
} {
  const out: ReturnType<typeof readBarlines> = {};
  for (const barline of children(mc, "barline")) {
    const bc = childrenOf(barline);
    const location = attr(barline, "location") ?? "right";
    const repeat = child(bc, "repeat");
    if (repeat) {
      const dir = attr(repeat, "direction");
      const times = Number(attr(repeat, "times"));
      if (dir === "forward") (out.repeat ??= {}).start = true;
      else if (dir === "backward") {
        out.repeat ??= {};
        out.repeat.end = true;
        if (Number.isFinite(times)) out.repeat.times = times;
      }
    }
    const ending = child(bc, "ending");
    if (ending) {
      const type = attr(ending, "type");
      if (type === "start") {
        out.endingStart = (attr(ending, "number") ?? "1")
          .split(",")
          .map((n) => Number(n.trim()))
          .filter((n) => Number.isFinite(n));
      } else if (type === "stop" || type === "discontinue") out.endingStop = true;
    }
    const style = childText(bc, "bar-style");
    if (style && location === "right" && BAR_STYLES.has(style)) {
      out.barlineStyleRight = style as BarSpec["barlineStyleRight"];
    }
  }
  return out;
}

/** Longest voice reach (in ticks) across a measure's cursor moves. */
function measureSoundingTicks(mc: XmlNode[], divisions: number): number {
  let cursor = 0;
  let max = 0;
  for (const node of mc) {
    const tag = tagOf(node);
    const nc = childrenOf(node);
    if (tag === "note") {
      if (child(nc, "chord") || child(nc, "grace")) continue;
      cursor += Number(childText(nc, "duration") ?? 0);
      max = Math.max(max, cursor);
    } else if (tag === "backup") {
      cursor -= Number(childText(nc, "duration") ?? 0);
    } else if (tag === "forward") {
      cursor += Number(childText(nc, "duration") ?? 0);
      max = Math.max(max, cursor);
    }
  }
  return Math.round((max * PPQ) / divisions);
}

interface VoiceState {
  voice: Voice;
  endDivs: number;
}

interface PartState {
  divisions: number;
  spanners: Spanner[];
  openTies: Map<string, { beatId: EntityId; noteId: EntityId }>;
  openTuplet: Tuplet | null;
  openSlurs: Map<number, EntityId>;
  pendingChord?: string;
}

const ORNAMENT_TAGS: Record<string, ArticulationOrnament["orn"]> = {
  "trill-mark": "trill-mark", mordent: "mordent", "inverted-mordent": "inverted-mordent",
  turn: "turn", "inverted-turn": "inverted-turn", "delayed-turn": "turn", schleifer: "schleifer", tremolo: "tremolo",
};
const ARTICULATION_TAGS: Record<string, ArticulationOrnament["art"]> = {
  staccato: "staccato", staccatissimo: "staccatissimo", accent: "accent",
  "strong-accent": "strong-accent", tenuto: "tenuto", "detached-legato": "detached-legato",
};
type ArticulationOrnament = { orn: NonNullable<Beat["ornaments"]>[number]; art: NonNullable<Beat["articulations"]>[number] };

function importPart(
  xmlPart: XmlNode,
  spanners: Spanner[],
  directions: Direction[],
): { measures: Measure[]; staves: Staff[]; transpose?: Transpose } {
  const measures: Measure[] = [];
  const staffClefs = new Map<number, Clef>();
  const staffTab = new Map<number, TabDetails>();
  let staffCount = 1;
  let transpose: Transpose | undefined;
  const state: PartState = {
    divisions: 1, spanners, openTies: new Map(), openTuplet: null, openSlurs: new Map(),
  };

  for (const [barIndex, xmlMeasure] of children(childrenOf(xmlPart), "measure").entries()) {
    const mc = childrenOf(xmlMeasure);
    const measureAttrs = readMeasureAttributes(mc, state, staffClefs, staffTab, (n) => (staffCount = n));
    transpose ??= readTranspose(mc);

    const voices = new Map<string, VoiceState>();
    const voiceOrder: string[] = [];
    state.openTuplet = null;
    let cursor = 0;

    const ensureVoice = (key: string, staff: number): VoiceState => {
      let vs = voices.get(key);
      if (!vs) {
        // Preserve the MusicXML voice number as the index; voices can appear
        // out of numeric order, so insertion order would mislabel them.
        const num = Number(key);
        const index = Number.isFinite(num) && num > 0 ? num - 1 : voiceOrder.length;
        vs = { voice: { id: newId("voice"), index, staff, beats: [] }, endDivs: 0 };
        voices.set(key, vs);
        voiceOrder.push(key);
      }
      return vs;
    };

    for (const node of mc) {
      const tag = tagOf(node);
      const nc = childrenOf(node);
      if (tag === "backup") cursor -= Number(childText(nc, "duration") ?? 0);
      else if (tag === "forward") cursor += Number(childText(nc, "duration") ?? 0);
      else if (tag === "note") cursor = importNote(nc, cursor, state, ensureVoice);
      else if (tag === "harmony") state.pendingChord = readHarmony(nc);
      else if (tag === "direction") {
        const dir = readDirection(nc, barIndex, Math.round((cursor * PPQ) / state.divisions));
        if (dir) directions.push(dir);
      }
    }

    measures.push({
      id: newId("measure"),
      barIndex,
      ...(Object.keys(measureAttrs).length ? { attributes: measureAttrs } : {}),
      voices: voiceOrder.map((k) => voices.get(k)!.voice),
    });
  }

  const staves: Staff[] = [];
  for (let i = 0; i < staffCount; i++) {
    const tab = staffTab.get(i);
    staves.push({
      id: newId("staff"),
      index: i,
      lines: tab?.lines ?? (tab?.tuning ? tab.tuning.length : 5),
      clef: staffClefs.get(i) ?? (i === 1 ? { sign: "F", line: 4 } : { sign: "G", line: 2 }),
      ...(tab?.tab ? { showTablature: true } : {}),
      ...(tab?.tuning ? { tuning: tab.tuning } : {}),
      ...(tab?.capo ? { capo: tab.capo } : {}),
    });
  }
  return { measures, staves, transpose };
}

interface TabDetails {
  tab?: boolean;
  tuning?: number[];
  capo?: number;
  lines?: number;
}

const STEP_TO_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Read <staff-details> tuning/capo/lines and TAB clef into per-staff details. */
function readStaffTab(ac: XmlNode[], staffTab: Map<number, TabDetails>): void {
  for (const clefNode of children(ac, "clef")) {
    if (childText(childrenOf(clefNode), "sign") === "TAB") {
      const idx = (Number(attr(clefNode, "number") ?? 1) || 1) - 1;
      (staffTab.get(idx) ?? staffTab.set(idx, {}).get(idx)!).tab = true;
    }
  }
  for (const details of children(ac, "staff-details")) {
    const idx = (Number(attr(details, "number") ?? 1) || 1) - 1;
    const info = staffTab.get(idx) ?? staffTab.set(idx, {}).get(idx)!;
    const dc = childrenOf(details);
    const lines = childText(dc, "staff-lines");
    if (lines) info.lines = Number(lines);
    const capo = childText(dc, "capo");
    if (capo) info.capo = Number(capo);
    const tunings = children(dc, "staff-tuning");
    if (tunings.length) {
      // Map staff-tuning line (1 = bottom = lowest string) to string 1 = highest.
      const byLine = new Map<number, number>();
      for (const st of tunings) {
        const stc = childrenOf(st);
        const step = childText(stc, "tuning-step") ?? "E";
        const octave = Number(childText(stc, "tuning-octave") ?? 2);
        const alter = Number(childText(stc, "tuning-alter") ?? 0);
        byLine.set(Number(attr(st, "line") ?? 1), (octave + 1) * 12 + STEP_TO_SEMITONE[step]! + alter);
      }
      const maxLine = Math.max(...byLine.keys());
      const tuning: number[] = [];
      for (let line = maxLine; line >= 1; line--) tuning.push(byLine.get(line) ?? 0);
      info.tuning = tuning;
    }
  }
}

/** Read a part's <attributes><transpose> (written->sounding pitch offset). */
function readTranspose(mc: XmlNode[]): Transpose | undefined {
  const attrs = child(mc, "attributes");
  if (!attrs) return undefined;
  const t = child(childrenOf(attrs), "transpose");
  if (!t) return undefined;
  const tc = childrenOf(t);
  const chromatic = Number(childText(tc, "chromatic") ?? 0);
  const diatonic = Number(childText(tc, "diatonic") ?? 0);
  const octaveChange = Number(childText(tc, "octave-change") ?? 0);
  if (!chromatic && !diatonic && !octaveChange) return undefined;
  return { diatonic, chromatic, ...(octaveChange ? { octaveChange } : {}) };
}

function readMeasureAttributes(
  mc: XmlNode[],
  state: PartState,
  staffClefs: Map<number, Clef>,
  staffTab: Map<number, TabDetails>,
  setStaffCount: (n: number) => void,
): MeasureAttributes {
  const out: MeasureAttributes = {};
  const attrsNode = child(mc, "attributes");
  if (!attrsNode) return out;
  const ac = childrenOf(attrsNode);
  readStaffTab(ac, staffTab);
  const d = childText(ac, "divisions");
  if (d) state.divisions = Number(d);
  const staves = childText(ac, "staves");
  if (staves) setStaffCount(Number(staves));
  const t = readTime(child(ac, "time"));
  if (t) out.time = t;
  const k = readKey(child(ac, "key"));
  if (k) out.key = k;
  for (const clefNode of children(ac, "clef")) {
    const staffIndex = (Number(attr(clefNode, "number") ?? 1) || 1) - 1;
    const clef = readClef(clefNode);
    const wasKnown = staffClefs.has(staffIndex);
    staffClefs.set(staffIndex, clef);
    if (wasKnown) (out.clefs ??= []).push({ staffIndex, clef });
  }
  return out;
}

/** Import one <note>; returns the new cursor position (in divisions). */
function importNote(
  nc: XmlNode[],
  cursor: number,
  state: PartState,
  ensureVoice: (key: string, staff: number) => VoiceState,
): number {
  const isGrace = !!child(nc, "grace");
  const isChord = !!child(nc, "chord");
  const isRest = !!child(nc, "rest");
  const staff = Math.max(0, Number(childText(nc, "staff") ?? 1) - 1);
  const voiceKey = childText(nc, "voice") ?? "1";
  const vs = ensureVoice(voiceKey, staff);

  if (isChord) {
    const last = vs.voice.beats[vs.voice.beats.length - 1];
    const note = readPitch(nc, staff);
    if (last && note) {
      last.notes.push(note);
      linkTie(nc, note, last.id, state, staff, voiceKey);
      // Slurs/ornaments can be authored on a chord note; capture them too.
      readNotations(nc, last, state);
    }
    return cursor;
  }

  const durationDivs = Number(childText(nc, "duration") ?? 0);
  const duration = readDuration(nc, durationDivs, state.divisions);
  const divToTicks = (dv: number) => Math.round((dv * PPQ) / state.divisions);

  // Fill a gap left by <forward> or a mid-measure voice entry with a rest.
  if (!isGrace && divToTicks(cursor) > divToTicks(vs.endDivs) + 1) {
    vs.voice.beats.push(makeRest(cursor - vs.endDivs, state.divisions));
    vs.endDivs = cursor;
  }

  const graceNode = child(nc, "grace");
  const beat: Beat = {
    id: newId("beat"),
    duration,
    rest: isRest,
    notes: [],
    ...(graceNode
      ? { grace: { kind: attr(graceNode, "slash") === "yes" ? "acciaccatura" : "appoggiatura" } }
      : {}),
    ...(!isGrace && staff > 0 ? { staff } : {}),
  };
  if (!isRest) {
    const note = readPitch(nc, staff);
    if (note) {
      beat.notes.push(note);
      linkTie(nc, note, beat.id, state, staff, voiceKey);
    }
  }
  if (!isChord && !isGrace && state.pendingChord) {
    beat.chordSymbol = state.pendingChord;
    state.pendingChord = undefined;
  }
  vs.voice.beats.push(beat);
  registerTuplet(nc, beat.id, state);
  readNotations(nc, beat, state);

  if (isGrace) return cursor;
  vs.endDivs = cursor + durationDivs;
  return cursor + durationDivs;
}

function makeRest(divs: number, divisions: number): Beat {
  return {
    id: newId("beat"),
    duration: ticksToDuration(Math.round((divs * PPQ) / divisions)),
    rest: true,
    notes: [],
  };
}

function readPitch(nc: XmlNode[], staff: number): Note | undefined {
  const pitch = child(nc, "pitch");
  if (!pitch) return undefined;
  const pc = childrenOf(pitch);
  const acc = childText(nc, "accidental");
  // Tablature string/fret from <notations><technical>.
  const notations = child(nc, "notations");
  const technical = notations ? child(childrenOf(notations), "technical") : undefined;
  const tc = technical ? childrenOf(technical) : [];
  const string = childText(tc, "string");
  const fret = childText(tc, "fret");
  return {
    id: newId("note"),
    step: (childText(pc, "step") ?? "C") as NoteStep,
    alter: Number(childText(pc, "alter") ?? 0),
    octave: Number(childText(pc, "octave") ?? 4),
    ...(acc ? { accidental: { kind: acc as AccidentalKind } } : {}),
    ...(staff > 0 ? { staff } : {}),
    ...(string ? { string: Number(string) } : {}),
    ...(fret ? { fret: Number(fret) } : {}),
  };
}

function linkTie(
  nc: XmlNode[],
  note: Note,
  beatId: EntityId,
  state: PartState,
  staff: number,
  voiceKey: string,
): void {
  const ties = children(nc, "tie");
  const key = `${voiceKey}:${staff}:${note.step}${note.alter}:${note.octave}`;
  if (ties.some((t) => attr(t, "type") === "stop")) {
    const open = state.openTies.get(key);
    if (open) {
      state.spanners.push({ id: newId("tie"), kind: "tie", from: open, to: { beatId, noteId: note.id } });
      state.openTies.delete(key);
    }
  }
  if (ties.some((t) => attr(t, "type") === "start")) {
    state.openTies.set(key, { beatId, noteId: note.id });
  }
}

/** Read slurs, ornaments, articulations, and fermatas from a note's <notations>. */
function readNotations(nc: XmlNode[], beat: Beat, state: PartState): void {
  const notations = child(nc, "notations");
  if (!notations) return;
  const nn = childrenOf(notations);

  for (const slur of children(nn, "slur")) {
    const number = Number(attr(slur, "number") ?? 1) || 1;
    const type = attr(slur, "type");
    if (type === "start") state.openSlurs.set(number, beat.id);
    else if (type === "stop") {
      const from = state.openSlurs.get(number);
      if (from) {
        state.spanners.push({ id: newId("slur"), kind: "slur", number, fromBeat: from, toBeat: beat.id });
        state.openSlurs.delete(number);
      }
    }
  }

  const ornamentsNode = child(nn, "ornaments");
  if (ornamentsNode) {
    for (const orn of childrenOf(ornamentsNode)) {
      const mapped = ORNAMENT_TAGS[tagOf(orn)];
      if (mapped) (beat.ornaments ??= []).push(mapped);
    }
  }

  const articulationsNode = child(nn, "articulations");
  if (articulationsNode) {
    for (const art of childrenOf(articulationsNode)) {
      const mapped = ARTICULATION_TAGS[tagOf(art)];
      if (mapped) (beat.articulations ??= []).push(mapped);
    }
  }

  if (child(nn, "fermata")) beat.fermata = true;
}

function registerTuplet(nc: XmlNode[], beatId: EntityId, state: PartState): void {
  const tm = child(nc, "time-modification");
  if (!tm) return;
  const tmc = childrenOf(tm);
  const actual = Number(childText(tmc, "actual-notes") ?? 0);
  const normal = Number(childText(tmc, "normal-notes") ?? 0);
  if (!actual || !normal) return;
  const notations = child(nc, "notations");
  const type = notations ? attr(child(childrenOf(notations), "tuplet") ?? {}, "type") : undefined;
  if (type === "start" || !state.openTuplet) {
    state.openTuplet = { id: newId("tuplet"), kind: "tuplet", beatIds: [beatId], actual, normal };
    state.spanners.push(state.openTuplet);
  } else {
    state.openTuplet.beatIds.push(beatId);
  }
  if (type === "stop") state.openTuplet = null;
}

function readDuration(nc: XmlNode[], durationDivs: number, divisions: number): DurationSpec {
  const typeText = childText(nc, "type");
  const type = typeText ? XML_TO_NOTE_TYPE[typeText] : undefined;
  if (type) return { noteType: type, dots: children(nc, "dot").length };
  return ticksToDuration(Math.round((durationDivs * PPQ) / divisions));
}

const DURATION_TABLE: Array<[ticks: number, spec: DurationSpec]> = (() => {
  const wholes: Record<string, number> = {
    whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625,
  };
  const rows: Array<[number, DurationSpec]> = [];
  for (const [t, w] of Object.entries(wholes)) {
    const base = w * PPQ;
    rows.push([base, { noteType: t as NoteType, dots: 0 }]);
    rows.push([base * 1.5, { noteType: t as NoteType, dots: 1 }]);
  }
  return rows.sort((a, b) => b[0] - a[0]);
})();

/** Nearest symbolic value for a tick length (fallback when <type> is absent). */
function ticksToDuration(ticks: number): DurationSpec {
  for (const [t, spec] of DURATION_TABLE) if (Math.abs(t - ticks) < 1) return spec;
  let best = DURATION_TABLE[0]!;
  for (const row of DURATION_TABLE) if (Math.abs(row[0] - ticks) < Math.abs(best[0] - ticks)) best = row;
  return best[1];
}

function readTime(node: XmlNode | undefined): TimeSignature | undefined {
  if (!node) return undefined;
  const c = childrenOf(node);
  const beats = Number(childText(c, "beats"));
  const beatUnit = Number(childText(c, "beat-type"));
  if (!beats || !beatUnit) return undefined;
  const symbol = attr(node, "symbol");
  return { beats, beatUnit, ...(symbol ? { symbol: symbol as TimeSignature["symbol"] } : {}) };
}

function readKey(node: XmlNode | undefined): KeySignature | undefined {
  if (!node) return undefined;
  const c = childrenOf(node);
  const fifths = childText(c, "fifths");
  if (fifths === undefined) return undefined;
  const mode = childText(c, "mode");
  return { fifths: Number(fifths), ...(mode ? { mode } : {}) };
}

function readClef(node: XmlNode): Clef {
  const c = childrenOf(node);
  const sign = (childText(c, "sign") ?? "G") as ClefSign;
  const line = Number(childText(c, "line") ?? (sign === "F" ? 4 : sign === "C" ? 3 : 2));
  const oct = childText(c, "clef-octave-change");
  return { sign, line, ...(oct ? { octaveChange: Number(oct) } : {}) };
}

const KIND_SUFFIX: Record<string, string> = {
  major: "", minor: "m", augmented: "aug", diminished: "dim", dominant: "7",
  "major-seventh": "maj7", "minor-seventh": "m7", "diminished-seventh": "dim7",
  "half-diminished": "m7b5", "major-sixth": "6", "minor-sixth": "m6",
  "dominant-ninth": "9", "major-ninth": "maj9", "minor-ninth": "m9",
  "suspended-fourth": "sus4", "suspended-second": "sus2", power: "5", none: "",
};

function alterSym(alter: number): string {
  return alter > 0 ? "#".repeat(alter) : alter < 0 ? "b".repeat(-alter) : "";
}

/** Read a <harmony> into a chord-symbol string (e.g. "Cmaj7", "G/B"). */
function readHarmony(nc: XmlNode[]): string | undefined {
  const root = child(nc, "root");
  if (!root) return undefined;
  const rc = childrenOf(root);
  let text = (childText(rc, "root-step") ?? "C") + alterSym(Number(childText(rc, "root-alter") ?? 0));
  const kindNode = child(nc, "kind");
  const kindText = kindNode ? attr(kindNode, "text") : undefined;
  const kindVal = kindNode ? textOf(kindNode) ?? "major" : "major";
  text += kindText ?? KIND_SUFFIX[kindVal] ?? "";
  const bass = child(nc, "bass");
  if (bass) {
    const bc = childrenOf(bass);
    text += "/" + (childText(bc, "bass-step") ?? "") + alterSym(Number(childText(bc, "bass-alter") ?? 0));
  }
  return text;
}

/** Read a <direction> (dynamics / words / metronome / rehearsal) into a Direction. */
function readDirection(nc: XmlNode[], barIndex: number, tick: number): Direction | undefined {
  const dt = child(nc, "direction-type");
  if (!dt) return undefined;
  const dtc = childrenOf(dt);
  const id = newId("dir");
  const staffText = childText(nc, "staff");
  const staff = staffText ? Number(staffText) - 1 : undefined;
  const base = { id, barIndex, tick, ...(staff !== undefined ? { staff } : {}) };
  const dynamics = child(dtc, "dynamics");
  if (dynamics) {
    const value = childrenOf(dynamics).map(tagOf).find((t) => t !== "#text");
    if (value) return { ...base, placement: "below", content: { kind: "dynamics", value } };
  }
  const words = child(dtc, "words");
  if (words) {
    const text = textOf(words);
    if (text) return { ...base, placement: "above", content: { kind: "words", text } };
  }
  const rehearsal = child(dtc, "rehearsal");
  if (rehearsal) {
    const text = textOf(rehearsal);
    if (text) return { ...base, placement: "above", content: { kind: "rehearsal", text } };
  }
  const metronome = child(dtc, "metronome");
  if (metronome) {
    const mc = childrenOf(metronome);
    const noteType = XML_TO_NOTE_TYPE[childText(mc, "beat-unit") ?? "quarter"] ?? "quarter";
    const perMinute = Number(childText(mc, "per-minute") ?? 0);
    if (perMinute) {
      return { ...base, placement: "above", content: { kind: "metronome", noteType, dots: children(mc, "beat-unit-dot").length, perMinute } };
    }
  }
  return undefined;
}

function findTempo(mc: XmlNode[]): number | undefined {
  // Guard against a malformed tempo attribute yielding NaN in the tempo map.
  const parse = (node: XmlNode | undefined): number | undefined => {
    const raw = node && attr(node, "tempo");
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  for (const d of children(mc, "direction")) {
    const t = parse(child(childrenOf(d), "sound"));
    if (t !== undefined) return t;
  }
  return parse(child(mc, "sound"));
}

function findComposer(pw: XmlNode[]): string | undefined {
  const ident = child(pw, "identification");
  if (!ident) return undefined;
  for (const creator of children(childrenOf(ident), "creator")) {
    if (attr(creator, "type") === "composer") return textOf(creator);
  }
  const first = child(childrenOf(ident), "creator");
  return first ? textOf(first) : undefined;
}

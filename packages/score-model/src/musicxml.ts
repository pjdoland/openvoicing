import { XMLParser } from "fast-xml-parser";
import { newId } from "./ids";
import {
  PPQ,
  SCORE_FORMAT,
  SCORE_FORMAT_VERSION,
  type BarSpec,
  type Beat,
  type Measure,
  type Note,
  type NoteStep,
  type Part,
  type ScoreDocument,
  type TimeSignature,
  type Voice,
} from "./types";

const ALWAYS_ARRAY = new Set(["part", "measure", "note", "score-part", "direction", "tie"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ALWAYS_ARRAY.has(name),
});

interface XmlNote {
  rest?: unknown;
  chord?: unknown;
  grace?: unknown;
  pitch?: { step: NoteStep; alter?: number; octave: number };
  duration?: number;
  voice?: number | string;
  tie?: Array<{ "@_type"?: string }>;
}

/**
 * Import a MusicXML (score-partwise) string into an OpenVoicing ScoreDocument.
 *
 * v0 limitations: voices are reconstructed by grouping notes per voice number in
 * document order (backup/forward cursors are not replayed), grace notes are
 * skipped, and unsupported elements are dropped rather than preserved.
 */
export function importMusicXml(xml: string): ScoreDocument {
  const root = parser.parse(xml);
  const partwise = root["score-partwise"];
  if (!partwise) throw new Error("only score-partwise MusicXML is supported");

  const title: string =
    partwise.work?.["work-title"] ?? partwise["movement-title"] ?? "Untitled";
  const composer = findComposer(partwise);

  const partNames = new Map<string, string>();
  const scoreParts = partwise["part-list"]?.["score-part"] ?? [];
  for (const sp of scoreParts) {
    partNames.set(String(sp["@_id"]), String(sp["part-name"] ?? sp["@_id"]));
  }

  const xmlParts: Array<{ "@_id": string; measure?: unknown[] }> = partwise.part ?? [];
  const barCount = Math.max(0, ...xmlParts.map((p) => p.measure?.length ?? 0));

  const bars: BarSpec[] = [];
  const parts: Part[] = [];

  let time: TimeSignature = { beats: 4, beatUnit: 4 };
  let keyFifths = 0;

  for (let i = 0; i < barCount; i++) {
    const firstPartMeasure = (xmlParts[0]?.measure?.[i] ?? {}) as Record<string, unknown>;
    const attrs = firstPartMeasure["attributes"] as Record<string, unknown> | undefined;
    const timeAttr = attrs?.["time"] as { beats?: number; "beat-type"?: number } | undefined;
    if (timeAttr?.beats && timeAttr["beat-type"]) {
      time = { beats: Number(timeAttr.beats), beatUnit: Number(timeAttr["beat-type"]) };
    }
    const keyAttr = attrs?.["key"] as { fifths?: number } | undefined;
    if (keyAttr?.fifths !== undefined) keyFifths = Number(keyAttr.fifths);

    bars.push({
      id: newId("bar"),
      index: i,
      timeSignature: time,
      keyFifths,
      tempoBpm: findTempo(firstPartMeasure),
    });
  }

  for (const xmlPart of xmlParts) {
    const partId = String(xmlPart["@_id"]);
    const measures: Measure[] = [];
    let divisions = 1;

    (xmlPart.measure ?? []).forEach((rawMeasure, barIndex) => {
      const m = rawMeasure as Record<string, unknown>;
      const attrs = m["attributes"] as Record<string, unknown> | undefined;
      if (attrs?.["divisions"]) divisions = Number(attrs["divisions"]);

      const voices = new Map<string, { voice: Voice; tick: number }>();
      const notes = (m["note"] ?? []) as XmlNote[];

      for (const xmlNote of notes) {
        if (xmlNote.grace !== undefined || xmlNote.duration === undefined) continue;
        const voiceKey = String(xmlNote.voice ?? 1);
        let entry = voices.get(voiceKey);
        if (!entry) {
          entry = { voice: { id: newId("voice"), beats: [] }, tick: 0 };
          voices.set(voiceKey, entry);
        }
        const durationTicks = Math.round((Number(xmlNote.duration) * PPQ) / divisions);
        const isChordContinuation =
          xmlNote.chord !== undefined && entry.voice.beats.length > 0;

        if (isChordContinuation) {
          const lastBeat = entry.voice.beats[entry.voice.beats.length - 1]!;
          const note = toNote(xmlNote);
          if (note) lastBeat.notes.push(note);
          continue;
        }

        const beat: Beat = {
          id: newId("beat"),
          startTick: entry.tick,
          durationTicks,
          rest: xmlNote.rest !== undefined,
          notes: [],
        };
        const note = toNote(xmlNote);
        if (note) beat.notes.push(note);
        entry.voice.beats.push(beat);
        entry.tick += durationTicks;
      }

      measures.push({
        id: newId("measure"),
        barIndex,
        voices: [...voices.values()].map((v) => v.voice),
      });
    });

    parts.push({
      id: newId("part"),
      name: partNames.get(partId) ?? partId,
      measures,
    });
  }

  return {
    format: SCORE_FORMAT,
    formatVersion: SCORE_FORMAT_VERSION,
    id: newId("score"),
    title,
    composer,
    bars,
    parts,
  };
}

function toNote(xmlNote: XmlNote): Note | undefined {
  if (!xmlNote.pitch) return undefined;
  const ties = xmlNote.tie ?? [];
  return {
    id: newId("note"),
    step: xmlNote.pitch.step,
    alter: Number(xmlNote.pitch.alter ?? 0),
    octave: Number(xmlNote.pitch.octave),
    ...(ties.some((t) => t["@_type"] === "start") ? { tieStart: true } : {}),
    ...(ties.some((t) => t["@_type"] === "stop") ? { tieStop: true } : {}),
  };
}

function findTempo(measure: Record<string, unknown>): number | undefined {
  const directions = (measure["direction"] ?? []) as Array<Record<string, unknown>>;
  for (const d of directions) {
    const sound = d["sound"] as Record<string, unknown> | undefined;
    if (sound?.["@_tempo"] !== undefined) return Number(sound["@_tempo"]);
  }
  const sound = measure["sound"] as Record<string, unknown> | undefined;
  if (sound?.["@_tempo"] !== undefined) return Number(sound["@_tempo"]);
  return undefined;
}

function findComposer(partwise: Record<string, unknown>): string | undefined {
  const identification = partwise["identification"] as Record<string, unknown> | undefined;
  const creator = identification?.["creator"];
  if (typeof creator === "string") return creator;
  if (creator && typeof creator === "object" && "#text" in creator) {
    return String((creator as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

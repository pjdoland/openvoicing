import * as alphaTab from "@coderline/alphatab";
import { v1 } from "@openvoicing/score-model";

/**
 * Convert a full-fidelity v1 document into an alphaTab Score for rendering.
 * This is the model→render projection at the heart of Option C: the v1 model is
 * the source of truth; alphaTab is a (re-buildable) render target. Pass the
 * result to Player.renderScore, which runs the finish pipeline.
 */
export function toAlphaTabScore(doc: v1.ScoreV1): alphaTab.model.Score {
  const m = alphaTab.model;
  const score = new m.Score();
  score.title = doc.work.title;
  if (doc.work.composer) score.artist = doc.work.composer;
  // Model beat id -> built alphaTab beat, for wiring slur spanners afterward.
  const beatMap = new Map<string, alphaTab.model.Beat>();
  // Effective per-bar time signature comes from any part's measure attributes.
  const timeByBar = effectiveTimes(doc);
  doc.bars.forEach((bar, i) => {
    const mb = new m.MasterBar();
    const ts = timeByBar[i]!;
    mb.timeSignatureNumerator = ts.beats;
    mb.timeSignatureDenominator = ts.beatUnit;
    // Score.tempo is read-only; tempo lives on master-bar automations.
    if (bar.tempoBpm) mb.tempoAutomations = [m.Automation.buildTempoAutomation(false, 0, bar.tempoBpm, 2, true)];
    if (bar.repeat?.start) mb.isRepeatStart = true;
    if (bar.repeat?.end) mb.repeatCount = bar.repeat.times && bar.repeat.times > 1 ? bar.repeat.times : 2;
    if (bar.ending?.length) mb.alternateEndings = bar.ending.reduce((mask, n) => mask | (1 << (n - 1)), 0);
    score.addMasterBar(mb);
  });

  // Allocate a distinct channel per call, skipping 9 (percussion). Each track
  // needs two DIFFERENT channels (primary for notes, secondary for effects and
  // note-offs) -- collapsing them to one silences playback.
  let nextChannel = 0;
  const takeChannel = () => {
    while (nextChannel === 9) nextChannel++;
    return nextChannel++ % 16;
  };

  for (const part of doc.parts) {
    const track = new m.Track();
    track.name = part.name;
    if (part.abbreviation) track.shortName = part.abbreviation;
    const inst = part.instruments[0];
    if (inst?.midiProgram !== undefined) track.playbackInfo.program = inst.midiProgram;
    // Distinct channels per track so parts don't collide; percussion on 9.
    if (inst?.unpitched) {
      track.playbackInfo.primaryChannel = 9;
      track.playbackInfo.secondaryChannel = 9;
    } else {
      track.playbackInfo.primaryChannel = takeChannel();
      track.playbackInfo.secondaryChannel = takeChannel();
    }
    if (inst?.volume !== undefined) track.playbackInfo.volume = Math.round((inst.volume / 127) * 16);
    if (inst?.pan !== undefined) track.playbackInfo.balance = Math.round((inst.pan / 127) * 16);
    score.addTrack(track);

    // Transposing instruments: shift playback so written pitch sounds correctly.
    const transposePitch = part.transpose
      ? part.transpose.chromatic + (part.transpose.octaveChange ?? 0) * 12
      : 0;

    const tupletOf = v1.tupletIndex(doc.spanners.filter((s): s is v1.Tuplet => s.kind === "tuplet"));
    part.staves.forEach((staffModel, staffIndex) => {
      const staff = new m.Staff();
      if (transposePitch) staff.transpositionPitch = transposePitch;
      if (staffModel.showTablature) {
        staff.showTablature = true;
        staff.showStandardNotation = false;
        if (staffModel.tuning?.length) {
          const tuning = new m.Tuning();
          tuning.tunings = [...staffModel.tuning];
          staff.stringTuning = tuning;
        }
        if (staffModel.capo) staff.capo = staffModel.capo;
      }
      track.addStaff(staff);
      // alphaTab chains voices by index across bars, so every bar on a staff
      // must carry the same number of voices (consolidate() normally does this,
      // but it isn't exported). Pad with full-bar rests.
      const maxVoices = Math.max(
        1,
        ...part.measures.map((me) => me.voices.filter((v) => v.staff === staffIndex).length),
      );
      let currentClef = staffModel.clef;
      let currentKeyFifths = 0;
      let currentKeyMinor = false;
      part.measures.forEach((measure, barIndex) => {
        const change = measure.attributes?.clefs?.find((c) => c.staffIndex === staffModel.index);
        if (change) currentClef = change.clef;
        const key = measure.attributes?.key;
        if (key) {
          currentKeyFifths = key.fifths;
          currentKeyMinor = key.mode === "minor";
        }
        const bar = new m.Bar();
        bar.clef = toAlphaClef(currentClef);
        // KeySignature enum values are the fifths (-7..7); carry forward like clef.
        bar.keySignature = currentKeyFifths as alphaTab.model.KeySignature;
        bar.keySignatureType = currentKeyMinor ? m.KeySignatureType.Minor : m.KeySignatureType.Major;
        staff.addBar(bar);
        const voices = measure.voices.filter((v) => v.staff === staffIndex);
        const barTicks = doc.bars[barIndex]?.durationTicks ?? 4 * v1.PPQ;
        for (let vi = 0; vi < maxVoices; vi++) {
          const voice = new m.Voice();
          bar.addVoice(voice);
          const vm = voices[vi];
          if (vm && vm.beats.length > 0) {
            for (const beatModel of vm.beats) voice.addBeat(toBeat(beatModel, tupletOf, beatMap));
          } else {
            voice.addBeat(fullBarRest(barTicks));
          }
        }
      });
    });
  }

  // Wire slur spanners as beat-level effect slurs once all beats exist.
  for (const spanner of doc.spanners) {
    if (spanner.kind !== "slur") continue;
    const from = beatMap.get(spanner.fromBeat);
    const to = beatMap.get(spanner.toBeat);
    if (from && to) {
      from.isEffectSlurOrigin = true;
      from.effectSlurDestination = to;
      to.effectSlurOrigin = from;
    }
  }

  return score;
}

const NOTE_ORNAMENT: Record<string, number> = {
  mordent: 4, // LowerMordent
  "inverted-mordent": 3, // UpperMordent
  turn: 2, // Turn
  "inverted-turn": 1, // InvertedTurn
};

function effectiveTimes(doc: v1.ScoreV1): v1.TimeSignature[] {
  const out: v1.TimeSignature[] = [];
  let current: v1.TimeSignature = { beats: 4, beatUnit: 4 };
  for (let i = 0; i < doc.bars.length; i++) {
    for (const part of doc.parts) {
      const t = part.measures[i]?.attributes?.time;
      if (t) current = t;
    }
    out.push(current);
  }
  return out;
}

function toAlphaClef(clef: v1.Clef): alphaTab.model.Clef {
  const C = alphaTab.model.Clef;
  if (clef.sign === "F") return C.F4;
  if (clef.sign === "C") return clef.line >= 4 ? C.C4 : C.C3;
  if (clef.sign === "percussion" || clef.sign === "none") return C.Neutral;
  return C.G2;
}

/** A single rest beat sized to fill a bar of the given tick length. */
function fullBarRest(barTicks: number): alphaTab.model.Beat {
  const beat = new alphaTab.model.Beat();
  const types: v1.NoteType[] = ["whole", "half", "quarter", "eighth", "16th"];
  for (const noteType of types) {
    for (let dots = 0; dots <= 2; dots++) {
      if (Math.abs(v1.writtenTicks({ noteType, dots }) - barTicks) < 1) {
        beat.duration = DURATION_MAP[noteType]!;
        beat.dots = dots;
        return beat;
      }
    }
  }
  beat.duration = alphaTab.model.Duration.Whole;
  return beat;
}

const DURATION_MAP: Record<string, number> = {
  maxima: -4, long: -4, breve: -2, whole: 1, half: 2, quarter: 4,
  eighth: 8, "16th": 16, "32nd": 32, "64th": 64, "128th": 128, "256th": 256,
};

const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function toBeat(
  beatModel: v1.Beat,
  tupletOf: (id: string) => v1.Tuplet | undefined,
  beatMap: Map<string, alphaTab.model.Beat>,
): alphaTab.model.Beat {
  const m = alphaTab.model;
  const beat = new m.Beat();
  beat.duration = DURATION_MAP[beatModel.duration.noteType] ?? 4;
  beat.dots = beatModel.duration.dots;
  const tuplet = tupletOf(beatModel.id);
  if (tuplet) {
    beat.tupletNumerator = tuplet.actual;
    beat.tupletDenominator = tuplet.normal;
  }
  if (beatModel.grace) {
    beat.graceType = beatModel.grace.kind === "acciaccatura" ? m.GraceType.OnBeat : m.GraceType.BeforeBeat;
  }
  if (beatModel.fermata) beat.fermata = new m.Fermata();
  if (beatModel.chordSymbol) beat.text = beatModel.chordSymbol;
  // A beat with no notes renders as a rest.
  if (!beatModel.rest) {
    const ornament = beatModel.ornaments?.map((o) => NOTE_ORNAMENT[o]).find((v) => v !== undefined);
    const hasTrill = beatModel.ornaments?.includes("trill-mark");
    beatModel.notes.forEach((noteModel, i) => {
      const note = toNote(noteModel);
      if (i === 0 && ornament !== undefined) note.ornament = ornament;
      // alphaTab renders a trill via a target note value a step above.
      if (i === 0 && hasTrill) {
        note.trillValue = note.octave * 12 + note.tone + 2;
        note.trillSpeed = m.Duration.Sixteenth;
      }
      beat.addNote(note);
    });
  }
  beatMap.set(beatModel.id, beat);
  // Stamp the model id so a clicked alphaTab beat maps back to the v1 model.
  (beat as unknown as { ovBeatId?: string }).ovBeatId = beatModel.id;
  return beat;
}

function toNote(noteModel: v1.Note): alphaTab.model.Note {
  const note = new alphaTab.model.Note();
  note.octave = noteModel.octave;
  note.tone = STEP_SEMITONE[noteModel.step]! + noteModel.alter;
  // Tablature: string/fret place the note on the tab staff.
  if (noteModel.string !== undefined) note.string = noteModel.string;
  if (noteModel.fret !== undefined) note.fret = noteModel.fret;
  // Stamp the model id so a clicked note maps back to the v1 model.
  (note as unknown as { ovNoteId?: string }).ovNoteId = noteModel.id;
  return note;
}

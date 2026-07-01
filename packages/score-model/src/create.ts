import { newId } from "./ids";
import { barDurationTicks } from "./syncmap";
import {
  SCORE_FORMAT,
  SCORE_FORMAT_VERSION,
  type BarSpec,
  type Measure,
  type ScoreDocument,
  type TimeSignature,
} from "./types";

export interface CreateScoreOptions {
  title?: string;
  composer?: string;
  partName?: string;
  bars?: number;
  timeSignature?: TimeSignature;
  keyFifths?: number;
  tempoBpm?: number;
}

/** A new empty score: every bar holds a single whole-bar rest, ready to edit. */
export function createEmptyScore(options: CreateScoreOptions = {}): ScoreDocument {
  const barCount = Math.max(1, options.bars ?? 8);
  const timeSignature = options.timeSignature ?? { beats: 4, beatUnit: 4 };
  const keyFifths = options.keyFifths ?? 0;

  const bars: BarSpec[] = [];
  const measures: Measure[] = [];
  for (let index = 0; index < barCount; index++) {
    bars.push({
      id: newId("bar"),
      index,
      timeSignature,
      keyFifths,
      ...(index === 0 ? { tempoBpm: options.tempoBpm ?? 120 } : {}),
    });
    measures.push({
      id: newId("measure"),
      barIndex: index,
      voices: [
        {
          id: newId("voice"),
          beats: [
            {
              id: newId("beat"),
              startTick: 0,
              durationTicks: barDurationTicks(bars[index]!),
              rest: true,
              notes: [],
            },
          ],
        },
      ],
    });
  }

  return {
    format: SCORE_FORMAT,
    formatVersion: SCORE_FORMAT_VERSION,
    id: newId("score"),
    title: options.title ?? "Untitled",
    ...(options.composer ? { composer: options.composer } : {}),
    bars,
    parts: [
      {
        id: newId("part"),
        name: options.partName ?? "Part 1",
        measures,
      },
    ],
  };
}

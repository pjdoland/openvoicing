/** A (tick, media time) sync anchor. Mirrors score-model's SyncPoint. */
export interface SyncPoint {
  tick: number;
  timeSeconds: number;
}

export const BUNDLE_FORMAT = "openvoicing-bundle";
/** Current manifest schema version this app writes. */
export const BUNDLE_FORMAT_VERSION = 1;
/** Oldest version this app can read (migrating forward to current). */
export const MIN_BUNDLE_FORMAT_VERSION = 0;

export type ScoreType = "guitarpro" | "musicxml" | "alphatex";

export interface BundleScore {
  /** Path of the score file inside the bundle. */
  path: string;
  type: ScoreType;
}

export interface SavedLoop {
  id: string;
  name: string;
  /** Loop region in recording seconds. */
  start: number;
  end: number;
}

/**
 * Where a recording's playback comes from. `audio` is a file packed in the
 * bundle (self-contained). `youtube` references an external video by id; such
 * bundles are not fully self-contained (see BundleManifest.external) and may
 * carry an optional paired audio file (`audioPath`) used only to draw a
 * waveform and auto-sync in the editor — playback is still the video.
 */
export type RecordingMedia =
  | { kind: "audio"; path: string }
  | {
      kind: "youtube";
      videoId: string;
      /** Optional clip bounds within the video, in seconds. */
      startSeconds?: number;
      endSeconds?: number;
      /** Optional paired audio file inside the bundle, for waveform/auto-sync. */
      audioPath?: string;
    };

export interface BundleRecording {
  id: string;
  /** Display name, usually the original file name or video title. */
  name: string;
  /** Playback source: a packed audio file or an external video. */
  media: RecordingMedia;
  /** Sync anchors in absolute score ticks, empty or absent when unsynced. */
  syncPoints?: SyncPoint[];
  /** Named practice loops. */
  loops?: SavedLoop[];
}

/** Attribution and licensing metadata. All fields are free text and optional. */
export interface BundleAttribution {
  composer?: string;
  artist?: string;
  copyright?: string;
  /** License of the bundle contents, ideally an SPDX id or a URL. */
  license?: string;
  /** Where the material came from, e.g. a URL. */
  source?: string;
}

/** A named practice passage as a bar range, so one list drives the synth and
 *  every recording (converted to seconds per take at recall time). */
export interface BundlePassage {
  id: string;
  name: string;
  fromBar: number;
  toBar: number;
}

/** A named position in the piece (Intro, Verse, "hard run at bar 40"). */
export interface BundleSection {
  barIndex: number;
  label: string;
  /** The learner's own progress flag; travels in the file, no account. */
  practiced?: boolean;
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  title: string;
  attribution?: BundleAttribution;
  /** A practice/assignment note shown to students. */
  assignment?: string;
  /** The piece's section map, so it travels with the file (no account). */
  sections?: BundleSection[];
  /** The learner's free-text practice notebook for this piece. */
  notebook?: string;
  /** Named bar-range practice passages, one list across all sources. */
  passages?: BundlePassage[];
  score: BundleScore;
  recordings: BundleRecording[];
  /**
   * True when the bundle references external media (e.g. a YouTube video) and
   * is therefore not fully self-contained: playback needs a network connection
   * and can break if the external media is removed. Set automatically on create.
   */
  external?: boolean;
}

/** An in-memory bundle: the manifest plus the file contents it references. */
export interface Bundle {
  manifest: BundleManifest;
  files: Map<string, Uint8Array>;
}

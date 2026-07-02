/** A (tick, media time) sync anchor. Mirrors score-model's SyncPoint. */
export interface SyncPoint {
  tick: number;
  timeSeconds: number;
}

export const BUNDLE_FORMAT = "openvoicing-bundle";
export const BUNDLE_FORMAT_VERSION = 0;

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

export interface BundleRecording {
  id: string;
  /** Display name, usually the original file name. */
  name: string;
  /** Path of the audio file inside the bundle. */
  path: string;
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

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  title: string;
  attribution?: BundleAttribution;
  /** A practice/assignment note shown to students. */
  assignment?: string;
  score: BundleScore;
  recordings: BundleRecording[];
}

/** An in-memory bundle: the manifest plus the file contents it references. */
export interface Bundle {
  manifest: BundleManifest;
  files: Map<string, Uint8Array>;
}

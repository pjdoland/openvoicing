import type { SyncPoint } from "@openvoicing/score-model";

export const BUNDLE_FORMAT = "openvoicing-bundle";
export const BUNDLE_FORMAT_VERSION = 0;

export type ScoreType = "guitarpro" | "musicxml" | "alphatex";

export interface BundleScore {
  /** Path of the score file inside the bundle. */
  path: string;
  type: ScoreType;
}

export interface BundleRecording {
  id: string;
  /** Display name, usually the original file name. */
  name: string;
  /** Path of the audio file inside the bundle. */
  path: string;
  /** Sync anchors in absolute score ticks, empty or absent when unsynced. */
  syncPoints?: SyncPoint[];
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  title: string;
  score: BundleScore;
  recordings: BundleRecording[];
}

/** An in-memory bundle: the manifest plus the file contents it references. */
export interface Bundle {
  manifest: BundleManifest;
  files: Map<string, Uint8Array>;
}

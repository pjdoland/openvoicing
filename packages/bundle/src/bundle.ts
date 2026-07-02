import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  MIN_BUNDLE_FORMAT_VERSION,
  type Bundle,
  type BundleManifest,
  type ScoreType,
} from "./types";

const MANIFEST_PATH = "manifest.json";
const SCORE_TYPES: ReadonlySet<string> = new Set(["guitarpro", "musicxml", "alphatex"]);

export class BundleError extends Error {}

function fail(message: string): never {
  throw new BundleError(message);
}

type RawManifest = Record<string, unknown>;

/**
 * Ordered manifest migrations, keyed by the version they upgrade *from*. Adding
 * a bundle-schema field means bumping BUNDLE_FORMAT_VERSION and registering the
 * v(n)->v(n+1) step here, so older bundles keep opening instead of being
 * rejected outright.
 */
const MANIFEST_MIGRATIONS: Record<number, (m: RawManifest) => RawManifest> = {};

function migrateManifest(m: RawManifest, fromVersion: number): RawManifest {
  let current = m;
  for (let v = fromVersion; v < BUNDLE_FORMAT_VERSION; v++) {
    const step = MANIFEST_MIGRATIONS[v];
    if (!step) fail(`no migration path from bundle version ${v}`);
    current = { ...step(current), formatVersion: v + 1 };
  }
  return current;
}

export function validateManifest(value: unknown): BundleManifest {
  if (typeof value !== "object" || value === null) fail("manifest is not an object");
  let m = value as RawManifest;
  if (m["format"] !== BUNDLE_FORMAT) fail(`unknown format ${JSON.stringify(m["format"])}`);
  const version = m["formatVersion"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    fail(`invalid bundle version ${JSON.stringify(version)}`);
  }
  if (version > BUNDLE_FORMAT_VERSION) {
    fail(
      `this bundle is version ${version}, newer than this app supports ` +
        `(${BUNDLE_FORMAT_VERSION}). Update OpenVoicing to open it.`,
    );
  }
  if (version < MIN_BUNDLE_FORMAT_VERSION) {
    fail(`bundle version ${version} is too old to open (minimum ${MIN_BUNDLE_FORMAT_VERSION}).`);
  }
  // Bring older-but-supported manifests up to the current schema.
  m = migrateManifest(m, version);
  if (typeof m["title"] !== "string") fail("missing title");
  if (m["attribution"] !== undefined) {
    const attribution = m["attribution"];
    if (typeof attribution !== "object" || attribution === null) {
      fail("attribution must be an object");
    }
    for (const [key, value] of Object.entries(attribution)) {
      if (value !== undefined && typeof value !== "string") {
        fail(`attribution.${key} must be a string`);
      }
    }
  }
  const score = m["score"] as Record<string, unknown> | undefined;
  if (!score || typeof score["path"] !== "string") fail("missing score.path");
  if (!SCORE_TYPES.has(String(score["type"]))) {
    fail(`unknown score type ${JSON.stringify(score["type"])}`);
  }
  const recordings = m["recordings"];
  if (!Array.isArray(recordings)) fail("missing recordings array");
  for (const r of recordings as Array<Record<string, unknown>>) {
    if (typeof r["id"] !== "string" || typeof r["path"] !== "string" || typeof r["name"] !== "string") {
      fail("recording entries need id, name, and path");
    }
    if (r["syncPoints"] !== undefined) {
      if (!Array.isArray(r["syncPoints"])) fail("syncPoints must be an array");
      for (const p of r["syncPoints"] as Array<Record<string, unknown>>) {
        if (typeof p["tick"] !== "number" || typeof p["timeSeconds"] !== "number") {
          fail("sync points need numeric tick and timeSeconds");
        }
      }
    }
    if (r["loops"] !== undefined) {
      if (!Array.isArray(r["loops"])) fail("loops must be an array");
      for (const l of r["loops"] as Array<Record<string, unknown>>) {
        if (
          typeof l["id"] !== "string" ||
          typeof l["name"] !== "string" ||
          typeof l["start"] !== "number" ||
          typeof l["end"] !== "number"
        ) {
          fail("loops need id, name, and numeric start/end");
        }
      }
    }
  }
  return value as BundleManifest;
}

/** Serialize a bundle to .ovb bytes (a ZIP archive). */
export function createBundle(bundle: Bundle): Uint8Array {
  const manifest = validateManifest(bundle.manifest);
  const referenced = [manifest.score.path, ...manifest.recordings.map((r) => r.path)];
  for (const path of referenced) {
    if (!bundle.files.has(path)) fail(`manifest references missing file ${path}`);
  }
  const entries: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, 2)),
  };
  for (const [path, data] of bundle.files) entries[path] = data;
  return zipSync(entries);
}

/** Parse .ovb bytes into an in-memory bundle. Throws BundleError when invalid. */
export function readBundle(data: Uint8Array): Bundle {
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b) {
    const preview = strFromU8(data.slice(0, 256)).trimStart().toLowerCase();
    if (preview.startsWith("<")) {
      fail(
        "not a bundle: the data is an HTML page, not a .ovb file. " +
          "Check the bundle URL; servers with SPA fallbacks often return their " +
          "index page for missing files.",
      );
    }
    fail("not a bundle: the data is not a ZIP archive");
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    fail("not a valid bundle: could not read the archive (truncated or corrupt)");
  }
  const manifestBytes = entries[MANIFEST_PATH];
  if (!manifestBytes) fail("not a valid bundle: missing manifest.json");
  let manifest: BundleManifest;
  try {
    manifest = validateManifest(JSON.parse(strFromU8(manifestBytes)));
  } catch (error) {
    if (error instanceof BundleError) throw error;
    fail("not a valid bundle: manifest.json is not valid JSON");
  }
  const files = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(entries)) {
    if (path !== MANIFEST_PATH && !path.endsWith("/")) files.set(path, bytes);
  }
  for (const path of [manifest.score.path, ...manifest.recordings.map((r) => r.path)]) {
    if (!files.has(path)) fail(`bundle is missing referenced file ${path}`);
  }
  return { manifest, files };
}

/** Guess the score type from a file name, defaulting to MusicXML. */
export function scoreTypeFromFileName(name: string): ScoreType {
  const lower = name.toLowerCase();
  if (/\.(gp|gp3|gp4|gp5|gpx)$/.test(lower)) return "guitarpro";
  if (lower.endsWith(".alphatex") || lower.endsWith(".atex")) return "alphatex";
  return "musicxml";
}

export function scoreFileExtension(type: ScoreType): string {
  switch (type) {
    case "guitarpro":
      return "gp";
    case "alphatex":
      return "alphatex";
    case "musicxml":
      return "musicxml";
  }
}

#!/usr/bin/env node
// OpenVoicing bundle CLI: validate, inspect, and create .ovb files.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let mod;
try {
  mod = require("../dist/index.js");
} catch {
  console.error("error: build the bundle package first (pnpm --filter @openvoicing/bundle build)");
  process.exit(1);
}
const { readBundle, createBundle, scoreTypeFromFileName, BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } = mod;

const [cmd, ...args] = process.argv.slice(2);

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function validate(path) {
  try {
    return readBundle(new Uint8Array(readFileSync(path)));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

switch (cmd) {
  case "validate": {
    if (!args[0]) fail("usage: ovb validate <file.ovb>");
    validate(args[0]);
    console.log(`ok: ${args[0]} is a valid bundle`);
    break;
  }
  case "inspect": {
    if (!args[0]) fail("usage: ovb inspect <file.ovb>");
    const { manifest, files } = validate(args[0]);
    console.log(JSON.stringify({ manifest, files: [...files.keys()] }, null, 2));
    break;
  }
  case "create": {
    // ovb create --score score.musicxml --out out.ovb [--title T] [--recording take.mp3]
    const opts = {};
    for (let i = 0; i < args.length; i += 2) opts[args[i].replace(/^--/, "")] = args[i + 1];
    if (!opts.score || !opts.out) fail("usage: ovb create --score <file> --out <file.ovb> [--title T] [--recording <audio>]");
    const files = new Map();
    const scoreType = scoreTypeFromFileName(opts.score);
    const scorePath = `score/${basename(opts.score)}`;
    files.set(scorePath, new Uint8Array(readFileSync(opts.score)));
    const recordings = [];
    if (opts.recording) {
      const recPath = `recordings/take1/${basename(opts.recording)}`;
      files.set(recPath, new Uint8Array(readFileSync(opts.recording)));
      recordings.push({ id: "take1", name: basename(opts.recording), path: recPath });
    }
    const bytes = createBundle({
      manifest: {
        format: BUNDLE_FORMAT,
        formatVersion: BUNDLE_FORMAT_VERSION,
        title: opts.title || basename(opts.score),
        score: { path: scorePath, type: scoreType },
        recordings,
      },
      files,
    });
    writeFileSync(opts.out, bytes);
    console.log(`wrote ${opts.out} (${bytes.length} bytes)`);
    break;
  }
  default:
    console.log("ovb <command>\n  validate <file.ovb>   check a bundle is valid\n  inspect  <file.ovb>   print the manifest and file list\n  create   --score <f> --out <f.ovb> [--title T] [--recording <audio>]");
    if (cmd && cmd !== "help") process.exit(1);
}

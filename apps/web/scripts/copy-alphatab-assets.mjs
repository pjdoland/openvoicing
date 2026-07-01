// Copies the Bravura music font into public/ so alphaTab can load it at a
// stable URL in both dev and production builds.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fontDir = dirname(require.resolve("@coderline/alphatab/font/Bravura.woff2"));
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "alphatab", "font");

mkdirSync(target, { recursive: true });
cpSync(fontDir, target, { recursive: true });
console.log(`copied alphaTab font assets to ${target}`);

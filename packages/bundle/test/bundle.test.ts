import { describe, expect, it } from "vitest";
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BundleError,
  createBundle,
  readBundle,
  scoreTypeFromFileName,
  type Bundle,
} from "../src/index";

function demoBundle(): Bundle {
  return {
    manifest: {
      format: BUNDLE_FORMAT,
      formatVersion: BUNDLE_FORMAT_VERSION,
      title: "Demo",
      score: { path: "score/score.alphatex", type: "alphatex" },
      recordings: [
        {
          id: "take1",
          name: "take1.wav",
          path: "recordings/take1.wav",
          syncPoints: [
            { tick: 0, timeSeconds: 0 },
            { tick: 3840, timeSeconds: 2 },
          ],
        },
      ],
    },
    files: new Map([
      ["score/score.alphatex", new TextEncoder().encode("\\title 'Demo' . 3.3.4")],
      ["recordings/take1.wav", new Uint8Array([1, 2, 3, 4, 5])],
    ]),
  };
}

describe("bundle round-trip", () => {
  it("creates and reads back a bundle", () => {
    const original = demoBundle();
    const bytes = createBundle(original);
    const parsed = readBundle(bytes);

    expect(parsed.manifest).toEqual(original.manifest);
    expect([...parsed.files.keys()].sort()).toEqual([...original.files.keys()].sort());
    expect(parsed.files.get("recordings/take1.wav")).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(new TextDecoder().decode(parsed.files.get("score/score.alphatex"))).toContain("Demo");
  });

  it("rejects a manifest referencing missing files", () => {
    const bundle = demoBundle();
    bundle.files.delete("recordings/take1.wav");
    expect(() => createBundle(bundle)).toThrow(BundleError);
  });

  it("rejects archives without a manifest", () => {
    const bundle = demoBundle();
    bundle.manifest.title = "x";
    const bytes = createBundle(bundle);
    expect(() => readBundle(bytes.slice(0, 10))).toThrow(BundleError);
  });

  it("explains when the data is an HTML page instead of a bundle", () => {
    const html = new TextEncoder().encode("<!doctype html><html><body>404</body></html>");
    expect(() => readBundle(html)).toThrow(/HTML page/);
  });

  it("explains when the data is not a ZIP at all", () => {
    expect(() => readBundle(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/not a ZIP archive/);
  });

  it("rejects unknown format versions", () => {
    const bundle = demoBundle();
    (bundle.manifest as { formatVersion: number }).formatVersion = 99;
    expect(() => createBundle(bundle)).toThrow(/unsupported bundle version/);
  });

  it("rejects malformed sync points", () => {
    const bundle = demoBundle();
    (bundle.manifest.recordings[0] as { syncPoints: unknown }).syncPoints = [{ tick: "a" }];
    expect(() => createBundle(bundle)).toThrow(/numeric tick/);
  });
});

describe("scoreTypeFromFileName", () => {
  it("detects types by extension", () => {
    expect(scoreTypeFromFileName("song.gp5")).toBe("guitarpro");
    expect(scoreTypeFromFileName("song.GP")).toBe("guitarpro");
    expect(scoreTypeFromFileName("song.alphatex")).toBe("alphatex");
    expect(scoreTypeFromFileName("song.musicxml")).toBe("musicxml");
    expect(scoreTypeFromFileName("song.xml")).toBe("musicxml");
  });
});

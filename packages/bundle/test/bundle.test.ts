import { describe, expect, it } from "vitest";
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BundleError,
  createBundle,
  parseYouTubeId,
  readBundle,
  recordingAudioPath,
  scoreFileExtension,
  scoreTypeFromFileName,
  validateManifest,
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
          media: { kind: "audio", path: "recordings/take1.wav" },
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

  it("rejects bundles newer than the app supports", () => {
    const bundle = demoBundle();
    (bundle.manifest as { formatVersion: number }).formatVersion = 99;
    expect(() => createBundle(bundle)).toThrow(/newer than this app supports/);
  });

  it("rejects a non-integer bundle version", () => {
    const bundle = demoBundle();
    (bundle.manifest as { formatVersion: unknown }).formatVersion = "1";
    expect(() => createBundle(bundle)).toThrow(/invalid bundle version/);
  });

  it("accepts the current version (migration chain is a no-op at head)", () => {
    const bundle = demoBundle();
    expect(() => readBundle(createBundle(bundle))).not.toThrow();
  });

  it("round-trips saved loops", () => {
    const bundle = demoBundle();
    bundle.manifest.recordings[0]!.loops = [
      { id: "l1", name: "tricky bit", start: 2.5, end: 6.25 },
    ];
    const parsed = readBundle(createBundle(bundle));
    expect(parsed.manifest.recordings[0]!.loops).toEqual([
      { id: "l1", name: "tricky bit", start: 2.5, end: 6.25 },
    ]);
  });

  it("round-trips attribution metadata", () => {
    const bundle = demoBundle();
    bundle.manifest.attribution = { composer: "Trad.", license: "CC-BY-4.0" };
    const parsed = readBundle(createBundle(bundle));
    expect(parsed.manifest.attribution).toEqual({ composer: "Trad.", license: "CC-BY-4.0" });
  });

  it("rejects non-string attribution values", () => {
    const bundle = demoBundle();
    (bundle.manifest as { attribution: unknown }).attribution = { composer: 42 };
    expect(() => createBundle(bundle)).toThrow(/attribution\.composer/);
  });

  it("rejects malformed sync points", () => {
    const bundle = demoBundle();
    (bundle.manifest.recordings[0] as { syncPoints: unknown }).syncPoints = [{ tick: "a" }];
    expect(() => createBundle(bundle)).toThrow(/numeric tick/);
  });
});

describe("recording media (YouTube + audio)", () => {
  it("round-trips a YouTube recording and flags the bundle external", () => {
    const bundle = demoBundle();
    bundle.files.delete("recordings/take1.wav");
    bundle.manifest.recordings = [
      {
        id: "yt",
        name: "Lesson video",
        media: { kind: "youtube", videoId: "dQw4w9WgXcQ", startSeconds: 5 },
        syncPoints: [{ tick: 0, timeSeconds: 5 }],
      },
    ];
    const parsed = readBundle(createBundle(bundle));
    expect(parsed.manifest.external).toBe(true);
    expect(parsed.manifest.recordings[0]!.media).toEqual({
      kind: "youtube",
      videoId: "dQw4w9WgXcQ",
      startSeconds: 5,
    });
  });

  it("packs paired audio for a YouTube recording", () => {
    const bundle = demoBundle();
    bundle.manifest.recordings = [
      {
        id: "yt",
        name: "v",
        media: { kind: "youtube", videoId: "abcdefghijk", audioPath: "recordings/take1.wav" },
      },
    ];
    const parsed = readBundle(createBundle(bundle));
    expect(parsed.manifest.recordings[0]!.media).toMatchObject({
      kind: "youtube",
      audioPath: "recordings/take1.wav",
    });
    expect(parsed.files.get("recordings/take1.wav")).toBeDefined();
  });

  it("leaves audio-only bundles unflagged", () => {
    expect(readBundle(createBundle(demoBundle())).manifest.external).toBeUndefined();
  });

  it("rejects youtube media without a videoId", () => {
    const bundle = demoBundle();
    bundle.manifest.recordings = [
      { id: "y", name: "v", media: { kind: "youtube" } as never },
    ];
    expect(() => createBundle(bundle)).toThrow(/videoId/);
  });

  it("migrates a v0 path-based recording to media", () => {
    const v0 = {
      format: BUNDLE_FORMAT,
      formatVersion: 0,
      title: "Old",
      score: { path: "s", type: "alphatex" },
      recordings: [{ id: "r", name: "take.wav", path: "recordings/take.wav" }],
    };
    const m = validateManifest(v0);
    expect(m.formatVersion).toBe(1);
    expect(m.recordings[0]!.media).toEqual({ kind: "audio", path: "recordings/take.wav" });
    expect((m.recordings[0] as { path?: string }).path).toBeUndefined();
  });

  it("recordingAudioPath returns the packed audio path", () => {
    expect(recordingAudioPath({ kind: "audio", path: "a.wav" })).toBe("a.wav");
    expect(recordingAudioPath({ kind: "youtube", videoId: "x", audioPath: "b.wav" })).toBe("b.wav");
    expect(recordingAudioPath({ kind: "youtube", videoId: "x" })).toBeUndefined();
  });
});

describe("parseYouTubeId", () => {
  it("extracts an id from URLs and bare ids", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://example.com/not-a-video")).toBeNull();
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

describe("scoreFileExtension", () => {
  it("maps each type to an extension", () => {
    expect(scoreFileExtension("guitarpro")).toBe("gp");
    expect(scoreFileExtension("alphatex")).toBe("alphatex");
    expect(scoreFileExtension("musicxml")).toBe("musicxml");
  });

  it("round-trips with scoreTypeFromFileName for known types", () => {
    for (const type of ["guitarpro", "musicxml", "alphatex"] as const) {
      expect(scoreTypeFromFileName(`x.${scoreFileExtension(type)}`)).toBe(type);
    }
  });
});

describe("saved loops and assignment round-trip", () => {
  it("preserves assignment metadata", () => {
    const bundle = demoBundle();
    bundle.manifest.assignment = "Practice bars 1-4 at 70%";
    const parsed = readBundle(createBundle(bundle));
    expect(parsed.manifest.assignment).toBe("Practice bars 1-4 at 70%");
  });
});

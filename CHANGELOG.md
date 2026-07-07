# Changelog

All notable changes to OpenVoicing are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy

OpenVoicing is **pre-1.0 and unstable**. Until a `1.0.0` release:

- Any release may contain breaking changes to APIs, the embed SDK, and the app.
- The `@openvoicing/*` packages are versioned together and share this changelog.
- The **`.ovb` bundle format** carries its own `formatVersion`; readers reject
  unknown major versions. Format changes are called out under a **Format** heading
  so integrators can tell when stored bundles are affected.

Once the format and embed API stabilize, the project will adopt
[Semantic Versioning](https://semver.org/) and tagged releases.

## [Unreleased]

Work in progress on `main`. Notable recent changes:

### Changed

- **Relicensed to MIT.** The whole project (app and libraries) is now MIT,
  replacing the previous AGPL-3.0 (app) and MPL-2.0 (libraries) split. Bundled
  third-party components keep their own permissive licenses (alphaTab MPL-2.0,
  the fonts OFL-1.1, the FluidR3Mono soundfont MIT); see `LICENSING.md` and
  `THIRD-PARTY-NOTICES.md`.
- **Corrected the soundfont notices.** The shipped FluidR3Mono soundfont is MIT;
  the folder previously carried an unrelated Apache-2.0 / Sonivox notice. Removed
  the unused Sonivox soundfont files from the build.

### Added

- **UX overhaul from a seven-expert review (vs. commercial tools).** Highlights:
  a single stable transport row (Play/Edit never reflow); a clickable speed
  readout with tempo presets + coarse steps; a seekable position scrubber;
  actionable sync status ("N of M synced, K need checking") with a colorblind
  cue and a "Next flagged" jump; sparse tap-sync (Skip + interpolate) and per-bar
  marker fixes (P / I); place / resize / hide the video (audio keeps playing);
  a meter-aware count-in and a loop **speed trainer**; **notation glyphs** +
  key-cap badges on the value palette; styled inline prompts replacing
  window.prompt; **chord fingering diagrams** with a click-to-draw mini-fretboard.
- **File-owned practice, no account.** Sections, named bar-range **passages**,
  per-section **practiced** ticks, and a per-piece **notebook** all live inside
  the `.ovb` and drive the synth and every recording alike. A Prev/Next section
  stepper (Page Up/Down) and the passages recall by number key.
- **YouTube video recordings.** Sync the score to a YouTube video (a lesson or
  a performance) and follow the notation as it plays, with the same cursor,
  Follow, looping, and tap-sync as audio. Video plays through YouTube's official
  IFrame player (embedded via youtube-nocookie, never downloaded); speed snaps
  to YouTube's steps. Works in the app and the embeddable player. Add one via the
  recording panel's **Add…** menu, `ovb create --youtube <url>`, or a `youtube`
  media entry in the bundle.
- **Paired audio for a video.** Attach an audio file to a YouTube recording
  (**Add… → Audio for waveform & auto-sync…**) to get a waveform, one-click
  **Auto sync**, and draggable bar markers, while playback stays the video. The
  audio travels in the bundle as the recording's `audioPath`.
- The recording panel's separate "Add audio" / "Add YouTube" buttons are
  consolidated into one **Add…** menu.
- A provider-agnostic `MediaPlayer` interface in `audio-engine` (`RecordingPlayer`
  and `YouTubePlayer`), so playback is decoupled from the source.
- Project license files (AGPL-3.0 for the app, MPL-2.0 for the libraries),
  `SECURITY.md`, `THIRD-PARTY-NOTICES.md`, and contributor issue/PR templates.
- Documentation set: user guide, architecture overview, self-hosting and embed
  references, and a `docs/` index.
- Autosave status ("All changes saved") and a "Restored your last session" toast.
- A first-run welcome card describing Play / Practice / Edit.

### Changed

- Renamed the mode toggle to **Listen / Practice** and the audio source to
  **Performance / Notes** for clarity.
- WCAG AA contrast pass across the light, dark, and high-contrast themes.
- Jumping to a bar or section now moves the recording playhead too, so pressing
  Play starts at that bar.

### Fixed

- The edit toolbar no longer clips its essential controls (Voice/Value/Pitch)
  on smaller screens; feature groups collapse into "More" instead.
- Safari audio playback (AudioContext resume within the user gesture).

### Format

- **`.ovb` bundle `formatVersion` 0 → 1.** Recordings now carry a discriminated
  `media` source (`{ kind: "audio", path }` or `{ kind: "youtube", videoId, … }`)
  instead of a bare `path`, and the manifest gains an `external` flag for bundles
  that reference outside media. Version-0 bundles are migrated on read (old
  `path` → `media: { kind: "audio", path }`), so existing files keep opening.

---

Entries above predate formal releases and are summarized rather than exhaustive.
Detailed history is in the Git log.

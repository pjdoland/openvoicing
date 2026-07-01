# OpenVoicing: Plan for an Open Source Soundslice Competitor

## 1. Vision

OpenVoicing is an open source platform for interactive sheet music: notation
that plays, follows along with real recordings, and comes with serious practice
tools. Its architecture is deliberately different from Soundslice's: instead of
a hosted service with accounts and a database, OpenVoicing is an **open file
format plus tools that read and write it**.

The unit of sharing is a **bundle**: a single self-contained file holding a
score, one or more recordings, and the sync maps that tie them together. The
editor exports bundles. The player, embeddable on any website, plays bundles
from any URL. Sharing a piece means sending a file or hosting it on any static
server; there is no account to create, no service to depend on, and nothing
that stops working if a company disappears.

Target users, in priority order:

1. Music teachers and students (practice tools, shareable lesson bundles)
2. Transcribers and arrangers (authoring, publishing bundles on their own sites)
3. Publishers and course platforms (embeddable player, no platform lock-in)
4. Anyone who wants their music library to outlive any particular service

## 2. Status

Phases 0 to 2 of the original plan are largely built:

- Monorepo (pnpm), CI, strict TypeScript
- `score-model`: canonical document format v0, MusicXML importer, sync-point
  interpolation (both directions), tests
- `player`: notation and tab rendering with synth playback on alphaTab, behind
  a renderer-agnostic API (cursor control, bar ticks, beat click events)
- `audio-engine`: time-stretched recording playback (Signalsmith Stretch in an
  AudioWorklet), region looping, waveform peaks
- Web app: practice toolbar, recording panel with zoomable waveform,
  drag-to-loop, tap-along sync editor with draggable syncpoint markers,
  follow-recording cursor, click-a-note-to-seek, IndexedDB session persistence

## 3. The Bundle

The core design artifact of the project. Working extension: `.ovb`
(a ZIP archive). Contents:

```
manifest.json          # format id + version, title, attribution, content index
score/                 # the score, in one or more representations
  score.alphatex       #   or score.gp, score.musicxml, score.json (canonical)
recordings/
  take1.mp3            # one or more audio (later video) files
  take2.ogg
```

The manifest indexes everything and carries the sync maps (they are small):

```json
{
  "format": "openvoicing-bundle",
  "formatVersion": 0,
  "title": "Blackbird",
  "score": { "path": "score/score.gp", "type": "guitarpro" },
  "recordings": [
    {
      "id": "take1",
      "name": "Studio take",
      "path": "recordings/take1.mp3",
      "syncPoints": [ { "tick": 0, "timeSeconds": 1.2 }, ... ]
    }
  ]
}
```

Format principles:

- **Versioned and specified.** The manifest schema is published and versioned;
  readers must reject versions they do not understand rather than guess
- **Self-contained.** A bundle on a USB stick in ten years still works
- **Lossless.** The original score source file is preserved alongside any
  canonical-format conversion, so nothing is destroyed by importing
- **Progressive.** v0 carries the score source, recordings, and sync points.
  Later versions add the canonical score JSON, waveform peak caches, cover
  images, and multiple sync granularities
- **Streamable variant.** A ZIP cannot be range-requested, so bundles download
  whole; fine for song-sized audio. The same manifest can later live in an
  unpacked directory layout for large-media streaming, with the ZIP as the
  portable form

## 4. The Three Hard Problems

Everything else is ordinary web engineering. These three drive the
architecture.

### 4.1 Notation rendering and layout

Engraving is a deep domain. We build on **alphaTab** (MPL-2.0): it renders
standard notation plus tab, imports Guitar Pro and MusicXML, and has a synth
and cursor API. The player wraps it behind a renderer-agnostic interface so it
stays swappable; re-evaluate against Verovio before the editor phase, which is
where the renderer choice locks in.

### 4.2 The document model and sync model

The canonical score format: versioned JSON, losslessly convertible to and from
MusicXML, with stable IDs on every musical entity so annotations and sync
anchors survive edits. Sync maps are first-class objects: ordered
(musical position, media timestamp) anchor pairs per recording, interpolated
between anchors. Positions are addressed as ticks, not pixels or note indexes,
so sync survives re-layout. Built and tested; the importer routes through it,
and the editor phase makes it the single source of truth.

### 4.3 Time-stretched playback

Slowing real recordings without pitch change, in the browser. Built:
**signalsmith-stretch** (MIT) in an AudioWorklet, with loop regions and
position events. Validated end to end, including sync-following at reduced
speed.

## 5. Architecture

```
openvoicing/
  packages/
    score-model/       # canonical format, converters, sync maps (MPL-2.0)
    player/            # rendering + playback + practice tools (MPL-2.0)
    audio-engine/      # time-stretch, waveforms, mixing (MPL-2.0)
    bundle/            # .ovb format: create, read, validate (MPL-2.0)
  apps/
    web/               # local-first authoring app + embeddable player page
  docs/                # format specs: bundle manifest, score JSON
```

There is **no server** in the core system.

- The **authoring app** is a static web app. Sessions persist locally in
  IndexedDB; the durable output is an exported bundle
- The **player** ships two ways: an iframe-embeddable page (available first)
  and a single-script embed with a JS API (load, seek, loop, events)
- **Scanning (OMR) and audio analysis** run client-side where feasible
  (onset detection, alignment in WASM); heavyweight OMR (Audiveris) becomes a
  local CLI tool rather than a hosted worker
- **Optional layers can come later, outside the core**: a gallery/registry
  that indexes publicly hosted bundles, or a classroom server (accounts,
  practice tracking) for institutions. Both speak the same bundle format and
  are never load-bearing

## 6. Roadmap

Phases 0 to 2 (foundations, player, recordings and sync) are essentially done;
see Status above. What remains, in order:

### Phase 3: Bundles and Embedding (current)

- `bundle` package: create/read/validate `.ovb` (ZIP via fflate)
- Export bundle and Open bundle in the authoring app
- Embeddable player page: `embed.html?bundle=<url>` with the practice tools,
  iframe-ready for any website
- Single-script embed build with a JS API; oEmbed later
- Publish the bundle manifest spec in `docs/`
- Sync editor refinements as needed: finer-than-bar anchors, guide notes

### Phase 4: The Editor (the hardest phase, started)

- Renderer checkpoint resolved for v1: stay on alphaTab, with the canonical
  model as source of truth rendered via alphaTex regeneration on every edit.
  Full-document re-render is fine at practice-piece scale; revisit incremental
  rendering (or Verovio) if large scores make it slow
- Done so far: MusicXML imports route through the canonical model, toAlphaTex
  bridges model to renderer, ScoreEditor provides snapshot undo/redo with
  stable entity IDs, and the app has an edit mode (select a beat, transpose by
  semitone or octave, undo/redo) with the document persisting across reloads
- Next: note entry (keyboard shortcuts, then MIDI input), duration editing,
  add/remove notes and bars
- v1 coverage target: notes/rests, voices, ties/slurs, articulations,
  dynamics, lyrics, chord symbols, tab fingering, repeats/endings, text
- Export: MusicXML, MIDI, PDF, PNG; bundles gain the canonical score JSON

### Phase 5: Scanning and Transcription Assist

- PDF/photo to notation via Audiveris as a local CLI companion tool
- Audio-to-MIDI drafts via basic-pitch, clearly labeled as drafts
- Automatic sync: shipped in v1 form (energy-flux onset detection, global
  tempo-scale and offset search with tie-breaks toward nominal tempo, onset
  snapping per bar). DTW-based local alignment for rubato passages remains

### Phase 6: Reach

- PWA: installable, offline practice, touch-first controls
- Video recordings in bundles; YouTube sync as a convenience tier with
  documented ToS limits (no audio extraction, coarse rate control)
- Optional community layer: a static-friendly gallery that indexes bundles
  hosted elsewhere; an optional AGPL classroom server for institutions

## 7. Licensing and Governance

- **All core packages and apps: MPL-2.0.** With no hosted service in the core,
  AGPL's SaaS protection buys little; MPL keeps embedding frictionless, which
  is the adoption path. Any future optional server layer: AGPL-3.0
- **Format specs (bundle manifest, score JSON): CC-BY.** The format outliving
  the software is a feature, not a risk
- DCO for contributions; BDFL-with-maintainers until there are more than 3
  regular contributors, then a lightweight RFC process

Sustainability options: paid support, sponsorship, and later a hosted
convenience gallery or classroom service built on the same open pieces.

## 8. Quality and Testing

- Unit tests per package (importers, sync math, peaks, bundle round-trip)
- Score corpus of CC0/PD files for import round-trip and, once the editor
  lands, visual regression (render to images, diff on every PR)
- Browser verification of the practice loop end to end (Playwright)
- Format conformance: published example bundles plus a validator, so third
  party implementations have something to test against

## 9. Risks

| Risk | Mitigation |
|---|---|
| Format churn breaks published bundles | Versioned manifest, readers reject unknown majors, spec + example corpus published early |
| Editor scope explodes | Strict v1 coverage list; unsupported elements preserved losslessly in the document |
| Renderer bet turns out wrong | Renderer-agnostic player API already in place; decision checkpoint before the editor |
| Copyright concerns land on bundle sharers | Same posture as any file format: we ship tools and a format, not a catalog. Manifest carries attribution/licensing fields; docs are explicit about responsibility |
| Zip-whole-download hurts long media | Directory-layout variant of the same manifest for streaming; ZIP remains the portable form |
| One-person project stalls | Public roadmap, the format spec as a contributor magnet, good-first-issue curation |

## 10. Immediate Next Steps

1. `bundle` package with round-trip tests
2. Export/Open bundle in the authoring app
3. Embeddable player page playing a bundle by URL
4. Write `docs/bundle-format.md` (manifest spec v0)
5. Single-script embed build with JS API

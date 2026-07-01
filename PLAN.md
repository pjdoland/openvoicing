# OpenVoicing: Plan for an Open Source Soundslice Competitor

## 1. Vision

OpenVoicing is an open source, self-hostable platform for interactive sheet music: notation that plays, follows along with real recordings, and comes with serious practice tools. The goal is feature parity with Soundslice's core experience (player, practice tools, audio/video sync, web-based editor, scanning) while adding what only open source can offer: self-hosting, an open document format, an open API, and no vendor lock-in for teachers and publishers.

Target users, in priority order:

1. Music teachers and students (practice tools, courses, assignments)
2. Transcribers and arrangers (editor, import/export, publishing)
3. Publishers and course platforms (embeddable player, API)
4. Self-hosters and institutions (schools, conservatories) who cannot put their catalogs on a third-party SaaS

## 2. Feature Parity Targets

Reference: Soundslice's public feature set as of mid-2026.

| Area | Soundslice capability | Parity goal |
|---|---|---|
| Player | Notes light up during playback, click-to-seek, responsive reflow on any screen | Phase 1 |
| Practice tools | Loop by dragging across notes (snaps to notes/barlines), slow down without pitch change, transpose, metronome/count-in, mute/solo parts, hide parts | Phase 1 |
| Playback | Synth playback from notation (soundfonts), per-part volume | Phase 1 |
| Recordings | Sync notation to real audio and video, multiple recordings per piece, YouTube sync | Phase 2 |
| Editor | Full web-based notation and tab editor, sync point editor | Phase 3 |
| Import | MusicXML, Guitar Pro (GP3 to GP8), MIDI, PowerTab | Phases 1 and 3 |
| Export | MusicXML, MIDI, PDF, PNG | Phase 3 |
| Scanning | PDF/photo to editable notation (OMR) | Phase 4 |
| Teaching | Courses, lists, private sharing, student practice tracking | Phase 5 |
| Embedding | Embeddable player with API for third-party sites | Phase 5 |
| Community | Channels, public catalog, search | Phase 5 |
| Mobile | Good touch UX, offline practice (PWA first, apps later) | Phase 6 |

Explicit non-goals for v1: a paid marketplace/store, native mobile apps, and real-time collaborative editing. These can come after parity.

## 3. The Three Hard Problems

Everything else in this plan is ordinary web engineering. These three are not, and they drive the architecture.

### 3.1 Notation rendering and layout

Engraving is a deep domain (beaming, spacing, collision avoidance, multi-voice layout, tab, reflow). Writing a layout engine from scratch is a multi-year project on its own, so we build on an existing engine and contribute upstream.

Candidates:

- **alphaTab** (MPL-2.0): TypeScript, renders standard notation plus guitar tab, imports Guitar Pro and MusicXML natively, has a built-in synth and a cursor/playback API. Weakness: its internal model was not designed for interactive editing.
- **Verovio** (LGPL-3.0): C++/WASM, superb engraving quality, MEI-native, good MusicXML import. Weakness: tab support and editing ergonomics.
- **OSMD/VexFlow** (BSD/MIT): pure JS, flexible, but engraving quality and completeness require significant work.

**Decision: start with alphaTab for the player** (it ships the most Soundslice-shaped feature set out of the box: tab, GP import, playback cursor, responsive layout) and design our document model so the renderer is swappable. Re-evaluate against Verovio before the editor phase; the editor is where the renderer choice really locks in.

### 3.2 The document model and sync model

The core intellectual property of the project is a well-designed score document format. Requirements:

- Own canonical format: versioned JSON, losslessly convertible to/from MusicXML, streamable, diffable (enables undo history and future collaboration)
- Stable IDs on every musical entity (note, beat, bar, part) so annotations, sync points, and comments survive edits
- A **SyncMap** as a first-class, separate object: an ordered list of (musical position, media timestamp) anchor pairs per recording, with interpolation between anchors. One score, many recordings, many sync maps
- Musical position addressed as (bar, beat-tick) rather than pixel or note index, so sync survives re-layout and most edits

### 3.3 Time-stretched playback

Slowing real recordings without pitch change, in the browser, with acceptable quality and latency.

**Decision: signalsmith-stretch** (MIT, C++ with a WASM/JS build) as the primary stretcher, running in an AudioWorklet. Fallback: SoundTouch WASM. Rubber Band has better quality but is GPL, which is fine for us but worth isolating behind an interface in case embedders need alternatives. Pitch-shifting for transposition of recordings uses the same engine.

## 4. Architecture

Monorepo (pnpm workspaces + Turborepo):

```
openvoicing/
  packages/
    score-model/       # Canonical document format, MusicXML/GP/MIDI converters, validation
    player/            # Embeddable player: rendering, playback, practice tools. Zero backend deps
    editor/            # Notation editor + sync editor, builds on player
    audio-engine/      # AudioWorklet graph: synth, time-stretch, metronome, mixer
    ui/                # Shared design system components
  apps/
    web/               # Main web app (catalog, accounts, courses, embed pages)
    server/            # API server
    workers/           # Background jobs: transcode, waveform, OMR, audio analysis
  docs/
  infra/               # Docker Compose for self-hosting, Helm chart later
```

### Frontend

- TypeScript, React, Vite. The player package must also work framework-free (vanilla JS embed) since embedding is a headline feature
- Rendering via alphaTab (SVG/canvas) wrapped behind a `Renderer` interface owned by `score-model` types
- Audio: Web Audio API. Synth playback via alphaTab's soundfont synth initially; a dedicated FluidSynth-WASM or sfumato-based synth in `audio-engine` when we need per-part routing and better sounds
- Waveform display: precomputed peaks (server-side) rendered with a lightweight custom canvas component

### Backend

- **API server: Node.js + TypeScript (Fastify) + PostgreSQL + Redis**, S3-compatible object storage for media. One language across the stack lowers the contribution barrier, and score-model code (validation, conversion) is shared between client and server
- Background workers (BullMQ): ffmpeg transcode of uploads, waveform peak generation, YouTube metadata fetch, OMR jobs, MusicXML/GP import for large files
- OMR: wrap **Audiveris** (AGPL, Java) as a containerized worker service; treat its MusicXML output as an import. Later, evaluate ML-based OMR (e.g. oemer) as an alternative backend
- Audio-to-notation assist: **basic-pitch** (Apache-2.0) for audio-to-MIDI as a transcription starting point, clearly labeled as a draft, not magic
- Auth: email + OAuth via self-hostable identity (Lucia-style sessions or Keycloak for institutions); SSO matters for schools

### Data model (core tables)

- `users`, `organizations` (schools/studios)
- `scores` (canonical JSON document, versioned; every save is a new version)
- `recordings` (uploaded audio/video or YouTube reference; transcoded renditions; waveform peaks)
- `syncmaps` (score_id, recording_id, anchor list)
- `collections` (folders/lists), `courses` (ordered lessons wrapping scores + text/video)
- `shares` (secret links, embed tokens, org visibility), `annotations` (text/drawing tied to entity IDs)
- `practice_sessions` (per-user telemetry: what was looped, at what speed, for how long) for the practice-tracking feature

## 5. Roadmap

Each phase ends with something shippable and demoable.

### Phase 0: Foundations (4 to 6 weeks)

- Monorepo, CI, lint/test/release infrastructure
- `score-model` v0: document schema, MusicXML import, alphaTab adapter
- Rendering spike: same scores through alphaTab and Verovio; document the comparison publicly (good first blog post, attracts contributors)
- Visual regression test harness for notation (render corpus scores to images, diff on every PR). This is the single highest-leverage piece of test infrastructure the project will have

### Phase 1: The Player (8 to 12 weeks). First public release

- Upload/import MusicXML and Guitar Pro; render notation and tab; responsive reflow
- Synth playback with lit-up notes and click-to-seek
- Practice tools: drag-to-loop with snapping, speed control (synth), transposition, metronome and count-in, per-part mute/solo/hide
- Minimal web app: accounts, upload, private/unlisted/public scores, share links
- Docker Compose self-host story from day one

Milestone: "MuseScore file to practiceable web link in 60 seconds, on your own server."

### Phase 2: Real Recordings (8 to 12 weeks). The differentiator

- Audio/video upload, transcode, waveform display; YouTube-synced playback via IFrame API (note: YouTube ToS constrains rate control to YouTube's own speed steps and forbids audio extraction; document this honestly)
- Sync point editor: tap-along-to-the-beat UX plus manual anchor dragging on the waveform
- Time-stretch playback of recordings in an AudioWorklet; loop and speed tools work identically on synth and real recordings
- Multiple recordings per score with quick switching
- Optional beat-tracking assist (onset detection to propose anchors, human confirms)

### Phase 3: The Editor (12 to 20 weeks). The hardest phase

- Note entry (mouse, keyboard shortcuts modeled on MuseScore conventions, MIDI keyboard input)
- Edit operations on the document model with full undo/redo (command pattern over the versioned document)
- Coverage target for v1: notes/rests, voices, ties/slurs, articulations, dynamics, lyrics, chord symbols, tab fingering, repeats/endings, text
- Export: MusicXML, MIDI, PDF (server-side render), PNG
- Renderer decision checkpoint: commit to alphaTab (and invest upstream in edit-oriented APIs) or move to Verovio, based on Phase 0/1 experience

### Phase 4: Scanning and Transcription Assist (6 to 10 weeks)

- PDF/photo upload to Audiveris worker to draft score, opening directly in the editor for correction
- Audio-to-MIDI draft via basic-pitch for transcribers
- Batch import tooling for publishers (CLI + API)

### Phase 5: Teaching, Embedding, Community (8 to 12 weeks)

- Courses: ordered lessons combining scores, text, video; student rosters via organizations; practice tracking dashboards
- Embeddable player: script tag + oEmbed + signed embed tokens; JS API (load, seek, loop, events) so course platforms can script it
- Public catalog with search (Postgres FTS first), channels/profiles, following
- Public REST API with tokens; webhooks

### Phase 6: Mobile and Offline

- PWA: installable, offline score cache, wake-lock during practice, touch-first loop/speed controls
- Native apps only if PWA limits demand it (iOS audio latency is the likely forcing function)

## 6. Licensing and Governance

- **Core (server, web app, editor): AGPL-3.0.** Protects against closed-source SaaS forks, the main commercial risk to sustainability
- **Player + score-model packages: MPL-2.0** (matching alphaTab), so publishers can embed the player in proprietary sites, which is essential for adoption of the embed feature
- Contributor agreement: DCO (not CLA) to keep contribution friction low
- Open document format spec published separately under CC-BY; the format outliving the software is a feature
- Governance: BDFL-with-maintainers to start; adopt a lightweight RFC process once there are more than 3 regular contributors

Sustainability options (pick later, design for now): hosted SaaS of the same code (Plausible/Cal.com model), paid support for institutions, GitHub Sponsors/Open Collective.

## 7. Quality and Testing Strategy

- Score corpus: several hundred CC0/PD MusicXML and GP files spanning genres and notation edge cases, used for import round-trip tests and visual regression
- Round-trip invariant tests: MusicXML in, our format, MusicXML out, semantic diff
- Audio engine: offline-render tests (deterministic WAV output hashing) plus manual latency QA matrix (Chrome/Firefox/Safari, macOS/Windows/Android/iOS)
- Sync accuracy: golden sync maps with tolerance assertions after edits and re-layout
- Playwright end-to-end tests for the practice loop: import, play, loop, slow down

## 8. Risks

| Risk | Mitigation |
|---|---|
| Editor scope explodes (it will) | Strict v1 coverage list in Phase 3; everything else behind an "unsupported yet" import warning that preserves data losslessly in the document |
| Renderer bet turns out wrong | Renderer interface from day one; Phase 0 spike; decision checkpoint before Phase 3 |
| Time-stretch quality/latency on Safari and mobile | Prototype in Phase 0 alongside rendering spike; it is cheap to validate early and expensive to discover late |
| YouTube ToS limits sync features | Design recordings as first-class uploads; YouTube is a convenience tier with documented limits |
| Copyright liability for hosted catalog | Self-hosting is the primary story; the flagship instance ships with DMCA process, private-by-default uploads, and no audio ripping features |
| One-person project stalls | Public roadmap, monthly demo posts, "good first issue" curation from Phase 0; the rendering-comparison and format-spec posts are contributor magnets |

## 9. Immediate Next Steps

1. `git init`, scaffold the monorepo, CI, and the empty packages
2. Write the score-model schema draft (the format spec is the first real design artifact)
3. Build the Phase 0 rendering spike: one page that loads a MusicXML file and renders it via alphaTab with a playback cursor
4. Build the time-stretch spike: load an MP3, loop a region at 70% speed via signalsmith-stretch in an AudioWorklet
5. Name check and trademark search for "OpenVoicing"; register domain and org handles

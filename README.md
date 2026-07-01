# OpenVoicing

Open source living sheet music: interactive notation that plays, syncs to real
recordings, and comes with serious practice tools. An open, self-hostable
alternative to Soundslice.

**Status: early development.** The interactive player (Phase 1 of the
[plan](PLAN.md)) is taking shape; everything else is ahead of us.

## What works today

- Monorepo scaffold with CI
- `@openvoicing/score-model`: the canonical score document format (versioned
  JSON, stable entity IDs, first-class sync maps) with a starter MusicXML importer
- `@openvoicing/player`: notation and tablature rendering with synth playback,
  built on [alphaTab](https://alphatab.net), behind a renderer-agnostic API
- A demo web app with practice tools: play/pause, loop, tempo control without
  pitch change, metronome, count-in, and opening MusicXML or Guitar Pro files

## Quickstart

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev        # demo app at http://localhost:5173
pnpm test       # unit tests
pnpm typecheck
pnpm build
```

## Layout

```
packages/score-model   # document format, converters, sync maps (MPL-2.0)
packages/player        # embeddable player (MPL-2.0)
apps/web               # demo web app
```

## Roadmap

See [PLAN.md](PLAN.md) for the full plan: real-recording sync, the sync point
editor, the notation editor, scanning (OMR), courses and teaching tools,
embedding, and self-hosting.

## License

Player and score-model packages: MPL-2.0. Platform components (server, web
app) will be AGPL-3.0. See [PLAN.md](PLAN.md#6-licensing-and-governance) for
the reasoning.

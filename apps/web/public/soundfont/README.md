# Soundfont

This folder ships one soundfont:

- **`FluidR3Mono_GM.sf3`**: a General MIDI soundfont used for "Notes" (notation)
  playback. It is a mono conversion of Frank Wen's FluidR3_GM soundfont, as
  distributed with MuseScore. Licensed under the **MIT** license; see
  [`LICENSE`](./LICENSE).

The app loads this soundfont on first playback (see `soundFontUrl` in
`apps/web/src/App.tsx` and `embed.tsx`). It is large (~24 MB), so it is fetched
and cached on demand rather than precached.

alphaTab also carries its own small fallback soundfont inside its distribution;
that is separate from this file and is covered by alphaTab's own license.

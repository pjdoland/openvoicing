# Third-Party Notices

OpenVoicing includes or depends on the third-party components listed below. Their
license terms apply to those components and their copyright and permission
notices are preserved here as required.

This file covers the notable components that ship in a build or bundle. The full
dependency tree and its licenses can be regenerated at any time; see the note at
the end.

---

## alphaTab

Music notation rendering and synth playback engine.

- Website: https://alphatab.net
- License: **Mozilla Public License 2.0 (MPL-2.0)**
- Full text: https://www.mozilla.org/en-US/MPL/2.0/ (also in this repo at
  `packages/player/LICENSE`)

alphaTab is used by `@openvoicing/player`. MPL-2.0 is file-level copyleft: the
alphaTab source remains under MPL-2.0; OpenVoicing does not modify it.

---

## Signalsmith Stretch

Real-time time-stretching / pitch-shifting AudioWorklet, used for slow-down
without pitch change.

- Website: https://signalsmith-audio.co.uk/code/stretch/
- License: **MIT**

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## FluidR3Mono GM soundfont

General MIDI soundfont used for notation ("Notes") playback. Shipped in the web
build at `apps/web/public/soundfont/FluidR3Mono_GM.sf3`.

- License: **MIT**
- A mono conversion of Frank Wen's FluidR3_GM soundfont, as distributed with
  MuseScore.
- Copyright (c) Frank Wen and the FluidR3Mono contributors.
- Full text: `apps/web/public/soundfont/FluidR3Mono_GM.LICENSE`

alphaTab's own bundled soundfont (`sonivox.sf2` / `sonivox.sf3`) is also copied
into that folder by the vite build. OpenVoicing does not use it (we override to
FluidR3Mono), but it ships in the build; it is **Apache-2.0**, copyright Sonic
Network Inc., with its notice alongside it (`apps/web/public/soundfont/LICENSE`).

---

## Noto Sans

The user-interface typeface, self-hosted (no webfont CDN) so the app stays
offline-capable and private. One weight-axis variable font, subset by script
(Latin, Latin-ext, Greek, Cyrillic, Vietnamese, and more) and loaded on demand,
chosen for its broad coverage as we prepare for full localization.

- Project: https://github.com/notofonts (Google Noto)
- Packaged via `@fontsource-variable/noto-sans`; shipped in the web build under
  `apps/web/dist/assets/` and on the site under `site/fonts/`.
- License: **SIL Open Font License 1.1 (OFL-1.1)**
- Copyright 2022 The Noto Project Authors
  (https://github.com/notofonts/latin-greek-cyrillic)
- Full text: `site/fonts/OFL.txt` and https://openfontlicense.org

The OFL permits self-hosting, embedding, and redistribution. We ship the font
unmodified with this notice; it is not sold on its own, and the reserved name is
not reused for any modified version.

---

## Regenerating the full list

To produce a complete report of every dependency and its license:

```sh
pnpm dlx license-checker-rseidelsohn --production --summary
```

If you add a dependency that ships in a build or bundle, add its notice here.

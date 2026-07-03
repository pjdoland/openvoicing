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

## FluidR3 GM soundfont

General MIDI soundfont used for notation ("Notes") playback. Shipped in the web
build under `apps/web/public/soundfont/`.

- License: **Apache License 2.0**
- Copyright (c) 2004-2006 Sonic Network Inc.
- Full text: `apps/web/public/soundfont/LICENSE` and
  https://www.apache.org/licenses/LICENSE-2.0

---

## Regenerating the full list

To produce a complete report of every dependency and its license:

```sh
pnpm dlx license-checker-rseidelsohn --production --summary
```

If you add a dependency that ships in a build or bundle, add its notice here.

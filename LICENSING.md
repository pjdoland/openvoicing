# Licensing

OpenVoicing is released under the **MIT License**. The full text is in
[`LICENSE`](LICENSE) (a copy also sits in each `packages/*/LICENSE`), and every
`package.json` carries an SPDX `license` field of `MIT`.

MIT lets you use, modify, host, embed, and redistribute the code, including in
commercial and closed-source products, as long as you keep the copyright and
permission notice. There is no copyleft and nothing to share back.

## Third-party code and assets

OpenVoicing bundles or depends on a few third-party components that keep their
own licenses. All are permissive, but they carry notices you must preserve when
you redistribute a build:

- **alphaTab** (notation rendering and synth): **MPL-2.0**, which is file-level
  copyleft. You may combine it freely with MIT code; only changes to alphaTab's
  own files would need to be shared, and OpenVoicing does not modify it.
- **Noto Sans** and **Bravura** (fonts): **SIL OFL-1.1**. Ship the font files
  with their license and keep the reserved names.
- **FluidR3Mono** soundfont: **MIT**.
- **Signalsmith Stretch** and the rest of the dependency tree: **MIT**.

See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for the details and the
full notices.

## The name

"OpenVoicing" (the name and any logo) is **not** covered by the MIT license. You
may fork and redistribute the code under MIT, but please rename your fork if you
distribute it or run it publicly, to avoid confusion about which project users
are dealing with.

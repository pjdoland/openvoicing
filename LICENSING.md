# Licensing

OpenVoicing is a mixed-license monorepo. Which license applies depends on which
part of the tree the code lives in.

| Path | License | What it is |
| --- | --- | --- |
| `packages/score-model` | **MPL-2.0** | Score document format, importers/exporters, sync math |
| `packages/player` | **MPL-2.0** | Embeddable notation/playback engine (alphaTab wrapper) |
| `packages/audio-engine` | **MPL-2.0** | Time-stretch playback, onset detection, waveforms |
| `packages/bundle` | **MPL-2.0** | `.ovb` bundle format + the `ovb` CLI |
| `apps/web` | **AGPL-3.0-only** | The authoring app and the embeddable player page |
| Repository root / aggregate | **AGPL-3.0-only** | The project as a whole |

The full license texts are in [`LICENSE`](LICENSE) (AGPL-3.0) and each package's
own [`packages/*/LICENSE`](packages) (MPL-2.0). Each `package.json` also carries
an SPDX `license` field.

## Why this split

The reusable libraries are permissively copyleft (MPL-2.0 is file-level: you can
combine them with other code, and only changes to MPL files themselves must be
shared back). The **application** is AGPL-3.0 so that anyone who runs a modified
OpenVoicing instance as a network service must offer their users the
corresponding source. See [PLAN.md](PLAN.md#6-licensing-and-governance) for the
longer reasoning.

## If you self-host the app

AGPL-3.0 section 13 treats **network use as distribution**: if you run a modified
version of `apps/web` (or a future server) and let other people interact with it
over a network, you must make the complete corresponding source of your modified
version available to those users. Running the unmodified app is fine; publish
your fork's source (a public repo link in the UI or docs is enough) if you change
it. See [`docs/deploy-app.md`](docs/deploy-app.md#agpl-and-self-hosting).

## Third-party code

Bundled and dependency licenses (alphaTab, Signalsmith Stretch, the FluidR3
soundfont) are listed in [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## The name

"OpenVoicing" (the name and any logo) is **not** covered by the code licenses.
You may fork and redistribute the code under its licenses, but please rename your
fork if you distribute it or run it publicly, to avoid confusion about which
project users are dealing with.

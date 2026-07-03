# Security Policy

## Supported versions

OpenVoicing is in early development (pre-1.0). Security fixes are applied to the
`main` branch only; there are no maintained release branches yet. If you run a
self-hosted instance, track `main` (or a pinned commit you upgrade deliberately).

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's **[Report a vulnerability](https://github.com/pjdoland/openvoicing/security/advisories/new)**
form (Security tab → Advisories). This opens a private advisory visible only to
you and the maintainers.

Please include:

- what you found and where (package/file/URL),
- how to reproduce it (steps, and a sample `.ovb`/MusicXML file if relevant),
- the impact you think it has.

## What to expect

- **Acknowledgement:** within 7 days.
- **Assessment and a plan:** within 30 days.
- We will keep you updated as we work on a fix and will credit you in the
  advisory and changelog unless you ask us not to.

## Scope notes

- OpenVoicing runs entirely in the browser and reads untrusted input (MusicXML,
  Guitar Pro, and `.ovb` bundles, which are ZIP archives). Parser/decompression
  issues that could cause crashes, hangs, or memory exhaustion are in scope.
- The embeddable player runs in a sandboxed `<iframe>` and communicates with the
  host page via `postMessage`. Issues that let a bundle escape the iframe or read
  host-page data are in scope; see [`docs/deploy-app.md`](docs/deploy-app.md#security-and-content-security-policy)
  for the embedding security model.
- Vulnerabilities in third-party dependencies (alphaTab, Signalsmith Stretch)
  should ideally be reported upstream, but let us know so we can pin/patch.

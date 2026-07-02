# Bundle gallery

The gallery is a community index of publicly hosted `.ovb` bundles. It is
deliberately just a list: OpenVoicing hosts no files and runs no service. Each
entry points at a bundle you host yourself, so you keep control and
responsibility for your content.

## Submitting a bundle

Add an entry to `gallery.json` (in the repo root) via pull request:

```json
{
  "title": "Study in A minor",
  "composer": "Trad., arr. You",
  "license": "CC-BY-4.0",
  "bundle": "https://your-host.example/study-a-minor.ovb",
  "tags": ["classical-guitar", "beginner"]
}
```

Requirements:

- The `bundle` URL must be publicly reachable over HTTPS with CORS enabled
  (see the [hosting cookbook](hosting-cookbook.md)).
- Validate it first: `ovb validate study-a-minor.ovb`.
- You must have the right to distribute the score and any recordings. Public
  domain or your own material only. Put the license in the manifest
  (`attribution.license`) and the gallery entry.

## Copyright

You are the publisher of your bundle. OpenVoicing and the gallery index neither
host nor endorse content; entries can be removed on request. Do not submit
material you do not have the right to share.

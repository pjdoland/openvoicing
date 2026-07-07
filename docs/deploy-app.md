# Self-hosting and deployment

How to build and host the OpenVoicing app, host `.ovb` bundles, and embed the
player on your own site. For the embed JavaScript API itself, see
[embed-api.md](embed-api.md).

## Build the app

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm build
```

The static site lands in `apps/web/dist/`:

- `index.html`, the authoring app
- `embed.html`, the embeddable player page
- `openvoicing-embed.js` + `openvoicing-embed.d.ts`, the embed SDK
- `alphatab/`, the notation renderer's worker and font assets
- `soundfont/`, the General MIDI soundfont for "Notes" playback (~24 MB)

Upload the contents of `dist/` to any static host (Netlify, Cloudflare Pages,
GitHub Pages, S3+CloudFront, Nginx, ...). There is no server to run.

## Deploying under a sub-path

By default the app assumes it is served from the domain root (`/`). To serve it
from a sub-path like `https://example.com/music/`, build with a matching base so
asset and service-worker URLs resolve:

```sh
# Vite reads the base from an env var in this project's config:
OPENVOICING_BASE=/music/ pnpm build
```

Then confirm the PWA manifest's `start_url` and icon paths also point under the
sub-path. If a deploy shows a blank page with 404s for `/assets/*.js`, a wrong
base is almost always the cause.

## Hosting `.ovb` bundles

A bundle is a **ZIP archive**. Serve it with the right headers or browsers will
mis-handle it.

- **Content-Type:** `application/zip` (do not let the host guess `text/html`).
- **CORS:** if the bundle is on a different origin than the page embedding it, send
  `Access-Control-Allow-Origin` for that origin (or `*` for public bundles).
- **Caching:** bundles are immutable once published, give them a long
  `Cache-Control: public, max-age=31536000, immutable` and change the URL when the
  content changes (content-hashed filenames work well).

### Server snippets

**Nginx**

```nginx
location ~ \.ovb$ {
  types { application/zip ovb; }
  add_header Access-Control-Allow-Origin *;
  add_header Cache-Control "public, max-age=31536000, immutable";
}
```

**Apache (`.htaccess`)**

```apache
AddType application/zip .ovb
<FilesMatch "\.ovb$">
  Header set Access-Control-Allow-Origin "*"
  Header set Cache-Control "public, max-age=31536000, immutable"
</FilesMatch>
```

**Netlify (`_headers`)**

```
/*.ovb
  Content-Type: application/zip
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable
```

For S3, set the object's `Content-Type` metadata to `application/zip` and enable
CORS on the bucket.

## Embedding on your site

The minimal embed:

```html
<script src="https://your-host/openvoicing-embed.js"></script>
<div data-openvoicing-bundle="https://example.com/tune.ovb"></div>
```

See [embed-api.md](embed-api.md) for options, methods, and events.

### Self-hosting vs CDN, and pinning

`openvoicing-embed.js` resolves its player page (`embed.html`) **relative to its
own script URL**, so keep the two files together. Whether you host them yourself
or from a CDN, **pin a version**, point `<script src>` at an immutable, versioned
path (e.g. `/v1/openvoicing-embed.js`), not a "latest" URL, so a player update
can't silently break your live embeds.

### Security and Content-Security-Policy

The player runs inside a sandboxed `<iframe>` and talks to the host page via
`postMessage`. If your site sends a CSP, allow the player to load and frame:

- `script-src` must allow the origin serving `openvoicing-embed.js`.
- `frame-src` (or `child-src`) must allow the origin serving `embed.html`.
- To control **who may embed your** instance, set `Content-Security-Policy:
  frame-ancestors` (and/or `X-Frame-Options`) on `embed.html`.

Only embed bundles you trust: a bundle is arbitrary content rendered in the player
iframe.

## Licensing

OpenVoicing is **MIT** licensed, so you can deploy it, modify it, and run it
publicly with no share-back obligation; just keep the copyright notice. A few
bundled components (alphaTab, the fonts, the soundfont) keep their own permissive
notices, which you preserve in your build. See [LICENSING.md](../LICENSING.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Blank page, 404s for `/assets/*.js` | Wrong base path for a sub-path deploy | Rebuild with `OPENVOICING_BASE` (see above) |
| Embed iframe is blank | Bundle 404, or served as the wrong MIME type | Check the bundle URL and that it's `application/zip` |
| "Failed to fetch" on a cross-origin bundle | Missing CORS header | Add `Access-Control-Allow-Origin` on the bundle host |
| No audio until the user clicks | Browser autoplay policy | Expected; audio starts on the first user gesture |
| Old version keeps loading after an upgrade | Service-worker cache | Hard-reload; the SW updates on next load and cache-busts |
| Notes playback silent / slow first note | ~24 MB soundfont still downloading | Wait for it, or host the `soundfont/` dir on a fast CDN |

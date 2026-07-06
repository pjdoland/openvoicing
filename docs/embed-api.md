# Embeddable player reference

OpenVoicing ships an embeddable player: a small script that mounts a sandboxed
`<iframe>` playing an `.ovb` bundle from any static URL. This page is the complete
API reference. For hosting the bundle and the script (MIME types, CORS, CSP), see
the [deployment guide](deploy-app.md).

## Quick start

Declarative: add the script and a div with a bundle URL:

```html
<script src="https://your-host/openvoicing-embed.js"></script>
<div data-openvoicing-bundle="https://example.com/tune.ovb"></div>
```

Every matching `div` on the page is upgraded automatically on load.

Programmatic, drive it from JavaScript:

```js
const player = OpenVoicing.create("#slot", {
  bundle: "https://example.com/tune.ovb",
});
player.on("ready", (e) => console.log("loaded:", e.title));
player.play();
player.setSpeed(0.5);
player.seek(30);
```

## `OpenVoicing.create(target, options)`

`target` is a CSS selector string or an `HTMLElement`. Returns an
[`OpenVoicingPlayer`](#the-player-object).

### Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `bundle` | `string` |, | Bundle URL. Falls back to the element's `data-openvoicing-bundle`. |
| `player` | `string` | `embed.html` next to the script | The player page URL. |
| `height` | `number \| string` | `480` | Iframe height in px (number) or any CSS length (string). |
| `title` | `string` |, | Iframe title for assistive technology. |
| `lazy` | `boolean` | `false` | Load the player when scrolled near, instead of immediately. |
| `params` | `Record<string, string \| number>` |, | Extra query params passed to the player, e.g. `{ speed: 0.75, loop: "2-6" }`. |

### Data attributes (declarative)

- `data-openvoicing-bundle`, the bundle URL (required unless `bundle` is passed).
- `data-openvoicing-player`, override the player page URL.
- `data-openvoicing-height`, override the height.

## The player object

```ts
interface OpenVoicingPlayer {
  readonly element: HTMLIFrameElement;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;        // seek to a time in seconds
  setSpeed(value: number): void;      // 0.25 to 1.5; pitch is preserved
  on(type, handler): () => void;      // returns an unsubscribe function
  destroy(): void;                    // remove the iframe and listeners
}
```

## Events

Subscribe with `player.on(type, handler)`; the return value unsubscribes.

| Type | Payload |
| --- | --- |
| `ready` | `{ type: "ready", title: string, hasRecording: boolean, duration: number }` |
| `state` | `{ type: "state", playing: boolean }` |
| `position` | `{ type: "position", current: number, total: number }` |

```js
const off = player.on("position", (e) => updateBar(e.current / e.total));
// later: off();
```

## TypeScript

Type definitions ship alongside the script as `openvoicing-embed.d.ts`. The global
is typed as `window.OpenVoicing: OpenVoicingSDK`.

## How the iframe resolves its player page

The script derives the default `embed.html` **relative to its own `<script src>`**.
If you host `openvoicing-embed.js` at `https://host/v1/openvoicing-embed.js`, the
player loads from `https://host/v1/embed.html`. Keep the two files together, or set
`player` / `data-openvoicing-player` explicitly. See
[deploy-app.md](deploy-app.md#self-hosting-vs-cdn-and-pinning) for pinning advice.

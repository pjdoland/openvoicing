// Type definitions for the OpenVoicing embed SDK (openvoicing-embed.js).

export interface OpenVoicingCreateOptions {
  /** Bundle URL. Falls back to the element's data-openvoicing-bundle. */
  bundle?: string;
  /** Player page URL. Defaults to embed.html next to the script. */
  player?: string;
  /** Iframe height in px (number) or any CSS length (string). Default 480. */
  height?: number | string;
  /** iframe title for assistive tech. */
  title?: string;
  /** Load the player immediately instead of when scrolled near. Default false. */
  lazy?: boolean;
  /** Extra query params passed to the player, e.g. { speed: 0.75, loop: "2-6" }. */
  params?: Record<string, string | number>;
}

export interface OpenVoicingReadyEvent {
  type: "ready";
  title: string;
  hasRecording: boolean;
  duration: number;
}
export interface OpenVoicingStateEvent {
  type: "state";
  playing: boolean;
}
export interface OpenVoicingPositionEvent {
  type: "position";
  current: number;
  total: number;
}

export interface OpenVoicingPlayer {
  readonly element: HTMLIFrameElement;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Seek to a time in seconds. */
  seek(seconds: number): void;
  /** Set playback speed factor (0.25 to 1.5). */
  setSpeed(value: number): void;
  on(type: "ready", handler: (e: OpenVoicingReadyEvent) => void): () => void;
  on(type: "state", handler: (e: OpenVoicingStateEvent) => void): () => void;
  on(type: "position", handler: (e: OpenVoicingPositionEvent) => void): () => void;
  destroy(): void;
}

export interface OpenVoicingSDK {
  create(
    target: string | HTMLElement,
    options?: OpenVoicingCreateOptions,
  ): OpenVoicingPlayer;
}

declare global {
  interface Window {
    OpenVoicing: OpenVoicingSDK;
  }
}

export {};

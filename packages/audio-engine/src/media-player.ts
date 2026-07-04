/**
 * The playback surface the app drives, regardless of where the media comes
 * from: a decoded audio file (RecordingPlayer) or an external video such as
 * YouTube (YouTubePlayer). Both report position in *seconds*, which the sync
 * layer maps to score ticks, so cursor/follow/loop code is source-agnostic.
 */

export interface LoopRegion {
  start: number;
  end: number;
}

export interface MediaPlayerEvents {
  stateChanged: (playing: boolean) => void;
  positionChanged: (seconds: number, duration: number) => void;
  speedChanged: (speed: number) => void;
  loopChanged: (region: LoopRegion | null) => void;
  /** Fired each time playback wraps from the end of the loop back to the start. */
  looped: () => void;
}

export interface MediaPlayer {
  readonly duration: number;
  readonly position: number;
  readonly playing: boolean;
  readonly loopRegion: LoopRegion | null;
  speed: number;
  /**
   * The discrete speeds this source supports, or null when speed is continuous.
   * YouTube reports a fixed set (0.25, 0.5, ..., 2); decoded audio is continuous.
   */
  readonly availableSpeeds: number[] | null;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setLoopRegion(region: LoopRegion | null): void;
  on<K extends keyof MediaPlayerEvents>(event: K, handler: MediaPlayerEvents[K]): () => void;
  destroy(): void;
}

import { beforeEach, describe, expect, it, vi } from "vitest";

// A controllable fake of alphaTab's event emitter.
function emitter<T = unknown>() {
  const handlers: Array<(arg: T) => void> = [];
  return {
    on: (h: (arg: T) => void) => handlers.push(h),
    fire: (arg: T) => handlers.forEach((h) => h(arg)),
  };
}

const events = {
  scoreLoaded: emitter(),
  playerReady: emitter(),
  playerStateChanged: emitter(),
  playerPositionChanged: emitter(),
  beatMouseDown: emitter(),
  error: emitter(),
  renderFinished: emitter(),
};

const api = {
  scoreLoaded: events.scoreLoaded,
  playerReady: events.playerReady,
  playerStateChanged: events.playerStateChanged,
  playerPositionChanged: events.playerPositionChanged,
  beatMouseDown: events.beatMouseDown,
  error: events.error,
  renderFinished: events.renderFinished,
  renderer: { boundsLookup: { staffSystems: [] } },
  tex: vi.fn(),
  load: vi.fn(() => true),
  playPause: vi.fn(),
  stop: vi.fn(),
  print: vi.fn(),
  destroy: vi.fn(),
  changeTrackMute: vi.fn(),
  changeTrackSolo: vi.fn(),
  playerState: 0,
  playbackSpeed: 1,
  metronomeVolume: 0,
  countInVolume: 0,
  isLooping: false,
  tickPosition: 0,
  timePosition: 0,
  playbackRange: null as unknown,
  score: {
    title: "T",
    artist: "A",
    tempo: 96,
    masterBars: [{ start: 0, calculateDuration: () => 3840 }],
    tracks: [
      { index: 0, name: "Gtr", playbackInfo: { isMute: false, isSolo: false } },
    ],
  },
};

vi.mock("@coderline/alphatab", () => ({
  // A regular function (not an arrow) so `new AlphaTabApi(...)` works.
  AlphaTabApi: vi.fn(function (this: unknown) {
    return api;
  }),
  PlayerMode: { EnabledAutomatic: 1 },
  ScrollMode: { Off: 0, Continuous: 1, OffScreen: 2 },
  model: { Color: class { constructor(...args: number[]) { void args; } } },
  synth: { PlayerState: { Paused: 0, Playing: 1 } },
}));

let Player: typeof import("../src/player").Player;

beforeEach(async () => {
  vi.clearAllMocks();
  api.playerState = 0;
  ({ Player } = await import("../src/player"));
});

function makePlayer() {
  const el = { nodeType: 1 } as unknown as HTMLElement;
  return new Player(el, { soundFontUrl: "s.sf3", fontDirectory: "/f/" });
}

describe("Player wrapper", () => {
  it("forwards scoreLoaded with title, artist, and tracks", () => {
    const player = makePlayer();
    const seen: Array<{ title: string; artist: string }> = [];
    player.on("scoreLoaded", (info) => seen.push(info));
    events.scoreLoaded.fire(api.score);
    expect(seen[0]).toMatchObject({ title: "T", artist: "A" });
    expect(seen[0]!.tracks[0]).toMatchObject({ name: "Gtr", mute: false });
  });

  it("maps playerStateChanged to a boolean", () => {
    const player = makePlayer();
    const states: boolean[] = [];
    player.on("playerStateChanged", (p) => states.push(p));
    events.playerStateChanged.fire({ state: 1 });
    events.playerStateChanged.fire({ state: 0 });
    expect(states).toEqual([true, false]);
  });

  it("converts position from ms to seconds", () => {
    const player = makePlayer();
    let current = -1;
    let total = -1;
    player.on("positionChanged", (c, t) => {
      current = c;
      total = t;
    });
    events.playerPositionChanged.fire({ currentTime: 1500, endTime: 3000 });
    expect(current).toBe(1.5);
    expect(total).toBe(3);
  });

  it("emits beatClicked with tick and structural address", () => {
    const player = makePlayer();
    let payload: unknown;
    player.on("beatClicked", (tick, loc) => (payload = { tick, loc }));
    events.beatMouseDown.fire({
      absolutePlaybackStart: 960,
      index: 2,
      voice: { index: 0, bar: { index: 3, staff: { track: { index: 0 } } } },
    });
    expect(payload).toEqual({
      tick: 960,
      loc: { trackIndex: 0, barIndex: 3, voiceIndex: 0, beatIndex: 2 },
    });
  });

  it("delegates transport and practice controls", () => {
    const player = makePlayer();
    player.loadTex("\\title 'x'");
    expect(api.tex).toHaveBeenCalled();
    player.playPause();
    expect(api.playPause).toHaveBeenCalled();
    player.speed = 0.5;
    expect(api.playbackSpeed).toBe(0.5);
    player.setLooping(true);
    expect(api.isLooping).toBe(true);
    player.setMetronome(true);
    expect(api.metronomeVolume).toBe(1);
    player.setCountIn(true);
    expect(api.countInVolume).toBe(1);
    player.print();
    expect(api.print).toHaveBeenCalled();
  });

  it("exposes bar ticks, tempo, and cursor control", () => {
    const player = makePlayer();
    expect(player.tempoBpm).toBe(96);
    expect(player.barTicks).toEqual([{ start: 0, duration: 3840 }]);
    player.cursorTick = 1920;
    expect(api.tickPosition).toBe(1920);
    player.playFromTick(500);
    expect(api.tickPosition).toBe(500);
    expect(api.playPause).toHaveBeenCalled();
    player.setPlaybackRange({ startTick: 0, endTick: 3840 });
    expect(api.playbackRange).toEqual({ startTick: 0, endTick: 3840 });
    expect(api.isLooping).toBe(true);
  });

  it("changes track mute and solo by index", () => {
    const player = makePlayer();
    player.setTrackMute(0, true);
    expect(api.changeTrackMute).toHaveBeenCalledWith([api.score.tracks[0]], true);
    player.setTrackSolo(0, true);
    expect(api.changeTrackSolo).toHaveBeenCalledWith([api.score.tracks[0]], true);
  });
});

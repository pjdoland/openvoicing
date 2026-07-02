import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Signalsmith worklet node is mocked so we can assert on scheduled state.
const scheduleCalls: Array<Record<string, unknown>> = [];
const fakeNode = {
  inputTime: 0,
  connect: vi.fn(),
  disconnect: vi.fn(),
  schedule: vi.fn((change: Record<string, unknown>) => scheduleCalls.push(change)),
  start: vi.fn(),
  stop: vi.fn(),
  addBuffers: vi.fn(async () => 0),
  dropBuffers: vi.fn(async () => undefined),
  setUpdateInterval: vi.fn(),
  latency: vi.fn(() => 0),
  configure: vi.fn(),
};

vi.mock("signalsmith-stretch", () => ({
  default: vi.fn(async () => fakeNode),
}));

class FakeAudioBuffer {
  constructor(
    public numberOfChannels: number,
    public duration: number,
    public sampleRate: number,
    private data: Float32Array[],
  ) {}
  getChannelData(i: number) {
    return this.data[i]!;
  }
}

class FakeAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {});
  createOscillator = vi.fn(() => ({
    frequency: { value: 0 },
    connect: () => ({ connect: () => {} }),
    start: () => {},
    stop: () => {},
  }));
  createGain = vi.fn(() => ({
    gain: {
      value: 0,
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    },
    connect: () => ({ connect: () => {} }),
  }));
  decodeAudioData = vi.fn(async (_data: ArrayBuffer) => {
    const channels = [new Float32Array(44100), new Float32Array(44100)];
    return new FakeAudioBuffer(2, 10, 44100, channels) as unknown as AudioBuffer;
  });
}

let RecordingPlayer: typeof import("../src/recording-player").RecordingPlayer;

beforeEach(async () => {
  scheduleCalls.length = 0;
  fakeNode.inputTime = 0;
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).AudioContext = FakeAudioContext;
  ({ RecordingPlayer } = await import("../src/recording-player"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function loaded() {
  const player = new RecordingPlayer();
  const events: Record<string, unknown> = {};
  player.on("loaded", (info) => (events.loaded = info));
  await player.load(new ArrayBuffer(8));
  return { player, events };
}

describe("RecordingPlayer.load", () => {
  it("decodes audio and emits loaded with duration and sample rate", async () => {
    const { player, events } = await loaded();
    expect(player.duration).toBe(10);
    expect(events.loaded).toMatchObject({ duration: 10, sampleRate: 44100 });
    expect(fakeNode.addBuffers).toHaveBeenCalledOnce();
  });
});

describe("RecordingPlayer playback scheduling", () => {
  it("schedules complete state on play", async () => {
    const { player } = await loaded();
    await player.play();
    expect(player.playing).toBe(true);
    const last = scheduleCalls.at(-1)!;
    expect(last).toMatchObject({ active: true, rate: 1, input: 0 });
  });

  it("re-sends full state (not partial) on speed change", async () => {
    const { player } = await loaded();
    const speeds: number[] = [];
    player.on("speedChanged", (s) => speeds.push(s));
    await player.play();
    player.speed = 0.5;
    expect(speeds).toEqual([0.5]);
    const last = scheduleCalls.at(-1)!;
    expect(last).toMatchObject({ active: true, rate: 0.5 });
  });

  it("emits loopChanged and includes the loop when playing", async () => {
    const { player } = await loaded();
    const loops: Array<unknown> = [];
    player.on("loopChanged", (l) => loops.push(l));
    await player.play();
    player.setLoopRegion({ start: 2, end: 4 });
    expect(loops).toEqual([{ start: 2, end: 4 }]);
    expect(scheduleCalls.at(-1)).toMatchObject({ loopStart: 2, loopEnd: 4 });
  });

  it("carries a pitch shift into the schedule", async () => {
    const { player } = await loaded();
    await player.play();
    player.pitchSemitones = 3;
    expect(scheduleCalls.at(-1)).toMatchObject({ semitones: 3 });
  });

  it("stops scheduling active on pause", async () => {
    const { player } = await loaded();
    await player.play();
    player.pause();
    expect(player.playing).toBe(false);
    expect(scheduleCalls.at(-1)).toMatchObject({ active: false });
  });

  it("clamps seek to the recording bounds", async () => {
    const { player } = await loaded();
    player.seek(999);
    expect(player.position).toBe(10);
    player.seek(-5);
    expect(player.position).toBe(0);
  });
});

describe("RecordingPlayer looping", () => {
  it("emits looped when the playhead wraps", async () => {
    vi.useFakeTimers();
    const { player } = await loaded();
    let looped = 0;
    player.on("looped", () => (looped += 1));
    player.setLoopRegion({ start: 0, end: 4 });
    await player.play();

    // Advance the worklet's input time forward, then wrap backwards.
    fakeNode.inputTime = 3.9;
    vi.advanceTimersByTime(50);
    fakeNode.inputTime = 0.1;
    vi.advanceTimersByTime(50);
    expect(looped).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MicRecorder } from "../src/mic";

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType: string;
  constructor(_stream: MediaStream, opts: { mimeType: string }) {
    this.mimeType = opts.mimeType;
  }
  start() {
    this.state = "recording";
    // Emit one chunk immediately.
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) });
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

const trackStop = vi.fn();
const fakeStream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;

beforeEach(() => {
  trackStop.mockClear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).MediaRecorder = FakeMediaRecorder;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream) },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MicRecorder", () => {
  it("records and produces an audio File", async () => {
    const rec = new MicRecorder();
    expect(rec.recording).toBe(false);
    await rec.start();
    expect(rec.recording).toBe(true);

    const file = await rec.stop();
    expect(file).toBeInstanceOf(File);
    expect(file.type).toContain("audio");
    expect(file.name).toMatch(/^mic-.*\.(webm|ogg)$/);
    expect(file.size).toBeGreaterThan(0);
    // Microphone tracks are released.
    expect(trackStop).toHaveBeenCalled();
  });

  it("rejects stop when not recording", async () => {
    const rec = new MicRecorder();
    await expect(rec.stop()).rejects.toThrow(/not recording/);
  });

  it("falls back to ogg when webm is unsupported", async () => {
    FakeMediaRecorder.isTypeSupported.mockReturnValueOnce(false);
    const rec = new MicRecorder();
    await rec.start();
    const file = await rec.stop();
    expect(file.name).toMatch(/\.ogg$/);
  });
});

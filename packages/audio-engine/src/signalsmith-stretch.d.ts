declare module "signalsmith-stretch" {
  export interface StretchScheduleChange {
    /** Audio context time for this change, in seconds. */
    output?: number;
    active?: boolean;
    /** Position in the input buffer, in seconds. */
    input?: number;
    /** Playback rate, 0.5 is half speed. Pitch is preserved. */
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    /** Auto-loop region in input seconds. Disabled when loopStart === loopEnd. */
    loopStart?: number;
    loopEnd?: number;
  }

  export interface SignalsmithStretchNode extends AudioWorkletNode {
    /** Current position in the input buffer, in seconds. */
    readonly inputTime: number;
    schedule(change: StretchScheduleChange): void;
    start(when?: number, offset?: number, duration?: number): void;
    stop(when?: number): void;
    addBuffers(buffers: Float32Array[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<{ start: number; end: number } | void>;
    setUpdateInterval(seconds: number, callback?: () => void): void;
    latency(): number;
    configure(options: {
      blockMs?: number | null;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: "default" | "cheaper";
    }): void;
  }

  export default function SignalsmithStretch(
    context: AudioContext,
    channelOptions?: Record<string, unknown>,
  ): Promise<SignalsmithStretchNode>;
}

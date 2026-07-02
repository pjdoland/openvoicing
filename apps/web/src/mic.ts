/** Microphone capture via getUserMedia + MediaRecorder, yielding an audio File. */
export class MicRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/ogg";
    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  stop(): Promise<File> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) {
        reject(new Error("not recording"));
        return;
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(this.chunks, { type });
        const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "-");
        this.cleanup();
        resolve(new File([blob], `mic-${stamp}.${ext}`, { type }));
      };
      recorder.stop();
    });
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }
}

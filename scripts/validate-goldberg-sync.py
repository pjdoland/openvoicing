#!/usr/bin/env python3
"""Check each computed bar time against detected note onsets in the recording."""
import subprocess, os, json
import numpy as np

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OGG = os.path.join(SCRATCH, "goldberg-aria.ogg")
SR, N_FFT, HOP = 22050, 2048, 256

raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", OGG, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                     capture_output=True, check=True).stdout
audio = np.frombuffer(raw, dtype=np.float32).astype(np.float64)

# spectral-flux onset envelope
w = np.hanning(N_FFT)
n = 1 + (len(audio) - N_FFT) // HOP
S = np.zeros((n, N_FFT // 2 + 1))
for i in range(n):
    S[i] = np.abs(np.fft.rfft(audio[i * HOP:i * HOP + N_FFT] * w))
S = np.log1p(S)
flux = np.maximum(0, np.diff(S, axis=0)).sum(axis=1)
flux = np.concatenate([[0], flux])
t = np.arange(n) * HOP / SR

# peak-pick onsets: local max above a moving average
onsets = []
win = int(0.3 * SR / HOP)
for i in range(1, n - 1):
    lo, hi = max(0, i - win), min(n, i + win)
    if flux[i] >= flux[i - 1] and flux[i] > flux[i + 1] and flux[i] > 1.3 * flux[lo:hi].mean() and flux[i] > 0:
        if not onsets or t[i] - onsets[-1] > 0.08:
            onsets.append(t[i])
onsets = np.array(onsets)

bar_times = np.array(json.load(open(os.path.join(SCRATCH, "sync.json")))["barTimes"])
dists = np.array([np.min(np.abs(onsets - bt)) for bt in bar_times])
print(f"onsets detected: {len(onsets)}, first onset {onsets[0]:.3f}s")
print(f"bar->nearest-onset dist: median={np.median(dists)*1000:.0f}ms  "
      f"mean={dists.mean()*1000:.0f}ms  90th={np.percentile(dists,90)*1000:.0f}ms  max={dists.max()*1000:.0f}ms")
print("bars within 100ms of an onset:", int((dists < 0.1).sum()), "/ 64")
print("worst bars (idx, time, dist ms):",
      [(int(i), round(float(bar_times[i]), 1), int(dists[i] * 1000))
       for i in np.argsort(dists)[-6:][::-1]])

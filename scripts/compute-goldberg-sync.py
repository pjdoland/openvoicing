#!/usr/bin/env python3
"""Score-informed audio alignment for the Goldberg Aria sample.

Builds a chromagram from the recording and from the MusicXML score, aligns them
with DTW (both are the same AABB structure), and reads off the time of each of
the 64 bar downbeats. Emits the sync points as JSON for baking into the OVB.
"""
import subprocess, sys, os, json
import numpy as np
import xml.etree.ElementTree as ET

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OGG = os.path.join(SCRATCH, "goldberg-aria.ogg")
XML = os.path.join(SCRATCH, "goldberg-aria.musicxml")

SR = 22050
N_FFT = 4096
HOP = 1024

# ---------- 1. decode audio ----------
raw = subprocess.run(
    ["ffmpeg", "-v", "quiet", "-i", OGG, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
    capture_output=True, check=True,
).stdout
audio = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
dur = len(audio) / SR
print(f"audio: {dur:.2f}s, {len(audio)} samples", file=sys.stderr)

# ---------- 1b. onset envelope + peaks (for trimming and snapping) ----------
# Fine hop for precise onset localization; a low band isolates the bass
# attacks that mark the sarabande downbeats (the measure divisions).
OW, OH = 2048, 256
own = np.hanning(OW)
on = 1 + (len(audio) - OW) // OH
spec = np.zeros((on, OW // 2 + 1))
for i in range(on):
    spec[i] = np.abs(np.fft.rfft(audio[i * OH:i * OH + OW] * own))
spec = np.log1p(spec)
ofreq = np.fft.rfftfreq(OW, 1 / SR)
bass_band = ofreq < 320
flux_full = np.concatenate([[0], np.maximum(0, np.diff(spec, axis=0)).sum(axis=1)])
flux_bass = np.concatenate([[0], np.maximum(0, np.diff(spec[:, bass_band], axis=0)).sum(axis=1)])

def pick_peaks(flux, min_sep, sensitivity):
    w = int(0.3 * SR / OH)
    peaks = []
    for i in range(1, on - 1):
        lo, hi = max(0, i - w), min(on, i + w)
        if flux[i] >= flux[i - 1] and flux[i] > flux[i + 1] and flux[i] > sensitivity * flux[lo:hi].mean() and flux[i] > 0:
            a, b, c = flux[i - 1], flux[i], flux[i + 1]
            denom = a - 2 * b + c
            off = 0.5 * (a - c) / denom if denom != 0 else 0.0  # sub-frame peak
            t = (i + max(-0.5, min(0.5, off))) * OH / SR
            if not peaks or t - peaks[-1] > min_sep:
                peaks.append(t)
    return np.array(peaks)

onset_peaks = pick_peaks(flux_full, min_sep=0.06, sensitivity=1.3)
bass_onsets = pick_peaks(flux_bass, min_sep=0.18, sensitivity=1.25)
lead = max(0.0, onset_peaks[0] - 0.05)  # trim silence before the first note
print(f"onsets={len(onset_peaks)} bass={len(bass_onsets)} first={onset_peaks[0]:.3f}s lead-trim={lead:.3f}s", file=sys.stderr)
audio = audio[int(lead * SR):]

# ---------- 2. audio chromagram ----------
window = np.hanning(N_FFT)
# pitch-class map for FFT bins
freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
with np.errstate(divide="ignore"):
    midi = 69 + 12 * np.log2(np.where(freqs > 0, freqs, 1) / 440.0)
pc = np.mod(np.round(midi).astype(int), 12)
valid = (freqs > 55) & (freqs < 5000)

n_frames = 1 + (len(audio) - N_FFT) // HOP
achroma = np.zeros((n_frames, 12))
for i in range(n_frames):
    seg = audio[i * HOP : i * HOP + N_FFT] * window
    mag = np.abs(np.fft.rfft(seg))
    mag = np.log1p(mag)
    for k in range(12):
        sel = valid & (pc == k)
        achroma[i, k] = mag[sel].sum()
# normalize each frame
achroma /= (np.linalg.norm(achroma, axis=1, keepdims=True) + 1e-9)
frame_time = np.arange(n_frames) * HOP / SR

# ---------- 3. score chromagram ----------
root = ET.parse(XML).getroot()
part = root.find("part")
divisions = int(part.find(".//divisions").text)  # per quarter
BAR_TICKS = 3 * divisions  # 3/4
notes = []  # (onset_tick, dur_tick, pitchclass)
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
for mi, measure in enumerate(part.findall("measure")):
    pos = 0
    prev_onset = 0
    for el in measure:
        if el.tag == "note":
            d = el.find("duration")
            dt = int(d.text) if d is not None else 0
            is_chord = el.find("chord") is not None
            onset = prev_onset if is_chord else pos
            p = el.find("pitch")
            if p is not None:
                step = p.find("step").text
                alt = p.find("alter")
                a = int(alt.text) if alt is not None else 0
                pcv = (STEP[step] + a) % 12
                notes.append((mi * BAR_TICKS + onset, dt, pcv))
            if not is_chord:
                prev_onset = pos
                pos += dt
        elif el.tag == "backup":
            pos -= int(el.find("duration").text)
        elif el.tag == "forward":
            pos += int(el.find("duration").text)

total_ticks = 64 * BAR_TICKS
TICKS_PER_FRAME = max(1, divisions // 4)  # ~16th-note score frames
n_sframes = total_ticks // TICKS_PER_FRAME
schroma = np.zeros((n_sframes, 12))
for onset, dt, k in notes:
    f0 = onset // TICKS_PER_FRAME
    f1 = max(f0 + 1, (onset + dt) // TICKS_PER_FRAME)
    for f in range(f0, min(f1, n_sframes)):
        # emphasize the attack, then sustain
        schroma[f, k] += 2.0 if f == f0 else 0.6
schroma /= (np.linalg.norm(schroma, axis=1, keepdims=True) + 1e-9)
print(f"frames: audio={n_frames}, score={n_sframes}, notes={len(notes)}", file=sys.stderr)

# ---------- 4. DTW with a Sakoe-Chiba band ----------
# cost = 1 - cosine similarity (both L2-normalized)
S = schroma @ achroma.T  # (n_sframes, n_frames)
cost = 1.0 - S
N, M = cost.shape
band = int(0.12 * M) + 1  # both are AABB, alignment is near-linear
INF = 1e18
D = np.full((N, M), INF)
D[0, 0] = cost[0, 0]
for j in range(1, min(band, M)):
    D[0, j] = D[0, j - 1] + cost[0, j]
for i in range(1, N):
    center = int(i * M / N)
    lo = max(1, center - band)
    hi = min(M, center + band)
    row, prev = D[i], D[i - 1]
    ci = cost[i]
    # first valid column can only come from up
    for j in range(lo, hi):
        best = prev[j]
        if prev[j - 1] < best: best = prev[j - 1]
        if row[j - 1] < best: best = row[j - 1]
        row[j] = ci[j] + best
    if lo == 1:
        row[0] = ci[0] + prev[0]

# ---------- 5. backtrack ----------
i, j = N - 1, M - 1
# snap end to the best final cell within band
path = []
while i > 0 or j > 0:
    path.append((i, j))
    if i == 0:
        j -= 1
    elif j == 0:
        i -= 1
    else:
        c = [(D[i - 1, j - 1], i - 1, j - 1), (D[i - 1, j], i - 1, j), (D[i, j - 1], i, j - 1)]
        _, i, j = min(c, key=lambda x: x[0])
path.append((0, 0))
path.reverse()

# map score-frame -> audio-frame (median of path columns per row)
s2a = {}
for si, aj in path:
    s2a.setdefault(si, []).append(aj)
s2a = {k: int(np.median(v)) for k, v in s2a.items()}

def audio_time_for_tick(tick):
    sf = min(n_sframes - 1, tick // TICKS_PER_FRAME)
    while sf not in s2a and sf > 0:
        sf -= 1
    return float(frame_time[s2a.get(sf, 0)]) + lead  # back to absolute time

# DTW gives a coarse time per bar; snap each to the nearest onset attack (finely
# localized). When a bass onset (the downbeat's left-hand note) sits very close
# to that onset, prefer it as the truer measure division.
WIN = 0.35
raw_times = [audio_time_for_tick(b * BAR_TICKS) for b in range(64)]

def snap(t):
    near = onset_peaks[np.argmin(np.abs(onset_peaks - t))]
    if abs(near - t) > WIN:
        return (t, False)
    if len(bass_onsets):
        bnear = bass_onsets[np.argmin(np.abs(bass_onsets - near))]
        if abs(bnear - near) <= 0.06:  # bass attack coincides with this onset
            return (float(bnear), True)
    return (float(near), True)

bar_times, anchored = [], []
for t in raw_times:
    st, ok = snap(t)
    bar_times.append(st)
    anchored.append(ok)

# Repair bars that did not snap (DTW drift) by interpolating between the nearest
# anchored bars on each side, then snapping the result.
for b in range(64):
    if anchored[b]:
        continue
    lo = next((k for k in range(b - 1, -1, -1) if anchored[k]), None)
    hi = next((k for k in range(b + 1, 64) if anchored[k]), None)
    if lo is not None and hi is not None:
        frac = (b - lo) / (hi - lo)
        t = bar_times[lo] + frac * (bar_times[hi] - bar_times[lo])
        st, ok = snap(t)
        bar_times[b] = st

for i in range(1, 64):
    if bar_times[i] <= bar_times[i - 1]:
        bar_times[i] = bar_times[i - 1] + 0.05

# report
gaps = np.diff(bar_times)
print(f"bar0={bar_times[0]:.2f}s bar63={bar_times[63]:.2f}s", file=sys.stderr)
print(f"gap min={gaps.min():.2f} max={gaps.max():.2f} mean={gaps.mean():.2f}s", file=sys.stderr)

# sync points keyed by tick in OUR document PPQ. alphaTab loads the score with
# its own PPQ; we express ticks as bar_index * barTicksAlpha. We do not know
# alphaTab's PPQ here, so emit bar index + time and let the app map to bar starts.
out = {"barTimes": [round(t, 3) for t in bar_times], "duration": round(dur, 3), "bars": 64}
json.dump(out, open(os.path.join(SCRATCH, "sync.json"), "w"), indent=1)
print("wrote sync.json", file=sys.stderr)

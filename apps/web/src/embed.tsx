import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player } from "@openvoicing/player";
import { RecordingPlayer, YouTubePlayer, type MediaPlayer } from "@openvoicing/audio-engine";
import { mediaTimeAtTick, tickAtMediaTime, type SyncPoint } from "@openvoicing/score-model";
import { readBundle, recordingAudioPath, type Bundle } from "@openvoicing/bundle";
import { parseDeepLink } from "./deep-link";
import { SpeedControl, clampSpeed } from "./SpeedControl";
import { Popover } from "./ui/Popover";
import "@fontsource-variable/noto-sans/wght.css";
import "./embed.css";

const soundFontUrl = `${import.meta.env.BASE_URL}soundfont/FluidR3Mono_GM.sf3`;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function applyDeepLink(
  params: URLSearchParams,
  player: Player,
  recording: MediaPlayer,
  syncPoints: SyncPoint[] | undefined,
): { speed?: number } {
  const preset = parseDeepLink(params);
  if (preset.speed !== undefined) {
    if (recording.duration > 0) recording.speed = preset.speed;
    else player.speed = preset.speed;
  }
  if (recording.duration > 0) {
    if (preset.loopBars && syncPoints?.length) {
      const ticks = player.barTicks;
      const from = ticks[preset.loopBars.fromBar - 1]?.start;
      const toBar = ticks[preset.loopBars.toBar - 1];
      if (from !== undefined && toBar) {
        recording.setLoopRegion({
          start: mediaTimeAtTick(syncPoints, from),
          end: mediaTimeAtTick(syncPoints, toBar.start + toBar.duration),
        });
      }
    } else if (preset.loopSeconds) {
      recording.setLoopRegion(preset.loopSeconds);
    }
  }
  if (preset.start !== undefined) {
    if (recording.duration > 0) recording.seek(preset.start);
    else player.seekSeconds(preset.start);
  }
  return { speed: preset.speed };
}

function EmbedApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const recordingRef = useRef<RecordingPlayer | null>(null);
  // The active playback source: the RecordingPlayer for audio, or a
  // YouTubePlayer for a video recording. Transport acts on mediaRef.
  const mediaRef = useRef<MediaPlayer | null>(null);
  const youtubeRef = useRef<YouTubePlayer | null>(null);
  const syncRef = useRef<SyncPoint[] | null>(null);
  const hasRecordingRef = useRef(false);
  const bundleRef = useRef<Bundle | null>(null);
  const lastBarRef = useRef(-1);
  const [hasVideo, setHasVideo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [ready, setReady] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [recordingIds, setRecordingIds] = useState<Array<{ id: string; name: string }>>([]);
  const [activeRecording, setActiveRecording] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState({ current: 0, total: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoHidden, setVideoHidden] = useState(false);
  const [looping, setLooping] = useState(false);
  const [loopBars, setLoopBars] = useState<{ from: number; to: number } | null>(null);
  const [loopFrom, setLoopFrom] = useState(1);
  const [loopTo, setLoopTo] = useState(1);
  const [barCount, setBarCount] = useState(0);
  // Speed trainer (tempo ramp): drop to Start, step up every N loops to Target.
  const [rampOn, setRampOn] = useState(false);
  const [rampStart, setRampStart] = useState(50);
  const [rampStep, setRampStep] = useState(5);
  const [rampEvery, setRampEvery] = useState(2);
  const [rampTarget, setRampTarget] = useState(100);
  const rampCountRef = useRef(0);
  const [sections, setSections] = useState<Array<{ barIndex: number; label: string }>>([]);
  const bundleUrlRef = useRef<string>("");

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  function toggleFullscreen() {
    // This component runs inside the embed iframe (which is created with
    // allow="fullscreen"), so fullscreen its own document element.
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const params = new URLSearchParams(window.location.search);
    const url = params.get("bundle");
    if (!url) {
      setError("No bundle specified. Use embed.html?bundle=<url>.");
      return;
    }

    const player = new Player(container, {
      soundFontUrl,
      fontDirectory: `${import.meta.env.BASE_URL}alphatab/font/`,
    });
    playerRef.current = player;
    const recording = new RecordingPlayer();
    recordingRef.current = recording;

    player.on("scoreLoaded", (info) => {
      setTitle(info.title);
      setBarCount(player.barTicks.length);
      setLoopTo(player.barTicks.length || 1);
    });
    player.on("playerReady", () => setReady(true));
    player.on("playerStateChanged", (p) => {
      if (!hasRecordingRef.current) setPlaying(p);
    });
    player.on("positionChanged", (current, total) => {
      if (!hasRecordingRef.current) setPosition({ current, total });
    });
    player.on("beatClicked", (tick) => {
      const points = syncRef.current;
      if (points) recordingRef.current?.seek(mediaTimeAtTick(points, tick));
    });
    // Subscribe whichever source is active (audio take or video) to drive the
    // position readout and the synced, self-scrolling cursor.
    const bindMedia = (m: MediaPlayer) => {
      mediaRef.current = m;
      m.on("stateChanged", setPlaying);
      m.on("positionChanged", (current, total) => {
        setPosition({ current, total });
        const points = syncRef.current;
        if (points) {
          const tick = Math.max(0, Math.round(tickAtMediaTime(points, current)));
          player.cursorTick = tick;
          // Follow: keep the playing bar in view (scroll only when it changes).
          const bar = player.barIndexAtTick(tick);
          if (bar !== lastBarRef.current) {
            lastBarRef.current = bar;
            player.scrollBarIntoView(bar);
          }
        }
      });
    };

    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not fetch bundle (HTTP ${response.status})`);
        const bundle = readBundle(new Uint8Array(await response.arrayBuffer()));
        const { manifest } = bundle;

        const scoreBytes = bundle.files.get(manifest.score.path)!;
        if (manifest.score.type === "alphatex") {
          player.loadTex(new TextDecoder().decode(scoreBytes));
        } else {
          player.load(scoreBytes.slice());
        }

        bundleRef.current = bundle;
        bundleUrlRef.current = url;
        setSections(manifest.sections ?? []);
        setRecordingIds(manifest.recordings.map((r) => ({ id: r.id, name: r.name })));
        // Prefer the first recording; a video plays through a YouTubePlayer.
        const rec =
          manifest.recordings.find((r) => r.media.kind === "youtube") ??
          manifest.recordings.find((r) => recordingAudioPath(r.media));
        if (rec?.media.kind === "youtube") {
          const yt = new YouTubePlayer(videoHostRef.current!, {
            videoId: rec.media.videoId,
            startSeconds: rec.media.startSeconds,
            endSeconds: rec.media.endSeconds,
          });
          youtubeRef.current = yt;
          bindMedia(yt);
          hasRecordingRef.current = true;
          setHasRecording(true);
          setHasVideo(true);
          setActiveRecording(rec.id);
          syncRef.current = rec.syncPoints?.length ? rec.syncPoints : null;
          // Wait for the video to report its duration; applyDeepLink routes speed/
          // seek/loop to the media only when duration > 0, and a fresh
          // YouTubePlayer reports 0 until it is ready.
          await yt.whenReady();
        } else if (rec) {
          const bytes = bundle.files.get(recordingAudioPath(rec.media)!)!;
          await recording.load(bytes.slice().buffer as ArrayBuffer);
          bindMedia(recording);
          hasRecordingRef.current = true;
          setHasRecording(true);
          setActiveRecording(rec.id);
          syncRef.current = rec.syncPoints?.length ? rec.syncPoints : null;
        }

        // Deep-link presets: ?speed=0.75&loop=2-6&t=1.5 (loop/t in seconds,
        // or loop=b3-6 for bar numbers when the recording is synced).
        const applied = applyDeepLink(params, player, mediaRef.current ?? recording, rec?.syncPoints);
        if (applied.speed) setSpeed(applied.speed);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      playerRef.current = null;
      recordingRef.current = null;
      mediaRef.current = null;
      youtubeRef.current?.destroy();
      youtubeRef.current = null;
      player.destroy();
      recording.destroy();
    };
  }, []);

  function isPlaying(): boolean {
    if (hasRecordingRef.current) return mediaRef.current?.playing ?? false;
    return playerRef.current?.playing ?? false;
  }

  function togglePlay() {
    if (hasRecordingRef.current) {
      const m = mediaRef.current;
      if (!m) return;
      if (m.playing) m.pause();
      else void m.play();
    } else {
      playerRef.current?.playPause();
    }
  }

  function seek(seconds: number) {
    if (hasRecordingRef.current) mediaRef.current?.seek(seconds);
    else playerRef.current?.seekSeconds(seconds);
  }

  function applySpeed(value: number) {
    if (hasRecordingRef.current && mediaRef.current) {
      mediaRef.current.speed = value;
      // YouTube snaps to discrete rates; show what it will actually play.
      setSpeed(mediaRef.current.speed);
    } else if (playerRef.current) {
      playerRef.current.speed = value;
      setSpeed(value);
    } else {
      setSpeed(value);
    }
  }


  async function selectRecording(id: string) {
    const bundle = bundleRef.current;
    const recorder = recordingRef.current;
    // Video embeds carry a single video source; only audio takes switch here.
    if (youtubeRef.current || !bundle || !recorder || id === activeRecording) return;
    const entry = bundle.manifest.recordings.find((r) => r.id === id);
    const audioPath = entry && recordingAudioPath(entry.media);
    if (!entry || !audioPath) return;
    const bytes = bundle.files.get(audioPath)!;
    await recorder.load(bytes.slice().buffer as ArrayBuffer);
    syncRef.current = entry.syncPoints?.length ? entry.syncPoints : null;
    setActiveRecording(id);
  }

  // Cross-frame control protocol for the embed SDK. Messages are marked with
  // ov: true in both directions; the child never assumes a specific parent origin
  // because bundles are public content.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data as { ov?: boolean; type?: string; seconds?: number; value?: number };
      if (!msg || msg.ov !== true) return;
      switch (msg.type) {
        case "toggle":
          togglePlay();
          break;
        case "play":
          if (!isPlaying()) togglePlay();
          break;
        case "pause":
          if (isPlaying()) togglePlay();
          break;
        case "seek":
          if (typeof msg.seconds === "number") seek(msg.seconds);
          break;
        case "setSpeed":
          if (typeof msg.value === "number") applySpeed(msg.value);
          break;
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  });

  const embedded = window.parent !== window;

  useEffect(() => {
    if (!embedded || !title) return;
    window.parent.postMessage(
      { ov: true, type: "ready", title, hasRecording, duration: position.total },
      "*",
    );
    // position.total intentionally omitted from deps: ready fires on title/recording
    // changes, not on every position tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, title, hasRecording]);

  useEffect(() => {
    if (embedded) window.parent.postMessage({ ov: true, type: "state", playing }, "*");
  }, [embedded, playing]);

  useEffect(() => {
    if (embedded) {
      window.parent.postMessage(
        { ov: true, type: "position", current: position.current, total: position.total },
        "*",
      );
    }
  }, [embedded, position]);

  function jumpToEmbedSection(barIndex: number) {
    const player = playerRef.current;
    if (!player) return;
    const tick = player.barTicks[barIndex]?.start ?? 0;
    player.cursorTick = tick;
    player.scrollBarIntoView(barIndex);
    const points = syncRef.current;
    if (points && mediaRef.current) mediaRef.current.seek(mediaTimeAtTick(points, tick));
  }
  // One loop, re-applied to whichever source is heard whenever the loop state or
  // the active source changes. `looping` enables it; `loopBars` narrows it to a
  // bar range (whole piece otherwise), converted to seconds per source.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const m = mediaRef.current;
    const clear = () => {
      player.setLoopMarkers(null);
      player.setPlaybackRange(null);
      player.setLooping(false);
      m?.setLoopRegion(null);
    };
    if (!looping) {
      clear();
      return;
    }
    const n = player.barTicks.length;
    if (n === 0) return;
    const from = loopBars ? Math.max(1, Math.min(n, loopBars.from)) : 1;
    const to = loopBars ? Math.max(from, Math.min(n, loopBars.to)) : n;
    const startTick = player.barTicks[from - 1]!.start;
    const endBar = player.barTicks[to - 1]!;
    const endTick = endBar.start + endBar.duration;
    player.setLoopMarkers(loopBars ? { startBar: from - 1, endBar: to - 1 } : null);
    if (hasRecordingRef.current && m) {
      const points = syncRef.current;
      const start = points ? mediaTimeAtTick(points, startTick) : 0;
      const end = points ? mediaTimeAtTick(points, endTick) : m.duration;
      player.setPlaybackRange(null);
      player.setLooping(false);
      m.setLoopRegion({ start, end });
    } else {
      m?.setLoopRegion(null);
      player.setPlaybackRange(loopBars ? { startTick, endTick } : null);
      player.setLooping(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looping, loopBars, activeRecording, hasRecording, ready]);

  function applyBarLoop(fromRaw: number, toRaw: number) {
    const player = playerRef.current;
    if (!player || player.barTicks.length === 0) return;
    const n = player.barTicks.length;
    const from = Math.max(1, Math.min(n, Math.min(fromRaw, toRaw)));
    const to = Math.max(from, Math.min(n, Math.max(fromRaw, toRaw)));
    setLoopFrom(from);
    setLoopTo(to);
    setLoopBars({ from, to });
    setLooping(true);
    player.cursorTick = player.barTicks[from - 1]!.start;
    player.scrollBarIntoView(from - 1);
    const points = syncRef.current;
    if (hasRecordingRef.current && mediaRef.current && points) {
      mediaRef.current.seek(mediaTimeAtTick(points, player.barTicks[from - 1]!.start));
    }
  }

  // Speed trainer: on enable drop to Start, then step the tempo up every N loop
  // repetitions until Target. A repetition is the media "looped" event, or the
  // synth position jumping backward, so it works for whichever source plays.
  useEffect(() => {
    if (!rampOn) return;
    rampCountRef.current = 0;
    setLooping(true);
    applySpeed(clampSpeed(rampStart / 100));
    const bump = () => {
      rampCountRef.current += 1;
      if (rampCountRef.current < rampEvery) return;
      rampCountRef.current = 0;
      const cur =
        hasRecordingRef.current && mediaRef.current
          ? mediaRef.current.speed
          : (playerRef.current?.speed ?? 1);
      applySpeed(clampSpeed(Math.min(rampTarget, Math.round(cur * 100) + rampStep) / 100));
    };
    const unsubs: Array<() => void> = [];
    const m = mediaRef.current;
    if (hasRecordingRef.current && m) {
      unsubs.push(m.on("looped", bump));
    } else if (playerRef.current) {
      let lastT = -1;
      unsubs.push(
        playerRef.current.on("positionChanged", (curSeconds) => {
          if (lastT >= 0 && curSeconds < lastT - 0.3) bump();
          lastT = curSeconds;
        }),
      );
    }
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rampOn, rampStart, rampStep, rampEvery, rampTarget, activeRecording, hasRecording]);

  // Open this exact piece in the full OpenVoicing app (no lock-in).
  const openInAppHref = bundleUrlRef.current
    ? `./?bundle=${encodeURIComponent(bundleUrlRef.current)}`
    : "./";

  if (error) {
    return (
      <div className="embed-error" role="alert">
        <p>This OpenVoicing player could not load.</p>
        <p className="embed-error-detail">{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="embed">
      <div className="embed-toolbar">
        <button className="embed-play" onClick={togglePlay} disabled={!ready && !hasRecording}>
          {playing ? "Pause" : "Play"}
        </button>
        <SpeedControl value={speed} onChange={applySpeed} />
        <Popover
          label="Loop"
          className="embed-loop-pop"
          active={looping}
          title="Loop a passage and train up to speed"
        >
          <div className="embed-loop-panel">
            <label className="embed-check">
              <input type="checkbox" checked={looping} onChange={(e) => setLooping(e.target.checked)} />
              Loop playback
            </label>
            <div className="embed-loop-row">
              Bars
              <input
                type="number"
                className="num-input"
                min={1}
                max={Math.max(1, barCount)}
                value={loopFrom}
                aria-label="Loop from bar"
                onChange={(e) => setLoopFrom(Number(e.target.value) || 1)}
              />
              to
              <input
                type="number"
                className="num-input"
                min={1}
                max={Math.max(1, barCount)}
                value={loopTo}
                aria-label="Loop to bar"
                onChange={(e) => setLoopTo(Number(e.target.value) || 1)}
              />
            </div>
            <div className="embed-loop-row">
              <button onClick={() => applyBarLoop(loopFrom, loopTo)}>Loop these bars</button>
              {loopBars && (
                <button onClick={() => setLoopBars(null)} title="Loop the whole piece">
                  Whole piece
                </button>
              )}
            </div>
            <div className="embed-loop-divider" />
            <label className="embed-check">
              <input type="checkbox" checked={rampOn} onChange={(e) => setRampOn(e.target.checked)} />
              Speed trainer
            </label>
            {rampOn && (
              <div className="embed-ramp">
                <div className="embed-loop-row">
                  Start
                  <input type="number" className="num-input" min={25} max={150} step={5} value={rampStart} onChange={(e) => setRampStart(Number(e.target.value) || 50)} />
                  %
                </div>
                <div className="embed-loop-row">
                  +
                  <input type="number" className="num-input" min={1} max={50} step={1} value={rampStep} onChange={(e) => setRampStep(Number(e.target.value) || 5)} />
                  % every
                  <input type="number" className="num-input" min={1} max={20} step={1} value={rampEvery} onChange={(e) => setRampEvery(Number(e.target.value) || 1)} />
                  loops
                </div>
                <div className="embed-loop-row">
                  up to
                  <input type="number" className="num-input" min={25} max={150} step={5} value={rampTarget} onChange={(e) => setRampTarget(Number(e.target.value) || 100)} />
                  %
                </div>
                <div className="embed-hint">now {rampStart}% to {rampTarget}%</div>
              </div>
            )}
          </div>
        </Popover>
        {sections.length > 0 && (
          <select
            className="embed-sections"
            value=""
            onChange={(e) => {
              if (e.target.value !== "") jumpToEmbedSection(Number(e.target.value));
            }}
            title="Jump to a section"
          >
            <option value="">Sections…</option>
            {sections.map((s) => (
              <option key={s.barIndex} value={s.barIndex}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <span className="embed-position">
          {formatTime(position.current)} / {formatTime(position.total)}
        </span>
        <span className="embed-title">{title}</span>
        <span className="embed-right">
          {recordingIds.length > 1 && (
            <select
              value={activeRecording ?? ""}
              onChange={(e) => void selectRecording(e.target.value)}
              title="Switch recording"
            >
              {recordingIds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          {hasRecording && <span className="embed-badge">recording{syncRef.current ? " + sync" : ""}</span>}
          {hasVideo && (
            <button
              className="embed-fs"
              onClick={() => setVideoHidden((v) => !v)}
              aria-pressed={videoHidden}
              title={videoHidden ? "Show the video" : "Hide the video (audio keeps playing)"}
            >
              {videoHidden ? "Show video" : "Hide video"}
            </button>
          )}
          <a
            className="embed-brand"
            href={openInAppHref}
            target="_blank"
            rel="noreferrer"
            title="Open this piece in the full OpenVoicing app"
          >
            Open in OpenVoicing
          </a>
          <button
            className="embed-fs"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? "✕" : "⛶"}
          </button>
        </span>
      </div>
      <div
        className={"embed-video" + (videoHidden ? " embed-video-off" : "")}
        ref={videoHostRef}
        style={hasVideo ? undefined : { display: "none" }}
      />
      <div className="embed-score" tabIndex={0} role="region" aria-label="Score">
        <div className="embed-score-inner" ref={containerRef} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<EmbedApp />);

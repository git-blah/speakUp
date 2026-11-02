"use client";

import { useEffect, useRef, useState } from "react";
import AssessmentPanel from "@/components/AssessmentPanel";
import { CoachPanel, OnePagerPanel, type Async } from "@/components/Coach";
import { runAssessment, type AssessInput } from "@/lib/assessment/client";
import { overallScores, type Assessment } from "@/lib/assessment/metrics";
import Feedback, { type Analysis } from "@/components/Feedback";
import { analyze, tips as tipsFor } from "@/lib/analysis";
import { cacheOnePager, cachedOnePager, requestFeedback, requestOnePager } from "@/lib/coach/client";
import { coachModelFor, resolveCoach } from "@/lib/coach/resolve";
import { weeklyReview } from "@/lib/progress";
import { SCORE_KEYS, type CoachFeedback, type FeedbackRequest, type OnePager, type ProviderInfo } from "@/lib/coach/types";
import { saveSession, updateSession, type Session } from "@/lib/history";
import { DIFFICULTY_LABELS, MODES, pickPrompt, type Prompt } from "@/lib/prompts";
import { formatSeconds, type Settings } from "@/lib/settings";
import { pruneRecordings, requestPersistentStorage, saveDetail, saveRecording } from "@/lib/takeStore";
import { transcribeOnServer } from "@/lib/transcribe";
import type { Transcript } from "@/lib/transcript";
import VideoFeedback from "@/components/VideoFeedback";
import { useFrameSampler } from "@/lib/useFrameSampler";
import { describeVideo, useRecorder, type Recording } from "@/lib/useRecorder";
import { summarizeVideo, type VideoStats } from "@/lib/videoAnalysis";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { FRAMING_HINT, framingFor, summarizeFace, type FaceStats, type Framing } from "@/lib/face/faceAnalysis";
import { detectFace, loadFaceTracker } from "@/lib/face/faceTracker";
import { speechRecognitionSupported, useSpeechRecognition } from "@/lib/useSpeechRecognition";

type Phase = "setup" | "ready" | "prep" | "speaking" | "review";

interface Take {
  url: string;
  type: string;
  seconds: number;
}

/** Words needed before AI coaching is worth asking for. */
const MIN_COACH_WORDS = 15;


const SELF_CHECK = [
  "I had a clear opening line",
  "I stayed on the prompt",
  "I gave at least one concrete example",
  "I kept filler words (um, like, you know) low",
  "I looked at the camera, not away",
  "I finished with a strong closing line",
];

interface PracticeProps {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  history: Session[];
  onHistory: (history: Session[]) => void;
  /** True while a session is running (camera on), so the app can lock navigation. */
  onActiveChange: (active: boolean) => void;
  /** A prompt chosen elsewhere (e.g. "practise again" in Progress) to use for the next reveal. */
  queued: Prompt | null;
  onQueuedTaken: () => void;
  onOpenSettings: () => void;
  providers: ProviderInfo[];
  serverStt: boolean;
}

export default function Practice({
  settings,
  onSettings: updateSettings,
  history,
  onHistory: setHistory,
  onActiveChange,
  queued,
  onQueuedTaken,
  onOpenSettings,
  providers,
  serverStt,
}: PracticeProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [prepLeft, setPrepLeft] = useState(0);
  const [speakLeft, setSpeakLeft] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [coach, setCoach] = useState<Async<CoachFeedback> | null>(null);
  const [onePager, setOnePager] = useState<Async<OnePager> | null>(null);
  const coachRequestRef = useRef<{ at: string; req: FeedbackRequest } | null>(null);
  const assessInputRef = useRef<{ at: string; input: AssessInput } | null>(null);
  const [assessment, setAssessment] = useState<Async<Assessment> | null>(null);

  const { stream, error, openStream, closeStream, startRecording, stopRecording } = useRecorder();
  const speech = useSpeechRecognition();
  const sampler = useFrameSampler();
  const [videoStats, setVideoStats] = useState<VideoStats | null>(null);
  const [faceStats, setFaceStats] = useState<FaceStats | null>(null);
  const [faceTracker, setFaceTracker] = useState<FaceLandmarker | null>(null);
  const [faceStatus, setFaceStatus] = useState<"off" | "loading" | "ready" | "error">("off");
  const [liveFraming, setLiveFraming] = useState<Framing | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const speakStartRef = useRef(0);
  // Bumped whenever a take starts or the session ends, so late transcription results are ignored.
  const takeIdRef = useRef(0);

  useEffect(() => {
    onActiveChange(phase !== "setup");
  }, [phase, onActiveChange]);

  const coachProvider = resolveCoach(settings, providers);
  const coachModel = coachModelFor(settings, coachProvider);
  const focus = weeklyReview(history).focus;
  const coachSource = coachProvider ? `${coachProvider.label} · ${coachModel}` : "";

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = stream;
  }, [stream, phase]);

  // Release the previous take's object URL when it's replaced or on unmount.
  useEffect(() => {
    return () => {
      if (take) URL.revokeObjectURL(take.url);
    };
  }, [take]);


  async function startSession() {
    setBusy(true);
    const ok = await openStream(settings.camera);
    setBusy(false);
    if (!ok) return;
    setPhase("ready");
    if (settings.camera && settings.faceTracking && !faceTracker) {
      setFaceStatus("loading");
      loadFaceTracker().then(
        (tracker) => {
          setFaceTracker(tracker);
          setFaceStatus("ready");
        },
        () => setFaceStatus("error"),
      );
    }
  }

  // Live framing check on the ready screen, about twice a second.
  useEffect(() => {
    if (phase !== "ready" || !faceTracker || !settings.faceTracking) {
      setLiveFraming(null);
      return;
    }
    const timer = setInterval(() => {
      const video = previewRef.current;
      if (!video) return;
      const f = detectFace(faceTracker, video, 0);
      if (f) setLiveFraming(f.present ? framingFor(f.cx!, f.cy!, f.size!) : "absent");
    }, 500);
    return () => clearInterval(timer);
  }, [phase, faceTracker, settings.faceTracking]);

  function endSession() {
    takeIdRef.current++;
    sampler.stop();
    setVideoStats(null);
    setFaceStats(null);
    void stopRecording();
    void speech.stop();
    closeStream();
    setTake(null);
    setAnalysis(null);
    setCoach(null);
    setAssessment(null);
    setOnePager(null);
    setPrompt(null);
    setPhase("setup");
  }

  function beginPrep(next: Prompt) {
    takeIdRef.current++;
    setVideoStats(null);
    setFaceStats(null);
    setPrompt(next);
    setTake(null);
    setAnalysis(null);
    setCoach(null);
    setAssessment(null);
    setOnePager(null);
    setChecked([]);
    if (settings.prepSeconds === 0) {
      beginSpeaking();
    } else {
      setPrepLeft(settings.prepSeconds);
      setPhase("prep");
    }
  }

  function revealPrompt() {
    if (queued) {
      onQueuedTaken();
      beginPrep(queued);
      return;
    }
    beginPrep(pickPrompt(settings, prompt?.id));
  }

  function beginSpeaking() {
    if (!startRecording()) {
      setPhase("ready");
      return;
    }
    // Without server transcription, transcribe live in the browser while recording.
    if (!serverStt) speech.start(settings.language);
    // Sample the live preview for movement, lighting, framing and eye contact (video takes only).
    if (previewRef.current && stream?.getVideoTracks().length) {
      sampler.start(previewRef.current, settings.faceTracking ? faceTracker : null);
    }
    speakStartRef.current = Date.now();
    setSpeakLeft(settings.speakSeconds);
    setPhase("speaking");
  }

  async function runAnalysis(
    recording: Recording | null,
    browserTranscript: Transcript | null,
    seconds: number,
  ): Promise<Analysis> {
    let transcript: Transcript;
    if (serverStt) {
      if (!recording?.audio) {
        return { status: "unavailable", message: "Couldn't record a separate audio track to transcribe." };
      }
      try {
        transcript = await transcribeOnServer(recording.audio, settings.language);
      } catch (err) {
        return { status: "unavailable", message: err instanceof Error ? err.message : "Transcription failed." };
      }
    } else if (browserTranscript) {
      transcript = browserTranscript;
    } else {
      return {
        status: "unavailable",
        message: speechRecognitionSupported()
          ? "Speech recognition didn't start, so there's no transcript for this take."
          : "This browser can't transcribe speech. Use Chrome, Edge or Safari, or set up Deepgram (see README) to get transcripts in any browser.",
      };
    }
    const stats = analyze(transcript, seconds);
    return { status: "done", transcript, stats, tips: tipsFor(stats) };
  }

  async function finishSpeaking() {
    if (phase !== "speaking" || !prompt) return;
    setPhase("review");
    const id = ++takeIdRef.current;
    const at = new Date().toISOString(); // the take's id across history and IndexedDB
    const seconds = (Date.now() - speakStartRef.current) / 1000;
    const samples = sampler.stop();
    const video = summarizeVideo(samples.frames);
    const face = summarizeFace(samples.faces);
    const [recording, browserTranscript] = await Promise.all([stopRecording(), speech.stop()]);
    if (id !== takeIdRef.current) return;
    setVideoStats(video);
    setFaceStats(face);
    if (recording && recording.media.size > 0) {
      setTake({ url: URL.createObjectURL(recording.media), type: recording.media.type, seconds });
      if (settings.keepRecordings > 0) void keepRecording(at, recording.media);
    }
    setAnalysis({ status: "working" });
    const result = await runAnalysis(recording, browserTranscript, seconds);
    // Record the take even if the user has already moved on.
    setHistory(
      saveSession({
        promptId: prompt.id,
        promptText: prompt.text,
        mode: prompt.mode,
        difficulty: prompt.difficulty,
        seconds: Math.round(seconds),
        at,
        ...(result.status === "done" && {
          words: result.stats.words,
          wpm: result.stats.wpm,
          fillersPerMin: result.stats.fillersPerMin,
          startDelay: result.stats.startDelay,
          longPauses: result.stats.longPauses,
        }),
        ...(video && { movement: video.movement, highMotionShare: video.highShare, lighting: video.lighting }),
        ...(face && { eyeContactShare: face.eyeContactShare, framing: face.framing }),
      }),
    );
    if (result.status === "done" || video || face) {
      void saveDetail(at, {
        ...(result.status === "done" && { transcript: result.transcript, tips: result.tips }),
        ...(video && { video }),
        ...(face && { face }),
      }).catch(() => {});
    }
    if (id !== takeIdRef.current) return;
    setAnalysis(result);

    if (result.status === "done" && settings.analysisProfile === "full" && result.stats.words >= MIN_COACH_WORDS) {
      assessInputRef.current = {
        at,
        input: {
          promptText: prompt.text,
          mode: prompt.mode,
          language: settings.language,
          transcript: result.transcript,
          stats: result.stats,
          audio: recording?.audio ?? null,
          video,
          face,
          seconds,
          allowedSeconds: settings.speakSeconds,
          judge: coachProvider ? { provider: coachProvider.id, model: coachModel, label: coachSource } : null,
        },
      };
      runAssess();
    } else if (result.status === "done" && coachProvider && result.stats.words >= MIN_COACH_WORDS) {
      coachRequestRef.current = {
        at,
        req: {
          provider: coachProvider.id,
          model: coachModel,
          promptText: prompt.text,
          mode: prompt.mode,
          language: settings.language,
          transcript: result.transcript.text,
          seconds,
          stats: {
            wpm: result.stats.wpm,
            fillersPerMin: result.stats.fillersPerMin,
            longPauses: result.stats.longPauses,
            startDelay: result.stats.startDelay,
            highMotionShare: video?.highShare ?? null,
            movement: video?.movement ?? null,
            lighting: video?.lighting ?? null,
            eyeContactShare: face?.eyeContactShare ?? null,
            lookingDownShare: face?.downShare ?? null,
            framing: face?.framing ?? null,
          },
        },
      };
      runCoach();
    }
  }

  /** The 50-metric assessment (full profile). Saved with the take even if the user moves on. */
  function runAssess() {
    const pending = assessInputRef.current;
    if (!pending) return;
    const id = takeIdRef.current;
    setAssessment({ status: "working" });
    runAssessment(pending.input).then(
      (data) => {
        const overall = overallScores(data.metrics).overall;
        if (overall !== null) setHistory(updateSession(pending.at, { assessmentScore: Math.round(overall * 10) / 10 }));
        void saveDetail(pending.at, { assessment: data }).catch(() => {});
        if (id === takeIdRef.current) setAssessment({ status: "done", data });
      },
      (err: Error) => id === takeIdRef.current && setAssessment({ status: "error", message: err.message }),
    );
  }

  /** Save the recording locally and drop the oldest beyond the user's limit. Best effort. */
  async function keepRecording(at: string, media: Blob) {
    try {
      requestPersistentStorage();
      await saveRecording(at, media);
      await pruneRecordings(settings.keepRecordings);
    } catch {
      // Storage full or unavailable: the take still works, it just isn't kept.
    }
  }

  function runCoach() {
    const pending = coachRequestRef.current;
    if (!pending) return;
    const id = takeIdRef.current;
    setCoach({ status: "working" });
    requestFeedback(pending.req).then(
      (data) => {
        // Store the feedback and score with the take, even if the user has moved on.
        const score = SCORE_KEYS.reduce((sum, k) => sum + data.scores[k], 0) / SCORE_KEYS.length;
        setHistory(updateSession(pending.at, { score }));
        void saveDetail(pending.at, { feedback: data }).catch(() => {});
        if (id === takeIdRef.current) setCoach({ status: "done", data });
      },
      (err: Error) => id === takeIdRef.current && setCoach({ status: "error", message: err.message }),
    );
  }

  function loadOnePager() {
    if (!coachProvider || !prompt) return;
    const req = {
      provider: coachProvider.id,
      model: coachModel,
      promptText: prompt.text,
      mode: prompt.mode,
      language: settings.language,
    };
    const cached = cachedOnePager(req);
    if (cached) {
      setOnePager({ status: "done", data: cached });
      return;
    }
    const id = takeIdRef.current;
    setOnePager({ status: "working" });
    requestOnePager(req).then(
      (data) => {
        cacheOnePager(req, data);
        if (id === takeIdRef.current) setOnePager({ status: "done", data });
      },
      (err: Error) => id === takeIdRef.current && setOnePager({ status: "error", message: err.message }),
    );
  }

  function answerFollowUp(question: string) {
    beginPrep({ id: `followup-${Date.now()}`, mode: "speech", difficulty: prompt?.difficulty ?? 2, text: question });
  }

  function seekTo(seconds: number) {
    const el = playbackRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds - 0.3);
    void el.play();
  }

  // Prep countdown.
  useEffect(() => {
    if (phase !== "prep") return;
    if (prepLeft <= 0) {
      beginSpeaking();
      return;
    }
    const t = setTimeout(() => setPrepLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, prepLeft]);

  // Speaking countdown; auto-stops at the time limit.
  useEffect(() => {
    if (phase !== "speaking") return;
    if (speakLeft <= 0) {
      void finishSpeaking();
      return;
    }
    const t = setTimeout(() => setSpeakLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, speakLeft]);

  const hasVideo = !!stream && stream.getVideoTracks().length > 0;
  const showStage = phase === "ready" || phase === "prep" || phase === "speaking";

  return (
    <>
      {error && (
        <div className="alert" role="alert">
          {error}
          {settings.camera && (
            <button className="link" onClick={() => updateSettings({ camera: false })}>
              Switch to audio only
            </button>
          )}
        </div>
      )}

      {phase === "setup" && (
        <section className="card hero">
          <h1>Ready to practise?</h1>
          <p className="muted">
            You&apos;ll get a random prompt,{" "}
            {settings.prepSeconds > 0 ? `${formatSeconds(settings.prepSeconds)} to think` : "no thinking time"}, then{" "}
            {formatSeconds(settings.speakSeconds)} to speak to the camera.
          </p>

          <div className="setup-summary" aria-label="Current settings">
            <span className="tag subtle">
              {settings.modes.length === Object.keys(MODES).length
                ? "All prompt types"
                : settings.modes.map((m) => MODES[m].label).join(", ")}
            </span>
            <span className="tag subtle">
              {settings.difficulty === "any" ? "Mixed difficulty" : DIFFICULTY_LABELS[settings.difficulty]}
            </span>
            <span className="tag subtle">
              {settings.camera ? (settings.faceTracking ? "Video + face tracking" : "Video") : "Audio only"}
            </span>
            <span className="tag subtle">{coachProvider ? `Coach: ${coachProvider.label}` : "No AI coach"}</span>
            <span className="tag subtle">{settings.analysisProfile === "full" ? "Full assessment" : "Quick coach"}</span>
            <button className="link small" onClick={onOpenSettings}>
              Change
            </button>
          </div>

          {queued && (
            <div className="queued">
              <span className="small muted">Up next</span>
              <span className="queued-text">{queued.text}</span>
              <button className="link" onClick={onQueuedTaken}>
                Clear
              </button>
            </div>
          )}

          <button className="primary hero-start" onClick={startSession} disabled={busy}>
            {busy ? "Starting camera…" : queued ? "▶ Start session with this prompt" : "▶ Start new session"}
          </button>

          {history.length > 0 && (
            <p className="hero-focus small">
              <span className="muted">This week&apos;s focus:</span> <strong>{focus.title}.</strong> {focus.detail}
            </p>
          )}
        </section>
      )}

      {showStage && (
        <section className="card stage-card">
          {prompt && phase !== "ready" && (
            <div className="prompt">
              <div className="prompt-meta">
                <span className="tag">{MODES[prompt.mode].label}</span>
                <span className="tag subtle">{DIFFICULTY_LABELS[prompt.difficulty]}</span>
              </div>
              <p className="prompt-text">{prompt.text}</p>
              <p className="muted small">{MODES[prompt.mode].hint}</p>
            </div>
          )}

          <div className={`stage ${phase === "speaking" ? "live" : ""}`}>
            {hasVideo ? (
              <video ref={previewRef} className="preview" autoPlay muted playsInline />
            ) : (
              <div className="preview audio-only">🎙️ Audio only</div>
            )}
            {phase === "ready" && describeVideo(stream) && (
              <div className="cam-info">
                {describeVideo(stream)}
                {faceStatus === "loading" && " · loading face tracking…"}
                {faceStatus === "error" && " · face tracking unavailable"}
              </div>
            )}
            {phase === "ready" && liveFraming && (
              <div className={`framing-badge ${liveFraming === "good" ? "ok" : ""}`} role="status">
                {liveFraming === "good" ? "✓ " : ""}
                {FRAMING_HINT[liveFraming]}
              </div>
            )}

            {phase === "prep" && (
              <div className="overlay">
                <div className="overlay-label">Think</div>
                <div className="countdown">{prepLeft}</div>
              </div>
            )}
            {phase === "speaking" && (
              <>
                <div className="rec-badge">● REC</div>
                <div className="timer">{formatSeconds(speakLeft)}</div>
                <div
                  className="progress"
                  style={{ width: `${(1 - speakLeft / settings.speakSeconds) * 100}%` }}
                />
              </>
            )}
          </div>

          <div className="actions">
            {phase === "ready" && (
              <>
                <button className="primary big" onClick={revealPrompt}>
                  Reveal prompt{settings.prepSeconds > 0 ? ` (${formatSeconds(settings.prepSeconds)} to think)` : ""}
                </button>
                <button className="ghost" onClick={endSession}>
                  End session
                </button>
              </>
            )}
            {phase === "prep" && (
              <>
                <button className="primary" onClick={beginSpeaking}>
                  Start speaking now
                </button>
                <button className="ghost" onClick={revealPrompt}>
                  Different prompt
                </button>
              </>
            )}
            {phase === "speaking" && (
              <button className="danger" onClick={() => void finishSpeaking()}>
                Stop
              </button>
            )}
          </div>
        </section>
      )}

      {phase === "review" && prompt && (
        <section className="card">
          <div className="prompt">
            <div className="prompt-meta">
              <span className="tag">{MODES[prompt.mode].label}</span>
              {take && <span className="tag subtle">{formatSeconds(take.seconds)}</span>}
            </div>
            <p className="prompt-text">{prompt.text}</p>
          </div>

          {take ? (
            take.type.startsWith("audio") ? (
              <audio ref={playbackRef} className="playback-audio" src={take.url} controls />
            ) : (
              <video ref={playbackRef} className="playback" src={take.url} controls playsInline />
            )
          ) : (
            <p className="muted">Saving your take…</p>
          )}

          {analysis && <Feedback analysis={analysis} onSeek={take ? seekTo : undefined} />}

          {videoStats && <VideoFeedback stats={videoStats} face={faceStats} onSeek={take ? seekTo : undefined} />}

          {coach && (
            <CoachPanel state={coach} source={coachSource} onRetry={runCoach} onFollowUp={answerFollowUp} />
          )}

          {assessment && <AssessmentPanel state={assessment} onRetry={runAssess} />}

          {coachProvider &&
            (onePager ? (
              <OnePagerPanel state={onePager} source={coachSource} onRetry={loadOnePager} />
            ) : (
              <button className="secondary learn-btn" onClick={loadOnePager}>
                Learn this topic: get a one-pager
              </button>
            ))}

          <div className="self-check">
            <h2>Watch it back, then check yourself</h2>
            {SELF_CHECK.map((item, i) => (
              <label key={item} className="check">
                <input
                  type="checkbox"
                  checked={!!checked[i]}
                  onChange={(e) => {
                    const next = [...checked];
                    next[i] = e.target.checked;
                    setChecked(next);
                  }}
                />
                {item}
              </label>
            ))}
            <p className="muted small">
              {checked.filter(Boolean).length}/{SELF_CHECK.length}. Doing a second take on the
              same prompt is the fastest way to improve.
            </p>
          </div>

          <div className="actions">
            <button className="primary" onClick={() => beginPrep(prompt)}>
              Try again, same prompt
            </button>
            <button className="secondary" onClick={revealPrompt}>
              Next prompt
            </button>
            {take && (
              <a
                className="ghost"
                href={take.url}
                download={`speak-up-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}.${
                  take.type.includes("mp4") ? "mp4" : "webm"
                }`}
              >
                Download
              </a>
            )}
            <button className="ghost" onClick={endSession}>
              End session
            </button>
          </div>
        </section>
      )}
    </>
  );
}

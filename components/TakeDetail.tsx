"use client";

import { useEffect, useRef, useState } from "react";
import { CoachPanel } from "@/components/Coach";
import Feedback from "@/components/Feedback";
import { analyze, tips as tipsFor } from "@/lib/analysis";
import type { Session } from "@/lib/history";
import { DIFFICULTY_LABELS, MODES, type Prompt } from "@/lib/prompts";
import { formatSeconds } from "@/lib/settings";
import { deleteRecording, getDetail, getRecording, type TakeDetail as Detail } from "@/lib/takeStore";

interface Props {
  take: Session;
  onClose: () => void;
  onPractise: (p: Prompt) => void;
  onDelete: (at: string) => void;
  /** Called after the recording alone is deleted, so lists can update. */
  onRecordingDeleted: () => void;
}

/** A past take: its recording (if kept), stats, transcript and AI feedback. */
export default function TakeDetail({ take, onClose, onPractise, onDelete, onRecordingDeleted }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const playerRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  const [media, setMedia] = useState<{ url: string; type: string } | null | undefined>(undefined);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    getDetail(take.at).then(
      (d) => !cancelled && setDetail(d),
      () => !cancelled && setDetail(null),
    );
    getRecording(take.at).then(
      (blob) => {
        if (cancelled) return;
        if (!blob) return setMedia(null);
        url = URL.createObjectURL(blob);
        setMedia({ url, type: blob.type });
      },
      () => !cancelled && setMedia(null),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [take.at]);

  const stats = detail?.transcript ? analyze(detail.transcript, take.seconds) : null;
  const when = new Date(take.at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  const prompt: Prompt = {
    id: take.promptId,
    mode: take.mode,
    difficulty: take.difficulty ?? 2,
    text: take.promptText,
  };

  function seek(seconds: number) {
    const el = playerRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds - 0.3);
    void el.play();
  }

  async function removeRecording() {
    if (!confirm("Delete this recording? The stats and feedback stay.")) return;
    await deleteRecording(take.at).catch(() => {});
    setMedia(null);
    onRecordingDeleted();
  }

  return (
    <dialog ref={dialogRef} className="take-dialog" onClose={onClose} aria-labelledby="take-title">
      <div className="take-dialog-head">
        <div>
          <div className="prompt-meta">
            <span className="tag">{MODES[take.mode].label}</span>
            {take.difficulty && <span className="tag subtle">{DIFFICULTY_LABELS[take.difficulty]}</span>}
            <span className="tag subtle">{formatSeconds(take.seconds)}</span>
          </div>
          <h2 id="take-title" className="prompt-text">
            {take.promptText}
          </h2>
          <p className="muted small">{when}</p>
        </div>
        <button className="ghost close" onClick={() => dialogRef.current?.close()} aria-label="Close">
          ✕
        </button>
      </div>

      {media === undefined ? null : media ? (
        media.type.startsWith("audio") ? (
          <audio ref={playerRef} className="playback-audio" src={media.url} controls />
        ) : (
          <video ref={playerRef} className="playback" src={media.url} controls playsInline />
        )
      ) : (
        <p className="muted small no-recording">The recording for this take wasn&apos;t kept.</p>
      )}

      {detail === undefined ? (
        <p className="muted working">Loading…</p>
      ) : stats && detail?.transcript ? (
        <Feedback
          analysis={{ status: "done", transcript: detail.transcript, stats, tips: detail.tips ?? tipsFor(stats) }}
          onSeek={media ? seek : undefined}
        />
      ) : (
        <p className="muted small">No transcript was saved for this take.</p>
      )}

      {detail?.feedback && (
        <CoachPanel
          state={{ status: "done", data: detail.feedback }}
          source="Saved feedback"
          onRetry={() => {}}
          onFollowUp={(q) => onPractise({ id: `followup-${Date.now()}`, mode: "speech", difficulty: prompt.difficulty, text: q })}
        />
      )}

      <div className="actions">
        <button className="primary" onClick={() => onPractise(prompt)}>
          Practise this prompt again
        </button>
        {media && (
          <a
            className="ghost"
            href={media.url}
            download={`speak-up-${take.at.slice(0, 16).replace(/[T:]/g, "-")}.${media.type.includes("mp4") ? "mp4" : "webm"}`}
          >
            Download
          </a>
        )}
        {media && (
          <button className="ghost" onClick={removeRecording}>
            Delete recording
          </button>
        )}
        <button
          className="ghost danger-text"
          onClick={() => {
            if (confirm("Delete this take, its recording and feedback? This can't be undone.")) onDelete(take.at);
          }}
        >
          Delete take
        </button>
      </div>
    </dialog>
  );
}

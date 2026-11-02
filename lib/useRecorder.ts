"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const VIDEO_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function pickMimeType(video: boolean): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return (video ? VIDEO_TYPES : AUDIO_TYPES).find((t) => MediaRecorder.isTypeSupported(t));
}

function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return "Camera/microphone permission was denied. Allow access in your browser's site settings and try again.";
    }
    if (err.name === "NotFoundError") {
      return "No camera or microphone was found on this device.";
    }
    if (err.name === "NotReadableError") {
      return "Your camera or microphone is being used by another app.";
    }
  }
  return "Couldn't start the camera or microphone.";
}

export interface Recording {
  /** What the user watches back: video+audio, or audio only when the camera is off. */
  media: Blob;
  /** Small audio-only copy for transcription uploads (null if it couldn't be recorded). */
  audio: Blob | null;
}

/** Records a stream into chunks; `stop()` resolves with the finished blob. */
function startTrack(stream: MediaStream, mimeType: string | undefined, options: MediaRecorderOptions = {}) {
  const recorder = new MediaRecorder(stream, mimeType ? { ...options, mimeType } : options);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);
  const stop = (): Promise<Blob | null> => {
    if (recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || chunks[0]?.type || mimeType || "video/webm";
        resolve(new Blob(chunks, { type }));
      };
      recorder.stop();
    });
  };
  return { stop };
}

type Track = ReturnType<typeof startTrack>;

/** Recording frame-rate ceiling. Higher rates only make files bigger for a talking-head video. */
export const MAX_FPS = 60;

/** Actual camera resolution and frame rate, e.g. "1280×720 · 30 fps" (null without video). */
export function describeVideo(stream: MediaStream | null): string | null {
  const s = stream?.getVideoTracks()[0]?.getSettings();
  if (!s?.width || !s.height) return null;
  return `${s.width}×${s.height}${s.frameRate ? ` · ${Math.round(s.frameRate)} fps` : ""}`;
}

/** Camera/mic stream plus MediaRecorders for one take at a time. */
export function useRecorder() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRef = useRef<Track | null>(null);
  const audioRef = useRef<Track | null>(null);

  const closeStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  /** Open (or reuse) a stream. Returns false if access failed. */
  const openStream = useCallback(
    async (video: boolean): Promise<boolean> => {
      const current = streamRef.current;
      if (current && current.getVideoTracks().length > 0 === video) return true;
      closeStream();
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't record. Try a recent Chrome, Edge, Firefox or Safari over HTTPS.");
        return false;
      }
      const audio = { echoCancellation: true, noiseSuppression: true };
      const camera: MediaTrackConstraints = { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };
      try {
        let s: MediaStream;
        try {
          s = await navigator.mediaDevices.getUserMedia({
            audio,
            // Only a ceiling: the camera keeps its own rate (often 30) up to 60 fps.
            video: video ? { ...camera, frameRate: { max: MAX_FPS } } : false,
          });
        } catch (err) {
          // A camera that can't satisfy the frame-rate cap: retry without it and cap the track afterwards.
          if (!(video && err instanceof DOMException && err.name === "OverconstrainedError")) throw err;
          s = await navigator.mediaDevices.getUserMedia({ audio, video: camera });
          await s.getVideoTracks()[0]?.applyConstraints({ frameRate: { max: MAX_FPS } }).catch(() => {});
        }
        streamRef.current = s;
        setStream(s);
        return true;
      } catch (err) {
        setError(describeError(err));
        return false;
      }
    },
    [closeStream],
  );

  const startRecording = useCallback((): boolean => {
    const s = streamRef.current;
    if (!s) return false;
    const hasVideo = s.getVideoTracks().length > 0;
    try {
      mediaRef.current = startTrack(s, pickMimeType(hasVideo));
    } catch {
      setError("Recording isn't supported in this browser.");
      return false;
    }
    // A low-bitrate audio-only copy keeps transcription uploads small (~0.4 MB/min).
    audioRef.current = null;
    if (hasVideo) {
      try {
        audioRef.current = startTrack(new MediaStream(s.getAudioTracks()), pickMimeType(false), {
          audioBitsPerSecond: 48000,
        });
      } catch {
        // Transcription upload will be skipped; playback still works.
      }
    }
    return true;
  }, []);

  const stopRecording = useCallback(async (): Promise<Recording | null> => {
    const media = mediaRef.current;
    const audio = audioRef.current;
    mediaRef.current = null;
    audioRef.current = null;
    if (!media) return null;
    const [mediaBlob, audioBlob] = await Promise.all([media.stop(), audio ? audio.stop() : null]);
    if (!mediaBlob) return null;
    const audioOnly = mediaBlob.type.startsWith("audio");
    return { media: mediaBlob, audio: audio ? audioBlob : audioOnly ? mediaBlob : null };
  }, []);

  useEffect(() => closeStream, [closeStream]);

  return { stream, error, openStream, closeStream, startRecording, stopRecording };
}

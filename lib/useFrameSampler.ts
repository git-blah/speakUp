"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef } from "react";
import type { FaceSample } from "./face/faceAnalysis";
import { detectFace } from "./face/faceTracker";
import {
  SAMPLE_H,
  SAMPLE_INTERVAL_MS,
  SAMPLE_W,
  frameSample,
  regionDiff,
  toGray,
  type FrameSample,
} from "./videoAnalysis";

export interface Samples {
  frames: FrameSample[];
  faces: FaceSample[];
}

/**
 * Samples the live preview while a take records, about 4 times a second: a tiny greyscale frame
 * for movement and lighting, and (if a face landmarker is loaded) the face for framing and eye
 * contact. It reads the preview only and never touches the recording.
 */
export function useFrameSampler() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const samplesRef = useRef<Samples>({ frames: [], faces: [] });

  const stop = useCallback((): Samples => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const out = samplesRef.current;
    samplesRef.current = { frames: [], faces: [] };
    return out;
  }, []);

  const start = useCallback(
    (video: HTMLVideoElement, face: FaceLandmarker | null = null): boolean => {
      stop();
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE_W;
      canvas.height = SAMPLE_H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return false;
      const startedAt = performance.now();
      let prev: Uint8Array | null = null;
      timerRef.current = setInterval(() => {
        if (video.readyState < 2) return; // no frame yet
        const t = (performance.now() - startedAt) / 1000;
        let frame: FrameSample | null = null;
        let gray: Uint8Array | null = null;
        try {
          ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
          gray = toGray(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
          frame = frameSample(gray, prev, t);
          samplesRef.current.frames.push(frame);
          prev = gray;
        } catch {
          // A frame can fail to draw mid-resize; skip it.
        }
        if (face) {
          const f = detectFace(face, video, t);
          if (f) {
            samplesRef.current.faces.push(f);
            // Face vs background brightness, for a more reliable backlight check.
            if (frame && gray && f.present) {
              const d = regionDiff(gray, f.cx!, f.cy!, f.w!, f.size!);
              if (d !== null) frame.faceDiff = d;
            }
          }
        }
      }, SAMPLE_INTERVAL_MS);
      return true;
    },
    [stop],
  );

  useEffect(() => () => void stop(), [stop]);

  return { start, stop };
}

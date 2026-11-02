"use client";

import { useCallback, useEffect, useRef } from "react";
import { SAMPLE_H, SAMPLE_INTERVAL_MS, SAMPLE_W, frameSample, toGray, type FrameSample } from "./videoAnalysis";

/**
 * Samples tiny greyscale frames from a playing <video> (the live preview) while a take records.
 * About 4 frames a second at 64×48, so it costs almost nothing and never touches the recording.
 */
export function useFrameSampler() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const samplesRef = useRef<FrameSample[]>([]);

  const stop = useCallback((): FrameSample[] => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const out = samplesRef.current;
    samplesRef.current = [];
    return out;
  }, []);

  const start = useCallback(
    (video: HTMLVideoElement): boolean => {
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
        try {
          ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
          const gray = toGray(ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data);
          samplesRef.current.push(frameSample(gray, prev, (performance.now() - startedAt) / 1000));
          prev = gray;
        } catch {
          // A frame can fail to draw mid-resize; skip it.
        }
      }, SAMPLE_INTERVAL_MS);
      return true;
    },
    [stop],
  );

  useEffect(() => () => void stop(), [stop]);

  return { start, stop };
}

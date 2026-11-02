/**
 * Basic on-camera analysis from small greyscale frames: how much the picture moves and how well
 * it's lit. No ML and nothing leaves the browser. Thresholds are starting points from typical
 * webcam footage; tune them here if they feel too strict or too lenient.
 */

export const SAMPLE_W = 64;
export const SAMPLE_H = 48;
export const SAMPLE_INTERVAL_MS = 250;

/** A pixel counts as "changed" when its brightness moves by more than this (0–255). */
const PIXEL_DIFF = 25;
/** Share of changed pixels below which a frame counts as still. */
const STILL = 0.01;
/** Share of changed pixels above which a frame counts as a lot of movement. */
const HIGH = 0.12;
/**
 * The camera probably moved when the frame's outer border changes this much: a speaker moves
 * in the middle while the background around them stays put, but a moving camera shifts everything.
 */
const EDGE_MOVE = 0.3;
/** ...or when nearly the whole frame changes (lights switched, camera knocked). */
const CAMERA_MOVE = 0.6;

const COVERED = 12;
const DARK = 60;
const BRIGHT = 205;
/** Centre this much darker than the edges (0–255) suggests a bright window behind the speaker. */
const BACKLIT = -45;

export interface FrameSample {
  /** Seconds since recording started. */
  t: number;
  /** Mean brightness, 0–255. */
  brightness: number;
  /** Share of pixels that changed since the previous frame (null for the first frame). */
  motion: number | null;
  /** Share of the outer border's pixels that changed (null for the first frame). */
  edgeMotion: number | null;
  /** Centre brightness minus edge brightness. */
  centerDiff: number;
}

export type Movement = "still" | "natural" | "busy" | "shaky";
export type Lighting = "good" | "dark" | "bright" | "backlit" | "covered";

export interface VideoStats {
  samples: number;
  /** Mean share of changed pixels per frame (0–1). */
  motionAvg: number;
  /** Share of the take with a lot of movement (0–1). */
  highShare: number;
  /** Share of the take with almost no movement (0–1). */
  stillShare: number;
  /** Share of the take where the whole camera seemed to move (0–1). */
  cameraMoveShare: number;
  brightness: number;
  movement: Movement;
  lighting: Lighting;
  /** Mean motion per second of the take (0–1), for the timeline. */
  timeline: number[];
}

export const HIGH_MOTION = HIGH;

/** RGBA pixels (from canvas getImageData) to luma. */
export function toGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

export function frameSample(gray: Uint8Array, prev: Uint8Array | null, t: number, w = SAMPLE_W, h = SAMPLE_H): FrameSample {
  let sum = 0;
  let changed = 0;
  let edgeChanged = 0;
  let edgeN = 0;
  let centerSum = 0;
  let centerN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = gray[i];
      sum += v;
      const isChanged = prev !== null && Math.abs(v - prev[i]) > PIXEL_DIFF;
      if (isChanged) changed++;
      // Border = outer sixth on every side.
      if (x < w / 6 || x >= (5 * w) / 6 || y < h / 6 || y >= (5 * h) / 6) {
        edgeN++;
        if (isChanged) edgeChanged++;
      }
      // Centre = middle third horizontally, middle half vertically (where a face usually is).
      if (x >= w / 3 && x < (2 * w) / 3 && y >= h / 4 && y < (3 * h) / 4) {
        centerSum += v;
        centerN++;
      }
    }
  }
  const n = w * h;
  const centerMean = centerSum / centerN;
  const edgeMean = (sum - centerSum) / (n - centerN);
  return {
    t,
    brightness: sum / n,
    motion: prev ? changed / n : null,
    edgeMotion: prev ? edgeChanged / edgeN : null,
    centerDiff: centerMean - edgeMean,
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Summarize a take's frame samples; null if there were too few to judge. */
export function summarizeVideo(samples: FrameSample[]): VideoStats | null {
  const moving = samples.filter(
    (s): s is FrameSample & { motion: number; edgeMotion: number } => s.motion !== null && s.edgeMotion !== null,
  );
  if (moving.length < 4) return null;

  const isCameraMove = (s: { motion: number; edgeMotion: number }) => s.edgeMotion > EDGE_MOVE || s.motion > CAMERA_MOVE;
  const cameraMoves = moving.filter(isCameraMove).length;
  const high = moving.filter((s) => s.motion > HIGH && !isCameraMove(s)).length;
  const still = moving.filter((s) => s.motion < STILL).length;
  const share = (n: number) => n / moving.length;

  const brightness = samples.reduce((a, s) => a + s.brightness, 0) / samples.length;
  const centerDiff = median(samples.map((s) => s.centerDiff));

  let movement: Movement = "natural";
  if (share(cameraMoves) > 0.15) movement = "shaky";
  else if (share(high) > 0.3) movement = "busy";
  else if (share(still) > 0.85) movement = "still";

  let lighting: Lighting = "good";
  // Backlit before bright: a bright window behind you raises the average but the fix is different.
  if (brightness < COVERED) lighting = "covered";
  else if (brightness < DARK) lighting = "dark";
  else if (centerDiff < BACKLIT) lighting = "backlit";
  else if (brightness > BRIGHT) lighting = "bright";

  const seconds = Math.ceil(moving[moving.length - 1].t);
  const timeline = Array.from({ length: Math.max(1, seconds) }, (_, sec) => {
    const inSec = moving.filter((s) => s.t >= sec && s.t < sec + 1);
    return inSec.length ? inSec.reduce((a, s) => a + s.motion, 0) / inSec.length : 0;
  });

  return {
    samples: samples.length,
    motionAvg: moving.reduce((a, s) => a + s.motion, 0) / moving.length,
    highShare: share(high),
    stillShare: share(still),
    cameraMoveShare: share(cameraMoves),
    brightness,
    movement,
    lighting,
    timeline,
  };
}

export const MOVEMENT_LABEL: Record<Movement, string> = {
  still: "Very still",
  natural: "Natural",
  busy: "A lot of movement",
  shaky: "Camera moving",
};

export const LIGHTING_LABEL: Record<Lighting, string> = {
  good: "Good",
  dark: "Too dark",
  bright: "Washed out",
  backlit: "Backlit",
  covered: "Camera blocked",
};

/** Concrete suggestions about on-camera presence. */
export function videoTips(v: VideoStats): string[] {
  const out: string[] = [];
  if (v.movement === "shaky") {
    out.push("The camera itself moved a lot. Rest your phone or laptop on something stable so you don't have to hold it.");
  } else if (v.movement === "busy") {
    out.push(
      `There was a lot of movement for ${Math.round(v.highShare * 100)}% of the take. Gestures are good, but rocking, swaying or fidgeting distracts. Plant your feet and keep gestures in front of your chest.`,
    );
  } else if (v.movement === "still") {
    out.push("You were very still. A few natural hand gestures make you look more confident and engaged.");
  }
  const light: Partial<Record<Lighting, string>> = {
    covered: "The camera looks covered or blocked.",
    dark: "Your video is quite dark. Face a window or lamp so your face is lit from the front.",
    bright: "The picture is washed out. Move away from direct light or turn down the brightness.",
    backlit: "You're backlit: the background is brighter than you. Turn so the light is in front of you, not behind.",
  };
  if (light[v.lighting]) out.push(light[v.lighting]!);
  return out;
}

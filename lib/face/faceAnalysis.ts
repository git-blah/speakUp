/**
 * Framing and eye contact from MediaPipe FaceLandmarker results. Pure functions so they can be
 * tested with synthetic data; the browser-only loading lives in faceTracker.ts.
 *
 * All positions are in the camera's raw (unmirrored) image, normalised 0–1. The preview the user
 * sees is mirrored, so left/right advice is flipped to match what they see.
 */

// ---- tunable thresholds ----

/** Head turned more than this many degrees left/right counts as looking away. */
const HEAD_YAW_AWAY = 25;
/**
 * Head pitch is judged against the speaker's own upright pose in the take (camera height changes
 * what "level" looks like): this many degrees below it counts as looking down...
 */
const PITCH_DOWN_REL = 15;
/** ...this many above it as looking away (up)... */
const PITCH_UP_REL = 20;
/** ...and anything below this absolute angle is looking down whatever the baseline. */
const PITCH_DOWN_ABS = -35;
/** Eye blendshape scores (0–1) above which the eyes are clearly looking down / to the side. */
const EYES_DOWN = 0.55;
const EYES_SIDE = 0.55;

/**
 * Face height (brow to chin, hair excluded) as a share of the frame: smaller is too far, bigger is
 * too close. Very small faces aren't detected at all, which shows as "no face".
 */
const FACE_FAR = 0.15;
const FACE_CLOSE = 0.42;
/** Face centre further than this from the middle (0–0.5) is off to one side. */
const OFF_CENTRE = 0.15;
/** Face centre above / below these heights (0 = top) is too high / too low. */
const TOO_HIGH = 0.3;
const TOO_LOW = 0.62;

export type Gaze = "camera" | "down" | "away";
export type Framing = "good" | "left" | "right" | "high" | "low" | "close" | "far" | "absent";

export interface FaceSample {
  /** Seconds since recording started. */
  t: number;
  present: boolean;
  /** Face box centre, width and height, normalised to the raw camera frame. */
  cx?: number;
  cy?: number;
  w?: number;
  size?: number;
  /** Head rotation in degrees (+ pitch = tilted up; verified on a real face, see README). */
  yaw?: number;
  pitch?: number;
  /** Eye blendshape signals, 0–1: both eyes looking down / to one side. */
  eyesDown?: number;
  eyesSide?: number;
}

export interface FaceStats {
  samples: number;
  /** Share of samples with a face in view. */
  presentShare: number;
  /** Shares of the samples with a face. */
  eyeContactShare: number;
  downShare: number;
  awayShare: number;
  framing: Framing;
  /** Median face centre and size, for display. */
  cx: number;
  cy: number;
  size: number;
  /** Median head rotation in degrees (see FaceSample). */
  yaw: number;
  pitch: number;
  /** Per second: where the speaker mostly looked, or "none" when no face was seen. */
  timeline: (Gaze | "none")[];
}

/** The parts of a FaceLandmarkerResult we use (kept structural so tests don't need MediaPipe). */
export interface LandmarkerResultLike {
  faceLandmarks: { x: number; y: number }[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { data: number[] }[];
}

const DEG = 180 / Math.PI;

/**
 * Head yaw/pitch from MediaPipe's facial transformation matrix (4×4, column-major). The third
 * column is the face's forward axis in camera space; facing the camera it points along +z.
 */
export function headPose(matrix: number[]): { yaw: number; pitch: number } {
  const fx = matrix[8];
  const fy = matrix[9];
  const fz = matrix[10];
  return { yaw: Math.atan2(fx, fz) * DEG, pitch: Math.atan2(fy, Math.hypot(fx, fz)) * DEG };
}

export function eyeSignals(blendshapes: Record<string, number>): { eyesDown: number; eyesSide: number } {
  const b = (name: string) => blendshapes[name] ?? 0;
  return {
    eyesDown: (b("eyeLookDownLeft") + b("eyeLookDownRight")) / 2,
    // Both eyes towards the subject's left: left eye looks out, right eye looks in (and vice versa).
    eyesSide: Math.max(
      (b("eyeLookOutLeft") + b("eyeLookInRight")) / 2,
      (b("eyeLookInLeft") + b("eyeLookOutRight")) / 2,
    ),
  };
}

interface GazeSignals {
  yaw: number;
  pitch: number;
  eyesDown: number;
  eyesSide: number;
}

/** Where one snapshot was looking, given the speaker's upright head pitch for this take. */
export function classifyGaze(s: GazeSignals, basePitch = 0): Gaze {
  const rel = s.pitch - basePitch;
  if (rel < -PITCH_DOWN_REL || s.pitch < PITCH_DOWN_ABS || s.eyesDown > EYES_DOWN) return "down";
  if (Math.abs(s.yaw) > HEAD_YAW_AWAY || rel > PITCH_UP_REL || s.eyesSide > EYES_SIDE) return "away";
  return "camera";
}

/** One FaceSample from a landmarker result. */
export function faceSample(result: LandmarkerResultLike, t: number): FaceSample {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks || landmarks.length === 0) return { t, present: false };

  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const blendshapes = Object.fromEntries(
    (result.faceBlendshapes?.[0]?.categories ?? []).map((c) => [c.categoryName, c.score]),
  );
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  const { yaw, pitch } = matrix && matrix.length >= 16 ? headPose(matrix) : { yaw: 0, pitch: 0 };

  return {
    t,
    present: true,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    size: maxY - minY,
    yaw,
    pitch,
    ...eyeSignals(blendshapes),
  };
}

/** Framing for one position (also used for the live check before a take). */
export function framingFor(cx: number, cy: number, size: number): Framing {
  if (size < FACE_FAR) return "far";
  if (size > FACE_CLOSE) return "close";
  if (cy - size / 2 < 0.02 || cy < TOO_HIGH) return "high";
  if (cy > TOO_LOW) return "low";
  // The preview is mirrored: a face on the raw image's left appears on the user's right.
  if (cx < 0.5 - OFF_CENTRE) return "right";
  if (cx > 0.5 + OFF_CENTRE) return "left";
  return "good";
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Summarize a take's face samples; null if there were too few to judge. */
export function summarizeFace(samples: FaceSample[]): FaceStats | null {
  if (samples.length < 4) return null;
  const seen = samples.filter((s) => s.present && s.cx !== undefined);
  const share = (n: number) => (seen.length ? n / seen.length : 0);
  // The speaker's upright pose: the 75th percentile of head pitch, so it holds even if they look
  // down at notes much of the time. Clamped so a whole take spent looking down still shows.
  const basePitch = seen.length ? Math.min(15, Math.max(-20, percentile(seen.map((s) => s.pitch ?? 0), 0.75))) : 0;
  const gazeOf = (s: FaceSample): Gaze =>
    classifyGaze({ yaw: s.yaw ?? 0, pitch: s.pitch ?? 0, eyesDown: s.eyesDown ?? 0, eyesSide: s.eyesSide ?? 0 }, basePitch);
  const gazes = new Map(seen.map((s) => [s, gazeOf(s)]));
  const presentShare = seen.length / samples.length;

  const cx = seen.length ? median(seen.map((s) => s.cx!)) : 0.5;
  const cy = seen.length ? median(seen.map((s) => s.cy!)) : 0.5;
  const size = seen.length ? median(seen.map((s) => s.size!)) : 0;
  const yaw = seen.length ? median(seen.map((s) => s.yaw ?? 0)) : 0;
  const pitch = seen.length ? median(seen.map((s) => s.pitch ?? 0)) : 0;
  const framing: Framing = presentShare < 0.5 ? "absent" : framingFor(cx, cy, size);

  const seconds = Math.max(1, Math.ceil(samples[samples.length - 1].t));
  const timeline = Array.from({ length: seconds }, (_, sec): Gaze | "none" => {
    const inSec = samples.filter((s) => s.t >= sec && s.t < sec + 1);
    const withFace = inSec.filter((s) => gazes.has(s));
    if (withFace.length === 0 || withFace.length < inSec.length / 2) return "none";
    const counts: Record<Gaze, number> = { camera: 0, down: 0, away: 0 };
    for (const s of withFace) counts[gazes.get(s)!]++;
    return (Object.keys(counts) as Gaze[]).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  });

  return {
    samples: samples.length,
    presentShare,
    eyeContactShare: share(seen.filter((s) => gazes.get(s) === "camera").length),
    downShare: share(seen.filter((s) => gazes.get(s) === "down").length),
    awayShare: share(seen.filter((s) => gazes.get(s) === "away").length),
    framing,
    cx,
    cy,
    size,
    yaw,
    pitch,
    timeline,
  };
}

export const FRAMING_LABEL: Record<Framing, string> = {
  good: "Well framed",
  left: "Off to the left",
  right: "Off to the right",
  high: "Head cut off",
  low: "Sitting too low",
  close: "Too close",
  far: "Too far away",
  absent: "Out of frame",
};

/** Short live instruction for the ready screen. */
export const FRAMING_HINT: Record<Framing, string> = {
  good: "Well framed",
  left: "Move a little to your right",
  right: "Move a little to your left",
  high: "Lower your head in the frame, or tilt the camera up",
  low: "Raise the camera or sit up so your eyes are near the top third",
  close: "Move back a little",
  far: "Move closer to the camera",
  absent: "No face detected: move into view, or closer",
};

export function faceTips(f: FaceStats): string[] {
  const out: string[] = [];
  if (f.framing === "absent") {
    return [
      "Your face wasn't detected for much of the take. Check the preview before you start: stay in view, and sit closer if you're far from the camera.",
    ];
  }
  if (f.downShare > 0.25) {
    out.push(
      `You looked down ${Math.round(f.downShare * 100)}% of the time. If you're reading notes, glance down briefly, then come back to the lens.`,
    );
  } else if (f.eyeContactShare < 0.6) {
    out.push(
      `You looked at the camera ${Math.round(f.eyeContactShare * 100)}% of the time. Talk to the lens as if it's a person; aim for most of the take.`,
    );
  }
  const framing: Partial<Record<Framing, string>> = {
    left: "You sat off to the left. Centre yourself so your face is in the middle of the frame.",
    right: "You sat off to the right. Centre yourself so your face is in the middle of the frame.",
    high: "The top of your head was close to the edge. Leave a little space above your head.",
    low: "You sat low in the frame. Raise the camera to eye level so your eyes sit near the top third.",
    close: "You were very close to the camera. Move back so your head and shoulders fit.",
    far: "You were far from the camera. Move closer so your face fills more of the frame.",
  };
  if (framing[f.framing]) out.push(framing[f.framing]!);
  if (f.presentShare < 0.85) {
    out.push(`Your face left the frame ${Math.round((1 - f.presentShare) * 100)}% of the time. Stay within the preview.`);
  }
  return out;
}

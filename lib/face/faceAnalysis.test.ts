import { describe, expect, it } from "vitest";
import {
  classifyGaze,
  eyeSignals,
  faceSample,
  faceTips,
  framingFor,
  headPose,
  summarizeFace,
  type FaceSample,
  type LandmarkerResultLike,
} from "./faceAnalysis";

/** Column-major 4×4 rotation: yaw about Y, then pitch about X (degrees). */
function rotation(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  // Forward axis (third column) = (sin y·cos p, sin p, cos y·cos p).
  const f = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  return [1, 0, 0, 0, 0, 1, 0, 0, f[0], f[1], f[2], 0, 0, 0, -50, 1];
}

function result(box: { x0: number; y0: number; x1: number; y1: number }, yaw = 0, pitch = 0, bs: Record<string, number> = {}): LandmarkerResultLike {
  return {
    faceLandmarks: [
      [
        { x: box.x0, y: box.y0 },
        { x: box.x1, y: box.y1 },
        { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 },
      ],
    ],
    faceBlendshapes: [{ categories: Object.entries(bs).map(([categoryName, score]) => ({ categoryName, score })) }],
    facialTransformationMatrixes: [{ data: rotation(yaw, pitch) }],
  };
}

const CENTRED = { x0: 0.4, y0: 0.25, x1: 0.6, y1: 0.6 };

describe("headPose", () => {
  it("recovers yaw and pitch from the matrix", () => {
    const { yaw, pitch } = headPose(rotation(30, -20));
    expect(yaw).toBeCloseTo(30, 5);
    expect(pitch).toBeCloseTo(-20, 5);
  });
});

describe("eyeSignals", () => {
  it("averages both eyes and picks the stronger side", () => {
    expect(eyeSignals({ eyeLookDownLeft: 0.6, eyeLookDownRight: 0.4, eyeLookOutLeft: 0.8, eyeLookInRight: 0.6 })).toEqual({
      eyesDown: 0.5,
      eyesSide: 0.7,
    });
  });
});

describe("classifyGaze", () => {
  const g = (yaw: number, pitch: number, eyesDown = 0, eyesSide = 0) => ({ yaw, pitch, eyesDown, eyesSide });
  it.each([
    [g(0, 0), 0, "camera"],
    [g(0, -20), 0, "down"],
    [g(0, 0, 0.7), 0, "down"],
    [g(35, 0), 0, "away"],
    [g(-35, 0), 0, "away"],
    [g(0, 25), 0, "away"],
    [g(0, 0, 0, 0.7), 0, "away"],
    [g(10, -5, 0.3), 0, "camera"],
    // Camera below eye level: a steady -12° is this speaker's normal pose, not looking down...
    [g(0, -12), -12, "camera"],
    // ...but a glance 15°+ below it is.
    [g(0, -30), -12, "down"],
    // Far down counts whatever the baseline.
    [g(0, -40), -20, "down"],
  ] as const)("%o with baseline %i -> %s", (signals, base, gaze) => {
    expect(classifyGaze(signals, base)).toBe(gaze);
  });
});

describe("faceSample", () => {
  it("measures the face box and gaze", () => {
    const s = faceSample(result(CENTRED, 0, -10, { eyeLookDownLeft: 0.2, eyeLookDownRight: 0.4 }), 1.5);
    expect(s).toMatchObject({ t: 1.5, present: true });
    expect(s.w).toBeCloseTo(0.2);
    expect(s.pitch).toBeCloseTo(-10);
    expect(s.eyesDown).toBeCloseTo(0.3);
    expect(s.cx).toBeCloseTo(0.5);
    expect(s.cy).toBeCloseTo(0.425);
    expect(s.size).toBeCloseTo(0.35);
  });

  it("reports no face", () => {
    expect(faceSample({ faceLandmarks: [] }, 2)).toEqual({ t: 2, present: false });
  });
});

describe("framingFor", () => {
  it.each([
    [0.5, 0.42, 0.35, "good"],
    [0.5, 0.42, 0.1, "far"],
    [0.5, 0.5, 0.47, "close"],
    [0.5, 0.2, 0.3, "high"],
    [0.5, 0.7, 0.3, "low"],
    // Mirrored preview: raw-left appears on the user's right.
    [0.25, 0.42, 0.3, "right"],
    [0.75, 0.42, 0.3, "left"],
  ] as const)("cx %f cy %f size %f -> %s", (cx, cy, size, framing) => {
    expect(framingFor(cx, cy, size)).toBe(framing);
  });
});

describe("summarizeFace", () => {
  type G = "camera" | "down" | "away";
  const SIGNALS: Record<G, Partial<FaceSample>> = {
    camera: { yaw: 0, pitch: -12, eyesDown: 0.2, eyesSide: 0.1 },
    down: { yaw: 0, pitch: -14, eyesDown: 0.7, eyesSide: 0.1 },
    away: { yaw: 40, pitch: -12, eyesDown: 0.1, eyesSide: 0.1 },
  };
  const take = (gazes: (G | null)[]): FaceSample[] =>
    gazes.map((g, i) =>
      g ? { t: i * 0.25, present: true, cx: 0.5, cy: 0.42, w: 0.2, size: 0.3, ...SIGNALS[g] } : { t: i * 0.25, present: false },
    );

  it("computes eye-contact shares among samples with a face", () => {
    // Second 1: mostly camera. Second 2: face seen in only 1 of 4 snapshots.
    const f = summarizeFace(take(["camera", "camera", "away", "down", null, null, null, "camera"]))!;
    expect(f.presentShare).toBe(5 / 8);
    expect(f.eyeContactShare).toBeCloseTo(3 / 5);
    expect(f.downShare).toBeCloseTo(1 / 5);
    expect(f.awayShare).toBeCloseTo(1 / 5);
    expect(f.framing).toBe("good");
    expect(f.timeline).toEqual(["camera", "none"]);
  });

  it("calls a mostly empty frame absent", () => {
    const f = summarizeFace(take(["camera", null, null, null, null]))!;
    expect(f.framing).toBe("absent");
    expect(faceTips(f)[0]).toMatch(/wasn.t detected/);
  });

  it("suggests looking up when the speaker reads notes", () => {
    const f = summarizeFace(take(["down", "down", "camera", "down", "camera", "camera", "down", "down"]))!;
    expect(faceTips(f)[0]).toMatch(/looked down 63%/);
  });

  it("judges head tilt against the speaker's own upright pose", () => {
    // Camera below eye level (steady -12°), with two clear glances down at notes (-30°).
    const samples: FaceSample[] = [-12, -11, -13, -30, -12, -30, -12, -11].map((pitch, i) => ({
      t: i * 0.25, present: true, cx: 0.5, cy: 0.42, w: 0.2, size: 0.3, yaw: 0, pitch, eyesDown: 0.2, eyesSide: 0,
    }));
    const f = summarizeFace(samples)!;
    expect(f.eyeContactShare).toBe(0.75);
    expect(f.downShare).toBe(0.25);
  });

  it("returns null with too few samples", () => {
    expect(summarizeFace(take(["camera"]))).toBeNull();
  });
});

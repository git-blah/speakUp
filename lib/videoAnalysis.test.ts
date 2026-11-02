import { describe, expect, it } from "vitest";
import { SAMPLE_H, SAMPLE_W, frameSample, summarizeVideo, toGray, videoTips, type FrameSample } from "./videoAnalysis";

const N = SAMPLE_W * SAMPLE_H;

function flat(v: number): Uint8Array {
  return new Uint8Array(N).fill(v);
}

/** A frame where the first `share` of pixels are `on`, the rest `off`. */
function partly(share: number, on = 200, off = 100): Uint8Array {
  const f = flat(off);
  f.fill(on, 0, Math.round(N * share));
  return f;
}

/** A frame with a bright block in the middle third, shifted right by `dx` pixels. */
function centred(dx: number, on = 200, off = 110): Uint8Array {
  const f = flat(off);
  for (let y = SAMPLE_H / 4; y < (3 * SAMPLE_H) / 4; y++) {
    f.fill(on, y * SAMPLE_W + SAMPLE_W / 3 + dx, y * SAMPLE_W + (2 * SAMPLE_W) / 3 + dx);
  }
  return f;
}

/** Build samples from a sequence of frames, 4 per second. */
function run(frames: Uint8Array[]): FrameSample[] {
  return frames.map((f, i) => frameSample(f, i > 0 ? frames[i - 1] : null, i * 0.25));
}

describe("frameSample", () => {
  it("measures brightness and the share of changed pixels", () => {
    const s = frameSample(partly(0.2), flat(100), 1);
    expect(s.brightness).toBeCloseTo(120, 0);
    expect(s.motion).toBeCloseTo(0.2, 2);
    expect(frameSample(flat(100), null, 0).motion).toBeNull();
  });

  it("ignores small changes such as sensor noise", () => {
    expect(frameSample(flat(110), flat(100), 1).motion).toBe(0);
  });

  it("detects a dark centre against bright edges", () => {
    const f = flat(220);
    for (let y = SAMPLE_H / 4; y < (3 * SAMPLE_H) / 4; y++) {
      f.fill(60, y * SAMPLE_W + SAMPLE_W / 3, y * SAMPLE_W + (2 * SAMPLE_W) / 3);
    }
    expect(frameSample(f, null, 0).centerDiff).toBeLessThan(-100);
  });

  it("converts RGBA to luma", () => {
    expect([...toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))]).toEqual([255, 0]);
  });
});

describe("summarizeVideo", () => {
  it("returns null with too few frames", () => {
    expect(summarizeVideo(run([flat(120), flat(120)]))).toBeNull();
  });

  it("classifies a steady, well-lit take as natural", () => {
    // Alternate 0% and 5% change: some movement, never a lot.
    const frames = Array.from({ length: 40 }, (_, i) => (i % 2 ? partly(0.05, 160, 120) : flat(120)));
    const v = summarizeVideo(run(frames))!;
    expect(v.movement).toBe("natural");
    expect(v.lighting).toBe("good");
    expect(v.highShare).toBe(0);
    expect(v.timeline).toHaveLength(10);
    expect(videoTips(v)).toEqual([]);
  });

  it("flags a lot of movement in the middle of the frame", () => {
    // A speaker-sized block swaying sideways; the border stays still.
    const frames = Array.from({ length: 20 }, (_, i) => centred(i % 2 ? 8 : -8));
    expect(frameSample(frames[1], frames[0], 0).motion).toBeGreaterThan(0.12);
    const v = summarizeVideo(run(frames))!;
    expect(v.movement).toBe("busy");
    expect(v.highShare).toBe(1);
    expect(videoTips(v)[0]).toMatch(/100% of the take/);
  });

  it("flags a moving camera separately from a moving speaker", () => {
    // Background detail at the edges shifting = the camera moved.
    const textured = (shift: number) => {
      const f = flat(110);
      for (let i = 0; i < f.length; i++) if (((i % SAMPLE_W) + shift) % 6 < 3) f[i] = 190;
      return f;
    };
    const frames = Array.from({ length: 20 }, (_, i) => textured(i % 2 ? 3 : 0));
    const v = summarizeVideo(run(frames))!;
    expect(v.movement).toBe("shaky");
    expect(v.highShare).toBe(0);
  });

  it("flags a very still speaker", () => {
    expect(summarizeVideo(run(Array.from({ length: 20 }, () => flat(120))))!.movement).toBe("still");
  });

  it("calls a bright background with a dark centre backlit, not washed out", () => {
    const f = flat(240);
    for (let y = SAMPLE_H / 4; y < (3 * SAMPLE_H) / 4; y++) {
      f.fill(70, y * SAMPLE_W + SAMPLE_W / 3, y * SAMPLE_W + (2 * SAMPLE_W) / 3);
    }
    const v = summarizeVideo(run(Array.from({ length: 10 }, () => f)))!;
    expect(v.brightness).toBeGreaterThan(205);
    expect(v.lighting).toBe("backlit");
  });

  it.each([
    [5, "covered"],
    [40, "dark"],
    [230, "bright"],
  ] as const)("brightness %i is %s", (level, lighting) => {
    const v = summarizeVideo(run(Array.from({ length: 10 }, () => flat(level))))!;
    expect(v.lighting).toBe(lighting);
    expect(videoTips(v).length).toBeGreaterThan(0);
  });
});

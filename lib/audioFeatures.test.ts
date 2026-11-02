import { describe, expect, it } from "vitest";
import { ANALYSIS_RATE, analyzeAudio, framePitch } from "./audioFeatures";

const R = ANALYSIS_RATE;

/** A harmonic-rich voiced tone with a pitch contour (Hz as a function of seconds). */
function voice(seconds: number, f0: (t: number) => number, amp = 0.3): Float32Array {
  const out = new Float32Array(Math.round(seconds * R));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * f0(i / R)) / R;
    out[i] = amp * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
  }
  return out;
}

function noise(seconds: number, amp = 0.001): Float32Array {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return Float32Array.from({ length: Math.round(seconds * R) }, () => amp * rnd());
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("framePitch", () => {
  it.each([110, 160, 220])("finds %i Hz", (hz) => {
    const p = framePitch(voice(0.04, () => hz))!;
    expect(Math.abs(p - hz) / hz).toBeLessThan(0.04);
  });

  it("returns null for noise", () => {
    expect(framePitch(noise(0.04, 0.3))).toBeNull();
  });
});

describe("analyzeAudio", () => {
  it("separates speech runs at long pauses", () => {
    const a = analyzeAudio(concat(noise(0.5), voice(2, () => 150), noise(1.2), voice(3, () => 150), noise(0.5)))!;
    expect(a.runs).toHaveLength(2);
    expect(a.runs[0].end - a.runs[0].start).toBeCloseTo(2, 0);
    expect(a.meanRunS).toBeCloseTo(2.5, 0);
    expect(a.speechShare).toBeGreaterThan(0.6);
  });

  it("bridges short gaps inside a phrase", () => {
    const a = analyzeAudio(concat(voice(1.5, () => 150), noise(0.3), voice(1.5, () => 150)))!;
    expect(a.runs).toHaveLength(1);
  });

  it("measures a flat voice as monotone and a moving one as varied", () => {
    const flat = analyzeAudio(voice(4, () => 140))!;
    const lively = analyzeAudio(voice(4, (t) => 140 * 2 ** ((4 * Math.sin(2 * Math.PI * 0.7 * t)) / 12)))!;
    expect(flat.pitchMedianHz!).toBeCloseTo(140, -1);
    expect(flat.pitchStdSt!).toBeLessThan(0.5);
    expect(lively.pitchStdSt!).toBeGreaterThan(2);
    expect(lively.pitchRangeSt!).toBeGreaterThan(5);
  });

  it("detects phrases that trail off", () => {
    // Each phrase fades to a quarter of its volume over its last 0.4 s.
    const fading = (s: number) => {
      const v = voice(s, () => 150);
      const fade = Math.round(0.4 * R);
      for (let i = 0; i < fade; i++) v[v.length - fade + i] *= 1 - 0.75 * (i / fade);
      return v;
    };
    const steady = analyzeAudio(concat(voice(2, () => 150), noise(1), voice(2, () => 150), noise(1), voice(2, () => 150)))!;
    const trailing = analyzeAudio(concat(fading(2), noise(1), fading(2), noise(1), fading(2)))!;
    expect(steady.phraseEndDropDb!).toBeLessThan(1);
    expect(trailing.phraseEndDropDb!).toBeGreaterThan(3);
  });

  it("returns null for very short audio", () => {
    expect(analyzeAudio(voice(0.2, () => 150))).toBeNull();
  });
});

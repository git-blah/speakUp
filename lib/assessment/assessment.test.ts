import { describe, expect, it } from "vitest";
import { analyze } from "../analysis";
import type { AudioFeatures } from "../audioFeatures";
import type { Transcript, Word } from "../transcript";
import { JUDGED, annotateTranscript, assessPrompts, normalizeAssessReply } from "./llm";
import { measureMetrics, mattr, repetitions, type MeasuredInput } from "./measured";
import { METRICS, overallScores, toMarkdown, type Assessment, type MetricResult } from "./metrics";

/** Timed words: [text, start, end, confidence?]. */
function timed(entries: [string, number, number, number?][]): Transcript {
  const words: Word[] = entries.map(([text, start, end, confidence]) => ({ text, start, end, confidence }));
  return { source: "deepgram", text: entries.map((e) => e[0]).join(" "), words, timed: true };
}

/** A steady timed transcript: `n` words at `wpm`, a sentence end every 8 words. */
function steady(n: number, wpm: number, opts: { pauseAfterSentence?: number; confidence?: number } = {}): Transcript {
  const per = 60 / wpm;
  const entries: [string, number, number, number?][] = [];
  let t = 1;
  const vocab = "people cities jobs culture transport rent nature quiet work friends family time money space".split(" ");
  for (let i = 0; i < n; i++) {
    const end = (i + 1) % 8 === 0;
    entries.push([`${vocab[(i * 7) % vocab.length]}${end ? "." : ""}`, t, t + per * 0.8, opts.confidence]);
    t += per + (end ? (opts.pauseAfterSentence ?? 0) : 0);
  }
  return timed(entries);
}

function input(t: Transcript, extra: Partial<MeasuredInput> = {}): MeasuredInput {
  const seconds = (t.words[t.words.length - 1].end ?? 30) + 0.5;
  return { transcript: t, stats: analyze(t, seconds), audio: null, video: null, face: null, seconds, ...extra };
}

const byId = (rs: MetricResult[]) => new Map(rs.map((r) => [r.id, r]));

describe("catalogue", () => {
  it("has 50 unique metrics: 17 measured, 33 for the AI", () => {
    expect(METRICS).toHaveLength(50);
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(50);
    expect(METRICS.filter((m) => m.method === "measured")).toHaveLength(17);
    expect(JUDGED).toHaveLength(33);
  });
});

describe("measured metrics", () => {
  it("returns all 17, with N/A where evidence is missing", () => {
    const rs = measureMetrics(input(steady(80, 140)));
    expect(rs).toHaveLength(17);
    const m = byId(rs);
    expect(m.get("intonation")!.score).toBeNull(); // no audio
    expect(m.get("eye_contact")!.score).toBeNull(); // no face tracking
    expect(m.get("intelligibility")!.score).toBeNull(); // no confidences
    expect(m.get("rate")!.score).toBe(10);
  });

  it("only gently penalises slow speech (slow is not disfluent)", () => {
    const m = byId(measureMetrics(input(steady(60, 100))));
    expect(m.get("rate")!.score).toBe(8);
    expect(m.get("rate")!.evidence).toMatch(/isn't treated as poor fluency/);
  });

  it("counts mid-phrase pauses as hesitation but not pauses at sentence ends", () => {
    const sentencePauses = byId(measureMetrics(input(steady(64, 140, { pauseAfterSentence: 1.5 }))));
    expect(sentencePauses.get("hesitation_pauses")!.score).toBe(10);
    expect(sentencePauses.get("deliberate_pauses")!.score).toBe(10);

    const mid = timed([
      ["I", 0.5, 0.6], ["think", 0.7, 0.9], ["the", 1.0, 1.1], ["city", 2.6, 2.9], ["is", 3.0, 3.1], ["better.", 3.2, 3.6],
      ["It", 3.7, 3.8], ["has", 3.9, 4.0], ["more", 5.4, 5.6], ["jobs.", 5.7, 6.0],
    ]);
    const m = byId(measureMetrics(input(mid)));
    expect(m.get("hesitation_pauses")!.evidence).toMatch(/2 pauses/);
    expect(m.get("hesitation_pauses")!.evidence).toMatch(/after "the"/);
    expect(m.get("hesitation_pauses")!.score!).toBeLessThan(10);
  });

  it("scores intelligibility from recognizer confidence, with the accent caveat", () => {
    const clear = byId(measureMetrics(input(steady(40, 140, { confidence: 0.98 }))));
    const unclear = byId(measureMetrics(input(steady(40, 140, { confidence: 0.5 }))));
    expect(clear.get("intelligibility")!.score).toBe(10);
    expect(unclear.get("intelligibility")!.score).toBe(0);
    expect(unclear.get("intelligibility")!.evidence).toMatch(/accents/);
  });

  it("uses the audio for intonation, volume and continuity", () => {
    const audio: AudioFeatures = {
      seconds: 30, speechShare: 0.8, pitchMedianHz: 140, pitchStdSt: 0.8, pitchRangeSt: 2,
      loudnessStdDb: 5, phraseEndDropDb: 8, runs: [{ start: 0, end: 3 }, { start: 4, end: 7 }], meanRunS: 3, voicedFrames: 500,
    };
    const m = byId(measureMetrics(input(steady(40, 140), { audio })));
    expect(m.get("intonation")!.score).toBe(2); // monotone
    expect(m.get("volume")!.score).toBe(6); // trails off by 8 dB
    expect(m.get("volume")!.improvement).toMatch(/trail off/);
    expect(m.get("continuity")!.score).toBe(5);
  });

  it("finds repetitions and computes lexical diversity", () => {
    expect(repetitions("i i think we went we went home".split(" "))).toEqual(["i i", "we went we went"]);
    expect(mattr("a b c".split(" "))).toBeNull();
    expect(mattr(Array.from({ length: 60 }, (_, i) => `w${i}`))).toBe(1);
  });
});

describe("AI reply", () => {
  it("turns a score without evidence into N/A and clamps scores", () => {
    const reply = normalizeAssessReply({
      summary: "Solid.",
      metrics: { grammar: { score: 12, evidence: "Few errors.", improvement: "x" }, tense: { score: 6, evidence: "" } },
      weaknesses: ["a", "b", "c", "d", "e", "f"],
      strengths: ["s"],
      exercises: [{ title: "T", steps: "S" }, { title: "" }],
    });
    const m = byId(reply.metrics);
    expect(reply.metrics).toHaveLength(33);
    expect(m.get("grammar")!.score).toBe(10);
    expect(m.get("tense")!.score).toBeNull();
    expect(m.get("relevance")!.score).toBeNull();
    expect(reply.weaknesses).toHaveLength(5);
    expect(reply.exercises).toHaveLength(1);
  });

  it("puts the rules and measurements in the prompt", () => {
    const { system, user } = assessPrompts({
      provider: "anthropic", promptText: "Is remote work better?", mode: "topic", language: "en-IN",
      transcript: "I think [pause 1.4s] remote work is better", seconds: 50, allowedSeconds: 60,
      measured: [{ name: "Speaking rate", score: 9, evidence: "150 wpm" }],
    });
    expect(system).toMatch(/Never penalise an Indian or other non-native accent/);
    expect(system).toMatch(/en-IN English/);
    expect(system).toMatch(/Do not penalise deliberate pauses/);
    expect(user).toMatch(/Speaking rate: 9\/10 — 150 wpm/);
    expect(user).toMatch(/grammar \(Language correctness\)/);
  });

  it("annotates long pauses and uncertain words", () => {
    expect(
      annotateTranscript([
        { text: "I", start: 0, end: 0.2 },
        { text: "think", start: 1.5, end: 1.8, confidence: 0.4 },
      ]),
    ).toBe("I [pause 1.3s] think(?)");
  });
});

describe("overall scores and report", () => {
  const metrics: MetricResult[] = METRICS.map((d, i) => ({
    id: d.id,
    score: d.category === "communication" ? null : d.category === "language" ? 8 : i % 2 ? 6 : 4,
    evidence: "e",
    improvement: "i",
  }));

  it("averages categories, ignoring N/A", () => {
    const o = overallScores(metrics);
    expect(o.categories.language).toBe(8);
    expect(o.categories.communication).toBeNull();
    expect(o.overall).toBeCloseTo((8 + o.categories.fluency! + o.categories.coherence!) / 3);
  });

  it("exports the requested report format", () => {
    const a: Assessment = {
      promptText: "P", createdAt: "2026-11-02T10:00:00Z", judge: "Claude", metrics, summary: "S",
      weaknesses: ["w1"], strengths: ["s1"], exercises: [{ title: "Shadowing", steps: "Do it." }],
    };
    const md = toMarkdown(a);
    for (const h of ["Overall language correctness", "Overall fluency and delivery", "Overall coherence and structure",
      "Overall communication effectiveness", "Overall speaking score", "Top 5 weaknesses", "Top 5 strengths", "Exercises"]) {
      expect(md).toContain(h);
    }
    expect(md).toMatch(/### Grammatical accuracy — 8\/10 _\(Transcript\)_/);
    expect(md).toMatch(/### Eye contact — N\/A _\(Measured\)_/);
    expect(md.match(/^### /gm)).toHaveLength(50);
  });
});

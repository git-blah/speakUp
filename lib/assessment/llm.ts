/**
 * The AI part of the full assessment: the request the client sends, the JSON Schema the model
 * must fill, the prompts, and a normalizer that enforces "no evidence, no score".
 */
import type { CoachRequestBase } from "../coach/types";
import { CATEGORIES, METRICS, clampScore, type MetricResult } from "./metrics";

export const JUDGED = METRICS.filter((m) => m.method !== "measured");

export interface AssessRequest extends CoachRequestBase {
  /** Transcript, annotated with [pause 1.4s] markers and (?) after words the recognizer was unsure of. */
  transcript: string;
  /** Seconds spoken / seconds allowed. */
  seconds: number;
  allowedSeconds: number;
  /** Already-scored measured metrics, for context. */
  measured: { name: string; score: number | null; evidence: string }[];
}

export interface AssessReply {
  summary: string;
  metrics: MetricResult[];
  weaknesses: string[];
  strengths: string[];
  exercises: { title: string; steps: string }[];
}

const metricSchema = {
  type: "object",
  properties: {
    score: { type: ["integer", "null"], description: "0–10, or null (N/A) when there is not enough evidence." },
    evidence: { type: "string", description: "Why this score, quoting the transcript where possible." },
    improvement: { type: "string", description: "The single most important improvement for this metric." },
  },
  required: ["score", "evidence", "improvement"],
};

export const ASSESS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "Two or three sentences summarising the speaker's level and main issue." },
    metrics: {
      type: "object",
      properties: Object.fromEntries(JUDGED.map((m) => [m.id, { ...metricSchema, description: `${m.name}: ${m.what}` }])),
      required: JUDGED.map((m) => m.id),
    },
    weaknesses: {
      type: "array",
      items: { type: "string" },
      description: "Top 5 weaknesses across ALL metrics (including measured ones), most important first, each tied to evidence.",
    },
    strengths: { type: "array", items: { type: "string" }, description: "Top 5 strengths, each tied to evidence." },
    exercises: {
      type: "array",
      description: "Exactly three specific practice exercises targeting the top weaknesses.",
      items: {
        type: "object",
        properties: { title: { type: "string" }, steps: { type: "string", description: "How to do it, concretely." } },
        required: ["title", "steps"],
      },
    },
  },
  required: ["summary", "metrics", "weaknesses", "strengths", "exercises"],
};

export function assessPrompts(req: AssessRequest) {
  const system = `You are an expert assessor of spoken English and public speaking. You evaluate one recorded answer to an impromptu speaking prompt, metric by metric, with evidence.

Evaluation rules:
1. Evaluate actual speaking ability, not written English. Spoken grammar (e.g. starting with "So", fragments that are natural in speech) is not an error.
2. Keep language correctness separate from delivery and communication effectiveness.
3. Delivery measurements (pace, pauses, fillers, pitch, volume, eye contact) have already been computed from the audio and video and are given to you. Do not re-score them. You cannot hear the audio, so do not claim anything about pronunciation, accent, rhythm or intonation beyond those measurements.
4. Use the transcript for grammar, vocabulary, sentence construction and word usage.
5. Use your contextual judgement for coherence, logical flow, structure and communication.
6. Never penalise an Indian or other non-native accent. The speaker uses ${req.language} English; valid regional usage is not an error.
7. Do not confuse speaking slowly with poor fluency.
8. Do not penalise deliberate pauses.
9. Do not invent mistakes or unsupported observations. Every score must be backed by evidence from the transcript or the measurements; quote the exact words. The transcript is machine-generated: missing punctuation or an obviously misrecognised word is not the speaker's error. Words marked (?) were hard for the recognizer to hear.
10. Use null (N/A) when there is not enough evidence, e.g. a very short answer gives no evidence of sentence variety, or no errors of a type could occur.

Scoring: 0–2 very poor, 3–4 weak, 5–6 adequate, 7–8 good, 9–10 excellent and rare. Be calibrated and consistent; a single minor slip should not drop a metric below 7.
Keep evidence and improvements to one or two sentences each. Improvements must be specific and actionable.
Weaknesses must be ranked by how much fixing them would improve the speaker overall, and may draw on the measured metrics too.`;

  const measured = req.measured
    .map((m) => `- ${m.name}: ${m.score === null ? "N/A" : `${m.score}/10`} — ${m.evidence}`)
    .join("\n");
  const toAssess = JUDGED.map((m) => `- ${m.id} (${CATEGORIES[m.category]}): ${m.name}. ${m.what}`).join("\n");

  const user = `Prompt type: ${req.mode}
Prompt: "${req.promptText}"
Spoke for ${Math.round(req.seconds)}s of the ${Math.round(req.allowedSeconds)}s allowed.

Measured delivery metrics (computed by the app, for context; don't re-score):
${measured}

Metrics for you to assess:
${toAssess}

<transcript>
${req.transcript}
</transcript>

Assess every listed metric, then give the summary, top 5 weaknesses, top 5 strengths and three exercises.`;

  return { system, user };
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const asStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const asList = (v: unknown, max: number) => (Array.isArray(v) ? v.map(asStr).filter(Boolean).slice(0, max) : []);

/** Coerce the model's reply. A score without evidence becomes N/A (rule 9). */
export function normalizeAssessReply(raw: unknown): AssessReply {
  const o = asObj(raw);
  const ms = asObj(o.metrics);
  const metrics: MetricResult[] = JUDGED.map((d) => {
    const item = asObj(ms[d.id]);
    const evidence = asStr(item.evidence);
    const n = typeof item.score === "number" ? item.score : Number.parseFloat(asStr(item.score));
    const scored = Number.isFinite(n) && evidence !== "";
    return {
      id: d.id,
      score: scored ? clampScore(n) : null,
      evidence: evidence || "Not assessed: no evidence was given.",
      improvement: asStr(item.improvement),
    };
  });
  const exercises = (Array.isArray(o.exercises) ? o.exercises : [])
    .map((e) => ({ title: asStr(asObj(e).title), steps: asStr(asObj(e).steps) }))
    .filter((e) => e.title && e.steps)
    .slice(0, 3);
  if (metrics.every((m) => m.score === null) && !asStr(o.summary)) {
    throw new Error("The model's reply didn't contain a usable assessment.");
  }
  return {
    summary: asStr(o.summary),
    metrics,
    weaknesses: asList(o.weaknesses, 5),
    strengths: asList(o.strengths, 5),
    exercises,
  };
}

/** Transcript text for the model: [pause] markers for gaps of 1s+, (?) after uncertain words. */
export function annotateTranscript(words: { text: string; start?: number; end?: number; confidence?: number }[]): string {
  const out: string[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev?.end !== undefined && w.start !== undefined && w.start - prev.end >= 1) {
      out.push(`[pause ${(w.start - prev.end).toFixed(1)}s]`);
    }
    out.push(typeof w.confidence === "number" && w.confidence < 0.7 ? `${w.text}(?)` : w.text);
  });
  return out.join(" ");
}

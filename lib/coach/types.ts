// Shared between the API routes and the UI: output shapes, JSON Schemas sent to the model,
// and normalizers that coerce model output (small local models don't always follow the schema).

export type ProviderId = "anthropic" | "ollama";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  available: boolean;
  /** Default model name used by this provider. */
  model: string;
  /** Installed models (Ollama only). */
  models?: string[];
  /** Why it's unavailable, for the setup screen. */
  reason?: string;
}

export interface CoachRequestBase {
  provider: ProviderId;
  /** Ollama model override; must be one of the installed models. */
  model?: string;
  promptText: string;
  mode: string;
  language: string;
}

export interface FeedbackRequest extends CoachRequestBase {
  transcript: string;
  seconds: number;
  stats: {
    wpm: number | null;
    fillersPerMin: number | null;
    longPauses: number | null;
    startDelay: number | null;
    /** On-camera stats (null for audio-only takes). */
    highMotionShare?: number | null;
    movement?: string | null;
    lighting?: string | null;
  };
}

export type OnePagerRequest = CoachRequestBase;

export const SCORE_KEYS = ["clarity", "structure", "relevance", "language"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

export interface CoachFeedback {
  summary: string;
  scores: Record<ScoreKey, number>;
  strengths: string[];
  improvements: { issue: string; suggestion: string }[];
  languageFixes: { said: string; better: string; why: string }[];
  betterVersion: string;
  followUpQuestion: string;
}

export interface OnePager {
  title: string;
  summary: string;
  keyPoints: string[];
  perspectives: { side: string; argument: string }[];
  vocabulary: { term: string; meaning: string; example: string }[];
  structure: string[];
  openers: string[];
  questions: string[];
}

const str = { type: "string" } as const;
const strArray = { type: "array", items: str } as const;

export const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One or two sentences: overall verdict on this take." },
    scores: {
      type: "object",
      description: "Each score is an integer from 1 (poor) to 10 (excellent).",
      properties: {
        clarity: { type: "integer", description: "How easy it was to follow." },
        structure: { type: "integer", description: "Clear opening, logical points, deliberate ending." },
        relevance: { type: "integer", description: "How well it addressed the prompt." },
        language: { type: "integer", description: "Grammar, word choice and range of vocabulary." },
      },
      required: ["clarity", "structure", "relevance", "language"],
    },
    strengths: { ...strArray, description: "2-3 specific things done well, referring to what was said." },
    improvements: {
      type: "array",
      description: "2-3 most valuable improvements.",
      items: {
        type: "object",
        properties: { issue: str, suggestion: { type: "string", description: "Concrete, actionable fix." } },
        required: ["issue", "suggestion"],
      },
    },
    languageFixes: {
      type: "array",
      description: "Up to 4 grammar or word-choice corrections quoted from the transcript. Empty if none.",
      items: {
        type: "object",
        properties: {
          said: { type: "string", description: "Short exact quote from the transcript." },
          better: { type: "string", description: "Corrected or more natural version." },
          why: { type: "string", description: "Brief reason." },
        },
        required: ["said", "better", "why"],
      },
    },
    betterVersion: {
      type: "string",
      description: "A stronger spoken answer to the same prompt (about 120-160 words), keeping the speaker's ideas where possible.",
    },
    followUpQuestion: {
      type: "string",
      description: "One challenging question an audience member might ask next, to practise answering on the spot.",
    },
  },
  required: ["summary", "scores", "strengths", "improvements", "languageFixes", "betterVersion", "followUpQuestion"],
} as const;

export const ONEPAGER_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title for the topic." },
    summary: { type: "string", description: "2-3 sentence plain-English overview." },
    keyPoints: { ...strArray, description: "4-6 key facts or ideas worth knowing." },
    perspectives: {
      type: "array",
      description: "2-4 viewpoints or angles (for a situation: what the other person likely thinks).",
      items: { type: "object", properties: { side: str, argument: str }, required: ["side", "argument"] },
    },
    vocabulary: {
      type: "array",
      description: "5-6 useful words or phrases for talking about this, at a level slightly above everyday English.",
      items: {
        type: "object",
        properties: { term: str, meaning: str, example: { type: "string", description: "Example sentence on this topic." } },
        required: ["term", "meaning", "example"],
      },
    },
    structure: { ...strArray, description: "3-5 step outline for a strong 1-2 minute answer." },
    openers: { ...strArray, description: "3 strong opening lines." },
    questions: { ...strArray, description: "2-3 questions to think about or research further." },
  },
  required: ["title", "summary", "keyPoints", "perspectives", "vocabulary", "structure", "openers", "questions"],
} as const;

// ---- normalizers ----

/** The model replied, but not with anything usable. */
export class InvalidReplyError extends Error {}

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function asStrList(v: unknown, max: number): string[] {
  return (Array.isArray(v) ? v : []).map(asStr).filter(Boolean).slice(0, max);
}

function asObjList<T>(v: unknown, keys: (keyof T & string)[], max: number): T[] {
  return (Array.isArray(v) ? v : [])
    .map((item) => {
      const o = asObj(item);
      return Object.fromEntries(keys.map((k) => [k, asStr(o[k])])) as T;
    })
    .filter((item) => keys.every((k) => (item as Obj)[k] !== ""))
    .slice(0, max);
}

function asScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(asStr(v));
  return Number.isFinite(n) ? Math.min(10, Math.max(1, Math.round(n))) : 5;
}

export function normalizeFeedback(raw: unknown): CoachFeedback {
  const o = asObj(raw);
  const scores = asObj(o.scores);
  const out: CoachFeedback = {
    summary: asStr(o.summary),
    scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, asScore(scores[k])])) as Record<ScoreKey, number>,
    strengths: asStrList(o.strengths, 3),
    improvements: asObjList(o.improvements, ["issue", "suggestion"], 3),
    languageFixes: asObjList(o.languageFixes, ["said", "better", "why"], 4),
    betterVersion: asStr(o.betterVersion),
    followUpQuestion: asStr(o.followUpQuestion),
  };
  if (!out.summary && out.strengths.length === 0 && out.improvements.length === 0) {
    throw new InvalidReplyError("The model's reply didn't contain usable feedback. Try again.");
  }
  return out;
}

export function normalizeOnePager(raw: unknown): OnePager {
  const o = asObj(raw);
  const out: OnePager = {
    title: asStr(o.title),
    summary: asStr(o.summary),
    keyPoints: asStrList(o.keyPoints, 6),
    perspectives: asObjList(o.perspectives, ["side", "argument"], 4),
    vocabulary: asObjList(o.vocabulary, ["term", "meaning", "example"], 6),
    structure: asStrList(o.structure, 5),
    openers: asStrList(o.openers, 3),
    questions: asStrList(o.questions, 3),
  };
  if (!out.summary && out.keyPoints.length === 0) {
    throw new InvalidReplyError("The model's reply didn't contain a usable one-pager. Try again.");
  }
  return out;
}

/** Parse JSON from a model's text reply, tolerating code fences, <think> blocks or surrounding prose. */
export function parseJsonReply(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("The model didn't return JSON.");
  }
}

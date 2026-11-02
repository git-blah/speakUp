/**
 * The "Full assessment" profile: 50 metrics in four groups. Each metric says how it's scored:
 * - measured:   computed in code from audio, word timings or video (lib/assessment/measured.ts)
 * - transcript: judged by the AI from the transcript (language use)
 * - judgement:  judged by the AI from context (structure, communication)
 * Group and overall scores are averages computed in code, ignoring N/A metrics.
 */

export type Category = "language" | "fluency" | "coherence" | "communication";
export type Method = "measured" | "transcript" | "judgement";

export interface MetricDef {
  id: string;
  name: string;
  category: Category;
  method: Method;
  /** What to assess (shown to the AI and in the report). */
  what: string;
}

export const CATEGORIES: Record<Category, string> = {
  language: "Language correctness",
  fluency: "Fluency & delivery",
  coherence: "Coherence & structure",
  communication: "Communication effectiveness",
};

export const METHOD_LABEL: Record<Method, string> = {
  measured: "Measured",
  transcript: "Transcript",
  judgement: "Judgement",
};

const m = (id: string, name: string, category: Category, method: Method, what: string): MetricDef => ({
  id,
  name,
  category,
  method,
  what,
});

export const METRICS: MetricDef[] = [
  // Language correctness: from the transcript.
  m("grammar", "Grammatical accuracy", "language", "transcript", "Overall grammatical correctness of spoken sentences."),
  m("tense", "Verb tense control", "language", "transcript", "Correct and consistent use of tenses and verb forms."),
  m("agreement", "Subject–verb agreement", "language", "transcript", "Agreement between subjects and verbs, and pronoun agreement."),
  m("articles", "Articles & determiners", "language", "transcript", "Use of a/an/the and other determiners."),
  m("prepositions", "Prepositions", "language", "transcript", "Correct prepositions in phrases and verb patterns."),
  m("construction", "Sentence construction", "language", "transcript", "Well-formed sentences: word order, complete clauses, no run-ons that confuse meaning."),
  m("complexity", "Sentence variety & complexity", "language", "transcript", "Mix of simple, compound and complex sentences used correctly."),
  m("vocab_range", "Vocabulary range", "language", "transcript", "Breadth of vocabulary for the topic, beyond basic words."),
  m("word_choice", "Word choice precision", "language", "transcript", "Choosing the exact word for the meaning; no misused words."),
  m("collocations", "Collocations & natural phrasing", "language", "transcript", "Word combinations a fluent speaker would use (e.g. 'make a decision')."),
  m("idiomatic", "Spoken-English idiom", "language", "transcript", "Natural spoken expressions and phrasal verbs, used appropriately."),
  m("register", "Register & tone fit", "language", "transcript", "Formality and tone suit the prompt and audience."),
  m("lexical_diversity", "Lexical diversity", "language", "measured", "Moving-average type–token ratio over the transcript."),

  // Fluency & delivery: measured from audio, timings and the transcript.
  m("rate", "Speaking rate", "fluency", "measured", "Words per minute over the whole answer."),
  m("articulation", "Articulation rate", "fluency", "measured", "Words per minute while actually speaking (pauses removed)."),
  m("rate_consistency", "Pace consistency", "fluency", "measured", "Variation of words per minute across 10-second windows."),
  m("filler_sounds", "Filler sounds", "fluency", "measured", "um / uh / er per minute."),
  m("crutches", "Verbal crutches", "fluency", "measured", "Possible fillers (like, you know, basically, actually…) per minute."),
  m("hesitation_pauses", "Hesitation pauses", "fluency", "measured", "Pauses of 1 s or more in the middle of a phrase, per minute."),
  m("deliberate_pauses", "Deliberate pausing", "fluency", "measured", "Share of sentence ends followed by a short pause (pausing for effect is good)."),
  m("start_latency", "Start latency", "fluency", "measured", "Seconds before the first word."),
  m("repetitions", "Repetitions & restarts", "fluency", "measured", "Immediately repeated words or phrases per 100 words."),
  m("continuity", "Speech continuity", "fluency", "measured", "Average length of continuous speech between silences."),
  m("intonation", "Intonation range", "fluency", "measured", "Pitch variation from the audio (monotone vs expressive)."),
  m("volume", "Volume control", "fluency", "measured", "Steady loudness and not trailing off at the ends of phrases, from the audio."),
  m("intelligibility", "Intelligibility (recognizer proxy)", "fluency", "measured", "Share of words the speech recognizer was unsure of."),

  // Coherence & structure: contextual judgement.
  m("relevance", "Relevance to the prompt", "coherence", "judgement", "How directly the answer addresses the prompt."),
  m("main_point", "Clear main point", "coherence", "judgement", "A clear position, thesis or purpose that a listener could repeat."),
  m("opening", "Opening", "coherence", "judgement", "How well the first sentences set up the answer."),
  m("organisation", "Logical organisation", "coherence", "judgement", "Ideas in a sensible order with a recognisable structure."),
  m("flow", "Flow between ideas", "coherence", "judgement", "Smooth transitions; each idea follows from the last."),
  m("signposting", "Connectors & signposting", "coherence", "transcript", "Discourse markers (first, however, for example, so) used well."),
  m("reasons", "Supporting reasons", "coherence", "judgement", "Claims are backed with reasons."),
  m("examples", "Examples & evidence", "coherence", "judgement", "Concrete examples, stories or evidence."),
  m("depth", "Development & depth", "coherence", "judgement", "Ideas are developed rather than listed."),
  m("conclusion", "Conclusion", "coherence", "judgement", "A deliberate ending that wraps up or restates the point."),
  m("on_track", "Staying on track", "coherence", "judgement", "No digressions or losing the thread."),
  m("time_use", "Use of time", "coherence", "judgement", "Content fits the time: not padded, not cut off mid-thought."),

  // Communication effectiveness.
  m("clarity", "Clarity of message", "communication", "judgement", "How easy the message is to understand on first hearing."),
  m("conciseness", "Conciseness", "communication", "judgement", "Says things without unnecessary words or repetition."),
  m("impact", "Persuasiveness & impact", "communication", "judgement", "How convincing or compelling the answer is for this prompt type."),
  m("audience", "Audience awareness", "communication", "judgement", "Adapts content and language to the listener implied by the prompt."),
  m("engagement", "Engagement", "communication", "judgement", "Interesting, vivid, holds attention."),
  m("confident_language", "Confident language", "communication", "transcript", "Avoids excessive hedging, apologising and minimising language."),
  m("task", "Task fulfilment", "communication", "judgement", "Does what the prompt asked (e.g. explains, persuades, resolves the situation)."),
  m("memorability", "Memorability", "communication", "judgement", "A line, image or idea the listener would remember."),
  m("listening_effort", "Ease of listening", "communication", "judgement", "Overall effort for a listener, using the delivery measurements and transcript."),
  m("eye_contact", "Eye contact", "communication", "measured", "Share of the time looking at the camera, from face tracking."),
  m("framing", "Framing & presence", "communication", "measured", "Position in the frame and staying in view, from face tracking."),
  m("body_movement", "Body movement", "communication", "measured", "Natural movement vs very still or restless, from the video."),
];

export const METRIC_BY_ID = new Map(METRICS.map((d) => [d.id, d]));

export interface MetricResult {
  id: string;
  /** 0–10, or null for N/A. */
  score: number | null;
  evidence: string;
  improvement: string;
}

export interface Assessment {
  /** Prompt the take answered (for the exported report). */
  promptText: string;
  createdAt: string;
  /** Who judged the transcript/judgement metrics, e.g. "Claude · claude-sonnet-5-5". */
  judge: string;
  metrics: MetricResult[];
  weaknesses: string[];
  strengths: string[];
  exercises: { title: string; steps: string }[];
  summary: string;
}

export interface Overall {
  categories: Record<Category, number | null>;
  overall: number | null;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Category scores = mean of their scored metrics; overall = mean of the category scores. */
export function overallScores(metrics: MetricResult[]): Overall {
  const categories = Object.fromEntries(
    (Object.keys(CATEGORIES) as Category[]).map((c) => [
      c,
      mean(
        metrics
          .filter((r) => METRIC_BY_ID.get(r.id)?.category === c && r.score !== null)
          .map((r) => r.score as number),
      ),
    ]),
  ) as Record<Category, number | null>;
  return { categories, overall: mean(Object.values(categories).filter((v): v is number => v !== null)) };
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const clampScore = (n: number) => round1(Math.min(10, Math.max(0, n)));

/** Markdown version of the report, in the requested output format. */
export function toMarkdown(a: Assessment): string {
  const o = overallScores(a.metrics);
  const fmt = (n: number | null) => (n === null ? "N/A" : `${round1(n)}/10`);
  const byId = new Map(a.metrics.map((r) => [r.id, r]));
  const lines: string[] = [
    `# Speaking assessment`,
    ``,
    `**Prompt:** ${a.promptText}  `,
    `**Date:** ${new Date(a.createdAt).toLocaleString()}  `,
    `**Judged by:** ${a.judge} (transcript & judgement metrics); measured metrics computed by the app.`,
    ``,
    a.summary,
    ``,
    `## Overall scores`,
    ``,
    `1. Overall language correctness: ${fmt(o.categories.language)}`,
    `2. Overall fluency and delivery: ${fmt(o.categories.fluency)}`,
    `3. Overall coherence and structure: ${fmt(o.categories.coherence)}`,
    `4. Overall communication effectiveness: ${fmt(o.categories.communication)}`,
    `5. Overall speaking score: ${fmt(o.overall)}`,
    ``,
    `## Top 5 weaknesses (most important first)`,
    ``,
    ...a.weaknesses.map((w, i) => `${i + 1}. ${w}`),
    ``,
    `## Top 5 strengths`,
    ``,
    ...a.strengths.map((s, i) => `${i + 1}. ${s}`),
    ``,
    `## Exercises`,
    ``,
    ...a.exercises.map((e, i) => `${i + 1}. **${e.title}:** ${e.steps}`),
    ``,
  ];
  for (const c of Object.keys(CATEGORIES) as Category[]) {
    lines.push(`## ${CATEGORIES[c]} — ${fmt(o.categories[c])}`, "");
    for (const d of METRICS.filter((x) => x.category === c)) {
      const r = byId.get(d.id);
      lines.push(
        `### ${d.name} — ${r?.score == null ? "N/A" : `${r.score}/10`} _(${METHOD_LABEL[d.method]})_`,
        "",
        `- **Evidence:** ${r?.evidence || "Not assessed."}`,
        `- **Improvement:** ${r?.improvement || "—"}`,
        "",
      );
    }
  }
  return lines.join("\n");
}

import type { SpeechStats } from "../analysis";
import { analyzeRecording } from "../audioFeatures";
import type { FaceStats } from "../face/faceAnalysis";
import type { Transcript } from "../transcript";
import type { VideoStats } from "../videoAnalysis";
import type { ProviderId } from "../coach/types";
import { JUDGED, annotateTranscript, type AssessReply, type AssessRequest } from "./llm";
import { measureMetrics } from "./measured";
import { METRICS, METRIC_BY_ID, type Assessment, type MetricResult } from "./metrics";

export interface AssessInput {
  promptText: string;
  mode: string;
  language: string;
  transcript: Transcript;
  stats: SpeechStats;
  audio: Blob | null;
  video: VideoStats | null;
  face: FaceStats | null;
  seconds: number;
  allowedSeconds: number;
  /** AI judge; null runs the measured metrics only. */
  judge: { provider: ProviderId; model?: string; label: string } | null;
}

async function requestJudgement(req: AssessRequest): Promise<AssessReply> {
  let res: Response;
  try {
    res = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  } catch {
    throw new Error("Couldn't reach the app server.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Assessment failed (${res.status}).`);
  return data as AssessReply;
}

/** Ranked by score, lowest first, for the no-AI fallback. */
function byScore(results: MetricResult[]) {
  return results.filter((r) => r.score !== null).sort((a, b) => (a.score as number) - (b.score as number));
}

/** Run the full 50-metric assessment for one take. */
export async function runAssessment(input: AssessInput): Promise<Assessment> {
  const audio = input.audio ? await analyzeRecording(input.audio).catch(() => null) : null;
  const measured = measureMetrics({
    transcript: input.transcript,
    stats: input.stats,
    audio,
    video: input.video,
    face: input.face,
    seconds: input.seconds,
  });

  let reply: AssessReply;
  if (input.judge) {
    reply = await requestJudgement({
      provider: input.judge.provider,
      model: input.judge.model,
      promptText: input.promptText,
      mode: input.mode,
      language: input.language,
      transcript: annotateTranscript(input.transcript.words),
      seconds: input.seconds,
      allowedSeconds: input.allowedSeconds,
      measured: measured.map((m) => ({ name: METRIC_BY_ID.get(m.id)!.name, score: m.score, evidence: m.evidence })),
    });
  } else {
    // No AI: the measured metrics only, with weaknesses/strengths ranked from them.
    const ranked = byScore(measured);
    const line = (r: MetricResult) => `${METRIC_BY_ID.get(r.id)!.name} (${r.score}/10): ${r.evidence}`;
    reply = {
      summary: "Measured metrics only. Turn on an AI coach (Claude or Ollama) to assess language, structure and communication.",
      metrics: JUDGED.map((d) => ({ id: d.id, score: null, evidence: "Needs an AI coach.", improvement: "" })),
      weaknesses: ranked.slice(0, 5).map(line),
      strengths: ranked.slice(-5).reverse().map(line),
      exercises: [],
    };
  }

  const all = new Map([...measured, ...reply.metrics].map((r) => [r.id, r]));
  return {
    promptText: input.promptText,
    createdAt: new Date().toISOString(),
    judge: input.judge?.label ?? "No AI judge",
    metrics: METRICS.map((d) => all.get(d.id) ?? { id: d.id, score: null, evidence: "Not assessed.", improvement: "" }),
    weaknesses: reply.weaknesses,
    strengths: reply.strengths,
    exercises: reply.exercises,
    summary: reply.summary,
  };
}

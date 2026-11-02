import { ASSESS_SCHEMA, assessPrompts, normalizeAssessReply, type AssessRequest } from "@/lib/assessment/llm";
import { generateJson } from "@/lib/coach/providers";
import { errorResponse, parseBase } from "@/lib/coach/request";
import { CoachError } from "@/lib/coach/providers";
import { InvalidReplyError } from "@/lib/coach/types";

export const runtime = "nodejs";
// The full report is long; give hosted platforms room (Vercel caps this by plan).
export const maxDuration = 300;

function parseAssess(body: unknown): AssessRequest {
  const base = parseBase(body);
  const b = body as Record<string, unknown>;
  const transcript = typeof b.transcript === "string" ? b.transcript.trim() : "";
  if (!transcript) throw new CoachError("Missing transcript.", 400);
  if (transcript.length > 30000) throw new CoachError("Transcript is too long.", 400);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const measured = (Array.isArray(b.measured) ? b.measured : []).slice(0, 30).map((m) => {
    const o = (m ?? {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? "").slice(0, 80),
      score: typeof o.score === "number" ? o.score : null,
      evidence: String(o.evidence ?? "").slice(0, 400),
    };
  });
  return { ...base, transcript, seconds: num(b.seconds), allowedSeconds: num(b.allowedSeconds), measured };
}

/** The 33 transcript/judgement metrics of the full assessment, plus summary, ranking and exercises. */
export async function POST(req: Request) {
  try {
    const request = parseAssess(await req.json());
    const { system, user } = assessPrompts(request);
    const raw = await generateJson({
      provider: request.provider,
      model: request.model,
      system,
      user,
      schema: ASSESS_SCHEMA,
      toolName: "submit_assessment",
      toolDescription: "Submit the metric-by-metric speaking assessment.",
      maxTokens: 12000,
      timeoutMs: 10 * 60 * 1000,
    });
    try {
      return Response.json(normalizeAssessReply(raw));
    } catch (err) {
      throw new InvalidReplyError(err instanceof Error ? err.message : "Unusable reply.");
    }
  } catch (err) {
    return errorResponse(err);
  }
}

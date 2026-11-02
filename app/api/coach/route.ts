import { feedbackPrompts } from "@/lib/coach/prompts";
import { generateJson, listProviders } from "@/lib/coach/providers";
import { errorResponse, parseFeedback } from "@/lib/coach/request";
import { FEEDBACK_SCHEMA, normalizeFeedback } from "@/lib/coach/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which AI coach providers are configured (and, for Ollama, which models are installed). */
export async function GET() {
  return Response.json({ providers: await listProviders() });
}

/** Coaching feedback on one take. */
export async function POST(req: Request) {
  try {
    const request = parseFeedback(await req.json());
    const { system, user } = feedbackPrompts(request);
    const raw = await generateJson({
      provider: request.provider,
      model: request.model,
      system,
      user,
      schema: FEEDBACK_SCHEMA,
      toolName: "submit_feedback",
      toolDescription: "Submit coaching feedback on the learner's spoken answer.",
      maxTokens: 2500,
    });
    return Response.json(normalizeFeedback(raw));
  } catch (err) {
    return errorResponse(err);
  }
}

import { onePagerPrompts } from "@/lib/coach/prompts";
import { generateJson } from "@/lib/coach/providers";
import { errorResponse, parseBase } from "@/lib/coach/request";
import { ONEPAGER_SCHEMA, normalizeOnePager } from "@/lib/coach/types";

export const runtime = "nodejs";

/** A one-page study sheet on the prompt's topic. */
export async function POST(req: Request) {
  try {
    const request = parseBase(await req.json());
    const { system, user } = onePagerPrompts(request);
    const raw = await generateJson({
      provider: request.provider,
      model: request.model,
      system,
      user,
      schema: ONEPAGER_SCHEMA,
      toolName: "submit_one_pager",
      toolDescription: "Submit the one-page study notes for this topic.",
      maxTokens: 2500,
    });
    return Response.json(normalizeOnePager(raw));
  } catch (err) {
    return errorResponse(err);
  }
}

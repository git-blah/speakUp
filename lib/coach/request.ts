import { LANGUAGES } from "../settings";
import { CoachError } from "./providers";
import { InvalidReplyError, type CoachRequestBase, type FeedbackRequest } from "./types";

const MODES = new Set(["word", "topic", "situation", "explain", "speech"]);
const MOVEMENTS = new Set(["still", "natural", "busy", "shaky"]);
const LIGHTINGS = new Set(["good", "dark", "bright", "backlit", "covered"]);
const FRAMINGS = new Set(["good", "left", "right", "high", "low", "close", "far", "absent"]);

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseBase(body: unknown): CoachRequestBase {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.provider !== "anthropic" && b.provider !== "ollama") throw new CoachError("Unknown provider.", 400);
  const promptText = typeof b.promptText === "string" ? b.promptText.trim() : "";
  if (!promptText || promptText.length > 500) throw new CoachError("Missing or overly long prompt.", 400);
  return {
    provider: b.provider,
    model: typeof b.model === "string" ? b.model : undefined,
    promptText,
    mode: typeof b.mode === "string" && MODES.has(b.mode) ? b.mode : "topic",
    language: LANGUAGES.some((l) => l.code === b.language) ? (b.language as string) : "en-US",
  };
}

export function parseFeedback(body: unknown): FeedbackRequest {
  const base = parseBase(body);
  const b = body as Record<string, unknown>;
  const transcript = typeof b.transcript === "string" ? b.transcript.trim() : "";
  if (!transcript) throw new CoachError("Missing transcript.", 400);
  if (transcript.length > 20000) throw new CoachError("Transcript is too long.", 400);
  const s = (b.stats ?? {}) as Record<string, unknown>;
  return {
    ...base,
    transcript,
    seconds: num(b.seconds) ?? 0,
    stats: {
      wpm: num(s.wpm),
      fillersPerMin: num(s.fillersPerMin),
      longPauses: num(s.longPauses),
      startDelay: num(s.startDelay),
      highMotionShare: num(s.highMotionShare),
      movement: typeof s.movement === "string" && MOVEMENTS.has(s.movement) ? s.movement : null,
      lighting: typeof s.lighting === "string" && LIGHTINGS.has(s.lighting) ? s.lighting : null,
      eyeContactShare: num(s.eyeContactShare),
      lookingDownShare: num(s.lookingDownShare),
      framing: typeof s.framing === "string" && FRAMINGS.has(s.framing) ? s.framing : null,
    },
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof CoachError) return Response.json({ error: err.message }, { status: err.status });
  if (err instanceof SyntaxError) return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  if (err instanceof InvalidReplyError) {
    return Response.json({ error: err.message }, { status: 502 });
  }
  console.error("Coach request failed", err);
  return Response.json({ error: "Something went wrong generating feedback." }, { status: 500 });
}

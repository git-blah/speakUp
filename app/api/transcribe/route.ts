import { LANGUAGES } from "@/lib/settings";
import type { TranscribeResponse } from "@/lib/transcript";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_API_URL = "https://api.deepgram.com/v1/listen";

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
}

/** Lets the client know whether server transcription is configured. */
export function GET() {
  return Response.json({ available: Boolean(process.env.DEEPGRAM_API_KEY) });
}

/** Body: the raw audio blob. Query: ?language=en-GB */
export async function POST(req: Request) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return Response.json({ error: "Server transcription isn't configured (DEEPGRAM_API_KEY)." }, { status: 501 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/") && !contentType.startsWith("video/")) {
    return Response.json({ error: "Expected an audio upload." }, { status: 415 });
  }
  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) {
    return Response.json({ error: "The recording was empty." }, { status: 400 });
  }
  if (audio.byteLength > MAX_BYTES) {
    return Response.json({ error: "The recording is too large to transcribe." }, { status: 413 });
  }

  const requested = new URL(req.url).searchParams.get("language") ?? "";
  const language = LANGUAGES.some((l) => l.code === requested) ? requested : "en";
  const params = new URLSearchParams({
    model: "nova-3",
    language,
    smart_format: "true",
    // Keep "um"/"uh" in the transcript; they're dropped by default.
    filler_words: "true",
  });

  let res: Response;
  try {
    res = await fetch(`${process.env.DEEPGRAM_API_URL ?? DEFAULT_API_URL}?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": contentType },
      body: audio,
    });
  } catch (err) {
    console.error("Deepgram request failed", err);
    return Response.json({ error: "Couldn't reach the transcription service." }, { status: 502 });
  }
  if (!res.ok) {
    console.error("Deepgram error", res.status, await res.text().catch(() => ""));
    return Response.json({ error: `Transcription failed (${res.status}).` }, { status: 502 });
  }

  const data = await res.json();
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  const body: TranscribeResponse = {
    text: alt?.transcript ?? "",
    words: ((alt?.words ?? []) as DeepgramWord[]).map((w) => ({
      text: w.punctuated_word ?? w.word,
      confidence: w.confidence,
      start: w.start,
      end: w.end,
    })),
  };
  return Response.json(body);
}

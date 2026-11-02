import type { TranscribeResponse, Transcript } from "./transcript";

export async function serverTranscriptionAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/transcribe");
    return res.ok && Boolean((await res.json()).available);
  } catch {
    return false;
  }
}

export async function transcribeOnServer(audio: Blob, language: string): Promise<Transcript> {
  const res = await fetch(`/api/transcribe?language=${encodeURIComponent(language)}`, {
    method: "POST",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: audio,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Transcription failed (${res.status}).`);
  const { text, words } = data as TranscribeResponse;
  return { source: "deepgram", text, words, timed: words.length > 0 };
}

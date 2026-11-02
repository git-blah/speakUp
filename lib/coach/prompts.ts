import type { FeedbackRequest, OnePagerRequest } from "./types";

const MODE_NOTES: Record<string, string> = {
  word: "The prompt is a single random word; the speaker could take it in any direction.",
  topic: "The prompt is a debate-style topic; a clear position with reasons and examples is expected.",
  situation: "The prompt is a real-life role-play; judge tone, politeness and clarity as if speaking to that person.",
  explain: "The prompt asks for an explanation; judge accuracy, simplicity and use of examples or analogies.",
  speech: "The prompt is an impromptu speech to an audience; judge the opening, flow and closing line.",
};

export function feedbackPrompts(req: FeedbackRequest) {
  const system = `You are an encouraging but honest coach for impromptu speaking and spoken English.
The learner got a random prompt, a few seconds to think, then spoke to a camera. You receive an automatic speech-to-text transcript and delivery stats.

Guidelines:
- Ground every point in what they actually said; quote short phrases.
- The transcript is machine-generated and may lack punctuation or contain recognition errors. Don't penalise those artefacts.
- Prioritise the few changes that would help most. Keep each item to one or two sentences.
- Language fixes: only genuine grammar or word-choice problems. The speaker uses ${req.language} English, so don't "correct" valid regional usage.
- Calibrate scores: 5 = adequate, 7 = good, 9-10 = rare and excellent.
- The better version should sound natural when spoken aloud, not like an essay.
- If on-camera stats are given, mention body language only when they show a clear problem (lots of movement, a moving camera, poor lighting, little eye contact, poor framing). They're rough automatic measures; hand gestures also count as movement.`;

  const s = req.stats;
  const statLines = [
    `Speaking time: ${Math.round(req.seconds)}s`,
    s.wpm !== null && `Pace: ${s.wpm} words per minute`,
    s.fillersPerMin !== null && `Filler words: ${s.fillersPerMin} per minute`,
    s.longPauses !== null && `Pauses of 2s or more: ${s.longPauses}`,
    s.startDelay !== null && `Seconds before first word: ${s.startDelay}`,
    s.movement && `On-camera movement: ${s.movement}${s.highMotionShare != null ? ` (a lot of movement ${Math.round(s.highMotionShare * 100)}% of the time)` : ""}`,
    s.lighting && `Video lighting: ${s.lighting}`,
    s.eyeContactShare != null &&
      `Looking at the camera: ${Math.round(s.eyeContactShare * 100)}% of the time${s.lookingDownShare != null ? ` (looking down ${Math.round(s.lookingDownShare * 100)}%)` : ""}`,
    s.framing && `Framing: ${s.framing}`,
  ].filter(Boolean);

  const user = `Prompt type: ${req.mode}. ${MODE_NOTES[req.mode] ?? ""}
Prompt: "${req.promptText}"

Delivery stats:
${statLines.join("\n")}

<transcript>
${req.transcript}
</transcript>

Give your coaching feedback.`;

  return { system, user };
}

export function onePagerPrompts(req: OnePagerRequest) {
  const system = `You write concise one-page study notes that help an English learner talk confidently about a topic on the spot.
Write accurate, neutral, plain English (around B2-C1 level). Keep every item short; this must fit on one page.
Adapt to the prompt type:
- word: meanings, associations, idioms and story angles.
- topic: balanced arguments with reasons and real-world examples.
- situation: useful phrases, etiquette and the other person's perspective.
- explain: the core concept, explained accurately, with one good analogy.
- speech: conventions for the occasion and ideas for content.
Don't invent statistics or quotes. If you're unsure of a figure, describe it qualitatively.`;

  const user = `Prompt type: ${req.mode}
Prompt: "${req.promptText}"
The learner speaks ${req.language} English.

Write the one-pager.`;

  return { system, user };
}

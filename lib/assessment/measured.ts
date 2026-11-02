/**
 * Scores for the "measured" metrics, computed in code so they're repeatable and explainable.
 * Every function returns N/A (score null) when the evidence it needs is missing, and states the
 * numbers it used. Scoring curves are deliberately gentle and documented inline.
 */
import type { SpeechStats } from "../analysis";
import { normalize } from "../analysis";
import type { AudioFeatures } from "../audioFeatures";
import type { FaceStats } from "../face/faceAnalysis";
import type { Transcript } from "../transcript";
import type { VideoStats } from "../videoAnalysis";
import { clampScore, round1, type MetricResult } from "./metrics";

export interface MeasuredInput {
  transcript: Transcript | null;
  stats: SpeechStats | null;
  audio: AudioFeatures | null;
  video: VideoStats | null;
  face: FaceStats | null;
  /** Length of the take in seconds. */
  seconds: number;
}

type Timed = { text: string; start: number; end: number; confidence?: number };

const na = (id: string, why: string): MetricResult => ({ id, score: null, evidence: why, improvement: "" });
const r = (id: string, score: number, evidence: string, improvement: string): MetricResult => ({
  id,
  score: clampScore(score),
  evidence,
  improvement,
});
const pct = (x: number) => `${Math.round(x * 100)}%`;
const SENTENCE_END = /[.!?]["')\]]*$/;
const PHRASE_END = /[.!?,;:]["')\]]*$/;

function timedWords(t: Transcript | null): Timed[] | null {
  if (!t?.timed) return null;
  const w = t.words.filter((x): x is Timed => x.start !== undefined && x.end !== undefined && normalize(x.text) !== "");
  return w.length >= 5 ? w : null;
}

/** Moving-average type–token ratio (window 25): length-independent lexical diversity. */
export function mattr(words: string[], window = 25): number | null {
  if (words.length < window + 15) return null;
  let total = 0;
  let n = 0;
  for (let i = 0; i + window <= words.length; i++) {
    total += new Set(words.slice(i, i + window)).size / window;
    n++;
  }
  return total / n;
}

/** Immediately repeated words and two-word phrases ("I I think", "we went we went"). */
export function repetitions(words: string[]): string[] {
  const found: string[] = [];
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) found.push(`${words[i]} ${words[i]}`);
    else if (i >= 3 && words[i - 1] === words[i - 3] && words[i] === words[i - 2]) {
      found.push(`${words[i - 1]} ${words[i]} ${words[i - 1]} ${words[i]}`);
    }
  }
  return found;
}

function lexicalDiversity(input: MeasuredInput): MetricResult {
  const words = (input.transcript?.words ?? []).map((w) => normalize(w.text)).filter(Boolean);
  const v = mattr(words);
  if (v === null) return na("lexical_diversity", `Not enough words (${words.length}; needs 40+).`);
  // 0.70 → 4, 0.85 → 10 (MATTR-25 on everyday speech usually sits around 0.75–0.85).
  return r(
    "lexical_diversity",
    4 + ((v - 0.7) / 0.15) * 6,
    `Moving-average type–token ratio ${v.toFixed(2)} over ${words.length} words (0.85+ scores 10).`,
    v < 0.8 ? "Swap repeated words for synonyms and add one precise, topic-specific word per point." : "Keep varying your vocabulary.",
  );
}

function rate(input: MeasuredInput): MetricResult {
  const wpm = input.stats?.wpm;
  if (wpm == null) return na("rate", "Too little transcribed speech to measure.");
  // Full marks across a wide natural band; slow speech is only mildly penalised (slow ≠ disfluent).
  const score = wpm < 120 ? 10 - (120 - wpm) / 10 : wpm > 170 ? 10 - (wpm - 170) / 8 : 10;
  return r(
    "rate",
    score,
    `${wpm} words per minute (comfortable range 120–170). Slower speech isn't treated as poor fluency.`,
    wpm < 120
      ? "Plan your first two sentences while thinking so you start with momentum; aim for ~130 wpm."
      : wpm > 170
        ? "Slow down slightly and pause at the end of each point."
        : "Your pace suits listeners; keep it.",
  );
}

function articulation(input: MeasuredInput): MetricResult {
  const w = timedWords(input.transcript);
  if (!w) return na("articulation", "Needs word timings (Deepgram transcription).");
  // Speaking time = spans of speech, splitting at gaps of 0.25 s or more.
  let speaking = 0;
  let runStart = w[0].start;
  for (let i = 1; i <= w.length; i++) {
    if (i === w.length || w[i].start - w[i - 1].end >= 0.25) {
      speaking += w[i - 1].end - runStart;
      if (i < w.length) runStart = w[i].start;
    }
  }
  if (speaking < 5) return na("articulation", "Too little speech to measure.");
  const ar = (w.length / speaking) * 60;
  const score = ar < 150 ? 10 - (150 - ar) / 12 : ar > 240 ? 10 - (ar - 240) / 10 : 10;
  return r(
    "articulation",
    score,
    `${Math.round(ar)} words per minute while speaking (pauses removed; natural range 150–240).`,
    ar < 150
      ? "Your words themselves are slow; practise reading a paragraph aloud at a steady, slightly quicker pace."
      : ar > 240
        ? "You rush words together; open your mouth more and finish each word."
        : "Your speed within phrases is natural.",
  );
}

function rateConsistency(input: MeasuredInput): MetricResult {
  const w = timedWords(input.transcript);
  if (!w) return na("rate_consistency", "Needs word timings (Deepgram transcription).");
  const from = w[0].start;
  const to = w[w.length - 1].end;
  if (to - from < 30) return na("rate_consistency", "Needs at least 30 seconds of speech.");
  const windows: number[] = [];
  for (let s = from; s + 10 <= to; s += 10) windows.push(w.filter((x) => x.start >= s && x.start < s + 10).length * 6);
  const mean = windows.reduce((a, b) => a + b, 0) / windows.length;
  const cv = Math.sqrt(windows.reduce((a, b) => a + (b - mean) ** 2, 0) / windows.length) / (mean || 1);
  return r(
    "rate_consistency",
    10 - Math.max(0, cv - 0.15) * 20,
    `Pace across ${windows.length} ten-second windows ranged ${Math.min(...windows)}–${Math.max(...windows)} wpm (variation ${pct(cv)}; under 15% scores 10).`,
    cv > 0.3
      ? "Your pace surges and stalls. Practise with a simple outline so you don't speed up when sure and stall when unsure."
      : "Your pace is steady.",
  );
}

function fillerSounds(input: MeasuredInput): MetricResult {
  if (!input.stats || input.seconds < 10) return na("filler_sounds", "Not enough speech.");
  const perMin = input.stats.hesitations / (input.seconds / 60);
  const browser = input.transcript?.source === "browser";
  return r(
    "filler_sounds",
    10 - 1.5 * perMin,
    `${input.stats.hesitations} um/uh in ${Math.round(input.seconds)}s (${perMin.toFixed(1)} per minute).${browser ? " Browser transcription often drops um/uh, so this may undercount." : ""}`,
    perMin > 2 ? "When you feel an 'um' coming, close your mouth and pause silently instead." : "Keep replacing hesitation sounds with silent pauses.",
  );
}

function crutches(input: MeasuredInput): MetricResult {
  if (!input.stats || input.seconds < 10) return na("crutches", "Not enough speech.");
  const perMin = input.stats.fillers / (input.seconds / 60);
  const top = input.stats.fillerCounts.filter((f) => !["um", "uh", "er", "erm", "ah", "eh", "hmm", "hm", "mm", "umm", "uhh", "uhm"].includes(f.text));
  return r(
    "crutches",
    10 - 1.2 * perMin,
    `${input.stats.fillers} possible fillers (${perMin.toFixed(1)} per minute)${top.length ? `: ${top.slice(0, 4).map((f) => `"${f.text}" ×${f.count}`).join(", ")}` : ""}. Some may be legitimate uses.`,
    perMin > 2 ? `Notice your favourite crutch${top[0] ? ` ("${top[0].text}")` : ""} and replace it with a pause.` : "Low use of crutch words; keep it up.",
  );
}

function hesitationPauses(input: MeasuredInput): MetricResult {
  const w = timedWords(input.transcript);
  if (!w) return na("hesitation_pauses", "Needs word timings (Deepgram transcription).");
  const mins = (w[w.length - 1].end - w[0].start) / 60;
  const mid = [];
  for (let i = 1; i < w.length; i++) {
    const gap = w[i].start - w[i - 1].end;
    if (gap >= 1 && !PHRASE_END.test(w[i - 1].text)) mid.push({ at: w[i - 1].end, gap, after: w[i - 1].text });
  }
  const perMin = mid.length / Math.max(mins, 0.25);
  const examples = mid
    .slice(0, 3)
    .map((p) => `${p.gap.toFixed(1)}s after "${p.after}" at ${Math.floor(p.at / 60)}:${String(Math.floor(p.at % 60)).padStart(2, "0")}`)
    .join("; ");
  return r(
    "hesitation_pauses",
    10 - 2 * perMin,
    `${mid.length} pause${mid.length === 1 ? "" : "s"} of 1s+ in the middle of a phrase (${perMin.toFixed(1)} per minute)${examples ? `: ${examples}` : ""}. Pauses at sentence or clause ends aren't counted.`,
    mid.length ? "Mid-sentence pauses usually mean searching for the next idea; outline 2–3 points before you start." : "No hesitation pauses mid-phrase.",
  );
}

function deliberatePauses(input: MeasuredInput): MetricResult {
  const w = timedWords(input.transcript);
  if (!w) return na("deliberate_pauses", "Needs word timings and punctuation (Deepgram transcription).");
  const ends = w.slice(0, -1).map((x, i) => ({ x, gap: w[i + 1].start - x.end })).filter((e) => SENTENCE_END.test(e.x.text));
  if (ends.length < 2) return na("deliberate_pauses", "Fewer than two sentence ends to judge.");
  const paused = ends.filter((e) => e.gap >= 0.3).length;
  const share = paused / ends.length;
  return r(
    "deliberate_pauses",
    4 + 12 * share,
    `Paused (0.3s+) after ${paused} of ${ends.length} sentence ends (${pct(share)}; half or more scores 10).`,
    share < 0.5 ? "Let sentences land: take a short breath at each full stop instead of running into the next one." : "You use pauses well to separate ideas.",
  );
}

function startLatency(input: MeasuredInput): MetricResult {
  const d = input.stats?.startDelay;
  if (d == null) return na("start_latency", "Start time not available.");
  return r(
    "start_latency",
    d <= 1.5 ? 10 : 10 - 1.2 * (d - 1.5),
    `First word after ${d.toFixed(1)}s (1.5s or less scores 10).`,
    d > 3 ? 'Have a go-to opener ready, e.g. "The first thing that comes to mind is…".' : "You start promptly.",
  );
}

function repetitionMetric(input: MeasuredInput): MetricResult {
  const words = (input.transcript?.words ?? []).map((w) => normalize(w.text)).filter(Boolean);
  if (words.length < 20) return na("repetitions", "Not enough words.");
  const reps = repetitions(words);
  const per100 = (reps.length / words.length) * 100;
  return r(
    "repetitions",
    10 - 2.5 * per100,
    `${reps.length} immediate repetition${reps.length === 1 ? "" : "s"} in ${words.length} words (${per100.toFixed(1)} per 100)${reps.length ? `: ${reps.slice(0, 3).map((x) => `"${x}"`).join(", ")}` : ""}.`,
    reps.length > 1 ? "Restarts often come from starting before you know the sentence's end; pause, then say it once." : "Very few restarts.",
  );
}

function continuity(input: MeasuredInput): MetricResult {
  let mean: number | null = null;
  let source = "";
  if (input.audio?.meanRunS != null && input.audio.runs.length >= 2) {
    mean = input.audio.meanRunS;
    source = `${input.audio.runs.length} stretches of speech in the audio`;
  } else {
    const w = timedWords(input.transcript);
    if (w) {
      const runs: number[] = [];
      let start = w[0].start;
      for (let i = 1; i <= w.length; i++) {
        if (i === w.length || w[i].start - w[i - 1].end >= 0.7) {
          runs.push(w[i - 1].end - start);
          if (i < w.length) start = w[i].start;
        }
      }
      if (runs.length >= 2) {
        mean = runs.reduce((a, b) => a + b, 0) / runs.length;
        source = `${runs.length} stretches of speech in the word timings`;
      }
    }
  }
  if (mean === null) return na("continuity", "Needs the audio analysis or word timings.");
  return r(
    "continuity",
    (mean / 6) * 10,
    `Average ${mean.toFixed(1)}s of continuous speech between silences of 0.7s+ (${source}; 6s+ scores 10).`,
    mean < 4 ? "Speak in whole thought-groups: plan each sentence's point, then say it in one breath." : "You speak in well-formed stretches.",
  );
}

function intonation(input: MeasuredInput): MetricResult {
  const a = input.audio;
  if (!a || a.pitchStdSt === null) return na("intonation", "Not enough voiced audio to measure pitch.");
  const sd = a.pitchStdSt;
  // SD of the middle 90% of pitch values. Calibrated on real speech: an expressive orator (JFK)
  // measures ~1.9; a near-monotone voice is under 1. Very wide (>5) may sound erratic.
  const score = sd < 1 ? 2 : sd < 2 ? 2 + (sd - 1) * 8 : sd <= 5 ? 10 : 10 - (sd - 5) * 1.5;
  return r(
    "intonation",
    score,
    `Pitch varied by ${round1(sd)} semitones (SD), range ${round1(a.pitchRangeSt ?? 0)} semitones around ${Math.round(a.pitchMedianHz ?? 0)} Hz (2–5 scores 10). Measured from the recording; background noise can affect it.`,
    sd < 1.5
      ? "Your voice stays quite flat. Stress the key word in each sentence and let your pitch fall at full stops."
      : "Your pitch moves naturally; use it to stress key words.",
  );
}

function volume(input: MeasuredInput): MetricResult {
  const a = input.audio;
  if (!a || (a.loudnessStdDb === null && a.phraseEndDropDb === null)) return na("volume", "Not enough audio to measure.");
  let score = 10;
  const parts: string[] = [];
  if (a.loudnessStdDb !== null) {
    parts.push(`loudness varied by ${round1(a.loudnessStdDb)} dB (SD) during speech`);
    if (a.loudnessStdDb > 10) score -= (a.loudnessStdDb - 10) * 0.8;
  }
  if (a.phraseEndDropDb !== null) {
    parts.push(`phrase endings were ${round1(a.phraseEndDropDb)} dB quieter than the rest`);
    if (a.phraseEndDropDb > 4) score -= (a.phraseEndDropDb - 4) * 1;
  }
  const trailing = (a.phraseEndDropDb ?? 0) > 4;
  return r(
    "volume",
    score,
    `${parts.join("; ")} (endings within 4 dB score 10). Absolute volume depends on your microphone, so it isn't scored.`,
    trailing ? "You trail off at the ends of phrases; keep your breath supported through the last word." : "Your volume is steady.",
  );
}

function intelligibility(input: MeasuredInput): MetricResult {
  const w = (input.transcript?.words ?? []).filter((x) => typeof x.confidence === "number");
  if (w.length < 20) return na("intelligibility", "Needs Deepgram transcription (word confidence).");
  const low = w.filter((x) => (x.confidence as number) < 0.7);
  const share = low.length / w.length;
  return r(
    "intelligibility",
    10 - share * 40,
    `The recognizer was unsure (confidence < 0.7) of ${low.length} of ${w.length} words (${pct(share)})${low.length ? `, e.g. ${low.slice(0, 4).map((x) => `"${x.text}"`).join(", ")}` : ""}. A rough proxy: recognizers can be less sure of some accents even when people understand easily.`,
    share > 0.1 ? "Slow slightly on longer words and finish word endings clearly." : "Your words were recognised clearly.",
  );
}

function eyeContact(input: MeasuredInput): MetricResult {
  const f = input.face;
  if (!f || f.framing === "absent") return na("eye_contact", "No face tracking data for this take.");
  return r(
    "eye_contact",
    ((f.eyeContactShare - 0.2) / 0.6) * 10,
    `Looked at the camera ${pct(f.eyeContactShare)} of the time; down ${pct(f.downShare)}, away ${pct(f.awayShare)} (80%+ scores 10).`,
    f.downShare > 0.2 ? "Glance at notes briefly, then return to the lens." : f.eyeContactShare < 0.7 ? "Talk to the lens as if it were a person." : "Strong eye contact.",
  );
}

function framing(input: MeasuredInput): MetricResult {
  const f = input.face;
  if (!f) return na("framing", "No face tracking data for this take.");
  const base = f.framing === "good" ? 9.5 : f.framing === "absent" ? 1 : 5;
  return r(
    "framing",
    base - (1 - f.presentShare) * 5,
    `Framing: ${f.framing}; face in view ${pct(f.presentShare)} of the time.`,
    f.framing === "good" ? "Well framed; keep the camera at eye level." : "Use the live framing check before you start.",
  );
}

function bodyMovement(input: MeasuredInput): MetricResult {
  const v = input.video;
  if (!v) return na("body_movement", "No video analysis for this take.");
  const score = v.movement === "natural" ? 9 : v.movement === "still" ? 6 : v.movement === "busy" ? 7 - v.highShare * 6 : 4;
  return r(
    "body_movement",
    score,
    `Movement: ${v.movement}; a lot of movement ${pct(v.highShare)} of the time, very still ${pct(v.stillShare)}, camera moving ${pct(v.cameraMoveShare)}. Hand gestures count as movement.`,
    v.movement === "busy"
      ? "Plant your feet and keep gestures in front of your chest."
      : v.movement === "still"
        ? "Add a few natural hand gestures to emphasise points."
        : v.movement === "shaky"
          ? "Rest the camera on something stable."
          : "Natural movement; keep it.",
  );
}

/** All 17 measured metrics. */
export function measureMetrics(input: MeasuredInput): MetricResult[] {
  return [
    lexicalDiversity(input),
    rate(input),
    articulation(input),
    rateConsistency(input),
    fillerSounds(input),
    crutches(input),
    hesitationPauses(input),
    deliberatePauses(input),
    startLatency(input),
    repetitionMetric(input),
    continuity(input),
    intonation(input),
    volume(input),
    intelligibility(input),
    eyeContact(input),
    framing(input),
    bodyMovement(input),
  ];
}

import type { Transcript } from "./transcript";

export const LONG_PAUSE_SECONDS = 2;

/** Sounds that are always hesitation, never content. */
const HESITATIONS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "eh", "hmm", "hm", "mm"]);

/** Words/phrases that are often filler but can be legitimate, so they count as "possible". */
const FILLER_PHRASES: string[][] = [
  ["you", "know"],
  ["i", "mean"],
  ["kind", "of"],
  ["sort", "of"],
  ["like"],
  ["basically"],
  ["actually"],
  ["literally"],
];

/** Previous words after which "like" is a verb or comparison, not filler ("I like", "looks like"). */
const LIKE_LEGIT_BEFORE = new Set([
  "i", "you", "we", "they", "he", "she", "people", "would", "really", "dont", "doesnt", "didnt",
  "not", "look", "looks", "looked", "looking", "feel", "feels", "felt", "seem", "seems", "sound",
  "sounds", "just", "more", "much", "something", "anything", "nothing", "thing", "things",
  "exactly", "also", "id", "youd", "theyd", "wed",
]);

/** Previous words after which "kind of"/"sort of" means "type of" ("what kind of car"). */
const TYPE_OF_BEFORE = new Set(["what", "this", "that", "a", "any", "every", "same", "the", "which", "some", "these", "those", "different", "one"]);

const STOPWORDS = new Set(
  (
    "the a an and or but so if then than that this these those there their they them it its is are was were be " +
    "been being am do does did have has had i me my we our you your he she his her to of in on at by for with " +
    "from as about into over not no yes just very can could would should will what which who when where why how " +
    "all also more most some any one two because really get got going go like know think mean thing things lot " +
    "dont its im youre thats theres"
  ).split(" "),
);

export type TokenKind = "word" | "hesitation" | "filler";

export interface Token {
  text: string;
  kind: TokenKind;
  start?: number;
  /** Gap in seconds before this token, set only when it's a long pause. */
  pauseBefore?: number;
}

export type Pace = "slow" | "steady" | "good" | "quick" | "fast";

export interface SpeechStats {
  /** Words spoken, excluding hesitations and fillers. */
  words: number;
  wpm: number | null;
  pace: Pace | null;
  hesitations: number;
  fillers: number;
  fillersPerMin: number | null;
  fillerCounts: { text: string; count: number }[];
  /** null when the transcript has no word timings. */
  longPauses: number | null;
  longestPause: number | null;
  startDelay: number | null;
  /** Unique / total content words (0–1); null for very short takes. */
  variety: number | null;
  repeated: { word: string; count: number }[];
  tokens: Token[];
}

export function normalize(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

export function paceFor(wpm: number): Pace {
  if (wpm < 110) return "slow";
  if (wpm < 130) return "steady";
  if (wpm <= 160) return "good";
  if (wpm <= 180) return "quick";
  return "fast";
}

function matchFiller(norm: string[], i: number): number {
  for (const phrase of FILLER_PHRASES) {
    if (!phrase.every((p, k) => norm[i + k] === p)) continue;
    const prev = norm[i - 1];
    if (phrase[0] === "like" && prev !== undefined && LIKE_LEGIT_BEFORE.has(prev)) continue;
    if (phrase[1] === "of" && (phrase[0] === "kind" || phrase[0] === "sort") && prev !== undefined && TYPE_OF_BEFORE.has(prev)) continue;
    return phrase.length;
  }
  return 0;
}

/**
 * @param durationSeconds length of the recorded take, used for pace when word timings are missing.
 */
export function analyze(transcript: Transcript, durationSeconds: number): SpeechStats {
  const words = transcript.words.filter((w) => normalize(w.text) !== "");
  const norm = words.map((w) => normalize(w.text));
  const timed = transcript.timed && words.length > 0;

  const tokens: Token[] = [];
  const fillerCounts = new Map<string, number>();
  const content: string[] = [];
  let hesitations = 0;
  let fillers = 0;
  let longPauses = 0;
  let longestPause = 0;

  for (let i = 0; i < words.length; ) {
    const w = words[i];
    let pauseBefore: number | undefined;
    if (timed && i > 0) {
      const gap = (w.start ?? 0) - (words[i - 1].end ?? 0);
      if (gap >= LONG_PAUSE_SECONDS) {
        pauseBefore = gap;
        longPauses++;
      }
      longestPause = Math.max(longestPause, gap);
    }

    let kind: TokenKind = "word";
    let span = 1;
    if (HESITATIONS.has(norm[i])) {
      kind = "hesitation";
      hesitations++;
    } else {
      const len = matchFiller(norm, i);
      if (len > 0) {
        kind = "filler";
        span = len;
        fillers++;
      }
    }

    const text = words.slice(i, i + span).map((x) => x.text).join(" ");
    if (kind === "word") {
      content.push(norm[i]);
    } else {
      const key = norm.slice(i, i + span).join(" ");
      fillerCounts.set(key, (fillerCounts.get(key) ?? 0) + 1);
    }
    tokens.push({ text, kind, start: w.start, pauseBefore });
    i += span;
  }

  const startDelay = timed ? (words[0].start ?? null) : (transcript.firstWordAt ?? null);

  let speakingSeconds: number;
  if (timed) {
    speakingSeconds = (words[words.length - 1].end ?? 0) - (words[0].start ?? 0);
  } else {
    speakingSeconds = durationSeconds - (startDelay ?? 0);
  }
  const minutes = speakingSeconds / 60;
  const wpm = content.length >= 5 && speakingSeconds >= 5 ? Math.round(content.length / minutes) : null;
  const fillersPerMin = durationSeconds >= 5 ? (hesitations + fillers) / (durationSeconds / 60) : null;

  const counts = new Map<string, number>();
  for (const c of content) {
    if (c.length >= 3 && !STOPWORDS.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const repeated = [...counts]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word, count]) => ({ word, count }));

  return {
    words: content.length,
    wpm,
    pace: wpm === null ? null : paceFor(wpm),
    hesitations,
    fillers,
    fillersPerMin: fillersPerMin === null ? null : Math.round(fillersPerMin * 10) / 10,
    fillerCounts: [...fillerCounts]
      .sort((a, b) => b[1] - a[1])
      .map(([text, count]) => ({ text, count })),
    longPauses: timed ? longPauses : null,
    longestPause: timed ? Math.round(longestPause * 10) / 10 : null,
    startDelay: startDelay === null ? null : Math.round(startDelay * 10) / 10,
    variety: content.length >= 20 ? new Set(content).size / content.length : null,
    repeated,
    tokens,
  };
}

/** Up to three concrete, rule-based suggestions for the next take. */
export function tips(stats: SpeechStats): string[] {
  const out: string[] = [];
  if (stats.words < 15) {
    return ["Very few words were picked up. Speak a little louder and keep going until the timer ends; it's fine to say less-than-perfect things."];
  }
  if (stats.fillersPerMin !== null && stats.fillersPerMin > 4) {
    const top = stats.fillerCounts[0]?.text;
    out.push(
      `About ${Math.round(stats.fillersPerMin)} fillers a minute${top ? ` (mostly "${top}")` : ""}. When you feel one coming, close your mouth and pause silently instead. A pause sounds confident; a filler doesn't.`,
    );
  }
  if (stats.pace === "slow") {
    out.push("Your pace was slow. Aim for 130–160 words a minute: plan your first two sentences during thinking time so you start with momentum.");
  } else if (stats.pace === "fast") {
    out.push("You spoke fast. Slow down slightly and pause at the end of each point so your audience can keep up.");
  }
  if (stats.startDelay !== null && stats.startDelay > 4) {
    out.push(`It took ${Math.round(stats.startDelay)}s to say your first word. Have a go-to opener ready, e.g. "The first thing that comes to mind is…".`);
  }
  if (stats.longPauses !== null && stats.longPauses >= 3) {
    out.push(`${stats.longPauses} long pauses. Use a simple structure (point → reason → example → point) so you always know what comes next.`);
  }
  if (stats.repeated.length > 0) {
    const r = stats.repeated[0];
    out.push(`You said "${r.word}" ${r.count} times. Try a synonym or two next time to vary your vocabulary.`);
  }
  if (out.length === 0) {
    out.push("Solid take: good pace and few fillers. Push yourself with a harder prompt or less thinking time.");
  }
  return out.slice(0, 3);
}

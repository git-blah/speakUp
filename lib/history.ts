import type { Prompt } from "./prompts";
import type { Framing } from "./face/faceAnalysis";
import type { Lighting, Movement } from "./videoAnalysis";

/** Summary of one take. Kept small: full transcripts, feedback and video live in IndexedDB (takeStore). */
export interface Session {
  promptId: string;
  promptText: string;
  mode: Prompt["mode"];
  /** Difficulty of the prompt, so it can be practised again (absent on older takes). */
  difficulty?: Prompt["difficulty"];
  seconds: number;
  at: string; // ISO timestamp; also the take's id
  // Speech stats; absent when the take couldn't be transcribed.
  words?: number;
  wpm?: number | null;
  fillersPerMin?: number | null;
  startDelay?: number | null;
  longPauses?: number | null;
  /** Average of the AI coach's four scores (1–10), once feedback arrives. */
  score?: number;
  // On-camera stats; absent for audio-only takes.
  movement?: Movement;
  /** Share of the take with a lot of movement (0–1). */
  highMotionShare?: number;
  lighting?: Lighting;
  /** Share of the time (with a face in view) spent looking at the camera (0–1). */
  eyeContactShare?: number;
  framing?: Framing;
  /** Overall speaking score (0–10) from the full assessment profile. */
  assessmentScore?: number;
}

const KEY = "speak-up:history";
const MAX = 1000;

export function loadHistory(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

function store(next: Session[]): Session[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable; history is a convenience only.
  }
  return next;
}

export function saveSession(session: Session): Session[] {
  return store([session, ...loadHistory()].slice(0, MAX));
}

/** Merge fields into an existing take (e.g. the coach score, which arrives later). */
export function updateSession(at: string, patch: Partial<Session>): Session[] {
  return store(loadHistory().map((s) => (s.at === at ? { ...s, ...patch, at } : s)));
}

export function deleteSession(at: string): Session[] {
  return store(loadHistory().filter((s) => s.at !== at));
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Consecutive days (ending today or yesterday) with at least one session. */
export function currentStreak(history: Session[], now = new Date()): number {
  const days = new Set(history.map((s) => dayKey(new Date(s.at))));
  const cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

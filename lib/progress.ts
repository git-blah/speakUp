import { dayKey, type Session } from "./history";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeriodSummary {
  takes: number;
  minutes: number;
  wpm: number | null;
  fillersPerMin: number | null;
  startDelay: number | null;
  score: number | null;
  /** Share of the time looking at the camera (0–1), from face tracking. */
  eyeContact: number | null;
}

export interface Focus {
  title: string;
  detail: string;
}

export interface WeeklyReview {
  /** Last 7 days, including today. */
  current: PeriodSummary;
  /** The 7 days before that. */
  previous: PeriodSummary;
  activeDays: number;
  focus: Focus;
}

export interface TrendPoint {
  /** Epoch ms. */
  t: number;
  v: number;
  at: string;
}

export interface CalendarDay {
  date: Date;
  count: number;
  future: boolean;
}

function mean(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function summarize(sessions: Session[]): PeriodSummary {
  return {
    takes: sessions.length,
    minutes: sessions.reduce((sum, s) => sum + s.seconds, 0) / 60,
    wpm: mean(sessions.map((s) => s.wpm)),
    fillersPerMin: mean(sessions.map((s) => s.fillersPerMin)),
    startDelay: mean(sessions.map((s) => s.startDelay)),
    score: mean(sessions.map((s) => s.score)),
    eyeContact: mean(sessions.map((s) => s.eyeContactShare)),
  };
}

/** Sessions with from <= at < to (epoch ms). */
export function between(history: Session[], from: number, to: number): Session[] {
  return history.filter((s) => {
    const t = Date.parse(s.at);
    return t >= from && t < to;
  });
}

export function focusFor(s: PeriodSummary, activeDays: number): Focus {
  if (s.takes === 0) {
    return { title: "Get started", detail: "Aim for one short take a day. Two minutes is enough to build the habit." };
  }
  if (s.fillersPerMin !== null && s.fillersPerMin > 4) {
    return {
      title: "Cut the fillers",
      detail: `You averaged ${s.fillersPerMin.toFixed(1)} fillers a minute. This week, swap every "um" for a silent pause. Short 30-second takes make it easier to stay aware.`,
    };
  }
  if (s.wpm !== null && s.wpm < 120) {
    return {
      title: "Pick up the pace",
      detail: `You averaged ${Math.round(s.wpm)} words a minute (aim for 130–160). Use your thinking time to plan your first two sentences so you start with momentum.`,
    };
  }
  if (s.wpm !== null && s.wpm > 170) {
    return {
      title: "Slow down",
      detail: `You averaged ${Math.round(s.wpm)} words a minute (aim for 130–160). Pause at the end of each point so your listener can keep up.`,
    };
  }
  if (s.startDelay !== null && s.startDelay > 3) {
    return {
      title: "Start faster",
      detail: `It took you ${s.startDelay.toFixed(1)}s on average to start speaking. Set thinking time to 15s or none, and have a go-to opening line ready.`,
    };
  }
  if (s.eyeContact !== null && s.eyeContact < 0.5) {
    return {
      title: "Look at the lens",
      detail: `You looked at the camera ${Math.round(s.eyeContact * 100)}% of the time. Put a sticker next to the lens as a reminder, and look back at it after every glance away.`,
    };
  }
  if (s.score !== null && s.score < 6) {
    return {
      title: "Structure your answers",
      detail: "Your coach scores suggest answers that wander. Use Point → Reason → Example → Point for every take this week.",
    };
  }
  if (activeDays < 4) {
    return {
      title: "Practise more often",
      detail: `You practised on ${activeDays} of the last 7 days. Short daily takes beat one long session. Aim for 5 days.`,
    };
  }
  return {
    title: "Level up",
    detail: "Your numbers look solid. Switch to Hard prompts or less thinking time to keep improving.",
  };
}

export function weeklyReview(history: Session[], now = new Date()): WeeklyReview {
  const end = now.getTime() + 1; // include a take recorded at exactly "now"
  const currentSessions = between(history, end - 7 * DAY_MS, end);
  const current = summarize(currentSessions);
  const activeDays = new Set(currentSessions.map((s) => dayKey(new Date(s.at)))).size;
  return {
    current,
    previous: summarize(between(history, end - 14 * DAY_MS, end - 7 * DAY_MS)),
    activeDays,
    focus: focusFor(current, activeDays),
  };
}

/** Longest run of consecutive days with at least one take. */
export function bestStreak(history: Session[]): number {
  const days = [...new Set(history.map((s) => dayKey(new Date(s.at))))]
    .map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m, d).getTime();
    })
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    // Compare calendar days via rounding, so DST shifts (23h/25h days) still count as consecutive.
    run = i > 0 && Math.round((days[i] - days[i - 1]) / DAY_MS) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** Trailing average over the last `window` values (fewer at the start). */
export function rollingAverage(values: number[], window = 5): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Oldest-first points for one numeric field, skipping takes without it. */
export function trendPoints(history: Session[], value: (s: Session) => number | null | undefined): TrendPoint[] {
  return history
    .map((s) => ({ t: Date.parse(s.at), v: value(s), at: s.at }))
    .filter((p): p is TrendPoint => typeof p.v === "number" && Number.isFinite(p.v) && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

/** Week columns (Monday first) covering the last `weeks` weeks, with take counts per day. */
export function practiceCalendar(history: Session[], weeks = 12, now = new Date()): CalendarDay[][] {
  const counts = new Map<string, number>();
  for (const s of history) {
    const k = dayKey(new Date(s.at));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - mondayOffset - (weeks - 1) * 7);

  const columns: CalendarDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      column.push({ date, count: counts.get(dayKey(date)) ?? 0, future: date > today });
    }
    columns.push(column);
  }
  return columns;
}

"use client";

import type { PeriodSummary, WeeklyReview } from "@/lib/progress";

export const PACE_TARGET: [number, number] = [130, 160];

type Better = "up" | "down" | "target";

interface Tile {
  key: keyof PeriodSummary;
  label: string;
  short: string;
  format: (n: number) => string;
  deltaFormat?: (n: number) => string;
  better: Better;
}

const TILES: Tile[] = [
  { key: "takes", label: "Takes", short: "Takes", format: (n) => String(n), better: "up" },
  { key: "minutes", label: "Minutes spoken", short: "Minutes", format: (n) => n.toFixed(n < 10 ? 1 : 0), better: "up" },
  { key: "wpm", label: "Pace", short: "Pace", format: (n) => `${Math.round(n)} wpm`, better: "target" },
  { key: "fillersPerMin", label: "Fillers per minute", short: "Fillers/min", format: (n) => n.toFixed(1), better: "down" },
  { key: "startDelay", label: "First word", short: "First word", format: (n) => `${n.toFixed(1)}s`, better: "down" },
  {
    key: "eyeContact",
    label: "Eye contact",
    short: "Eye contact",
    format: (n) => `${Math.round(n * 100)}%`,
    deltaFormat: (n) => `${Math.round(n * 100)} pts`,
    better: "up",
  },
  {
    key: "score",
    label: "Coach score",
    short: "Coach score",
    format: (n) => `${n.toFixed(1)}/10`,
    deltaFormat: (n) => n.toFixed(1),
    better: "up",
  },
];

const paceMiss = (wpm: number) => Math.max(0, PACE_TARGET[0] - wpm, wpm - PACE_TARGET[1]);

function Delta({ cur, prev, tile, compact }: { cur: number | null; prev: number | null; tile: Tile; compact: boolean }) {
  if (cur === null) return <span className="muted">{compact ? "—" : "No data this week"}</span>;
  if (prev === null) return <span className="muted">{compact ? "new" : "Nothing to compare yet"}</span>;
  const diff = cur - prev;
  const fmt = tile.deltaFormat ?? tile.format;
  if (tile.better === "target" && paceMiss(cur) === 0 && paceMiss(prev) === 0) {
    return <span className="muted">{compact ? "on target" : "In the target range both weeks"}</span>;
  }
  // Compare at display precision so a change that rounds to zero reads as "same".
  if (fmt(Math.abs(diff)) === fmt(0) || (tile.better === "target" && paceMiss(cur) === paceMiss(prev))) {
    return <span className="muted">{compact ? "same" : "Same as the week before"}</span>;
  }
  const improved =
    tile.better === "up" ? diff > 0 : tile.better === "down" ? diff < 0 : paceMiss(cur) < paceMiss(prev);
  return (
    <span
      className={improved ? "delta-good" : "delta-bad"}
      title={`${improved ? "Better" : "Worse"} than the week before`}
    >
      {diff > 0 ? "▲" : "▼"} {fmt(Math.abs(diff))}
      {compact ? "" : ` · ${improved ? "better" : "worse"}`}
      {compact && <span className="sr-only">{improved ? " better" : " worse"}</span>}
    </span>
  );
}

/**
 * The last 7 days vs the 7 before. `compact` is the sidebar version: shorter labels, no focus box,
 * and tiles with no data this week are hidden.
 */
export function WeeklyTiles({ review, compact = false }: { review: WeeklyReview; compact?: boolean }) {
  const tiles = compact ? TILES.filter((t) => review.current[t.key] !== null || t.key === "takes") : TILES;
  return (
    <div className={`tiles ${compact ? "mini-tiles" : "review-tiles"}`}>
      {tiles.map((tile) => {
        const cur = review.current[tile.key];
        return (
          <div key={tile.key} className="tile">
            <div className="tile-label">{compact ? tile.short : tile.label}</div>
            <div className="tile-value">{cur === null ? "—" : tile.format(cur)}</div>
            <div className="tile-sub">
              <Delta cur={cur} prev={review.previous[tile.key]} tile={tile} compact={compact} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FocusBox({ review }: { review: WeeklyReview }) {
  return (
    <div className="focus">
      <div className="small muted">Focus for the next 7 days</div>
      <div className="focus-title">{review.focus.title}</div>
      <p>{review.focus.detail}</p>
    </div>
  );
}

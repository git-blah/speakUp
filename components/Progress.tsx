"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PracticeCalendar, TrendChart, shortDate } from "@/components/charts";
import TakeDetail from "@/components/TakeDetail";
import { deleteSession, type Session } from "@/lib/history";
import {
  bestStreak,
  practiceCalendar,
  trendPoints,
  weeklyReview,
  type PeriodSummary,
} from "@/lib/progress";
import { MODES, type Mode, type Prompt } from "@/lib/prompts";
import { deleteTake, listRecordings, type RecordingInfo } from "@/lib/takeStore";

const DAY_MS = 24 * 60 * 60 * 1000;
const PACE_TARGET: [number, number] = [130, 160];
const PAGE = 25;

const RANGES = [
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: Infinity },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

type Better = "up" | "down" | "target";

const TILES: {
  key: keyof PeriodSummary;
  label: string;
  format: (n: number) => string;
  deltaFormat?: (n: number) => string;
  better: Better;
}[] = [
  { key: "takes", label: "Takes", format: (n) => String(n), better: "up" },
  { key: "minutes", label: "Minutes spoken", format: (n) => n.toFixed(n < 10 ? 1 : 0), better: "up" },
  { key: "wpm", label: "Pace", format: (n) => `${Math.round(n)} wpm`, better: "target" },
  { key: "fillersPerMin", label: "Fillers per minute", format: (n) => n.toFixed(1), better: "down" },
  { key: "startDelay", label: "First word", format: (n) => `${n.toFixed(1)}s`, better: "down" },
  { key: "score", label: "Coach score", format: (n) => `${n.toFixed(1)}/10`, deltaFormat: (n) => n.toFixed(1), better: "up" },
];

const paceMiss = (wpm: number) => Math.max(0, PACE_TARGET[0] - wpm, wpm - PACE_TARGET[1]);

function Delta({ cur, prev, tile }: { cur: number | null; prev: number | null; tile: (typeof TILES)[number] }) {
  if (cur === null) return <span className="muted">No data this week</span>;
  if (prev === null) return <span className="muted">Nothing to compare yet</span>;
  const diff = cur - prev;
  const fmt = tile.deltaFormat ?? tile.format;
  if (tile.better === "target" && paceMiss(cur) === 0 && paceMiss(prev) === 0) {
    return <span className="muted">In the target range both weeks</span>;
  }
  // Compare at display precision so a change that rounds to zero reads as "same".
  if (fmt(Math.abs(diff)) === fmt(0) || (tile.better === "target" && paceMiss(cur) === paceMiss(prev))) {
    return <span className="muted">Same as the week before</span>;
  }
  const improved =
    tile.better === "up" ? diff > 0 : tile.better === "down" ? diff < 0 : paceMiss(cur) < paceMiss(prev);
  return (
    <span className={improved ? "delta-good" : "delta-bad"}>
      {diff > 0 ? "▲" : "▼"} {fmt(Math.abs(diff))} · {improved ? "better" : "worse"}
    </span>
  );
}

interface Props {
  history: Session[];
  onHistory: (h: Session[]) => void;
  onPractise: (p: Prompt) => void;
  onGoPractice: () => void;
  keepRecordings: number;
}

export default function Progress({ history, onHistory, onPractise, onGoPractice, keepRecordings }: Props) {
  const [range, setRange] = useState<RangeId>("30");
  const [mode, setMode] = useState<Mode | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<Session | null>(null);
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);

  const refreshRecordings = useCallback(() => {
    listRecordings().then(setRecordings, () => setRecordings([]));
  }, []);
  useEffect(refreshRecordings, [refreshRecordings]);

  const review = useMemo(() => weeklyReview(history), [history]);
  const calendar = useMemo(() => practiceCalendar(history, 16), [history]);
  const best = useMemo(() => bestStreak(history), [history]);

  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const from = Number.isFinite(days) ? Date.now() - days * DAY_MS : -Infinity;
    return history.filter((s) => Date.parse(s.at) >= from && (mode === "all" || s.mode === mode));
  }, [history, range, mode]);

  const recordingSet = useMemo(() => new Set(recordings.map((r) => r.at)), [recordings]);
  const recordingMb = recordings.reduce((n, r) => n + r.size, 0) / 1024 / 1024;

  async function removeTake(at: string) {
    await deleteTake(at).catch(() => {});
    onHistory(deleteSession(at));
    setOpen(null);
    refreshRecordings();
  }

  if (history.length === 0) {
    return (
      <section className="card empty-progress">
        <h1>Your progress</h1>
        <p className="muted">
          Once you&apos;ve done a few takes, this page shows your weekly review, a practice calendar and
          how your pace, fillers and scores change over time.
        </p>
        <button className="primary" onClick={onGoPractice}>
          Start practising
        </button>
      </section>
    );
  }

  const { current, previous } = review;

  return (
    <div className="progress-page">
      <section className="card">
        <div className="section-head spread">
          <h1>Last 7 days</h1>
          <span className="small muted">
            Active {review.activeDays} of 7 days · best streak {best} day{best === 1 ? "" : "s"}
          </span>
        </div>
        <div className="tiles review-tiles">
          {TILES.map((tile) => {
            const cur = current[tile.key];
            return (
              <div key={tile.key} className="tile">
                <div className="tile-label">{tile.label}</div>
                <div className="tile-value">{cur === null ? "—" : tile.format(cur)}</div>
                <div className="tile-sub">
                  <Delta cur={cur} prev={previous[tile.key]} tile={tile} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="focus">
          <div className="small muted">Focus for the next 7 days</div>
          <div className="focus-title">{review.focus.title}</div>
          <p>{review.focus.detail}</p>
        </div>
      </section>

      <section className="card">
        <h2>Practice calendar</h2>
        <PracticeCalendar columns={calendar} />
      </section>

      <div className="filters" role="group" aria-label="Filter trends and takes">
        <div className="chips">
          {RANGES.map((r) => (
            <button
              key={r.id}
              className={`chip ${range === r.id ? "on" : ""}`}
              aria-pressed={range === r.id}
              onClick={() => {
                setRange(r.id);
                setShown(PAGE);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <select
          className="select"
          value={mode}
          aria-label="Prompt type"
          onChange={(e) => {
            setMode(e.target.value as Mode | "all");
            setShown(PAGE);
          }}
        >
          <option value="all">All prompt types</option>
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <option key={m} value={m}>
              {MODES[m].label}
            </option>
          ))}
        </select>
      </div>

      <section className="card">
        <h2>Trends</h2>
        <p className="muted small">
          {filtered.length} take{filtered.length === 1 ? "" : "s"} in this range. Hover or use the arrow keys
          for details; click a point to open that take.
        </p>
        <div className="charts">
          <TrendChart
            title="Pace"
            subtitle="Words per minute · aim for 130–160"
            points={trendPoints(filtered, (s) => s.wpm)}
            format={(v) => String(Math.round(v))}
            band={PACE_TARGET}
            onSelect={(at) => setOpen(history.find((s) => s.at === at) ?? null)}
          />
          <TrendChart
            title="Fillers"
            subtitle="Per minute · lower is better"
            points={trendPoints(filtered, (s) => s.fillersPerMin)}
            format={(v) => v.toFixed(1)}
            onSelect={(at) => setOpen(history.find((s) => s.at === at) ?? null)}
          />
          <TrendChart
            title="First word"
            subtitle="Seconds before you started · lower is better"
            points={trendPoints(filtered, (s) => s.startDelay)}
            format={(v) => `${v.toFixed(1)}s`}
            onSelect={(at) => setOpen(history.find((s) => s.at === at) ?? null)}
          />
          <TrendChart
            title="Coach score"
            subtitle="Average of the AI coach's four scores · out of 10"
            points={trendPoints(filtered, (s) => s.score)}
            format={(v) => v.toFixed(1)}
            domain={[0, 10]}
            onSelect={(at) => setOpen(history.find((s) => s.at === at) ?? null)}
          />
          <TrendChart
            title="Eye contact"
            subtitle="Share of the time looking at the camera · higher is better"
            points={trendPoints(filtered, (s) => (s.eyeContactShare != null ? s.eyeContactShare * 100 : null))}
            format={(v) => `${Math.round(v)}%`}
            domain={[0, 100]}
            onSelect={(at) => setOpen(history.find((s) => s.at === at) ?? null)}
          />
        </div>
      </section>

      <section className="card">
        <div className="section-head spread">
          <h2>All takes</h2>
          <span className="small muted">
            {recordings.length} recording{recordings.length === 1 ? "" : "s"} saved ·{" "}
            {recordingMb.toFixed(recordingMb < 10 ? 1 : 0)} MB ·{" "}
            {keepRecordings === 0 ? "saving is off" : `keeping the last ${keepRecordings}`}
          </span>
        </div>
        {filtered.length === 0 ? (
          <p className="muted">No takes match these filters.</p>
        ) : (
          <div className="table-wrap">
            <table className="takes">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Prompt</th>
                  <th scope="col" className="num">
                    Pace
                  </th>
                  <th scope="col" className="num" title="Fillers per minute">
                    Fillers
                  </th>
                  <th scope="col" className="num hide-narrow">
                    First word
                  </th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col" className="hide-narrow">
                    <span className="sr-only">Recording</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((s) => (
                  <tr key={s.at}>
                    <td className="nowrap muted">{shortDate(Date.parse(s.at))}</td>
                    <td className="prompt-cell">
                      <button className="row-link" onClick={() => setOpen(s)}>
                        {s.promptText}
                      </button>
                      <span className="tag subtle">{MODES[s.mode].label}</span>
                    </td>
                    <td className="num">{s.wpm ?? "—"}</td>
                    <td className="num">{s.fillersPerMin != null ? s.fillersPerMin.toFixed(1) : "—"}</td>
                    <td className="num hide-narrow">{s.startDelay != null ? `${s.startDelay}s` : "—"}</td>
                    <td className="num">{s.score != null ? s.score.toFixed(1) : "—"}</td>
                    <td className="hide-narrow" title={recordingSet.has(s.at) ? "Recording saved" : undefined}>
                      {recordingSet.has(s.at) ? <span aria-label="Recording saved">▶</span> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > shown && (
          <button className="ghost show-more" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({filtered.length - shown} left)
          </button>
        )}
      </section>

      {open && (
        <TakeDetail
          key={open.at}
          take={open}
          onClose={() => setOpen(null)}
          onPractise={onPractise}
          onDelete={removeTake}
          onRecordingDeleted={refreshRecordings}
        />
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { PracticeCalendar, shortDate } from "@/components/charts";
import TakeDetail from "@/components/TakeDetail";
import { WeeklyTiles } from "@/components/WeeklySummary";
import { currentStreak, deleteSession, type Session } from "@/lib/history";
import { bestStreak, practiceCalendar, weeklyReview } from "@/lib/progress";
import { MODES, type Prompt } from "@/lib/prompts";
import { formatSeconds } from "@/lib/settings";
import { deleteTake } from "@/lib/takeStore";

const HISTORY_ROWS = 12;
/** Fits the sidebar width: 14 weeks × 16 px + day labels. */
const CALENDAR_WEEKS = 14;

interface Props {
  history: Session[];
  onHistory: (h: Session[]) => void;
  onPractise: (p: Prompt) => void;
  onOpenProgress: () => void;
}

/** Left column: last 7 days at a glance, practice consistency, then recent takes. */
export default function Sidebar({ history, onHistory, onPractise, onOpenProgress }: Props) {
  const [open, setOpen] = useState<Session | null>(null);
  const review = useMemo(() => weeklyReview(history), [history]);
  const calendar = useMemo(() => practiceCalendar(history, CALENDAR_WEEKS), [history]);
  const streak = currentStreak(history);
  const best = useMemo(() => bestStreak(history), [history]);

  async function removeTake(at: string) {
    await deleteTake(at).catch(() => {});
    onHistory(deleteSession(at));
    setOpen(null);
  }

  return (
    <aside className="sidebar" aria-label="Your progress">
      <section className="card side-card">
        <div className="section-head spread">
          <h2>Last 7 days</h2>
          <span className="small muted">vs the week before</span>
        </div>
        {history.length === 0 ? (
          <p className="muted small">Your stats appear here after your first take.</p>
        ) : (
          <WeeklyTiles review={review} compact />
        )}
      </section>

      <section className="card side-card">
        <div className="section-head spread">
          <h2>Consistency</h2>
          <span className="small muted">
            🔥 {streak} day{streak === 1 ? "" : "s"} · best {best}
          </span>
        </div>
        <PracticeCalendar columns={calendar} />
        <p className="small muted side-note">Active on {review.activeDays} of the last 7 days.</p>
      </section>

      <section className="card side-card">
        <div className="section-head spread">
          <h2>History</h2>
          {history.length > 0 && (
            <button className="link" onClick={onOpenProgress}>
              All takes & trends →
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="muted small">No takes yet.</p>
        ) : (
          <ul className="side-history">
            {history.slice(0, HISTORY_ROWS).map((s) => (
              <li key={s.at}>
                <button className="side-take" onClick={() => setOpen(s)}>
                  <span className="side-take-text">{s.promptText}</span>
                  <span className="side-take-meta small muted">
                    {shortDate(Date.parse(s.at))} · {MODES[s.mode].label} · {formatSeconds(s.seconds)}
                    {s.wpm != null && ` · ${s.wpm} wpm`}
                    {s.eyeContactShare != null && ` · ${Math.round(s.eyeContactShare * 100)}% eye contact`}
                    {s.assessmentScore != null && ` · assessed ${s.assessmentScore}/10`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && (
        <TakeDetail
          key={open.at}
          take={open}
          onClose={() => setOpen(null)}
          onPractise={(p) => {
            setOpen(null);
            onPractise(p);
          }}
          onDelete={removeTake}
          onRecordingDeleted={() => {}}
        />
      )}
    </aside>
  );
}

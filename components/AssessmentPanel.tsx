"use client";

import type { Async } from "@/components/Coach";
import {
  CATEGORIES,
  METHOD_LABEL,
  METRICS,
  overallScores,
  round1,
  toMarkdown,
  type Assessment,
  type Category,
  type Method,
} from "@/lib/assessment/metrics";

const fmt = (n: number | null) => (n === null ? "N/A" : String(round1(n)));

function download(a: Assessment) {
  const blob = new Blob([toMarkdown(a)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `speak-up-assessment-${a.createdAt.slice(0, 16).replace(/[T:]/g, "-")}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ScoreBar({ score }: { score: number | null }) {
  return (
    <div className="metric-score">
      <span className={score === null ? "muted" : ""}>{score === null ? "N/A" : score}</span>
      <div className="score-track" aria-hidden>
        {score !== null && <div className="score-fill" style={{ width: `${score * 10}%` }} />}
      </div>
    </div>
  );
}

function Report({ a }: { a: Assessment }) {
  const o = overallScores(a.metrics);
  const byId = new Map(a.metrics.map((r) => [r.id, r]));
  const counts = METRICS.reduce(
    (acc, m) => ({ ...acc, [m.method]: (acc[m.method] ?? 0) + 1 }),
    {} as Record<Method, number>,
  );
  const scored = a.metrics.filter((r) => r.score !== null).length;

  return (
    <>
      {a.summary && <p className="coach-summary">{a.summary}</p>}

      <div className="tiles overall-tiles">
        {(Object.keys(CATEGORIES) as Category[]).map((c) => (
          <div key={c} className="tile">
            <div className="tile-label">{CATEGORIES[c]}</div>
            <div className="tile-value">{fmt(o.categories[c])}</div>
          </div>
        ))}
        <div className="tile overall-tile">
          <div className="tile-label">Overall speaking</div>
          <div className="tile-value">{fmt(o.overall)}</div>
        </div>
      </div>
      <p className="small muted">
        {scored} of {METRICS.length} metrics scored. {counts.measured} measured by the app from audio, timings and
        video; {counts.transcript} judged from the transcript; {counts.judgement} contextual judgements by {a.judge}.
        Group scores are averages that ignore N/A.
      </p>

      <div className="two-col">
        {a.weaknesses.length > 0 && (
          <div>
            <h3>Top weaknesses</h3>
            <ol className="ranked">
              {a.weaknesses.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ol>
          </div>
        )}
        {a.strengths.length > 0 && (
          <div>
            <h3>Top strengths</h3>
            <ol className="ranked">
              {a.strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {a.exercises.length > 0 && (
        <div className="exercises">
          <h3>Exercises</h3>
          {a.exercises.map((e, i) => (
            <div key={e.title} className="exercise">
              <strong>
                {i + 1}. {e.title}
              </strong>
              <p>{e.steps}</p>
            </div>
          ))}
        </div>
      )}

      {(Object.keys(CATEGORIES) as Category[]).map((c, i) => {
        const defs = METRICS.filter((m) => m.category === c);
        return (
          <details key={c} className="metric-group" open={i === 0}>
            <summary>
              <span className="metric-group-name">{CATEGORIES[c]}</span>
              <span className="metric-group-score">{fmt(o.categories[c])}</span>
              <span className="small muted">{defs.length} metrics</span>
            </summary>
            <ul className="metric-list">
              {defs.map((d) => {
                const r = byId.get(d.id);
                const score = r?.score ?? null;
                return (
                  <li key={d.id} className={score === null ? "na" : ""}>
                    <div className="metric-head">
                      <span className="metric-name">{d.name}</span>
                      <span className={`method method-${d.method}`} title={d.what}>
                        {METHOD_LABEL[d.method]}
                      </span>
                      <ScoreBar score={score} />
                    </div>
                    <p className="metric-evidence">{r?.evidence || "Not assessed."}</p>
                    {r?.improvement && <p className="metric-improve">→ {r.improvement}</p>}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}

      <div className="onepager-foot">
        <span className="small muted">Scores are evidence-based estimates, not a certified exam result.</span>
        <button className="ghost" onClick={() => download(a)}>
          Download report (.md)
        </button>
      </div>
    </>
  );
}

export default function AssessmentPanel({ state, onRetry }: { state: Async<Assessment>; onRetry: () => void }) {
  return (
    <section className="coach assessment">
      <div className="section-head">
        <h2>Full assessment</h2>
        <span className="tag subtle">50 metrics</span>
      </div>
      {state.status === "working" && (
        <p className="muted working">Measuring the audio and judging 50 metrics… this can take a minute.</p>
      )}
      {state.status === "error" && (
        <div className="alert">
          {state.message}
          <button className="link" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      {state.status === "done" && <Report a={state.data} />}
    </section>
  );
}

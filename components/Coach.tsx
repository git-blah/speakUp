"use client";

import { SCORE_KEYS, type CoachFeedback, type OnePager, type ScoreKey } from "@/lib/coach/types";

export type Async<T> =
  | { status: "working" }
  | { status: "done"; data: T }
  | { status: "error"; message: string };

const SCORE_LABELS: Record<ScoreKey, string> = {
  clarity: "Clarity",
  structure: "Structure",
  relevance: "On topic",
  language: "Language",
};

function Working({ text }: { text: string }) {
  return <p className="muted working">{text}</p>;
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="alert">
      {message}
      <button className="link" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function CoachPanel({
  state,
  source,
  onRetry,
  onFollowUp,
}: {
  state: Async<CoachFeedback>;
  source: string;
  onRetry: () => void;
  onFollowUp: (question: string) => void;
}) {
  return (
    <section className="coach">
      <div className="section-head">
        <h2>AI coach</h2>
        <span className="tag subtle">{source}</span>
      </div>
      {state.status === "working" && <Working text="Your coach is reviewing the take…" />}
      {state.status === "error" && <Failed message={state.message} onRetry={onRetry} />}
      {state.status === "done" && <FeedbackBody f={state.data} onFollowUp={onFollowUp} />}
    </section>
  );
}

function FeedbackBody({ f, onFollowUp }: { f: CoachFeedback; onFollowUp: (q: string) => void }) {
  return (
    <>
      {f.summary && <p className="coach-summary">{f.summary}</p>}

      <div className="scores">
        {SCORE_KEYS.map((k) => (
          <div key={k} className="score">
            <div className="score-head">
              <span>{SCORE_LABELS[k]}</span>
              <span className="score-num">{f.scores[k]}/10</span>
            </div>
            <div className="score-track">
              <div className="score-fill" style={{ width: `${f.scores[k] * 10}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="two-col">
        {f.strengths.length > 0 && (
          <div>
            <h3>What worked</h3>
            <ul className="plain good-list">
              {f.strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {f.improvements.length > 0 && (
          <div>
            <h3>What to improve</h3>
            <ul className="plain improve-list">
              {f.improvements.map((i) => (
                <li key={i.issue}>
                  <strong>{i.issue}.</strong> {i.suggestion}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {f.languageFixes.length > 0 && (
        <div className="fixes">
          <h3>Language fixes</h3>
          {f.languageFixes.map((x) => (
            <div key={x.said} className="fix">
              <div>
                <span className="said">{x.said}</span> → <span className="better">{x.better}</span>
              </div>
              <div className="small muted">{x.why}</div>
            </div>
          ))}
        </div>
      )}

      {f.betterVersion && (
        <div className="better-version">
          <h3>A stronger answer</h3>
          <blockquote>{f.betterVersion}</blockquote>
          <p className="small muted">Read it aloud once, then do another take in your own words.</p>
        </div>
      )}

      {f.followUpQuestion && (
        <div className="follow-up">
          <div>
            <div className="small muted">Someone in the audience asks…</div>
            <p className="follow-up-q">{f.followUpQuestion}</p>
          </div>
          <button className="secondary" onClick={() => onFollowUp(f.followUpQuestion)}>
            Answer it now
          </button>
        </div>
      )}
    </>
  );
}

export function OnePagerPanel({
  state,
  source,
  onRetry,
}: {
  state: Async<OnePager>;
  source: string;
  onRetry: () => void;
}) {
  return (
    <section className="onepager">
      <div className="section-head">
        <h2>Learn: one-pager</h2>
        <span className="tag subtle no-print">{source}</span>
      </div>
      {state.status === "working" && <Working text="Writing your one-pager…" />}
      {state.status === "error" && <Failed message={state.message} onRetry={onRetry} />}
      {state.status === "done" && <OnePagerBody p={state.data} />}
    </section>
  );
}

function OnePagerBody({ p }: { p: OnePager }) {
  return (
    <article className="onepager-body">
      {p.title && <h3 className="onepager-title">{p.title}</h3>}
      {p.summary && <p>{p.summary}</p>}

      <div className="two-col">
        {p.keyPoints.length > 0 && (
          <div>
            <h4>Key points</h4>
            <ul>
              {p.keyPoints.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </div>
        )}
        {p.perspectives.length > 0 && (
          <div>
            <h4>Perspectives</h4>
            <ul>
              {p.perspectives.map((x) => (
                <li key={x.side}>
                  <strong>{x.side}:</strong> {x.argument}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {p.vocabulary.length > 0 && (
        <>
          <h4>Useful vocabulary</h4>
          <dl className="vocab">
            {p.vocabulary.map((v) => (
              <div key={v.term}>
                <dt>{v.term}</dt>
                <dd>
                  {v.meaning}
                  <span className="vocab-example">“{v.example}”</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <div className="two-col">
        {p.structure.length > 0 && (
          <div>
            <h4>How to structure an answer</h4>
            <ol>
              {p.structure.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        )}
        {p.openers.length > 0 && (
          <div>
            <h4>Strong openers</h4>
            <ul>
              {p.openers.map((o) => (
                <li key={o}>“{o}”</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {p.questions.length > 0 && (
        <>
          <h4>Think further</h4>
          <ul>
            {p.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}

      <div className="onepager-foot no-print">
        <span className="small muted">AI-generated. Double-check important facts.</span>
        <button className="ghost" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      </div>
    </article>
  );
}

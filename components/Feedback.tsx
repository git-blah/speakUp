"use client";

import type { Pace, SpeechStats } from "@/lib/analysis";
import type { Transcript } from "@/lib/transcript";

export type Analysis =
  | { status: "working" }
  | { status: "done"; transcript: Transcript; stats: SpeechStats; tips: string[] }
  | { status: "unavailable"; message: string };

type Tone = "good" | "ok" | "warn" | "none";

const PACE_LABEL: Record<Pace, string> = {
  slow: "Slow",
  steady: "A little slow",
  good: "Good pace",
  quick: "A little fast",
  fast: "Fast",
};

const PACE_TONE: Record<Pace, Tone> = { slow: "warn", steady: "ok", good: "good", quick: "ok", fast: "warn" };

function band(value: number | null, good: number, ok: number): Tone {
  if (value === null) return "none";
  return value <= good ? "good" : value <= ok ? "ok" : "warn";
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: Tone }) {
  return (
    <div className={`tile tone-${tone}`}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

export default function Feedback({ analysis, onSeek }: { analysis: Analysis; onSeek?: (seconds: number) => void }) {
  if (analysis.status === "working") {
    return (
      <div className="feedback">
        <p className="muted working">Transcribing and analysing your take…</p>
      </div>
    );
  }
  if (analysis.status === "unavailable") {
    return (
      <div className="feedback">
        <p className="muted small">{analysis.message}</p>
      </div>
    );
  }

  const { stats, transcript, tips } = analysis;
  const fillerTotal = stats.hesitations + stats.fillers;
  const seekable = transcript.timed && !!onSeek;

  return (
    <div className="feedback">
      <div className="tiles">
        <Tile
          label="Pace"
          value={stats.wpm === null ? "—" : `${stats.wpm} wpm`}
          sub={stats.pace ? `${PACE_LABEL[stats.pace]} · aim 130–160` : "Too short to measure"}
          tone={stats.pace ? PACE_TONE[stats.pace] : "none"}
        />
        <Tile
          label="Fillers"
          value={String(fillerTotal)}
          sub={stats.fillersPerMin === null ? "um, uh, like…" : `${stats.fillersPerMin} per minute`}
          tone={band(stats.fillersPerMin, 2, 4)}
        />
        <Tile
          label="Long pauses"
          value={stats.longPauses === null ? "—" : String(stats.longPauses)}
          sub={stats.longPauses === null ? "Needs word timings" : "2 seconds or longer"}
          tone={band(stats.longPauses, 1, 2)}
        />
        <Tile
          label="First word"
          value={stats.startDelay === null ? "—" : `${stats.startDelay}s`}
          sub="Time before you started"
          tone={band(stats.startDelay, 2, 4)}
        />
        <Tile
          label="Words"
          value={String(stats.words)}
          sub={stats.variety === null ? "Not counting fillers" : `${Math.round(stats.variety * 100)}% different words`}
          tone="none"
        />
      </div>

      <div className="tips">
        <h2>For your next take</h2>
        <ul>
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>

      <div className="transcript-block">
        <div className="transcript-head">
          <h2>What you said</h2>
          <div className="legend small">
            <span className="tok hesitation">um</span> hesitation
            <span className="tok filler">like</span> possible filler
            {transcript.timed && <span className="pause">pause</span>}
          </div>
        </div>
        {stats.tokens.length === 0 ? (
          <p className="muted">No speech was picked up.</p>
        ) : (
          <p className="transcript">
            {stats.tokens.map((t, i) => (
              <span key={i}>
                {t.pauseBefore !== undefined && <span className="pause">{t.pauseBefore.toFixed(1)}s pause</span>}
                {seekable && t.start !== undefined ? (
                  <button
                    className={`tok tok-btn ${t.kind}`}
                    title={`Jump to ${t.start.toFixed(1)}s`}
                    onClick={() => onSeek?.(t.start ?? 0)}
                  >
                    {t.text}
                  </button>
                ) : (
                  <span className={`tok ${t.kind}`}>{t.text}</span>
                )}{" "}
              </span>
            ))}
          </p>
        )}
        {stats.fillerCounts.length > 0 && (
          <p className="small muted">
            {stats.fillerCounts.map((f) => `"${f.text}" ×${f.count}`).join(" · ")}
          </p>
        )}
        <p className="small muted">
          {transcript.source === "deepgram"
            ? "Transcribed by Deepgram. Click any word to jump to that moment."
            : "Transcribed live by your browser, which can miss filler words. For exact pauses and fillers, set up Deepgram (see README)."}
        </p>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useWidth } from "@/components/charts";
import { FRAMING_LABEL, faceTips, type FaceStats, type Gaze } from "@/lib/face/faceAnalysis";
import {
  HIGH_MOTION,
  LIGHTING_LABEL,
  MOVEMENT_LABEL,
  videoTips,
  type Lighting,
  type Movement,
  type VideoStats,
} from "@/lib/videoAnalysis";

const MOVEMENT_TONE: Record<Movement, string> = { natural: "good", still: "ok", busy: "warn", shaky: "warn" };
const LIGHTING_TONE: Record<Lighting, string> = { good: "good", dark: "warn", bright: "warn", backlit: "warn", covered: "warn" };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pct = (share: number) => `${Math.round(share * 100)}%`;

function movementSub(v: VideoStats): string {
  if (v.movement === "shaky") return `Camera moved ${pct(v.cameraMoveShare)} of the time`;
  if (v.movement === "still") return `Almost no movement ${pct(v.stillShare)} of the time`;
  if (v.movement === "busy") return `${pct(v.highShare)} of the time`;
  return v.highShare > 0 ? `A lot of movement ${pct(v.highShare)} of the time` : "Steady, with some movement";
}

const H = 72;
const AXIS = 16;

/** Per-second movement columns with the "a lot of movement" threshold; click to seek. */
function MovementTimeline({ timeline, onSeek }: { timeline: number[]; onSeek?: (s: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotH = H - AXIS;
  // Scale so the threshold sits around half height; big spikes are clipped at the top.
  const top = Math.max(HIGH_MOTION * 2, Math.min(0.5, Math.max(...timeline)));
  const slot = width / timeline.length;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const y = (v: number) => plotH - (Math.min(v, top) / top) * plotH;

  return (
    <div ref={ref} className="timeline chart-wrap">
      <svg width={width} height={H} role="img" aria-label="Movement over the take, one column per second">
        <line className="grid" x1={0} x2={width} y1={plotH} y2={plotH} />
        <line className="threshold" x1={0} x2={width} y1={y(HIGH_MOTION)} y2={y(HIGH_MOTION)} />
        <text className="tick" x={width} y={y(HIGH_MOTION) - 4} textAnchor="end">
          a lot
        </text>
        {timeline.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 0, plotH - y(v));
          return (
            <rect
              key={i}
              className={`motion-bar ${hover === i ? "on" : ""}`}
              x={i * slot + (slot - barW) / 2}
              y={plotH - h}
              width={barW}
              height={h}
              rx={Math.min(2, barW / 2)}
            />
          );
        })}
        <text className="tick" x={0} y={H - 3}>
          0:00
        </text>
        <text className="tick" x={width} y={H - 3} textAnchor="end">
          {clock(timeline.length)}
        </text>
        {/* Full-height hit columns, wider than the bars. */}
        {timeline.map((_, i) => (
          <rect
            key={`hit-${i}`}
            className="hit"
            x={i * slot}
            y={0}
            width={slot}
            height={plotH}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onClick={() => onSeek?.(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: Math.min(width - 60, Math.max(60, (hover + 0.5) * slot)), top: 0 }}>
          <strong>{timeline[hover] > HIGH_MOTION ? "A lot of movement" : timeline[hover] < 0.01 ? "Still" : "Some movement"}</strong>
          <span className="muted">
            {clock(hover)}
            {onSeek ? " · click to watch" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

const GAZE_LABEL: Record<Gaze | "none", string> = {
  camera: "At the camera",
  down: "Looking down",
  away: "Looking away",
  none: "No face",
};

/** One cell per second, coloured by where the speaker mostly looked; click to seek. */
function GazeStrip({ face, onSeek }: { face: FaceStats; onSeek?: (s: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = face.timeline.length;
  const slot = width / n;
  const shares: Record<Gaze | "none", number> = {
    camera: face.eyeContactShare * face.presentShare,
    down: face.downShare * face.presentShare,
    away: face.awayShare * face.presentShare,
    none: 1 - face.presentShare,
  };
  return (
    <>
      <div ref={ref} className="gaze-strip chart-wrap">
        <svg width={width} height={18} role="img" aria-label="Where you looked, second by second">
          {face.timeline.map((g, i) => (
            <rect
              key={i}
              className={`gaze gaze-${g} ${hover === i ? "on" : ""}`}
              x={i * slot + 1}
              y={0}
              width={Math.max(1, slot - 2)}
              height={18}
              rx={Math.min(3, slot / 3)}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onSeek?.(i)}
            />
          ))}
        </svg>
        {hover !== null && (
          <div className="chart-tooltip" style={{ left: Math.min(width - 60, Math.max(60, (hover + 0.5) * slot)), top: -4 }}>
            <strong>{GAZE_LABEL[face.timeline[hover]]}</strong>
            <span className="muted">
              {clock(hover)}
              {onSeek ? " · click to watch" : ""}
            </span>
          </div>
        )}
      </div>
      <div className="gaze-legend small muted">
        {(Object.keys(GAZE_LABEL) as (Gaze | "none")[]).map((g) =>
          shares[g] > 0 || g === "camera" ? (
            <span key={g} className="key-item">
              <span className={`gaze-key gaze-${g}`} aria-hidden /> {GAZE_LABEL[g]} {pct(shares[g])}
            </span>
          ) : null,
        )}
      </div>
    </>
  );
}

export default function VideoFeedback({
  stats,
  face,
  onSeek,
}: {
  stats: VideoStats;
  face?: FaceStats | null;
  onSeek?: (s: number) => void;
}) {
  const tips = [...(face ? faceTips(face) : []), ...videoTips(stats)];
  return (
    <section className="on-camera">
      <h2>On camera</h2>
      <div className="tiles camera-tiles">
        {face && (
          <>
            <div className={`tile tone-${face.framing === "absent" ? "warn" : face.eyeContactShare >= 0.7 ? "good" : face.eyeContactShare >= 0.5 ? "ok" : "warn"}`}>
              <div className="tile-label">Eye contact</div>
              <div className="tile-value">{face.framing === "absent" ? "—" : pct(face.eyeContactShare)}</div>
              <div className="tile-sub">
                {face.framing === "absent"
                  ? "Face not in view"
                  : ["of the time", face.downShare > 0 && `down ${pct(face.downShare)}`, face.awayShare > 0 && `away ${pct(face.awayShare)}`]
                      .filter(Boolean)
                      .join(" · ")}
              </div>
            </div>
            <div className={`tile tone-${face.framing === "good" ? "good" : "warn"}`}>
              <div className="tile-label">Framing</div>
              <div className="tile-value">{FRAMING_LABEL[face.framing]}</div>
              <div className="tile-sub">Face in view {pct(face.presentShare)} of the time</div>
            </div>
          </>
        )}
        <div className={`tile tone-${MOVEMENT_TONE[stats.movement]}`}>
          <div className="tile-label">Movement</div>
          <div className="tile-value">{MOVEMENT_LABEL[stats.movement]}</div>
          <div className="tile-sub">{movementSub(stats)}</div>
        </div>
        <div className={`tile tone-${LIGHTING_TONE[stats.lighting]}`}>
          <div className="tile-label">Lighting</div>
          <div className="tile-value">{LIGHTING_LABEL[stats.lighting]}</div>
          <div className="tile-sub">Average brightness {Math.round((stats.brightness / 255) * 100)}%</div>
        </div>
      </div>
      {face && face.timeline.length > 1 && (
        <>
          <div className="small muted timeline-label">Where you looked, second by second</div>
          <GazeStrip face={face} onSeek={onSeek} />
        </>
      )}
      {stats.timeline.length > 1 && (
        <>
          <div className="small muted timeline-label">Movement, second by second</div>
          <MovementTimeline timeline={stats.timeline} onSeek={onSeek} />
        </>
      )}
      {tips.length > 0 && (
        <ul className="camera-tips">
          {tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <p className="small muted">
        Measured in your browser from snapshots of the preview{face ? ", with MediaPipe face tracking" : ""}. Hand
        gestures count as movement and glasses or low light can confuse eye tracking, so use this as a rough guide.
      </p>
    </section>
  );
}

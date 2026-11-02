"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { rollingAverage, type CalendarDay, type TrendPoint } from "@/lib/progress";

/** Width of an element, tracked with ResizeObserver so charts fit their card. */
function useWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function niceTicks(lo: number, hi: number, count: number): number[] {
  const step = niceStep((hi - lo || 1) / count);
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export const shortDate = (t: number | Date) =>
  new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const AVG_WINDOW = 5;
const H = 170;
const M = { top: 12, right: 48, bottom: 24, left: 38 };

interface TrendChartProps {
  title: string;
  subtitle: string;
  points: TrendPoint[];
  format: (v: number) => string;
  /** Fixed y range (e.g. 0–10 for scores); otherwise fitted to the data and band. */
  domain?: [number, number];
  /** Target range, drawn as a soft band. */
  band?: [number, number];
  onSelect?: (at: string) => void;
}

export function TrendChart({ title, subtitle, points, format, domain, band, onSelect }: TrendChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const head = (
    <div className="chart-head">
      <h3>{title}</h3>
      <span className="small muted">{subtitle}</span>
    </div>
  );
  if (points.length < 2) {
    return (
      <div ref={ref} className="chart-card">
        {head}
        <p className="muted small chart-empty">Do at least two transcribed takes to see a trend here.</p>
      </div>
    );
  }

  const avg = rollingAverage(points.map((p) => p.v), AVG_WINDOW);
  const all = [...points.map((p) => p.v), ...(band ?? [])];
  let [lo, hi] = domain ?? [Math.min(...all), Math.max(...all)];
  if (!domain) {
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
    lo = Math.max(0, lo - pad);
    hi += pad;
  }
  const ticks = niceTicks(lo, hi, 3);
  lo = Math.min(lo, ticks[0]);
  hi = Math.max(hi, ticks[ticks.length - 1]);

  const plotW = width - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => M.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;

  const avgPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(avg[i]).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  const xTicks = t1 === t0 ? [t0] : [t0, t0 + (t1 - t0) / 2, t1];

  function nearest(e: { clientX: number; currentTarget: Element }) {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left + M.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].t) - px) < Math.abs(x(points[best].t) - px)) best = i;
    }
    return best;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setHover((h) => Math.min(last, Math.max(0, (h ?? (step > 0 ? -1 : last + 1)) + step)));
    } else if (e.key === "Enter" && hover !== null) {
      // Without this, the Enter keypress lands on the dialog's focused close button and shuts it.
      e.preventDefault();
      onSelect?.(points[hover].at);
    } else if (e.key === "Escape") {
      setHover(null);
    }
  }

  const hp = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="chart-card">
      {head}
      <div
        className="chart-wrap"
        tabIndex={0}
        role="group"
        aria-label={`${title} over ${points.length} takes. Latest ${AVG_WINDOW}-take average ${format(avg[last])}. Use arrow keys to step through takes, Enter to open one.`}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <svg width={width} height={H} aria-hidden>
          {band && (
            <>
              <rect
                className="band"
                x={M.left}
                width={plotW}
                y={y(band[1])}
                height={Math.max(0, y(band[0]) - y(band[1]))}
              />
            </>
          )}
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
              <text className="tick" x={M.left - 6} y={y(v) + 4} textAnchor="end">
                {format(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={t}
              className="tick"
              x={x(t)}
              y={H - 6}
              textAnchor={xTicks.length === 1 ? "middle" : i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            >
              {shortDate(t)}
            </text>
          ))}

          {points.map((p) => (
            <circle key={p.at} className="dot" cx={x(p.t)} cy={y(p.v)} r={4} />
          ))}
          <path className="avg-line" d={avgPath} />
          <circle className="end-dot" cx={x(points[last].t)} cy={y(avg[last])} r={4} />
          <text className="end-label" x={x(points[last].t) + 8} y={y(avg[last]) + 4}>
            {format(avg[last])}
          </text>

          {hp && (
            <>
              <line className="crosshair" x1={x(hp.t)} x2={x(hp.t)} y1={M.top} y2={M.top + plotH} />
              <circle className="dot-hover" cx={x(hp.t)} cy={y(hp.v)} r={5} />
            </>
          )}
          <rect
            className="hit"
            x={M.left}
            y={0}
            width={plotW}
            height={H - M.bottom}
            onPointerMove={(e) => setHover(nearest(e))}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => onSelect?.(points[nearest(e)].at)}
          />
        </svg>
        {hp && hover !== null && (
          <div
            className="chart-tooltip"
            style={{ left: Math.min(width - 70, Math.max(70, x(hp.t))), top: y(hp.v) - 10 }}
          >
            <strong>{format(hp.v)}</strong>
            <span>
              {AVG_WINDOW}-take avg {format(avg[hover])}
            </span>
            <span className="muted">{shortDate(hp.t)} · click to open</span>
          </div>
        )}
      </div>
      <div className="chart-key small muted">
        <span className="key-item">
          <span className="key-dot" aria-hidden /> each take
        </span>
        <span className="key-item">
          <span className="key-line" aria-hidden /> {AVG_WINDOW}-take average
        </span>
        {band && (
          <span className="key-item">
            <span className="key-band" aria-hidden /> target range
          </span>
        )}
      </div>
    </div>
  );
}

const CELL = 14;
const GAP = 2;
const DAY_LABEL_W = 28;
const MONTH_LABEL_H = 16;

function level(count: number): number {
  return Math.min(4, count);
}

export function PracticeCalendar({ columns }: { columns: CalendarDay[][] }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const step = CELL + GAP;
  const width = DAY_LABEL_W + columns.length * step;
  const height = MONTH_LABEL_H + 7 * step;
  const total = columns.flat().reduce((n, d) => n + d.count, 0);
  const days = columns.flat().filter((d) => d.count > 0).length;

  return (
    <div className="calendar">
      <div className="calendar-wrap">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${total} takes on ${days} days in the last ${columns.length} weeks`}
        >
          {columns.map((col, w) => {
            const first = col[0].date;
            const showMonth = w === 0 || first.getDate() <= 7;
            return (
              <g key={w}>
                {showMonth && (
                  <text className="tick" x={DAY_LABEL_W + w * step} y={11}>
                    {first.toLocaleDateString(undefined, { month: "short" })}
                  </text>
                )}
                {col.map((d, i) =>
                  d.future ? null : (
                    <rect
                      key={i}
                      className={`heat heat-${level(d.count)}`}
                      x={DAY_LABEL_W + w * step}
                      y={MONTH_LABEL_H + i * step}
                      width={CELL}
                      height={CELL}
                      rx={3}
                      onPointerEnter={() =>
                        setTip({
                          x: DAY_LABEL_W + w * step + CELL / 2,
                          y: MONTH_LABEL_H + i * step,
                          text: `${d.count === 0 ? "No" : d.count} take${d.count === 1 ? "" : "s"} · ${d.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`,
                        })
                      }
                      onPointerLeave={() => setTip(null)}
                    />
                  ),
                )}
              </g>
            );
          })}
          {["Mon", "Wed", "Fri"].map((label, i) => (
            <text key={label} className="tick" x={0} y={MONTH_LABEL_H + i * 2 * step + CELL - 3}>
              {label}
            </text>
          ))}
        </svg>
        {tip && (
          <div className="chart-tooltip small" style={{ left: tip.x, top: tip.y - 6 }}>
            {tip.text}
          </div>
        )}
      </div>
      <div className="heat-legend small muted" aria-hidden>
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <svg key={l} width={CELL} height={CELL}>
            <rect className={`heat heat-${l}`} width={CELL} height={CELL} rx={3} />
          </svg>
        ))}
        More
      </div>
    </div>
  );
}

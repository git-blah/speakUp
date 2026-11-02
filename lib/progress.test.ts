import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "./history";
import {
  bestStreak,
  focusFor,
  practiceCalendar,
  rollingAverage,
  summarize,
  trendPoints,
  weeklyReview,
} from "./progress";
import {
  deleteTake,
  getDetail,
  getRecording,
  listRecordings,
  pruneRecordings,
  saveDetail,
  saveRecording,
} from "./takeStore";

const NOW = new Date(2026, 10, 2, 18, 0); // Mon 2 Nov 2026, 18:00 local

function take(daysAgo: number, extra: Partial<Session> = {}, hour = 9): Session {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return { promptId: "p", promptText: "Prompt", mode: "topic", seconds: 60, at: d.toISOString(), ...extra };
}

describe("summarize", () => {
  it("averages only the takes that have each metric", () => {
    const s = summarize([take(0, { wpm: 120, score: 6 }), take(1, { wpm: 140 }), take(2, { seconds: 30 })]);
    expect(s.takes).toBe(3);
    expect(s.minutes).toBe(2.5);
    expect(s.wpm).toBe(130);
    expect(s.score).toBe(6);
    expect(s.fillersPerMin).toBeNull();
  });
});

describe("weeklyReview", () => {
  it("splits the last 7 days from the 7 before and counts active days", () => {
    const history = [
      take(0, { fillersPerMin: 2 }),
      take(0, { fillersPerMin: 4 }, 10),
      take(3, { fillersPerMin: 3 }),
      take(6, { fillersPerMin: 3 }),
      take(8, { fillersPerMin: 6 }),
      take(15, { fillersPerMin: 9 }),
    ];
    const r = weeklyReview(history, NOW);
    expect(r.current.takes).toBe(4);
    expect(r.activeDays).toBe(3);
    expect(r.current.fillersPerMin).toBe(3);
    expect(r.previous.takes).toBe(1);
    expect(r.previous.fillersPerMin).toBe(6);
    expect(r.focus.title).toBe("Practise more often");
  });
});

describe("focusFor", () => {
  const base = { takes: 5, minutes: 5, wpm: 145, fillersPerMin: 1, startDelay: 1, score: 8, eyeContact: 0.8 };
  it.each([
    [{ takes: 0 }, "Get started"],
    [{ fillersPerMin: 5 }, "Cut the fillers"],
    [{ wpm: 100 }, "Pick up the pace"],
    [{ wpm: 190 }, "Slow down"],
    [{ startDelay: 5 }, "Start faster"],
    [{ eyeContact: 0.3 }, "Look at the lens"],
    [{ score: 5 }, "Structure your answers"],
    [{}, "Level up"],
  ])("%o -> %s", (patch, title) => {
    expect(focusFor({ ...base, ...patch }, 5).title).toBe(title);
  });
});

describe("streaks and series", () => {
  it("finds the longest run of consecutive days", () => {
    const history = [take(0), take(1), take(1, {}, 15), take(2), take(5), take(6), take(7), take(8)];
    expect(bestStreak(history)).toBe(4);
    expect(bestStreak([])).toBe(0);
  });

  it("computes a trailing rolling average", () => {
    expect(rollingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });

  it("returns trend points oldest first, skipping missing values", () => {
    const pts = trendPoints([take(0, { wpm: 150 }), take(2, { wpm: null }), take(4, { wpm: 120 })], (s) => s.wpm);
    expect(pts.map((p) => p.v)).toEqual([120, 150]);
  });

  it("builds a Monday-first calendar ending this week", () => {
    const cal = practiceCalendar([take(0), take(0, {}, 11), take(7)], 2, NOW);
    expect(cal).toHaveLength(2);
    expect(cal[0][0].date.getDay()).toBe(1); // Monday
    expect(cal[1][0].count).toBe(2); // today (a Monday)
    expect(cal[0][0].count).toBe(1); // a week ago
    expect(cal[1][1].future).toBe(true);
  });
});

describe("takeStore", () => {
  beforeEach(async () => {
    for (const r of await listRecordings()) await deleteTake(r.at);
  });

  it("merges detail patches", async () => {
    await saveDetail("a", { tips: ["one"] });
    await saveDetail("a", { feedback: { summary: "ok" } as never });
    expect(await getDetail("a")).toMatchObject({ at: "a", tips: ["one"], feedback: { summary: "ok" } });
    expect(await getDetail("missing")).toBeNull();
  });

  it("stores recordings and prunes the oldest", async () => {
    for (const at of ["2026-01-01", "2026-01-03", "2026-01-02"]) {
      await saveRecording(at, new Blob([at], { type: "video/webm" }));
    }
    expect((await listRecordings()).map((r) => r.at)).toEqual(["2026-01-03", "2026-01-02", "2026-01-01"]);
    expect(await pruneRecordings(2)).toBe(1);
    expect(await getRecording("2026-01-01")).toBeNull();
    expect(await (await getRecording("2026-01-03"))!.text()).toBe("2026-01-03");
  });

  it("deletes details and recording together", async () => {
    await saveDetail("b", { tips: [] });
    await saveRecording("b", new Blob(["x"]));
    await deleteTake("b");
    expect(await getDetail("b")).toBeNull();
    expect(await getRecording("b")).toBeNull();
  });
});

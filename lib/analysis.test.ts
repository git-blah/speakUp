import { describe, expect, it } from "vitest";
import { analyze, paceFor, tips } from "./analysis";
import { wordsFromText, type Transcript, type Word } from "./transcript";

function untimed(text: string, firstWordAt?: number): Transcript {
  return { source: "browser", text, words: wordsFromText(text), timed: false, firstWordAt };
}

/** Build a timed transcript: each entry is [word, start, end]. */
function timed(entries: [string, number, number][]): Transcript {
  const words: Word[] = entries.map(([text, start, end]) => ({ text, start, end }));
  return { source: "deepgram", text: entries.map((e) => e[0]).join(" "), words, timed: true };
}

describe("analyze", () => {
  it("counts hesitations and filler phrases separately from content words", () => {
    const s = analyze(untimed("Um so I think, you know, cities are basically uh too crowded"), 10);
    expect(s.hesitations).toBe(2);
    expect(s.fillers).toBe(2); // "you know", "basically"
    expect(s.words).toBe(7); // so I think cities are too crowded
    expect(s.fillerCounts).toEqual(
      expect.arrayContaining([
        { text: "um", count: 1 },
        { text: "uh", count: 1 },
        { text: "you know", count: 1 },
        { text: "basically", count: 1 },
      ]),
    );
  });

  it("does not count 'like' as a filler when it's a verb or comparison", () => {
    const s = analyze(untimed("I like coffee and it looks like rain but it was like really cold"), 10);
    expect(s.fillers).toBe(1); // only "was like"
    expect(s.tokens.filter((t) => t.kind === "filler").map((t) => t.text)).toEqual(["like"]);
  });

  it("does not count 'kind of' meaning 'type of'", () => {
    const s = analyze(untimed("What kind of car is it? It's kind of old."), 10);
    expect(s.fillers).toBe(1);
  });

  it("computes words per minute from take duration minus start delay when untimed", () => {
    const text = Array.from({ length: 70 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}`).join(" ");
    const s = analyze(untimed(text, 4), 34); // 70 words in 30s of speaking
    expect(s.wpm).toBe(140);
    expect(s.pace).toBe("good");
    expect(s.startDelay).toBe(4);
    expect(s.longPauses).toBeNull();
  });

  it("detects long pauses and start delay from word timings", () => {
    const s = analyze(
      timed([
        ["Well", 3.0, 3.3],
        ["this", 3.4, 3.6],
        ["is", 3.7, 3.8],
        ["hard", 3.9, 4.2],
        ["but", 6.8, 7.0], // 2.6s gap
        ["I", 7.1, 7.2],
        ["will", 7.3, 7.5],
        ["try", 7.6, 8.0],
      ]),
      10,
    );
    expect(s.startDelay).toBe(3);
    expect(s.longPauses).toBe(1);
    expect(s.longestPause).toBe(2.6);
    expect(s.tokens[4].pauseBefore).toBeCloseTo(2.6);
    expect(s.tokens[4].start).toBe(6.8);
  });

  it("returns null pace for very short takes", () => {
    const s = analyze(untimed("Hello there"), 3);
    expect(s.wpm).toBeNull();
    expect(s.pace).toBeNull();
    expect(s.fillersPerMin).toBeNull();
  });

  it("finds repeated non-stopwords", () => {
    const s = analyze(untimed("Cities are great. Cities have jobs. Cities have culture. Great food too."), 20);
    expect(s.repeated[0]).toEqual({ word: "cities", count: 3 });
  });
});

describe("paceFor", () => {
  it.each([
    [90, "slow"],
    [120, "steady"],
    [145, "good"],
    [170, "quick"],
    [200, "fast"],
  ] as const)("%i wpm is %s", (wpm, pace) => {
    expect(paceFor(wpm)).toBe(pace);
  });
});

describe("tips", () => {
  it("flags heavy filler use and names the most common filler", () => {
    const text = "um ".repeat(10) + "the main reason is that people need space to live and work well together in cities every day";
    const t = tips(analyze(untimed(text), 60));
    expect(t[0]).toMatch(/fillers a minute.*"um"/);
  });

  it("asks for more speech when almost nothing was transcribed", () => {
    expect(tips(analyze(untimed("hi"), 30))[0]).toMatch(/Very few words/);
  });
});

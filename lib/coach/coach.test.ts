import { afterEach, describe, expect, it, vi } from "vitest";
import { feedbackPrompts } from "./prompts";
import { generateJson, listProviders } from "./providers";
import { parseFeedback } from "./request";
import { FEEDBACK_SCHEMA, InvalidReplyError, normalizeFeedback, normalizeOnePager, parseJsonReply } from "./types";

describe("parseJsonReply", () => {
  it("parses plain JSON", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips think blocks, code fences and prose", () => {
    expect(parseJsonReply('<think>hmm {no}</think>Here you go:\n```json\n{"a":{"b":2}}\n```')).toEqual({ a: { b: 2 } });
  });

  it("throws when there is no JSON", () => {
    expect(() => parseJsonReply("sorry, I can't")).toThrow();
  });
});

describe("normalizeFeedback", () => {
  it("clamps scores, trims lists and drops incomplete items", () => {
    const f = normalizeFeedback({
      summary: " Good start. ",
      scores: { clarity: 12, structure: "7", relevance: 0, language: "n/a" },
      strengths: ["a", "b", "c", "d", 5, ""],
      improvements: [{ issue: "pace", suggestion: "slow down" }, { issue: "no fix" }],
      languageFixes: "none",
      betterVersion: "Better.",
      followUpQuestion: "Why?",
    });
    expect(f.summary).toBe("Good start.");
    expect(f.scores).toEqual({ clarity: 10, structure: 7, relevance: 1, language: 5 });
    expect(f.strengths).toEqual(["a", "b", "c"]);
    expect(f.improvements).toEqual([{ issue: "pace", suggestion: "slow down" }]);
    expect(f.languageFixes).toEqual([]);
  });

  it("rejects replies with nothing usable", () => {
    expect(() => normalizeFeedback({ scores: {} })).toThrow(InvalidReplyError);
  });
});

describe("normalizeOnePager", () => {
  it("keeps complete vocabulary entries only", () => {
    const p = normalizeOnePager({
      title: "Remote work",
      summary: "Overview.",
      keyPoints: ["one"],
      vocabulary: [{ term: "hybrid", meaning: "mix", example: "A hybrid week." }, { term: "x" }],
    });
    expect(p.vocabulary).toHaveLength(1);
    expect(p.perspectives).toEqual([]);
  });
});

describe("parseFeedback", () => {
  it("validates provider and falls back on unknown language and mode", () => {
    const r = parseFeedback({ provider: "ollama", promptText: "Hi", transcript: "hello", language: "fr", mode: "x", stats: { wpm: "fast" } });
    expect(r.language).toBe("en-US");
    expect(r.mode).toBe("topic");
    expect(r.stats.wpm).toBeNull();
    expect(() => parseFeedback({ provider: "openai", promptText: "Hi", transcript: "x" })).toThrow(/provider/);
  });

  it("passes valid on-camera stats to the coach prompt and drops unknown ones", () => {
    const r = parseFeedback({
      provider: "anthropic",
      promptText: "Hi",
      transcript: "hello",
      stats: { highMotionShare: 0.4, movement: "busy", lighting: "sideways" },
    });
    expect(r.stats).toMatchObject({ highMotionShare: 0.4, movement: "busy", lighting: null });
    const { user } = feedbackPrompts(r);
    expect(user).toContain("On-camera movement: busy (a lot of movement 40% of the time)");
    expect(user).not.toContain("Video lighting");
  });
});

describe("ollama provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lists installed models and prefers OLLAMA_MODEL when installed", async () => {
    vi.stubEnv("OLLAMA_MODEL", "qwen3:8b");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{ name: "llama3.2" }, { name: "qwen3:8b" }] })));
    const ollama = (await listProviders()).find((p) => p.id === "ollama")!;
    expect(ollama.available).toBe(true);
    expect(ollama.model).toBe("qwen3:8b");
    expect(ollama.models).toEqual(["llama3.2", "qwen3:8b"]);
  });

  it("reports Ollama as unavailable when it isn't running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const ollama = (await listProviders()).find((p) => p.id === "ollama")!;
    expect(ollama.available).toBe(false);
    expect(ollama.reason).toMatch(/isn't running/);
  });

  it("sends the schema as `format` and parses the reply", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ message: { content: '{"summary":"ok"}' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await generateJson({
      provider: "ollama",
      model: "llama3.2",
      system: "sys",
      user: "usr",
      schema: FEEDBACK_SCHEMA,
      toolName: "t",
      toolDescription: "d",
      maxTokens: 100,
    });
    expect(out).toEqual({ summary: "ok" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "llama3.2", stream: false, format: FEEDBACK_SCHEMA });
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("explains how to install a missing model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("model not found", { status: 404 })));
    await expect(
      generateJson({ provider: "ollama", model: "gemma3", system: "", user: "", schema: {}, toolName: "t", toolDescription: "d", maxTokens: 1 }),
    ).rejects.toThrow("ollama pull gemma3");
  });
});

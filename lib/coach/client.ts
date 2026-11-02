import type { CoachFeedback, FeedbackRequest, OnePager, OnePagerRequest, ProviderInfo } from "./types";

export async function fetchProviders(): Promise<ProviderInfo[]> {
  try {
    const res = await fetch("/api/coach", { cache: "no-store" });
    return res.ok ? ((await res.json()).providers as ProviderInfo[]) : [];
  } catch {
    return [];
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach the app server.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data as T;
}

export const requestFeedback = (req: FeedbackRequest) => post<CoachFeedback>("/api/coach", req);
export const requestOnePager = (req: OnePagerRequest) => post<OnePager>("/api/learn", req);

// One-pagers depend only on the prompt, so cache them per browser to avoid paying twice.
const CACHE_KEY = "speak-up:onepagers";
const CACHE_MAX = 30;

function cacheKey(req: OnePagerRequest) {
  return `${req.provider}:${req.model ?? ""}:${req.language}:${req.promptText}`;
}

export function cachedOnePager(req: OnePagerRequest): OnePager | null {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, OnePager>;
    return all[cacheKey(req)] ?? null;
  } catch {
    return null;
  }
}

export function cacheOnePager(req: OnePagerRequest, page: OnePager) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, OnePager>;
    delete all[cacheKey(req)];
    const entries = [[cacheKey(req), page], ...Object.entries(all)].slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Non-essential.
  }
}

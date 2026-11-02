"use client";

import { useCallback, useEffect, useState } from "react";
import Practice from "@/components/Practice";
import Progress from "@/components/Progress";
import { currentStreak, loadHistory, type Session } from "@/lib/history";
import type { Prompt } from "@/lib/prompts";
import { DEFAULT_SETTINGS, loadSettings, storeSettings, type Settings } from "@/lib/settings";

type View = "practice" | "progress";

export default function App() {
  const [view, setView] = useState<View>("practice");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<Session[]>([]);
  const [active, setActive] = useState(false);
  const [queued, setQueued] = useState<Prompt | null>(null);

  // Load per-browser settings and history after mount (localStorage isn't available on the server).
  useEffect(() => {
    setSettings(loadSettings());
    setHistory(loadHistory());
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      storeSettings(next);
      return next;
    });
  }, []);

  const practise = useCallback((p: Prompt) => {
    setQueued(p);
    setView("practice");
    window.scrollTo({ top: 0 });
  }, []);

  const streak = currentStreak(history);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>●</span> Speak Up
        </div>
        <nav className="tabs" aria-label="Sections">
          {(["practice", "progress"] as const).map((v) => (
            <button
              key={v}
              className={`tab ${view === v ? "on" : ""}`}
              aria-current={view === v ? "page" : undefined}
              disabled={active && v !== view}
              title={active && v !== view ? "End your session first" : undefined}
              onClick={() => setView(v)}
            >
              {v === "practice" ? "Practice" : "Progress"}
            </button>
          ))}
        </nav>
        <div className="stats">
          <span title="Days in a row with at least one take">🔥 {streak} day{streak === 1 ? "" : "s"}</span>
          <span className="hide-narrow" title="Total takes recorded">
            {history.length} take{history.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {view === "practice" ? (
        <Practice
          settings={settings}
          onSettings={updateSettings}
          history={history}
          onHistory={setHistory}
          onActiveChange={setActive}
          queued={queued}
          onQueuedTaken={() => setQueued(null)}
          onOpenProgress={() => setView("progress")}
        />
      ) : (
        <Progress
          history={history}
          onHistory={setHistory}
          onPractise={practise}
          onGoPractice={() => setView("practice")}
          keepRecordings={settings.keepRecordings}
        />
      )}
    </div>
  );
}

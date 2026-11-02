"use client";

import { useCallback, useEffect, useState } from "react";
import Practice from "@/components/Practice";
import Progress from "@/components/Progress";
import SettingsPanel from "@/components/SettingsPanel";
import Sidebar from "@/components/Sidebar";
import { fetchProviders } from "@/lib/coach/client";
import type { ProviderInfo } from "@/lib/coach/types";
import { currentStreak, loadHistory, type Session } from "@/lib/history";
import type { Prompt } from "@/lib/prompts";
import { DEFAULT_SETTINGS, loadSettings, storeSettings, type Settings } from "@/lib/settings";
import { serverTranscriptionAvailable } from "@/lib/transcribe";

type View = "practice" | "progress";

const PANEL_KEY = "speak-up:settings-open";
/** Below this width the settings panel is a drawer over the page instead of a column. */
const WIDE_QUERY = "(min-width: 1100px)";

function loadPanelOpen(): boolean {
  const wide = window.matchMedia(WIDE_QUERY).matches;
  if (!wide) return false; // drawers start closed on small screens
  try {
    return localStorage.getItem(PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

export default function App() {
  const [view, setView] = useState<View>("practice");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<Session[]>([]);
  const [active, setActive] = useState(false);
  const [queued, setQueued] = useState<Prompt | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [serverStt, setServerStt] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // Load per-browser state after mount (localStorage isn't available on the server).
  useEffect(() => {
    setSettings(loadSettings());
    setHistory(loadHistory());
    setPanelOpen(loadPanelOpen());
    void fetchProviders().then(setProviders);
    void serverTranscriptionAvailable().then(setServerStt);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      storeSettings(next);
      return next;
    });
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      // Remember the choice for the wide layout only; the drawer always starts closed.
      if (window.matchMedia(WIDE_QUERY).matches) {
        try {
          localStorage.setItem(PANEL_KEY, open ? "0" : "1");
        } catch {
          // Non-essential.
        }
      }
      return !open;
    });
  }, []);

  const practise = useCallback((p: Prompt) => {
    setQueued(p);
    setView("practice");
    window.scrollTo({ top: 0 });
  }, []);

  const streak = currentStreak(history);

  return (
    <div className={`app ${view === "practice" ? "app-wide" : ""}`}>
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
          <span className="hide-narrow" title="Days in a row with at least one take">
            🔥 {streak} day{streak === 1 ? "" : "s"}
          </span>
          {view === "practice" && (
            <button
              className="ghost settings-toggle"
              onClick={togglePanel}
              aria-expanded={panelOpen}
              aria-label={panelOpen ? "Hide settings" : "Show settings"}
              title="Settings"
            >
              ⚙
            </button>
          )}
        </div>
      </header>

      {view === "practice" ? (
        <div className={`workspace ${panelOpen ? "panel-open" : "panel-closed"}`}>
          <div className="col-main">
            <Practice
              settings={settings}
              onSettings={updateSettings}
              history={history}
              onHistory={setHistory}
              onActiveChange={setActive}
              queued={queued}
              onQueuedTaken={() => setQueued(null)}
              onOpenSettings={() => setPanelOpen(true)}
              providers={providers}
              serverStt={serverStt}
            />
          </div>
          <div className="col-left">
            <Sidebar
              history={history}
              onHistory={setHistory}
              onPractise={practise}
              onOpenProgress={() => setView("progress")}
            />
          </div>
          <div className="col-right">
            <SettingsPanel
              settings={settings}
              onSettings={updateSettings}
              providers={providers}
              serverStt={serverStt}
              active={active}
              open={panelOpen}
              onToggle={togglePanel}
            />
          </div>
        </div>
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

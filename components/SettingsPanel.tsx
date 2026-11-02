"use client";

import { coachModelFor, resolveCoach } from "@/lib/coach/resolve";
import type { ProviderInfo } from "@/lib/coach/types";
import { DIFFICULTY_LABELS, MODES, type Mode } from "@/lib/prompts";
import {
  KEEP_OPTIONS,
  LANGUAGES,
  PREP_OPTIONS,
  SPEAK_OPTIONS,
  formatSeconds,
  type Settings,
} from "@/lib/settings";

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  providers: ProviderInfo[];
  serverStt: boolean;
  /** A session is running: camera settings are locked until it ends. */
  active: boolean;
  open: boolean;
  onToggle: () => void;
}

function Chips<T extends string | number>({
  options,
  selected,
  label,
  onPick,
  disabled,
}: {
  options: readonly T[];
  selected: (v: T) => boolean;
  label: (v: T) => string;
  onPick: (v: T) => void;
  disabled?: (v: T) => boolean;
}) {
  return (
    <div className="chips">
      {options.map((v) => (
        <button
          key={String(v)}
          className={`chip ${selected(v) ? "on" : ""}`}
          aria-pressed={selected(v)}
          disabled={disabled?.(v)}
          onClick={() => onPick(v)}
        >
          {label(v)}
        </button>
      ))}
    </div>
  );
}

/** Every setting, in a right-hand panel that collapses to a slim rail (or a drawer on small screens). */
export default function SettingsPanel({ settings, onSettings, providers, serverStt, active, open, onToggle }: Props) {
  const coachProvider = resolveCoach(settings, providers);
  const coachModel = coachModelFor(settings, coachProvider);

  function toggleMode(mode: Mode) {
    const has = settings.modes.includes(mode);
    if (has && settings.modes.length === 1) return; // keep at least one
    onSettings({ modes: has ? settings.modes.filter((m) => m !== mode) : [...settings.modes, mode] });
  }

  if (!open) {
    return (
      <aside className="settings-panel collapsed" aria-label="Settings">
        <button className="rail-button" onClick={onToggle} aria-expanded={false} aria-label="Show settings" title="Show settings">
          <span aria-hidden>⚙</span>
          <span className="rail-label">Settings</span>
        </button>
      </aside>
    );
  }

  return (
    <>
      {/* Backdrop for the drawer on small screens (hidden by CSS on wide ones). */}
      <div className="settings-backdrop" onClick={onToggle} aria-hidden />
      <aside className="settings-panel" aria-label="Settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="ghost close" onClick={onToggle} aria-expanded title="Hide settings" aria-label="Hide settings">
            ✕
          </button>
        </div>
        {active && <p className="small muted settings-note">Changes apply to your next take.</p>}

        <section className="settings-group">
          <h3>Prompts</h3>
          <fieldset>
            <legend>Types</legend>
            <Chips
              options={Object.keys(MODES) as Mode[]}
              selected={(m) => settings.modes.includes(m)}
              label={(m) => MODES[m].label}
              onPick={toggleMode}
            />
          </fieldset>
          <fieldset>
            <legend>Difficulty</legend>
            <Chips
              options={["any", 1, 2, 3] as const}
              selected={(d) => settings.difficulty === d}
              label={(d) => (d === "any" ? "Mixed" : DIFFICULTY_LABELS[d])}
              onPick={(d) => onSettings({ difficulty: d })}
            />
          </fieldset>
        </section>

        <section className="settings-group">
          <h3>Timing</h3>
          <fieldset>
            <legend>Thinking time</legend>
            <Chips
              options={PREP_OPTIONS}
              selected={(s) => settings.prepSeconds === s}
              label={(s) => (s === 0 ? "None" : formatSeconds(s))}
              onPick={(s) => onSettings({ prepSeconds: s })}
            />
          </fieldset>
          <fieldset>
            <legend>Speaking time</legend>
            <Chips
              options={SPEAK_OPTIONS}
              selected={(s) => settings.speakSeconds === s}
              label={formatSeconds}
              onPick={(s) => onSettings({ speakSeconds: s })}
            />
          </fieldset>
        </section>

        <section className="settings-group">
          <h3>Language</h3>
          <fieldset>
            <legend>Your English</legend>
            <Chips
              options={LANGUAGES.map((l) => l.code)}
              selected={(c) => settings.language === c}
              label={(c) => LANGUAGES.find((l) => l.code === c)!.label}
              onPick={(c) => onSettings({ language: c })}
            />
            <p className="muted small hint">
              Pick the accent closest to yours for a more accurate transcript.{" "}
              {serverStt ? "Transcripts come from Deepgram." : "Transcripts come from your browser's speech recognition."}
            </p>
          </fieldset>
        </section>

        <section className="settings-group">
          <h3>AI coach</h3>
          <fieldset>
            <legend className="sr-only">Provider</legend>
            <div className="chips">
              {providers.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${coachProvider?.id === p.id ? "on" : ""}`}
                  aria-pressed={coachProvider?.id === p.id}
                  disabled={!p.available}
                  title={p.reason}
                  onClick={() => onSettings({ coach: p.id })}
                >
                  {p.label}
                </button>
              ))}
              <button
                className={`chip ${settings.coach === "off" ? "on" : ""}`}
                aria-pressed={settings.coach === "off"}
                onClick={() => onSettings({ coach: "off" })}
              >
                Off
              </button>
            </div>
            {coachProvider?.id === "ollama" && (coachProvider.models?.length ?? 0) > 1 && (
              <label className="model-select small">
                Model
                <select value={coachModel} onChange={(e) => onSettings({ ollamaModel: e.target.value })}>
                  {coachProvider.models?.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="muted small hint">
              {coachProvider
                ? `After each take, ${coachProvider.label} (${coachModel})${coachProvider.id === "ollama" ? ", running on your computer," : ""} gives feedback and can write a one-pager on the topic.`
                : settings.coach === "off"
                  ? "AI coaching is off."
                  : "Add an ANTHROPIC_API_KEY or run Ollama locally to get AI feedback and one-pagers (see README)."}
            </p>
          </fieldset>
        </section>

        <section className="settings-group">
          <h3>Camera</h3>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.camera}
              disabled={active}
              onChange={(e) => onSettings({ camera: e.target.checked })}
            />
            Record video (off for audio only)
          </label>
          {settings.camera && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings.faceTracking}
                disabled={active}
                onChange={(e) => onSettings({ faceTracking: e.target.checked })}
              />
              Check framing and eye contact
            </label>
          )}
          {settings.camera && (
            <p className="muted small hint">
              Face tracking runs in your browser and downloads a ~4 MB model once.
              {active ? " End the session to change camera settings." : ""}
            </p>
          )}
          <fieldset>
            <legend>Save recordings</legend>
            <Chips
              options={KEEP_OPTIONS}
              selected={(n) => settings.keepRecordings === n}
              label={(n) => (n === 0 ? "Off" : `Last ${n}`)}
              onPick={(n) => onSettings({ keepRecordings: n })}
            />
            <p className="muted small hint">
              Kept only in this browser, so you can rewatch old takes. A one-minute video is roughly 5–15 MB.
            </p>
          </fieldset>
        </section>
      </aside>
    </>
  );
}

import type { ProviderId } from "./coach/types";
import type { Difficulty, Mode } from "./prompts";

export interface Settings {
  modes: Mode[];
  difficulty: Difficulty | "any";
  prepSeconds: number;
  speakSeconds: number;
  camera: boolean;
  /** BCP-47 English variant used for speech recognition. */
  language: string;
  /** AI coach provider; "auto" picks Claude if configured, else Ollama. */
  coach: "auto" | ProviderId | "off";
  /** Preferred Ollama model ("" = server default). */
  ollamaModel: string;
  /** How many recent recordings to keep in this browser (0 = don't save). */
  keepRecordings: number;
  /** Track the face (MediaPipe, in the browser) for framing and eye contact. */
  faceTracking: boolean;
}

/** English variants supported by both browser speech recognition and Deepgram nova-3. */
export const LANGUAGES = [
  { code: "en-US", label: "US" },
  { code: "en-GB", label: "UK" },
  { code: "en-IN", label: "India" },
  { code: "en-AU", label: "Australia" },
];

export const DEFAULT_SETTINGS: Settings = {
  modes: ["word", "topic", "situation", "explain", "speech"],
  difficulty: "any",
  prepSeconds: 15,
  speakSeconds: 60,
  camera: true,
  language: "en-US",
  coach: "auto",
  ollamaModel: "",
  keepRecordings: 10,
  faceTracking: true,
};

export const PREP_OPTIONS = [0, 15, 30, 60];
export const SPEAK_OPTIONS = [30, 60, 120, 180];
export const KEEP_OPTIONS = [0, 10, 30, 100];

const KEY = "speak-up:settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const browserLang = LANGUAGES.find((l) => l.code === navigator.language)?.code;
    const defaults = browserLang ? { ...DEFAULT_SETTINGS, language: browserLang } : DEFAULT_SETTINGS;
    if (!raw) return defaults;
    const parsed = { ...defaults, ...JSON.parse(raw) } as Settings;
    return parsed.modes.length > 0 ? parsed : { ...parsed, modes: DEFAULT_SETTINGS.modes };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function storeSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Non-essential.
  }
}

export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

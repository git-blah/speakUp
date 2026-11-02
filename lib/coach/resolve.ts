import type { Settings } from "../settings";
import type { ProviderInfo } from "./types";

/** The coach to use: the chosen provider if available, else the first available one (or none). */
export function resolveCoach(settings: Settings, providers: ProviderInfo[]): ProviderInfo | null {
  if (settings.coach === "off") return null;
  const available = providers.filter((p) => p.available);
  return available.find((p) => p.id === settings.coach) ?? available[0] ?? null;
}

/** The model that provider will use, honouring the user's Ollama model choice when installed. */
export function coachModelFor(settings: Settings, provider: ProviderInfo | null): string | undefined {
  if (provider?.id === "ollama" && provider.models?.includes(settings.ollamaModel)) return settings.ollamaModel;
  return provider?.model;
}

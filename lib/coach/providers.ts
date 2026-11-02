import Anthropic from "@anthropic-ai/sdk";
import { parseJsonReply, type ProviderId, type ProviderInfo } from "./types";

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";
const OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434";
const OLLAMA_DEFAULT_MODEL = "llama3.1:8b";
const OLLAMA_TIMEOUT_MS = 4 * 60 * 1000; // local models on a laptop can be slow

export class CoachError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const anthropicModel = () => process.env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL;
const ollamaUrl = () => (process.env.OLLAMA_BASE_URL || OLLAMA_DEFAULT_URL).replace(/\/+$/, "");
const ollamaDefaultModel = () => process.env.OLLAMA_MODEL || OLLAMA_DEFAULT_MODEL;

async function listOllamaModels(): Promise<string[] | null> {
  try {
    const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name ?? "").filter(Boolean);
  } catch {
    return null;
  }
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const models = await listOllamaModels();
  const defaultOllama = ollamaDefaultModel();
  const ollamaModel = models?.includes(defaultOllama) ? defaultOllama : (models?.[0] ?? defaultOllama);
  return [
    {
      id: "anthropic",
      label: "Claude",
      available: Boolean(process.env.ANTHROPIC_API_KEY),
      model: anthropicModel(),
      reason: process.env.ANTHROPIC_API_KEY ? undefined : "Set ANTHROPIC_API_KEY to enable.",
    },
    {
      id: "ollama",
      label: "Ollama",
      available: !!models && models.length > 0,
      model: ollamaModel,
      models: models ?? [],
      reason: !models
        ? `Ollama isn't running at ${ollamaUrl()}.`
        : models.length === 0
          ? `No models installed. Run: ollama pull ${defaultOllama}`
          : undefined,
    },
  ];
}

export interface GenerateArgs {
  provider: ProviderId;
  model?: string;
  system: string;
  user: string;
  schema: object;
  /** Tool name/description used for Claude's forced tool call. */
  toolName: string;
  toolDescription: string;
  maxTokens: number;
  /** Ollama only: how long to wait (local models can be slow on long outputs). */
  timeoutMs?: number;
}

/** Ask the chosen provider for JSON matching `schema`. Returns the raw (unvalidated) object. */
export async function generateJson(args: GenerateArgs): Promise<unknown> {
  return args.provider === "anthropic" ? generateWithClaude(args) : generateWithOllama(args);
}

async function generateWithClaude(args: GenerateArgs): Promise<unknown> {
  if (!process.env.ANTHROPIC_API_KEY) throw new CoachError("ANTHROPIC_API_KEY isn't set.", 503);
  const client = new Anthropic();
  let message: Anthropic.Message;
  try {
    // A forced tool call guarantees the reply is structured input matching the schema.
    message = await client.messages.create({
      model: anthropicModel(),
      max_tokens: args.maxTokens,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      tools: [
        {
          name: args.toolName,
          description: args.toolDescription,
          input_schema: args.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: args.toolName },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      if (err.status === 401) throw new CoachError("Claude rejected the API key. Check ANTHROPIC_API_KEY.");
      if (err.status === 429) throw new CoachError("Claude is rate-limiting requests. Try again in a minute.", 429);
      if (err.status === 404) throw new CoachError(`Claude model "${anthropicModel()}" wasn't found. Check ANTHROPIC_MODEL.`);
      throw new CoachError(`Claude request failed (${err.status ?? "network error"}).`);
    }
    throw err;
  }
  if (message.stop_reason === "max_tokens") throw new CoachError("Claude's reply was cut off. Try again.");
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new CoachError("Claude didn't return structured output.");
  return block.input;
}

async function generateWithOllama(args: GenerateArgs): Promise<unknown> {
  const model = args.model || ollamaDefaultModel();
  if (!/^[\w.:/-]+$/.test(model)) throw new CoachError("Invalid model name.", 400);

  let res: Response;
  try {
    res = await fetch(`${ollamaUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(args.timeoutMs ?? OLLAMA_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        // Structured outputs: Ollama constrains generation to this JSON Schema.
        format: args.schema,
        options: { temperature: 0.3, num_ctx: 8192 },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: `${args.user}\n\nRespond only with JSON matching the requested schema.` },
        ],
      }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new CoachError(`Ollama (${model}) took too long. Try a smaller model.`, 504);
    }
    throw new CoachError(`Couldn't reach Ollama at ${ollamaUrl()}. Is it running?`, 503);
  }
  if (res.status === 404) throw new CoachError(`Model "${model}" isn't installed. Run: ollama pull ${model}`, 400);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new CoachError(`Ollama request failed (${res.status}). ${detail.slice(0, 200)}`.trim());
  }
  const data = (await res.json()) as { message?: { content?: string } };
  try {
    return parseJsonReply(data.message?.content ?? "");
  } catch {
    throw new CoachError(`${model} didn't return valid JSON. Try again or use a larger model.`);
  }
}

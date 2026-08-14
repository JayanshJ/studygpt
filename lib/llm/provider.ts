import type { LanguageModel, EmbeddingModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { ollamaProvider } from "./ollama";
import { getAllSettings, getSetting } from "@/lib/db";

// Swappable provider layer. v1 ships only the Ollama provider, but the
// interface is what everything else talks to. Adding Claude/GPT later =
// one new file exporting a Provider + a case in PROVIDERS. Nothing else
// in the app changes.

export interface Provider {
  name: string;
  languageModel(config: { model: string; baseURL?: string; apiKey?: string }): LanguageModel;
  // Optional preflight: confirm the backend is reachable and the model is
  // available. Throw with a human-readable message on failure so the route
  // can return a clean 502 instead of an empty streamed bubble.
  validate?(config: { model: string; baseURL: string; apiKey?: string }): Promise<void>;
  embeddingModel?(config: { model: string; baseURL?: string; apiKey?: string }): EmbeddingModel;
  validateEmbedding?(config: { model: string; baseURL: string; apiKey?: string }): Promise<void>;
}

const PROVIDERS: Record<string, Provider> = {
  ollama: ollamaProvider,
  // anthropic: anthropicProvider,  // phase-later
  // openai: openaiProvider,         // phase-later
};

export function getProvider(name?: string): Provider {
  const key = name || getSetting("provider", "ollama");
  const provider = PROVIDERS[key];
  if (!provider) throw new Error(`Unknown LLM provider: ${key}`);
  return provider;
}

// Resolve the live model config from settings (falls back to .env defaults).
export function getModelConfig(): {
  provider: string;
  model: string;
  embeddingModel: string;
  baseURL: string;
  apiKey: string;
  tavilyApiKey: string;
  openaiApiKey: string;
  // Vision model for the diagram pipeline — lives on a SEPARATE backend from
  // the chat model (chat = local Ollama; vision = OpenRouter cloud by default,
  // which is OpenAI-compatible). Empty visionModel disables the vision path
  // and diagram turns fall back to the text-only Mermaid path.
  visionModel: string;
  visionBaseURL: string;
  visionApiKey: string;
} {
  const all = getAllSettings();
  return {
    provider: all.provider || "ollama",
    model: all.model || process.env.OLLAMA_MODEL || "glm-5.2:cloud",
    embeddingModel: all.embeddingModel || process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
    baseURL: all.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
    apiKey: all.apiKey || "",
    tavilyApiKey: all.tavilyApiKey || process.env.TAVILY_API_KEY || "",
    // Used only for voice typing: the mic records a clip and the server proxies
    // it to OpenAI's Whisper transcription endpoint. Kept server-side so the
    // key never reaches the browser. Empty → voice falls back to the browser's
    // built-in Web Speech API (which needs Google's service, often blocked).
    openaiApiKey: all.openaiApiKey || process.env.OPENAI_API_KEY || "",
    visionModel: all.visionModel || process.env.OPENROUTER_VISION_MODEL || "google/gemini-2.5-flash",
    visionBaseURL: all.visionBaseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    visionApiKey: all.visionApiKey || process.env.OPENROUTER_API_KEY || "",
  };
}

// Build the vision LanguageModel on its own OpenAI-compatible backend
// (OpenRouter by default). Separate from the chat provider because the vision
// model typically runs on a different host (cloud) than the chat model (local
// Ollama). Returns null if no vision model/key is configured so the caller can
// fall back to the text-only path.
export function getVisionLanguageModel(cfg: {
  visionModel: string;
  visionBaseURL: string;
  visionApiKey: string;
}): LanguageModel | null {
  if (!cfg.visionModel || !cfg.visionApiKey) return null;
  const client = createOpenAICompatible({
    name: "openrouter",
    baseURL: cfg.visionBaseURL,
    apiKey: cfg.visionApiKey,
    headers: { Authorization: `Bearer ${cfg.visionApiKey}` },
  });
  return client.chatModel(cfg.visionModel);
}

// Preflight the vision backend: confirm the endpoint is reachable and the key
// is accepted. Throws on auth failure (401/403) or unreachable backend so the
// chat route can fall back to the text-only Mermaid path instead of streaming a
// vision call that's doomed to fail. A 200 (even from OpenRouter's public
// /models list) only proves the key isn't rejected — a bad model id would still
// surface mid-stream, but that's an edge case the user fixes in Settings.
export async function validateVision(cfg: {
  visionModel: string;
  visionBaseURL: string;
  visionApiKey: string;
}): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${cfg.visionBaseURL}/models`, {
      signal: AbortSignal.timeout(5000),
      headers: cfg.visionApiKey ? { Authorization: `Bearer ${cfg.visionApiKey}` } : {},
    });
  } catch {
    throw new Error(`Could not reach the vision backend at ${cfg.visionBaseURL}.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Vision backend rejected the API key (${res.status}). Check the vision API key in Settings.`);
  }
  if (!res.ok) {
    throw new Error(`Vision backend returned ${res.status} from ${cfg.visionBaseURL}/models.`);
  }
}
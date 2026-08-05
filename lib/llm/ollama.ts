import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Provider } from "./provider";

// Ollama exposes an OpenAI-compatible endpoint (default :11434/v1),
// so we use @ai-sdk/openai-compatible to talk to it. If an apiKey is set
// (e.g. for a hosted endpoint), it's sent as `Authorization: Bearer <key>`.
export const ollamaProvider: Provider = {
  name: "ollama",
  languageModel({ model, baseURL, apiKey }) {
    const client = createOpenAICompatible({
      name: "ollama",
      baseURL: baseURL || "http://localhost:11434/v1",
      // When a key is present it's used for the auth header; without one we
      // talk to the local server, which needs no auth.
      ...(apiKey ? { apiKey, headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    });
    return client.chatModel(model);
  },

  // Preflight: hit /v1/models to confirm the backend is reachable and the
  // model is available. Catches the two failure modes that would otherwise
  // surface as an empty streamed bubble: backend not running, and a model
  // that was never pulled/available.
  async validate({ model, baseURL, apiKey }) {
    let res: Response;
    try {
      res = await fetch(`${baseURL}/models`, {
        signal: AbortSignal.timeout(3000),
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
    } catch {
      throw new Error(
        `Could not reach the model server at ${baseURL}. Is Ollama running? (start with \`ollama serve\`)`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Authentication failed (${res.status}). Check the API key in Settings.`);
    }
    if (!res.ok) {
      throw new Error(`Server returned ${res.status} from ${baseURL}/models`);
    }
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id);
    if (!ids.includes(model)) {
      throw new Error(
        `Model "${model}" is not available. Available models: ${ids.join(", ") || "(none)"}.`,
      );
    }
  },
};
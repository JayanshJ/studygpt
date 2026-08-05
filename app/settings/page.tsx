"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Config {
  provider: string;
  model: string;
  baseURL: string;
  apiKey: string;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        setModel(c.model);
        setBaseUrl(c.baseURL);
        setApiKey(c.apiKey || "");
      })
      .catch(() => setError("Could not load settings."));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "ollama", model, baseUrl, apiKey }),
    });
    if (res.ok) {
      setSaved(true);
      setConfig(await res.json());
    } else {
      setError("Save failed.");
    }
  }

  if (!config) {
    return <div className="mono p-8 text-sm text-ink-3">Loading settings…</div>;
  }

  return (
    <div className="graph-paper min-h-screen">
      <div className="mx-auto max-w-xl px-6 py-14">
        <p className="mono mb-2 text-[11px] tracking-[0.2em] text-rule">
          SETTINGS
        </p>
        <h1 className="text-[1.6rem] leading-tight text-ink">Model &amp; connection</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          These control how StudyGPT talks to the model. Changes apply to new
          conversations. The provider layer is swappable — today only Ollama is
          wired, but adding Claude or GPT later is one file plus a switch here.
        </p>

        <form onSubmit={save} className="mt-9 flex flex-col gap-7">
          <Field label="Provider" hint="More providers arrive in later phases.">
            <select
              value="ollama"
              disabled
              className="mono w-full border-0 border-b border-line bg-transparent py-2 text-[14px] text-ink-2"
            >
              <option value="ollama">Ollama (local / cloud)</option>
            </select>
          </Field>

          <Field
            label="Model"
            hint={`Any model pulled or available — e.g. ${config.model}.`}
          >
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="glm-5.2:cloud"
              className="mono w-full border-0 border-b border-line bg-transparent py-2 text-[14px] text-ink outline-none transition-colors focus:border-ink"
            />
          </Field>

          <Field label="Base URL" hint="OpenAI-compatible endpoint.">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="mono w-full border-0 border-b border-line bg-transparent py-2 text-[14px] text-ink outline-none transition-colors focus:border-ink"
            />
          </Field>

          <Field
            label="API key"
            hint="Optional. Leave blank for local Ollama. Sent as a Bearer token when set — for a hosted endpoint."
          >
            <div className="flex items-center gap-3">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="(none — local mode)"
                autoComplete="off"
                spellCheck={false}
                className="mono w-full border-0 border-b border-line bg-transparent py-2 text-[14px] text-ink outline-none transition-colors focus:border-ink"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="mono shrink-0 text-[11px] tracking-wide text-ink-3 hover:text-ink"
              >
                {showKey ? "hide" : "show"}
              </button>
            </div>
          </Field>

          <div className="flex items-center gap-4 pt-1">
            <button
              type="submit"
              className="mono rounded-[3px] bg-ink px-5 py-2 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90"
            >
              Save
            </button>
            <Link
              href="/"
              className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink"
            >
              ← back to chat
            </Link>
            {saved && <span className="mono text-[12px] text-feynman">saved.</span>}
            {error && <span className="mono text-[12px] text-rule">{error}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="mono text-[12px] tracking-wide text-ink-2">{label}</span>
      {children}
      {hint && <span className="mono mt-1 text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}
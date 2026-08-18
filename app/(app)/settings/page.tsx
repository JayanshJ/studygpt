"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Settings as SettingsIcon, Eye, EyeOff, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";

interface Config {
  provider: string;
  model: string;
  baseURL: string;
  apiKey: string;
  tavilyApiKey: string;
  openaiApiKey: string;
  visionModel: string;
  visionBaseURL: string;
  visionApiKey: string;
  totalTokens: number;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [visionBaseUrl, setVisionBaseUrl] = useState("");
  const [visionApiKey, setVisionApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showTavilyKey, setShowTavilyKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = useMotion();

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        setModel(c.model);
        setBaseUrl(c.baseURL);
        setApiKey(c.apiKey || "");
        setTavilyApiKey(c.tavilyApiKey || "");
        setOpenaiApiKey(c.openaiApiKey || "");
        setVisionModel(c.visionModel || "");
        setVisionBaseUrl(c.visionBaseURL || "");
        setVisionApiKey(c.visionApiKey || "");
      })
      .catch(() => setError("Could not load settings."));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "ollama",
        model,
        baseUrl,
        apiKey,
        tavilyApiKey,
        openaiApiKey,
        visionModel,
        visionBaseUrl,
        visionApiKey,
      }),
    });
    if (res.ok) {
      setConfig(await res.json());
      toast.success("Settings saved", { description: "Changes apply to new conversations." });
    } else {
      setError("Save failed.");
      toast.error("Save failed", { description: "Could not write settings to the server." });
    }
  }

  if (!config) {
    return (
      <div className="graph-paper h-full overflow-y-auto">
        <div className="mx-auto max-w-xl px-4 py-14 tab:px-6">
          <p className="mono mb-2 text-[11px] tracking-[0.2em] text-rule">SETTINGS</p>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-3 h-4 w-full max-w-md" />
          <div className="mt-7 flex items-baseline gap-3 border-y border-border py-3">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="mt-9 flex flex-col gap-7">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-5 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="graph-paper h-full overflow-y-auto">
      <div className="mx-auto max-w-xl px-4 py-10 tab:px-6 tab:py-14">
        <motion.div {...m} variants={fadeUp} className="mb-5 flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <SettingsIcon size={16} className="text-rule" />
          Settings
        </motion.div>

        <motion.h1 {...m} variants={fadeUp} className="font-serif text-[1.6rem] leading-tight text-ink">
          Model &amp; connection
        </motion.h1>
        <motion.p {...m} variants={fadeUp} className="mt-2 text-[15px] text-content-muted">
          These control how Loom talks to the model. Changes apply to new
          conversations. The provider layer is swappable — today only Ollama is
          wired, but adding Claude or GPT later is one file plus a switch here.
        </motion.p>

        <motion.div {...m} variants={fadeUp} className="mt-7 flex items-baseline gap-3 border-y border-border py-3">
          <span className="mono text-[11px] tracking-[0.18em] text-content-faint">
            TOTAL TOKENS
          </span>
          <span className="mono text-[15px] text-ink">
            {config.totalTokens.toLocaleString()}
          </span>
          <span className="mono text-[11px] text-content-faint">
            · across all conversations
          </span>
        </motion.div>

        <form onSubmit={save} className="mt-9 flex flex-col gap-7">
          <Field label="Provider" hint="More providers arrive in later phases.">
            <Input value="ollama" disabled className="font-sans" />
          </Field>

          <Field
            label="Model"
            hint={`Any model pulled or available — e.g. ${config.model}.`}
          >
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="glm-5.2:cloud"
              className="font-sans"
            />
          </Field>

          <Field label="Base URL" hint="OpenAI-compatible endpoint.">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1"
              className="font-sans"
            />
          </Field>

          <Field
            label="API key"
            hint="Optional. Leave blank for local Ollama. Sent as a Bearer token when set — for a hosted endpoint."
          >
            <KeyInput
              value={apiKey}
              onChange={setApiKey}
              show={showKey}
              onToggle={() => setShowKey((s) => !s)}
              placeholder="(none — local mode)"
            />
          </Field>

          <Field
            label="Tavily API key"
            hint="Optional — enables web search. When set, the assistant can search the web for current info."
          >
            <KeyInput
              value={tavilyApiKey}
              onChange={setTavilyApiKey}
              show={showTavilyKey}
              onToggle={() => setShowTavilyKey((s) => !s)}
              placeholder="(none — web search disabled)"
            />
          </Field>

          <Field
            label="OpenAI API key"
            hint="Optional — enables voice typing. The mic records a clip and this server transcribes it via OpenAI Whisper, so voice works even when the browser's built-in speech service is blocked. The key never leaves the server."
          >
            <KeyInput
              value={openaiApiKey}
              onChange={setOpenaiApiKey}
              show={showOpenaiKey}
              onToggle={() => setShowOpenaiKey((s) => !s)}
              placeholder="(none — voice uses the browser engine)"
            />
          </Field>

          <div className="mono mt-2 text-[11px] tracking-[0.18em] text-rule">VISION (DIAGRAMS)</div>
          <p className="mono -mt-4 text-[11px] text-content-faint">
            When you ask for a diagram (e.g. an ER model), the app feeds the
            relevant slide page images to this vision model so it can reproduce
            your course&apos;s notation. Runs on a separate OpenAI-compatible
            backend (OpenRouter by default). Leave the key blank to fall back to
            a text-only diagram.
          </p>

          <Field
            label="Vision model"
            hint={`Any OpenAI-compatible vision model — e.g. ${config.visionModel || "google/gemini-2.5-flash"}.`}
          >
            <Input
              value={visionModel}
              onChange={(e) => setVisionModel(e.target.value)}
              placeholder="google/gemini-2.5-flash"
              className="font-sans"
            />
          </Field>

          <Field label="Vision base URL" hint="OpenAI-compatible endpoint for the vision model.">
            <Input
              value={visionBaseUrl}
              onChange={(e) => setVisionBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              className="font-sans"
            />
          </Field>

          <Field
            label="Vision API key"
            hint="Sent as a Bearer token to the vision backend. Leave blank to disable the vision path."
          >
            <KeyInput
              value={visionApiKey}
              onChange={setVisionApiKey}
              show={showVisionKey}
              onToggle={() => setShowVisionKey((s) => !s)}
              placeholder="(none — vision disabled)"
            />
          </Field>

          <div className="flex items-center gap-4 pt-1">
            <Button type="submit" variant="primary">
              <Check size={15} />
              Save
            </Button>
            {error && <span className="mono text-[12px] text-danger">{error}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function KeyInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="font-sans"
      />
      <IconButton
        label={show ? "Hide key" : "Show key"}
        size="md"
        variant="solid"
        onClick={onToggle}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </IconButton>
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
      <span className="mono text-[12px] tracking-wide text-content-muted">{label}</span>
      {children}
      {hint && <span className="mono mt-1 text-[11px] text-content-faint">{hint}</span>}
    </label>
  );
}
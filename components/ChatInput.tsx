"use client";

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import type { Attachment } from "@/lib/db/schema";

interface Props {
  onSend: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  streaming?: boolean;
  onStop?: () => void;
  projectId?: string | null;
}

const TEXT_ACCEPT =
  ".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.kt,.c,.cc,.cpp,.h,.hpp,.cs,.php,.swift,.sh,.bash,.sql,.html,.htm,.css,.scss,.toml,.ini,.env,.log,.xml";

// Largest dimension (px) we downscale an attached image to before storing and
// OCR. Phone screenshots/photos at 3000px+ make tesseract slow and bloat the
// stored data URL; ~1600px keeps text legible for OCR while cutting recognition
// time and DB size sharply. Photos become JPEG, screenshots stay PNG so text
// stays sharp.
const MAX_DIM = 1600;

function downscaleImage(file: File): Promise<{ blob: File; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const isPng = file.type === "image/png";
      const type = isPng ? "image/png" : "image/jpeg";
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas toBlob failed"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = typeof reader.result === "string" ? reader.result : "";
            if (!dataUrl) {
              reject(new Error("dataURL read failed"));
              return;
            }
            resolve({ blob: new File([blob], file.name, { type }), dataUrl });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        },
        type,
        isPng ? undefined : 0.92,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image decode failed"));
    };
    img.src = url;
  });
}

export function ChatInput({ onSend, disabled, placeholder, streaming, onStop, projectId }: Props) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<Array<{ id: string; attachment: Attachment; file?: File }>>([]);
  const [extracting, setExtracting] = useState(false);
  const [parsingImage, setParsingImage] = useState<Set<string>>(new Set());
  const [addedToProject, setAddedToProject] = useState<Set<string>>(new Set());
  const [addingToProject, setAddingToProject] = useState<string | null>(null);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseRef = useRef("");
  // Start false so the server and the client's first render agree (no mic
  // button), then detect Web Speech support after mount. Computing this during
  // render would be false on the server and true on the client → hydration
  // mismatch on the mic button.
  const [speechSupported, setSpeechSupported] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeechSupported(
      typeof window !== "undefined" &&
        !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    );
  }, []);

  // Grow to fit content, capped at ~6 lines, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value]);

  // Add an image attachment. All models accept images: vision-capable models
  // Add an image attachment. All models accept images: vision-capable models
  // get the raw image part server-side; text-only models get the OCR'd text
  // inlined instead. We OCR here at attach time so the parsed text travels with
  // the persisted attachment and is reused on every turn (and survives a later
  // model switch) rather than re-parsing each turn. Images are downscaled
  // (module-scope downscaleImage) before storing/OCR — see MAX_DIM above.
  async function addImageFile(file: File) {
    const id = crypto.randomUUID();
    let stored: { blob: File; dataUrl: string };
    try {
      stored = await downscaleImage(file);
    } catch {
      // Downscale can fail on exotic formats; fall back to the original file.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      }).catch(() => "");
      stored = { blob: file, dataUrl };
    }
    setPending((prev) => [
      ...prev,
      { id, attachment: { type: "image", name: file.name, mime: stored.blob.type, dataUrl: stored.dataUrl }, file: stored.blob },
    ]);
    await parseImage(id, stored.blob);
  }

  async function parseImage(id: string, file: File) {
    setParsingImage((prev) => new Set(prev).add(id));
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-image", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; charCount?: number };
      const text = typeof data.text === "string" ? data.text : "";
      const charCount = typeof data.charCount === "number" ? data.charCount : text.length;
      setPending((prev) =>
        prev.map((p) =>
          p.id === id && p.attachment.type === "image"
            ? { ...p, attachment: { ...p.attachment, text, charCount } }
            : p,
        ),
      );
    } finally {
      setParsingImage((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function addTextFile(file: File) {
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGateMsg(err.error || "Could not read that file.");
        return;
      }
      const data = (await res.json()) as { name: string; text: string; charCount: number };
      setPending((prev) => [
        ...prev,
        { id: crypto.randomUUID(), attachment: { type: "file", name: data.name, text: data.text, charCount: data.charCount }, file },
      ]);
    } finally {
      setExtracting(false);
    }
  }

  function onPickChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) {
      for (const f of Array.from(files)) {
        if (f.type.startsWith("image/")) addImageFile(f);
        else addTextFile(f);
      }
    }
    e.target.value = "";
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          e.preventDefault();
          addImageFile(f);
        }
      }
    }
  }

  async function addToProject(id: string) {
    const item = pending.find((p) => p.id === id);
    if (!item || item.attachment.type !== "file" || !item.file || !projectId) return;
    setAddingToProject(id);
    try {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", item.file);
      const res = await fetch("/api/materials", { method: "POST", body: form });
      if (res.ok) {
        setAddedToProject((prev) => new Set(prev).add(id));
      } else {
        // /api/materials returns JSON errors { error: string }; fall back to a
        // status-coded message if the body isn't JSON (transport errors etc.).
        const err = await res.json().catch(() => ({}));
        const detail =
          (err && typeof err === "object" && "error" in err && typeof err.error === "string" && err.error) ||
          `Add to project failed (${res.status}).`;
        setGateMsg(detail);
      }
    } finally {
      setAddingToProject(null);
    }
  }

  function submit() {
    const text = value.trim();
    // Block send while an image is still being OCR'd: for a text-only model the
    // parsed text IS the image's content, so sending mid-parse would lose it.
    if ((!text && pending.length === 0) || disabled || streaming || parsingImage.size > 0) return;
    onSend(text, pending.map((p) => p.attachment));
    setValue("");
    setPending([]);
    setAddedToProject(new Set());
    setGateMsg(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function toggleVoice() {
    if (!speechSupported) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = value;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setValue(baseRef.current + final + interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <form onSubmit={onSubmit} className="px-4 pb-5 pt-2">
      {gateMsg && (
        <div className="mx-auto mb-1 max-w-3xl text-[11px] text-rule">{gateMsg}</div>
      )}
      <div className="mx-auto max-w-3xl rounded-[3px] border border-line bg-paper-2 px-3 py-2 transition-colors focus-within:border-ink/40">
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="mono flex items-center gap-1.5 rounded-[2px] border border-line bg-paper px-2 py-1 text-[11px] text-ink-2"
              >
                {p.attachment.type === "image" ? (
                  <>
                    <img src={p.attachment.dataUrl} alt={p.attachment.name} className="h-7 w-7 rounded-[2px] object-cover" />
                    <span className="truncate max-w-[160px]">
                      {parsingImage.has(p.id)
                        ? "parsing…"
                        : `OCR ${(p.attachment.charCount ?? 0).toLocaleString()}c`}
                    </span>
                  </>
                ) : (
                  <span className="truncate max-w-[160px]">📎 {p.attachment.name} ({p.attachment.charCount.toLocaleString()}c)</span>
                )}
                {p.attachment.type === "file" && projectId && (
                  addedToProject.has(p.id) ? (
                    <span className="text-feynman">added ✓</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToProject(p.id)}
                      disabled={addingToProject === p.id}
                      className="text-feynman hover:underline disabled:opacity-50"
                    >
                      {addingToProject === p.id ? "…" : "＋ to project"}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                  aria-label="Remove attachment"
                  className="text-ink-3 hover:text-rule"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={`${TEXT_ACCEPT},image/*`}
            multiple
            className="hidden"
            onChange={onPickChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || extracting}
            title="Attach files or images (images are OCR'd so any model can read them)"
            aria-label="Attach files"
            className="mono shrink-0 rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] tracking-wide text-ink-2 transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            +
          </button>
          {speechSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={disabled}
              title={listening ? "Stop voice typing" : "Voice type"}
              aria-label={listening ? "Stop voice typing" : "Voice type"}
              className={`mono shrink-0 rounded-[3px] border px-2 py-1.5 text-[12px] tracking-wide transition-colors disabled:opacity-40 ${
                listening
                  ? "border-rule text-rule hover:bg-rule/10"
                  : "border-line bg-paper text-ink-2 hover:border-ink/40"
              }`}
            >
              {listening ? "●" : "🎙"}
            </button>
          )}
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            disabled={disabled}
            placeholder={placeholder || "Ask about a concept…"}
            className="mono max-h-48 flex-1 resize-none bg-transparent py-1 text-[13px] leading-6 text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="mono shrink-0 rounded-[3px] border border-rule px-3 py-1.5 text-[12px] tracking-wide text-rule transition-colors hover:bg-rule/10"
            >
              stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || (!value.trim() && pending.length === 0) || parsingImage.size > 0}
              aria-label="Send"
              className="mono shrink-0 rounded-[3px] bg-ink px-3 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              send ↵
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
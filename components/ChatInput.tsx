"use client";

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  streaming?: boolean;
  onStop?: () => void;
}

export function ChatInput({ onSend, disabled, placeholder, streaming, onStop }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow to fit content, capped at ~6 lines, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    setValue("");
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

  return (
    <form onSubmit={onSubmit} className="px-4 pb-5 pt-2">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[3px] border border-line bg-paper-2 px-3 py-2 transition-colors focus-within:border-ink/40">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
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
            disabled={disabled || !value.trim()}
            aria-label="Send"
            className="mono shrink-0 rounded-[3px] bg-ink px-3 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            send ↵
          </button>
        )}
      </div>
    </form>
  );
}
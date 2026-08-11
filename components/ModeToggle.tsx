"use client";

import type { ConversationMode } from "@/lib/db/schema";
import { cn } from "@/lib/cn";

interface Props {
  mode: ConversationMode;
  onChange: (mode: ConversationMode) => void;
}

// Segmented control. Color encodes the mode: ink for Chat, chalk-blue for
// Feynman — so the active state tells you which kind of session you're in.
export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="mono inline-flex rounded-[4px] border border-border bg-surface-2 p-0.5 text-[11px] tracking-wide">
      <button
        onClick={() => onChange("chat")}
        aria-pressed={mode === "chat"}
        className={cn(
          "rounded-[3px] px-2.5 py-1 transition-colors duration-fast ease-out",
          mode === "chat" ? "bg-ink text-paper-2" : "text-content-faint hover:text-content",
        )}
      >
        Chat
      </button>
      <button
        onClick={() => onChange("feynman")}
        aria-pressed={mode === "feynman"}
        title="You explain concepts back; the tutor critiques the gaps."
        className={cn(
          "rounded-[3px] px-2.5 py-1 transition-colors duration-fast ease-out",
          mode === "feynman" ? "bg-feynman text-paper-2" : "text-content-faint hover:text-content",
        )}
      >
        Feynman
      </button>
    </div>
  );
}
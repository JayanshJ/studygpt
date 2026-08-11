"use client";

import { useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";
import { extractText } from "@/lib/markdown/extract-text";

interface PreProps {
  children?: ReactNode;
}

export function CodeBlock({ children }: PreProps) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  }

  return (
    <div className="group/code relative">
      <button
        onClick={copy}
        aria-label="Copy code"
        className="no-print absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-[3px] text-content-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-content group-hover/code:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring outline-none"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
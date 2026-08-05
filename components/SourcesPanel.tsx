"use client";

import { useState } from "react";
import type { SourceEntry } from "@/lib/db/schema";

export function SourcesPanel({ sources }: { sources: SourceEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  return (
    <div className="mt-3 border-t border-line pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mono flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3 transition-colors hover:text-ink"
      >
        <span className="h-1 w-1 rounded-full bg-feynman" />
        {sources.length} source{sources.length === 1 ? "" : "s"}
        <span className="text-ink-3">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-2">
          {sources.map((s, i) => (
            <li key={`${s.materialId}-${s.ordinal}-${i}`} className="rounded-[2px] bg-paper-3/60 px-2.5 py-2">
              <p className="mono text-[10px] tracking-wide text-feynman">{s.title}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2 line-clamp-3">“{s.snippet}”</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
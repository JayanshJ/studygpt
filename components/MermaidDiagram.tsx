"use client";

import { useId, useState, useEffect } from "react";
import mermaid from "mermaid";

// Renders a ```mermaid fence (entity-relationship, flow, sequence, …) to inline
// SVG inside the chat / print page. Mermaid is the canonical format the model
// emits for diagrams; without this a bare mermaid fence falls through to
// CodeBlock and renders as code. Inline SVG (not an iframe) so it also prints
// crisply into the headless-Chromium PDF.

// Initialize once at module load (idempotent). `securityLevel: 'loose'` allows
// labeled nodes / click handlers; the source is the model in a local
// single-user app, not untrusted multi-tenant input.
mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "default" });

// Track in-flight renders so the print page can wait for diagrams to finish
// before signalling data-print-ready (see app/print/[id]/page.tsx). Each
// MermaidDiagram inc's on render start and dec's on settle; the print page
// drains __pendingRenders to 0 before marking the page ready for the PDF.
const g = globalThis as unknown as { __pendingRenders?: number };
const incPending = () => {
  g.__pendingRenders = (g.__pendingRenders ?? 0) + 1;
};
const decPending = () => {
  g.__pendingRenders = Math.max(0, (g.__pendingRenders ?? 0) - 1);
};

export function MermaidDiagram({ code }: { code: string }) {
  const reactId = useId();
  // useId() yields ":r0:"-style strings; strip non-alphanumerics for a valid
  // SVG element id (mermaid uses it internally).
  const id = "mmd-" + reactId.replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    incPending();
    setFailed(false);
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setSvg(null);
        }
      })
      .finally(() => {
        settled = true;
        if (!cancelled) decPending();
      });
    // Dec exactly once per inc: if the render settled, .finally decs; if it's
    // still in flight when we clean up (unmount / code change), the cleanup
    // decs instead. `settled` keeps the two paths from double-decrementing.
    return () => {
      cancelled = true;
      if (!settled) decPending();
    };
  }, [code, id]);

  if (failed) {
    return (
      <div className="my-3 rounded-card border border-border bg-surface-2 px-4 py-3 shadow-sm">
        <div className="mono mb-1.5 text-[11px] text-danger">invalid mermaid — showing source</div>
        <pre className="mono overflow-x-auto text-[12px] leading-5 text-content-muted">{code}</pre>
      </div>
    );
  }
  if (!svg) {
    return (
      <div className="mono my-3 flex items-center gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint shadow-sm">
        <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
        rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="my-3 overflow-x-auto rounded-card border border-border bg-surface-2 px-4 py-4 shadow-card [&>svg]:mx-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

"use client";

import { useEffect, useState } from "react";
import type { ConceptDetail } from "@/lib/db";

interface DetailPanelProps {
  conceptId: string | null;
  clusterName: string | null;
  onSelectConcept: (id: string) => void;
}

export function DetailPanel({ conceptId, clusterName, onSelectConcept }: DetailPanelProps) {
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conceptId) {
      return;
    }
    let alive = true;
    // Fetch-on-select: marking loading + clearing stale error before the
    // async call is the canonical pattern; the synchronous setState here is
    // intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/concepts/${encodeURIComponent(conceptId)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as ConceptDetail) : null))
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setLoading(false);
        if (!d) setError("Concept not found");
      })
      .catch(() => {
        if (!alive) return;
        setError("Could not load concept");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [conceptId]);

  if (!conceptId) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-ink-3">
        select a concept to see its description, provenance, and neighbors.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-ink-3">
        loading…
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-rule">
        {error ?? "Could not load concept"}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[3px] border border-line bg-paper-2 p-4">
      <div>
        <div className="text-[15px] text-ink">{detail.concept.label}</div>
        {clusterName && <div className="mono mt-0.5 text-[10px] text-ink-3">{clusterName}</div>}
      </div>
      <div className="mono text-[10px] text-ink-3">
        {detail.concept.sourceCount} source{detail.concept.sourceCount === 1 ? "" : "s"}
      </div>
      {detail.concept.description && (
        <p className="text-[12px] leading-relaxed text-ink-2">{detail.concept.description}</p>
      )}

      <div>
        <div className="mono mb-1 text-[10px] tracking-wide text-ink-3">PROVENANCE</div>
        {detail.sources.length === 0 ? (
          <div className="mono text-[10px] text-ink-3">none</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.sources.map((s, i) => (
              <li key={i} className="mono text-[10px] text-ink-2">
                <span className="text-ink">{s.title}</span>{" "}
                <span className="text-ink-3">· chunk {s.ordinal}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mono mb-1 text-[10px] tracking-wide text-ink-3">NEIGHBORS</div>
        {detail.neighbors.length === 0 ? (
          <div className="mono text-[10px] text-ink-3">none</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.neighbors.map((n, i) => (
              <li key={i}>
                <button
                  onClick={() => onSelectConcept(n.id)}
                  className="mono w-full truncate text-left text-[10px] text-ink-2 hover:text-ink"
                  title={`${n.relation} · ${n.confidence}`}
                >
                  <span className="text-ink-3">{n.direction === "out" ? "→" : "←"} </span>
                  <span className="text-ink">{n.label}</span>{" "}
                  <span className="text-ink-3">{n.relation}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
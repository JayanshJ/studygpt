"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ArrowLeft } from "lucide-react";
import type { ConceptDetail } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { useMotion, fadeUp } from "@/lib/motion";

interface DetailPanelProps {
  conceptId: string | null;
  clusterName: string | null;
  onSelectConcept: (id: string) => void;
}

export function DetailPanel({ conceptId, clusterName, onSelectConcept }: DetailPanelProps) {
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = useMotion();

  useEffect(() => {
    if (!conceptId) {
      return;
    }
    let alive = true;
    // Fetch-on-select: marking loading + clearing stale error before the
    // async call is the canonical pattern; the synchronous setState here is
    // intentional. The last-good `detail` is intentionally kept so the panel
    // can render a dimmed body during refetch / on fetch failure.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/concepts/${encodeURIComponent(conceptId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("not-found");
        return (await r.json()) as ConceptDetail;
      })
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoading(false);
        setError(err instanceof Error && err.message === "not-found" ? "Concept not found" : "Could not load concept");
      });
    return () => {
      alive = false;
    };
  }, [conceptId]);

  // Shared detail body JSX — reused by the normal, dimmed-error, and
  // dimmed-loading render paths so the markup exists once.
  const detailBody = detail ? (
    <motion.div {...m} variants={fadeUp}>
      <Card accent className="flex flex-col gap-3 p-4 pl-5">
        <div>
          <div className="text-[15px] text-ink">{detail.concept.label}</div>
          {clusterName && <div className="mono mt-0.5 text-[10px] text-content-faint">{clusterName}</div>}
        </div>
        <div className="mono text-[10px] text-content-faint">
          {detail.concept.sourceCount} source{detail.concept.sourceCount === 1 ? "" : "s"}
        </div>
        {detail.concept.description && (
          <p className="text-[12px] leading-relaxed text-content-muted">{detail.concept.description}</p>
        )}

        <div>
          <div className="mono mb-1 text-[10px] tracking-wide text-content-faint">PROVENANCE</div>
          {detail.sources.length === 0 ? (
            <div className="mono text-[10px] text-content-faint">none</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {detail.sources.map((s, i) => (
                <li key={i} className="mono text-[10px] text-content-muted">
                  <span className="text-ink">{s.title}</span>{" "}
                  <span className="text-content-faint">· chunk {s.ordinal}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mono mb-1 text-[10px] tracking-wide text-content-faint">NEIGHBORS</div>
          {detail.neighbors.length === 0 ? (
            <div className="mono text-[10px] text-content-faint">none</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {detail.neighbors.map((n, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSelectConcept(n.id)}
                    className="mono flex w-full items-center gap-1 truncate text-left text-[10px] text-content-muted hover:text-ink"
                    title={`${n.relation} · ${n.confidence}`}
                  >
                    {n.direction === "out" ? <ArrowRight size={10} className="shrink-0 text-content-faint" /> : <ArrowLeft size={10} className="shrink-0 text-content-faint" />}
                    <span className="truncate text-ink">{n.label}</span>
                    <span className="shrink-0 text-content-faint">{n.relation}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </motion.div>
  ) : null;

  if (!conceptId) {
    return (
      <Card className="p-4">
        <div className="mono text-[12px] text-content-faint">
          select a concept to see its description, provenance, and neighbors.
        </div>
      </Card>
    );
  }
  // Fetch failure with last-good state: show a small error line above the
  // dimmed prior detail body (spec: keeps last good state dimmed).
  if (error && detail) {
    return (
      <div className="flex flex-col gap-2">
        <div className="mono text-[10px] text-rule">{error}</div>
        <div className="opacity-40">{detailBody}</div>
      </div>
    );
  }
  // Fetch failure with no prior state: bare error block.
  if (error && !detail) {
    return (
      <Card className="p-4">
        <div className="mono text-[12px] text-rule">{error}</div>
      </Card>
    );
  }
  // Refetching with last-good state: dim the prior body + small loading line.
  if (loading && detail) {
    return (
      <div className="flex flex-col gap-2">
        <div className="mono text-[10px] text-content-faint">loading…</div>
        <div className="opacity-40">{detailBody}</div>
      </div>
    );
  }
  // First load with no prior state: standalone loading block.
  if (loading && !detail) {
    return (
      <Card className="p-4">
        <div className="mono text-[12px] text-content-faint">loading…</div>
      </Card>
    );
  }
  // Normal: freshly loaded detail body.
  return detailBody;
}
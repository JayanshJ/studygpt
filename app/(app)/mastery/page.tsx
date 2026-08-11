"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gem } from "lucide-react";
import type { Project } from "@/lib/db/schema";
import type { Band } from "@/lib/mastery/model";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";

type Row = {
  id: string;
  label: string;
  mastery: number | null;
  band: Band;
  reviewedCards: number;
  totalCards: number;
  lastReviewed: number | null;
};

function bandTone(band: Band): "slipping" | "strong" | "learning" | "untested" {
  if (band === "slipping") return "slipping";
  if (band === "strong") return "strong";
  if (band === "learning") return "learning";
  return "untested";
}

const NONE = "__none__";

export default function MasteryPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const m = useMotion();

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : []))
      .then((ps: Project[]) => setProjects(Array.isArray(ps) ? ps : []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("projectId");
    // One-shot read of an external system into state on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setProjectId(q);
  }, []);

  useEffect(() => {
    // Fetch-on-mount / on-projectId-change is the legitimate data-loading pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!projectId) { setRows(null); return; }
    setLoading(true);
    setLoadError(null);
    fetch(`/api/mastery?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { rows: Row[] }) => setRows(d.rows))
      .catch(() => setLoadError("Could not load mastery"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const counts = (rows ?? []).reduce(
    (a, r) => ({ ...a, [r.band]: a[r.band] + 1 }),
    { slipping: 0, learning: 0, strong: 0, untested: 0, unknown: 0 } as Record<Band, number>,
  );

  return (
    <div className="graph-paper h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 tab:px-6 tab:py-10">
        <motion.div {...m} variants={fadeUp} className="mb-5 flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <Gem size={16} className="text-feynman" />
          Mastery
        </motion.div>

        <motion.h1 {...m} variants={fadeUp} className="mb-6 font-serif text-[1.6rem] leading-tight text-ink">
          Mastery
        </motion.h1>

        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-border pb-4">
          <Select
            value={projectId ?? NONE}
            onValueChange={(v) => setProjectId(v === NONE ? null : v)}
          >
            <SelectTrigger aria-label="Project" className="w-[200px]">
              <SelectValue placeholder="choose a project…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>choose a project…</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rows && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="slipping">{counts.slipping} slipping</Badge>
              <Badge tone="learning">{counts.learning} learning</Badge>
              <Badge tone="strong">{counts.strong} strong</Badge>
            </div>
          )}
        </div>

        {!projectId ? (
          <p className="mono py-10 text-center text-[12px] text-content-faint">choose a project to view concept mastery</p>
        ) : loading ? (
          <p className="mono py-10 text-center text-[12px] text-content-faint">loading mastery…</p>
        ) : loadError ? (
          <p className="mono py-10 text-center text-[12px] text-danger">{loadError}</p>
        ) : !rows || rows.length === 0 ? (
          <div className="mono py-10 text-center text-[12px] text-content-faint">
            no concepts yet —{" "}
            <Link href="/projects" className="text-content-muted underline">build a concept graph first</Link>
          </div>
        ) : (
          <ul className="space-y-1 overflow-x-auto">
            {rows.map((r) => (
              <motion.li key={r.id} {...m} variants={fadeUp}>
                <Card className="mono flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                  <span className="min-w-0 truncate text-ink">{r.label}</span>
                  <span className="flex shrink-0 items-center gap-3 tabular-nums text-content-faint">
                    <Badge tone={bandTone(r.band)}>{r.band}</Badge>
                    <span className="hidden sm:inline">{r.reviewedCards}/{r.totalCards} cards</span>
                    {r.lastReviewed && <span className="hidden md:inline">last {new Date(r.lastReviewed).toLocaleDateString()}</span>}
                  </span>
                </Card>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
"use client";

import { Plus, Search, X } from "lucide-react";
import { motion, LayoutGroup } from "motion/react";
import type { Conversation, Project } from "@/lib/db/schema";
import { groupConversationsByRecency } from "@/lib/chat/conversation-groups";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { useLayoutMotion } from "@/lib/motion";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  projects: Project[];
  activeProjectId: string | null;
  onProjectChange: (id: string | null) => void;
  // True until the first conversations fetch resolves. While true AND the list
  // is empty, show skeleton rows instead of "no conversations yet".
  loading?: boolean;
}

// The chat surface's conversation content: project scope, search,
// new-conversation, and the conversation list. Renders as pure content (no
// outer chrome / width / header) so it fills whatever container hosts it — the
// global Sidebar's slot on desktop (portaled in by the chat page) or the mobile
// slide-in sheet. Nav + theme live in the Sidebar, not here.
export function ConversationListPane({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  query,
  onQueryChange,
  projects,
  activeProjectId,
  onProjectChange,
  loading = false,
}: Props) {
  const layoutTransition = useLayoutMotion();
  const scoped = activeProjectId
    ? conversations.filter((c) => c.project_id === activeProjectId)
    : conversations.filter((c) => !c.project_id);
  const q = query.trim().toLowerCase();
  const filtered = q ? scoped.filter((c) => c.title.toLowerCase().includes(q)) : scoped;
  // Claude-style recency headers only for the unfiltered browse view; while
  // searching, results render flat so the query output reads as one list.
  const groups = q ? null : groupConversationsByRecency(filtered);

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <div className="px-3 pb-2 pt-1">
        <Button variant="primary" size="sm" className="w-full justify-center" onClick={onNew}>
          <Plus size={14} strokeWidth={2} />
          new conversation
        </Button>
      </div>

      <div className="px-3 pb-1">
        <ProjectSwitcher
          projects={projects}
          activeProjectId={activeProjectId}
          onChange={onProjectChange}
        />
      </div>

      {/* Ghost search row — no box, sits like a nav item (Claude's search). */}
      <label className="mx-3 mb-3 flex h-9 cursor-text items-center gap-2 rounded-control px-3 text-content-faint transition-colors duration-fast ease-out hover:bg-ink/[0.04] focus-within:bg-ink/[0.06]">
        <Search size={14} strokeWidth={1.75} className="shrink-0" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="search"
          className="w-full bg-transparent text-[13px] text-content outline-none placeholder:text-content-faint"
        />
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
        <div className="flex w-full flex-col gap-0.5">
          {/* LayoutGroup gives Motion a stable layout-tracking context for the
             animated conversation rows even though this list is rendered
             through a React portal (the chat page portals this pane into the
             global Sidebar). Without it, Motion's layout measurement crosses
             the portal boundary and React emits a spurious "unique key"
             warning for the keyed motion.div children. */}
          <LayoutGroup id="conversation-list">
          {loading && scoped.length === 0 && (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2 rounded-control px-3 py-2.5">
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-3 w-4" />
                </div>
              ))}
            </>
          )}
          {!loading && filtered.length === 0 && (
            <p className="mono px-3 py-4 text-[11px] text-content-faint">
              {scoped.length === 0
                ? activeProjectId
                  ? "no conversations in this project"
                  : "no conversations yet"
                : "no matches"}
            </p>
          )}
          {(groups ?? [{ label: "", items: filtered }]).map((group, gi) => (
            <div key={group.label || `results-${gi}`}>
              {group.label && (
                <p className="mono px-3 pb-1 pt-3 text-[10px] uppercase tracking-[0.14em] text-content-faint">
                  {group.label}
                </p>
              )}
              {group.items.map((c) => {
                const active = c.id === activeId;
                return (
                  <motion.div
                    key={c.id}
                    layout="position"
                    transition={layoutTransition}
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      "group relative flex h-10 w-full cursor-pointer items-center overflow-hidden rounded-control px-3 text-[13px] transition-colors duration-fast ease-out",
                      active ? "bg-ink/[0.06]" : "hover:bg-ink/[0.04]",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate leading-snug text-ink">{c.title}</span>
                    {c.mode === "feynman" && (
                      <Badge tone="feynman" className="shrink-0 px-1 py-0 text-[9px]">
                        F
                      </Badge>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                      aria-label="Delete conversation"
                      className="shrink-0 rounded-control p-1 text-content-faint opacity-0 transition-opacity duration-fast ease-out hover:text-rule focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </motion.div>
                );
              })}
            </div>
          ))}
          </LayoutGroup>
        </div>
      </div>
    </div>
  );
}

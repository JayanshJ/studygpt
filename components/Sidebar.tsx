"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Conversation, Project } from "@/lib/db/schema";
import { ThemeToggle } from "./ThemeToggle";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { Skeleton } from "./Skeleton";

// Primary nav destinations, promoted from the old row of tiny inline glyphs to
// labeled tiles (expanded) / icon buttons (collapsed rail). Glyphs are the same
// monochrome marks; labels make them discoverable and the bigger hit area makes
// them accessible.
const NAV = [
  { href: "/decks", glyph: "▤", label: "decks" },
  { href: "/review", glyph: "⟳", label: "review" },
  { href: "/mastery", glyph: "◆", label: "mastery" },
  { href: "/settings", glyph: "⚙", label: "settings" },
] as const;

const COLLAPSE_KEY = "studygpt.sidebar.collapsed";

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
  // is empty, show skeleton rows instead of "no conversations yet" — otherwise
  // every load briefly looks like an empty account.
  loading?: boolean;
  // Desktop sidebar collapses to an icon rail; the mobile overlay passes false
  // so it is always full-width regardless of the persisted collapse state.
  collapsible?: boolean;
}

export function Sidebar({
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
  collapsible = true,
}: Props) {
  // Persisted collapse state. SSR-safe: defaults to expanded on first render
  // (matches the server render), then reconciles from localStorage in an effect
  // so there is no hydration mismatch (at most a one-frame width settle).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // One-shot read of the persisted collapse pref on mount — the legitimate
    // external-store pattern (cf. ThemeToggle).
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      // storage unavailable (private mode) — non-fatal, stay expanded
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed]);

  const isRail = collapsible && collapsed;

  const scoped = activeProjectId
    ? conversations.filter((c) => c.project_id === activeProjectId)
    : conversations.filter((c) => !c.project_id);
  const q = query.trim().toLowerCase();
  const filtered = q ? scoped.filter((c) => c.title.toLowerCase().includes(q)) : scoped;

  return (
    <aside
      className={`margin-rule flex h-full shrink-0 flex-col bg-paper-3 transition-[width] duration-200 ${
        isRail ? "w-16" : "w-64"
      }`}
    >
      {isRail ? (
        <header className="flex flex-col items-center gap-3 py-3.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rule" />
          <button
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="mono text-[15px] leading-none text-ink-3 transition-colors hover:text-ink"
          >
            »
          </button>
          <ThemeToggle />
        </header>
      ) : (
        <header className="flex items-center justify-between px-4 py-3.5">
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-rule" />
            StudyGPT
          </span>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {collapsible && (
              <button
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="mono text-[15px] leading-none text-ink-3 transition-colors hover:text-ink"
              >
                «
              </button>
            )}
          </div>
        </header>
      )}

      {/* Primary nav: labeled 2×2 tiles when expanded, icon stack when collapsed. */}
      {isRail ? (
        <div className="flex flex-col items-center gap-1.5 px-2 pb-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-label={n.label}
              title={n.label}
              className="mono flex h-9 w-9 items-center justify-center rounded-[3px] border border-line bg-paper-2 text-[18px] leading-none text-ink-2 transition-colors hover:border-ink/40 hover:text-ink"
            >
              {n.glyph}
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5 px-3 pb-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-label={n.label}
              title={n.label}
              className="flex flex-col items-center gap-0.5 rounded-[3px] border border-line bg-paper-2 px-1 py-2 transition-colors hover:border-ink/40"
            >
              <span className="mono text-[18px] leading-none text-ink-2">{n.glyph}</span>
              <span className="mono text-[10px] tracking-wide text-ink-3">{n.label}</span>
            </Link>
          ))}
        </div>
      )}

      {!isRail && (
        <ProjectSwitcher
          projects={projects}
          activeProjectId={activeProjectId}
          onChange={onProjectChange}
        />
      )}

      <div className="px-3 pb-2">
        {isRail ? (
          <button
            onClick={onNew}
            aria-label="New conversation"
            title="New conversation"
            className="mono flex h-9 w-9 items-center justify-center rounded-[3px] border border-line bg-paper-2 text-[16px] leading-none text-ink transition-colors hover:border-ink/40"
          >
            +
          </button>
        ) : (
          <button
            onClick={onNew}
            className="mono w-full rounded-[3px] border border-line bg-paper-2 px-3 py-2 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
          >
            + new conversation
          </button>
        )}
      </div>

      {!isRail && (
        <div className="px-3 pb-1">
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="search"
            className="mono w-full rounded-[3px] border border-line bg-paper-2 px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink/40"
          />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {isRail ? (
          // Collapsed: each conversation is a dot; the active one is the rule
          // accent. Keeps the list scannable + the active conversation visible
          // without titles.
          filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              aria-label={c.title}
              title={c.title}
              className="flex h-6 w-full items-center justify-center"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  c.id === activeId ? "bg-rule" : "bg-ink-3/50"
                }`}
              />
            </button>
          ))
        ) : (
          <>
            {loading && scoped.length === 0 && (
              <div className="px-1 pt-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-2">
                    <Skeleton className="h-3.5 flex-1" />
                    <Skeleton className="h-3 w-4" />
                  </div>
                ))}
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <p className="mono px-2 py-4 text-[11px] text-ink-3">
                {scoped.length === 0
                  ? activeProjectId
                    ? "no conversations in this project"
                    : "no conversations yet"
                  : "no matches"}
              </p>
            )}
            {filtered.map((c) => {
              const active = c.id === activeId;
              return (
                <div
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className={`group relative cursor-pointer rounded-[3px] px-3 py-2 text-[14px] transition-colors ${
                    active ? "bg-paper-2" : "hover:bg-paper-2/60"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-rule" />
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="flex-1 truncate leading-snug text-ink">{c.title}</span>
                    {c.mode === "feynman" && (
                      <span className="mono rounded-[2px] bg-feynman/10 px-1 py-px text-[9px] font-medium text-feynman">
                        F
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(c.id);
                      }}
                      aria-label="Delete conversation"
                      className="mono opacity-0 transition-opacity group-hover:opacity-100 hover:text-rule"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
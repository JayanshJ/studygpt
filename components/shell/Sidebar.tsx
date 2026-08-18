"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV, isNavActive } from "./nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { IconButton } from "@/components/ui/IconButton";
import { useSidebarSlot } from "./sidebar-slot";
import { cn } from "@/lib/cn";
import { useLayoutMotion } from "@/lib/motion";

// The app's single desktop sidebar (≥ `tab`). Replaces the old icon Rail: nav
// items are labeled, and the flex-1 slot below the nav receives page-injected
// content — the chat home portals its conversation list here, so the chat
// surface gets nav + project + search + conversations in ONE column instead of
// the previous rail + separate pane. Other surfaces render nothing into the
// slot (nav + theme only). Collapsible to an icon rail via the bottom toggle
// (persisted). Hidden below `tab`, where the BottomTabBar + the chat page's
// slide-in conversation sheet take over.
export function Sidebar() {
  const pathname = usePathname();
  const { slotRef } = useSidebarSlot();
  const layoutTransition = useLayoutMotion();
  // Collapsed = icon rail (w-14, labels + slot hidden). Default expanded; read
  // in an effect (SSR-safe — avoids a hydration mismatch on the persisted value).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem("studygpt.sidebar.collapsed") === "1");
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("studygpt.sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* ignore storage failures */
      }
      return next;
    });
  }, []);

  return (
    <aside
      className={cn(
        // Flush to the window's left edge, transparent so the macOS vibrancy
        // material (set on the BrowserWindow) shows through — the sidebar
        // reads as a native translucent pane, not a bordered card. pt-10
        // clears the traffic-light buttons. No border/shadow/rounding: native
        // sidebars are part of the window surface, separated from content by
        // the content panel's left border (in AppShell), not their own.
        "hidden shrink-0 flex-col bg-transparent pt-10 pb-3 transition-[width] duration-fast ease-out tab:flex",
        collapsed ? "w-14" : "w-64",
      )}
    >
      <nav
        aria-label="Primary"
        className={cn("flex flex-col gap-0.5", collapsed ? "items-center px-0" : "px-3")}
      >
        {NAV.map((item, i) => {
          const active = isNavActive(pathname, item);
          const Icon = item.icon;
          // Insert a "Library" section header before the first secondary item,
          // so the study surfaces (Decks, Map, Projects) group under it while
          // Chat and Settings stay primary. Collapsed mode hides the label
          // (there's no room) and shows a thin divider instead.
          const showLibraryHeader =
            !collapsed && item.secondary && !NAV[i - 1]?.secondary;
          return (
            <Fragment key={item.href}>
              {showLibraryHeader && (
                <div className="pointer-events-none flex items-center gap-2 px-2.5 pb-0.5 pt-3">
                  <span className="mono text-[10px] uppercase tracking-[0.16em] text-content-faint">
                    Library
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
              )}
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "relative inline-flex items-center rounded-control text-[13px] transition-[transform,background-color,color] duration-fast ease-out hover:-translate-y-px outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
                  collapsed
                    ? "h-9 w-9 justify-center"
                    : "gap-2.5 px-2.5 py-1.5",
                  active
                    ? "text-ink"
                    : item.secondary
                      ? "text-content-faint hover:bg-surface hover:text-content-muted"
                      : "text-content-faint hover:bg-surface hover:text-content",
                )}
              >
                {active && (
                  <motion.span
                    aria-hidden
                    layoutId="active-sidebar-indicator"
                    transition={layoutTransition}
                    className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-rule"
                  />
                )}
                <Icon size={16} strokeWidth={1.75} />
                {!collapsed && item.label}
              </Link>
            </Fragment>
          );
        })}
      </nav>

      {/* Page-injected content (the chat home's conversation list). Hidden
          when collapsed — the portaled pane stays in the DOM but the slot is
          display:none, so it's simply not shown until the sidebar expands. */}
      <div ref={slotRef} className={cn("min-h-0", collapsed ? "hidden" : "flex-1")} />

      <div
        className={cn(
          "flex items-center gap-2 py-3",
          collapsed ? "flex-col px-0" : "flex-row px-3",
        )}
      >
        <IconButton
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggle}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.75} />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.75} />
          )}
        </IconButton>
        <ThemeToggle />
      </div>
    </aside>
  );
}

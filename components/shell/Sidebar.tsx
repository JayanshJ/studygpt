"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isNavActive } from "./nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSidebarSlot } from "./sidebar-slot";
import { cn } from "@/lib/cn";

// The app's single desktop sidebar (≥ `tab`). Replaces the old icon Rail: nav
// items are labeled, and the flex-1 slot below the nav receives page-injected
// content — the chat home portals its conversation list here, so the chat
// surface gets nav + project + search + conversations in ONE column instead of
// the previous rail + separate pane. Other surfaces render nothing into the
// slot (nav + theme only). Hidden below `tab`, where the BottomTabBar + the
// chat page's slide-in conversation sheet take over.
export function Sidebar() {
  const pathname = usePathname();
  const { slotRef } = useSidebarSlot();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface-2 tab:flex">
      <nav className="flex flex-col gap-0.5 px-3 py-3" aria-label="Primary">
        {NAV.map((item) => {
          const active = isNavActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-[13px] transition-colors duration-fast ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
                active
                  ? "text-ink"
                  : "text-content-faint hover:bg-surface hover:text-content",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute -left-3 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-[2px] bg-rule"
                />
              )}
              <Icon size={16} strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div ref={slotRef} className="min-h-0 flex-1" />
      <div className="flex items-center px-3 py-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
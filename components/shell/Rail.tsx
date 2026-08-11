"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isNavActive } from "./nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/cn";

// Desktop navigation rail — a persistent 56px icon column on every app surface.
// Hidden below the `tab` breakpoint (768px), where the BottomTabBar takes over.
export function Rail() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-2 py-3 tab:flex">
      <nav className="flex flex-1 flex-col items-center gap-1">
        {NAV.map((item) => {
          const active = isNavActive(pathname, item);
          const Icon = item.icon;
          const link = (
            <Link
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center rounded-[3px] transition-colors duration-fast ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2",
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
              <Icon size={18} strokeWidth={1.75} />
            </Link>
          );
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <div className="flex flex-col items-center gap-1">
        <ThemeToggle />
      </div>
    </aside>
  );
}
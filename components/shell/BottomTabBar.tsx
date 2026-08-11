"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, isNavActive } from "./nav";
import { cn } from "@/lib/cn";

// Mobile navigation — a fixed bottom tab bar shown only below the `tab`
// breakpoint (the desktop Rail is hidden there). Safe-area padding keeps it
// clear of the home indicator on notched devices.
export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface-2 pb-[env(safe-area-inset-bottom)] tab:hidden"
    >
      {NAV.map((item) => {
        const active = isNavActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors duration-fast ease-out",
              active ? "text-ink" : "text-content-faint",
            )}
          >
            <span className="relative inline-flex h-6 w-6 items-center justify-center">
              {active && (
                <span
                  aria-hidden
                  className="absolute -top-2 h-[2px] w-5 rounded-[2px] bg-rule"
                />
              )}
              <Icon size={19} strokeWidth={1.75} />
            </span>
            <span className="mono text-[9px] tracking-wide">{item.label.toLowerCase()}</span>
          </Link>
        );
      })}
    </nav>
  );
}
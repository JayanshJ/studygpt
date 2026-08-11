"use client";

import { TooltipProvider } from "@/components/ui/Tooltip";
import { Toaster } from "@/components/ui/Toaster";
import { Rail } from "./Rail";
import { BottomTabBar } from "./BottomTabBar";

// The shared app shell wrapping every surface except /print/[id] (which keeps a
// clean, chrome-free print layout). Rail on desktop, bottom tab bar on mobile,
// a single Toaster mounted for all surfaces, and a TooltipProvider so every
// IconButton tooltip across the app resolves.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink">
      <TooltipProvider delayDuration={200} skipDelayDuration={300}>
        <Rail />
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
        <BottomTabBar />
        <Toaster />
      </TooltipProvider>
    </div>
  );
}
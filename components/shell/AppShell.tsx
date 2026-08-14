"use client";

import { TooltipProvider } from "@/components/ui/Tooltip";
import { Toaster } from "@/components/ui/Toaster";
import { Sidebar } from "./Sidebar";
import { BottomTabBar } from "./BottomTabBar";
import { SidebarSlotProvider } from "./sidebar-slot";

// The shared app shell wrapping every surface except /print/[id] (which keeps a
// clean, chrome-free print layout). One labeled sidebar (desktop) / bottom tab
// bar (mobile), a single Toaster for all surfaces, and a TooltipProvider so
// every IconButton tooltip resolves. The SidebarSlotProvider lets the chat home
// portal its conversation list into the sidebar so there's a single left column
// instead of a nav rail + a separate conversation pane.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] w-full gap-0 overflow-hidden bg-paper-2 p-0 text-ink tab:p-3">
      <SidebarSlotProvider>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          <Sidebar />
          {/* min-h-0: the content column is a stretched flex item of the
              h-screen row; without it, min-height:auto lets a tall page (e.g.
              the chat transcript) grow the column past 100vh so the page's own
              overflow-y-auto never engages and the outer overflow-hidden clips
              the spill — the page reads as "unscrollable". min-h-0 makes the
              100vh stretch a hard bound so the page scrolls internally. */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-paper tab:ml-3 tab:rounded-panel tab:shadow-card">{children}</div>
          <BottomTabBar />
          <Toaster />
        </TooltipProvider>
      </SidebarSlotProvider>
    </div>
  );
}

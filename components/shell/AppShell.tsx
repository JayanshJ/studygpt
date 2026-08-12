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
    <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink">
      <SidebarSlotProvider>
        <TooltipProvider delayDuration={200} skipDelayDuration={300}>
          <Sidebar />
          <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
          <BottomTabBar />
          <Toaster />
        </TooltipProvider>
      </SidebarSlotProvider>
    </div>
  );
}
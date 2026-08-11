"use client";

import { AppShell } from "@/components/shell/AppShell";

// App Shell layout — wraps every surface except /print/[id]. Introduced as the
// app's first nested layout (the single root layout stays at app/layout.tsx, so
// navigating to /print stays a normal nested-layout nav, not a full reload).
// The rail + bottom tab bar + toaster live in components/shell/AppShell.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
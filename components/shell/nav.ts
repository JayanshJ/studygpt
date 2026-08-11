import {
  MessageSquare,
  Layers,
  RotateCw,
  Gem,
  Share2,
  FolderKanban,
  Settings,
  type LucideIcon,
} from "lucide-react";

// Single source of truth for app navigation. Shared by the desktop Rail and the
// mobile BottomTabBar. Chat is included here (it was not in the old Sidebar NAV
// because chat was the home — now the rail is global, so every surface is one
// tap away).
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Match strategy: "exact" (only `/`) or "prefix" (path === href || starts with href + "/").
  match: "exact" | "prefix";
}

export const NAV: NavItem[] = [
  { href: "/", label: "Chat", icon: MessageSquare, match: "exact" },
  { href: "/decks", label: "Decks", icon: Layers, match: "prefix" },
  { href: "/review", label: "Review", icon: RotateCw, match: "prefix" },
  { href: "/mastery", label: "Mastery", icon: Gem, match: "prefix" },
  { href: "/graph", label: "Graph", icon: Share2, match: "prefix" },
  { href: "/projects", label: "Projects", icon: FolderKanban, match: "prefix" },
  { href: "/settings", label: "Settings", icon: Settings, match: "prefix" },
];

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
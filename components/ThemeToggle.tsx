"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

// Single glyph toggle. The no-flash script in layout.tsx sets
// <html data-theme> before paint; this component reconciles from the
// settings DB on mount and flips it on click, mirroring to localStorage
// (no-flash on reload) and the settings DB (cross-session source).
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current);
    setMounted(true);
    // Reconcile with the DB (authoritative) in case it changed elsewhere.
    fetch("/api/settings")
      .then((r) => r.json())
      .then((c: { raw?: { theme?: string } }) => {
        const db = c.raw?.theme === "dark" ? "dark" : "light";
        if (db !== current) applyTheme(db);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTheme(t: Theme) {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("studygpt-theme", t);
    } catch {
      // storage unavailable (private mode) — non-fatal
    }
    setTheme(t);
  }

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  }

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="mono text-[14px] leading-none text-ink-3 transition-colors hover:text-ink"
    >
      {/* Render a stable glyph until mounted to avoid a hydration mismatch; */}
      {/* the no-flash script has already set the correct page theme. */}
      {mounted ? (theme === "dark" ? "☾" : "☀") : "☀"}
    </button>
  );
}
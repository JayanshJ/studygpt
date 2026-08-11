# Minimal Orange Redesign — Design Spec

**Date:** 2026-08-12
**Status:** Draft, awaiting user review
**Scope:** Full visual redesign of the StudyGPT Next.js app — new token palette + chat-surface layout change, applied across every screen.

---

## Context

The app today uses the "Graph Paper Lab / Studio Notebook" design system: aged-paper background, warm ink, a red notebook-margin rule as the signature accent, a faint graph-paper grid, serif reading type. The user wants to leave this warm-paper look entirely for something **minimal and polished**: clean neutral surfaces (white in light, near-black in dark — no cream, no brown), a single **orange** accent in both modes, and a chat surface that is **not** left/right chat bubbles but a **reading transcript** (full-width serif prose; each user prompt sits as a small italic mono query-line above the answer; a hairline divides turns).

This spec defines the new token system, the transcript chat layout, and the per-surface application across the shell, UI primitives, graph, and all screens. It preserves the existing theme-switching mechanism, font stack, and motion vocabulary. The token *names* are kept stable (so the restyle is mostly value swaps); semantics that changed (errors, processing, mastery bands) are re-pointed with explicit class edits.

**Non-goals:** no new features, no information-architecture changes, no font changes, no motion-system rewrite, no change to the theme-switching mechanism or persistence. The graph layout algorithm, chat streaming protocol, and all data/API behavior are untouched.

---

## Design language

- **Light:** clean white page (`#ffffff`), faintly off-white raised surfaces, near-black neutral ink.
- **Dark:** near-black page (`#0b0b0c`), dark-gray raised surfaces, warm-neutral off-white ink. Never pure `#000`; never cold blue-gray.
- **Accent:** one orange — `#f97316` (light) / `#ff7a3d` (dark). Used sparingly: active nav indicator, brand dot, you-are-here marker, ready status, the user query-line rule, the send button, accent/links in prose, focus rings on inputs. Never as a flood color.
- **Status (mastery/graph):** a muted, desaturated set — emerald (mastered/strong), amber (learning/in-progress), rose (slipping), neutral gray (untested/unknown). Quiet, never loud; distinct from the orange accent.
- **Errors/danger:** muted rose (same rose as slipping).
- **Surfaces:** soft layered shadows, 3px-ish radii, hairline borders. No graph-paper grid (removed for minimal). No red margin rule.

---

## Token system

Architecture is unchanged: raw core tokens in `:root`, dark overrides in `html[data-theme="dark"]`, semantic aliases reference the core, `@theme inline` exposes Tailwind utilities. Only **values** change (plus two new core tokens `--amber` / `--rose` and one new semantic alias `--danger`).

### Core raw tokens

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--paper` | `#ffffff` | `#0b0b0c` | page background |
| `--paper-2` | `#f6f6f7` | `#161618` | raised surface (cards, composer) |
| `--paper-3` | `#ececef` | `#1f1f22` | recessed surface (rail, tabs track) |
| `--ink` | `#18181b` | `#e6e6ea` | primary text |
| `--ink-2` | `#52525b` | `#9a9aa2` | secondary text |
| `--ink-3` | `#8a8a93` | `#6a6a72` | faint/caption text |
| `--rule` | `#f97316` | `#ff7a3d` | **orange accent** |
| `--feynman` | `#0f9d76` | `#34c896` | **muted emerald** — mastered/strong/complete |
| `--amber` *(new)* | `#c08a00` | `#d9a441` | muted amber — learning/in-progress |
| `--rose` *(new)* | `#c0445a` | `#e06a7c` | muted rose — slipping / danger |
| `--line` | `#e6e6e9` | `#262629` | hairlines |
| `--grid` | `transparent` | `transparent` | grid removed |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06)` | `0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.5)` | neutral (not warm) |

### Semantic aliases

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--surface` | `var(--paper-2)` | `var(--paper-2)` | unchanged structure |
| `--surface-2` | `var(--paper-3)` | `var(--paper-3)` | |
| `--border` | `var(--line)` | `var(--line)` | |
| `--border-strong` | `color-mix(in oklab, var(--ink) 16%, var(--line))` | `color-mix(in oklab, var(--ink) 20%, var(--line))` | slightly stronger in dark |
| `--ring` | `var(--ink)` | `var(--ink)` | button focus |
| `--ring-accent` | `var(--rule)` | `var(--rule)` | input focus (orange) |
| `--content` | `var(--ink)` | `var(--ink)` | |
| `--content-muted` | `var(--ink-2)` | `var(--ink-2)` | |
| `--content-faint` | `var(--ink-3)` | `var(--ink-3)` | |
| `--accent` | `var(--rule)` | `var(--rule)` | orange |
| `--accent-2` | `var(--feynman)` | `var(--feynman)` | emerald, used sparingly |
| `--danger` *(new)* | `var(--rose)` | `var(--rose)` | errors/danger |
| `--band-strong` | `var(--feynman)` | `var(--feynman)` | mastered = emerald |
| `--band-learning` | `var(--amber)` | `var(--amber)` | learning = amber |
| `--band-slipping` | `var(--rose)` | `var(--rose)` | slipping = rose |
| `--band-untested` | `var(--ink-3)` | `var(--ink-3)` | gray |
| `--band-unknown` | `var(--ink-3)` | `var(--ink-3)` | gray |

### Tailwind `@theme inline` additions

Add `--color-amber`, `--color-rose`, `--color-danger` alongside the existing `--color-*` entries so `bg-amber` / `text-rose` / `bg-danger` / `text-danger` utilities exist. All existing utility names (`bg-paper`, `bg-surface`, `text-content-muted`, `bg-band-*`, `text-feynman`, `bg-rule`, etc.) keep working — only their resolved values change.

---

## Theme switching (unchanged)

- `data-theme="light|dark"` attribute on `<html>`, set by the no-flash inline script in `app/ThemeScript.tsx`.
- Dual persistence: `localStorage["studygpt-theme"]` + `/api/settings` DB (`{raw:{theme}}`).
- `components/ThemeToggle.tsx` reconciles DB ↔ live. **No change.**

---

## Typography (unchanged fonts, same roles)

- **Inter** (`--font-sans`) — UI chrome, body default.
- **Newsreader** (`--font-serif`) — reading: assistant prose (`.prose-chat`), card/dialog titles, page h1s.
- **JetBrains Mono** (`--font-mono` / `.mono`) — chrome labels, timestamps, the user **query-line**, status lines.

Loaded via `next/font/google` in `app/layout.tsx`; mapped in `@theme inline`. No change.

---

## Motion (unchanged vocabulary, kept subtle)

Keep `lib/motion.ts` (`fadeUp`, `fadeIn`, `stagger`, `cardFlip`, `streamingCursor`, `useMotion` with reduced-motion guard). Per-turn enter stays a gentle `fadeUp`. Streaming indicator stays a `animate-pulse` orange caret. No new motion.

---

## Chat surface — reading transcript

Replaces the left/right bubble layout. The change is concentrated in `components/ChatMessage.tsx`, the message list in `app/(app)/page.tsx`, and `components/ChatInput.tsx` (send button color). Inner content components (`Markdown`, `CodeBlock`, `Artifact`, `SourcesPanel`, `FlashcardDeck`) carry no bubble alignment and only need light re-skin / separator cleanup.

### Message list (`app/(app)/page.tsx:743`)

- Container: `mx-auto flex w-full max-w-[680px] flex-col` (narrower reading measure; was `max-w-3xl gap-5`).
- Turn divider: replace `gap-5` with per-turn top padding + hairline. Each `ChatMessage` after the first gets `border-t border-border pt-6 mt-6`; the first has `pt-2` only. (Equivalently a `<div className="my-6 border-t border-border" />` between turns — implementer's choice, single rule: a hairline separates every turn.)
- The scroll container `graph-paper flex-1 overflow-y-auto` stays (the `.graph-paper` grid is now a no-op via `--grid: transparent`).

### `components/ChatMessage.tsx`

Remove all role-based alignment and bubble chrome. Both roles render full-width, no `max-w-*` cap, no `bg-surface`/`bg-surface-2`/`border`/`shadow-card` card frame, no `justify-end`/`justify-start`.

**User message** — a small italic mono query-line + plain text, no card:
```
<motion.div {...m} variants={fadeUp} className="group">
  <div className="border-l-2 border-rule pl-3 font-mono italic text-[13px] leading-relaxed text-content">
    {content}
  </div>
  {/* hover-only: edit affordance, right-aligned, faint */}
  {onEdit && <IconButton ... className="opacity-0 group-hover:opacity-100 ...">…</IconButton>}
</motion.div>
```
- The orange left rule + italic mono signals "your turn" — no "you" label, no token count on display (keep it on the assistant side only).
- Attachments (images/files) render below the query-line, inline, faint chips — no card.
- Edit mode: replace the right-aligned edit card with an inline `<textarea>` in the same query-line measure (full width, mono), save/cancel row below; no bubble.

**Assistant message** — full-width serif prose, no card:
```
<motion.div {...m} variants={fadeUp} className="group">
  {/* status line only while streaming/working */}
  {status && <div className="mono mb-2 flex items-center gap-1.5 text-[11px] text-content-faint">
    <span className="h-1.5 w-1.5 rounded-full bg-rule animate-pulse" /> {STATUS_LABELS[status] ?? status}
  </div>}
  {reasoning && <details className="mb-3 rounded-[3px] border border-border bg-surface-2/50 px-3 py-2">
    <summary className="mono text-[11px] text-content-faint">thinking</summary>
    <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-content-muted" />
  </details>}
  <Markdown content={content} className="prose-chat text-ink" streaming={streaming} …/>
  {streaming && <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />}
  {/* hover-only toolbar, top-right absolute: copy + regenerate */}
  {!streaming && <div className="absolute right-0 top-0 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">…copy/regen…</div>}
  {!streaming && <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />}
</motion.div>
```
- The `prose-chat` block already provides serif 1rem/1.8 typography; the orange accent flows in via its existing `border-left` blockquote rule and link color (now orange).
- The old mono "• studygpt · N tok" header is **removed**. Copy/regenerate move to a hover-only top-right toolbar. Token count can live as a faint mono caption at the bottom of the turn if desired — optional; default: drop it.
- The thinking/reading status dot becomes orange (`bg-rule`), not feynman — it's the "actively working" signal.
- Assistant **document** variant: same structure, slightly wider measure (keep `max-w-[680px]` for consistency), keep the "download PDF" Button at the bottom. No card.

### `components/SourcesPanel.tsx`

- Keep, but drop its own top `border-t border-border` (the turn hairline now separates turns; a second border double-lines). Use spacing + a faint label instead: a `mono text-[10px] tracking-wide text-content-faint` header "N sources" with a small emerald dot (`bg-feynman`), then the citation list.
- Citation entries: `rounded-[3px] bg-surface-2/60 px-2.5 py-2`, mono title in `text-content-muted` (was `text-feynman` — citations don't need the emerald; keep neutral), `text-[12px] line-clamp-3` snippet, concept `Badge`s (which now auto-render emerald/amber/rose/gray via band tokens).

### `components/ChatInput.tsx`

- Structure unchanged (toolbar + auto-grow textarea + send/stop). Restyle is token-driven (`bg-surface`, `border-border`, `focus-within:border-border-strong focus-within:shadow-card` — already correct, auto-recolored).
- **Send button → orange.** Currently `variant="primary"` (`bg-ink`). Change the send button to `variant="accent"` (new — see UI primitives) so it renders `bg-rule text-white`. The stop button stays `variant="secondary"` tinted with `border-rule text-rule` (orange stop).
- Container measure matches the transcript: `max-w-[680px]` (was `max-w-3xl`).

---

## App shell (`components/shell/`)

All token-driven; the orange accent automatically replaces the old red on every active indicator.

- **`AppShell.tsx`** — `bg-paper text-ink` → white/near-black (auto).
- **`Rail.tsx`** — `bg-surface-2 border-r border-border`; active indicator `bg-rule` → **orange** (auto); active icon `text-ink`, inactive `text-content-faint hover:bg-surface hover:text-content` (auto). Tooltip `bg-surface-2` (auto).
- **`BottomTabBar.tsx`** — `border-t bg-surface-2`; active indicator `bg-rule` → orange (auto); active label `text-ink`.
- **`ConversationListPane.tsx`** — brand dot `bg-rule` → orange (auto); active row `bg-surface shadow-card`; active rail `bg-rule` → orange (auto); delete hover `hover:bg-rule/10 hover:text-rule` → orange-tinted (auto). Feynman badge `<Badge tone="feynman">` → emerald (auto, via `--feynman`).
- **`nav.ts`** — no change (pure data).

No structural changes; the orange flows through the existing `bg-rule` / `text-rule` classes.

---

## UI primitives (`components/ui/`)

Most auto-recolor via tokens. Three intentional edits:

- **`Button.tsx`** —
  - `accent` variant (new or repurpose the existing accent slot): `bg-rule text-white hover:opacity-90 active:opacity-100 focus-visible:ring-ring-accent`. **Text is `text-white`, not `text-paper-2`** (the old `text-paper-2` is dark in dark-mode and fails on a bright orange button).
  - `danger` variant: change `bg-rule …` → `bg-danger text-white … focus-visible:ring-ring`. Rose, not orange.
  - `primary` variant stays `bg-ink text-paper-2` (inverted ink button — still works in both modes).
- **`Badge.tsx`** — band tones (`strong`/`learning`/`slipping`/`untested`) auto-render emerald/amber/rose/gray via `--band-*`; `accent` tone → orange; `feynman` tone → emerald. No code change.
- **`Switch.tsx`** — `data-[state=checked]:bg-rule` → orange checked (auto). Thumb `bg-paper-2` (auto).
- **`Input.tsx` / `Textarea.tsx` / `Select.tsx`** — `focus-visible:ring-ring-accent/60` → orange focus ring (auto). `bg-surface` (auto).
- **`Card.tsx`** — `border-border bg-surface shadow-card` (auto). The `accent` prop's left rule `bg-rule` → orange (auto). `CardTitle` `font-serif text-ink` (auto).
- **`Dialog.tsx`** / **`DropdownMenu.tsx`** / **`Tooltip.tsx`** / **`Tabs.tsx`** / **`Toaster.tsx`** / **`Skeleton.tsx`** / **`ScrollArea.tsx`** / **`IconButton.tsx`** — all token-driven, auto-recolored. No code change.

---

## Graph (`components/graph/` + `lib/graph/graph-tokens.ts`)

The Cytoscape canvas reads raw CSS vars by name in `lib/graph/graph-tokens.ts:39-51` (`readGraphTokens()`): `--paper, --paper-2, --ink, --ink-2, --ink-3, --rule, --feynman, --line`. **Two changes required:**

1. **Add two reads:** `--amber` and `--rose` (with sensible fallbacks) so `buildCytoscapeStyle` can bind the new band colors.
2. **Re-map band + status borders in `buildCytoscapeStyle`:**
   - `band-strong` → `t.feynman` (emerald) ✓ unchanged
   - `band-learning` → `t.amber` (was `t.ink`)
   - `band-slipping` → `t.rose` (was `t.rule`)
   - `band-untested` / `band-unknown` → `t.ink3` (gray) ✓ unchanged
   - `status-ready` → `t.rule` (orange) ✓ unchanged (ready = accent)
   - `status-mastered` → `t.feynman` (emerald) ✓ unchanged
   - `status-locked` → `t.ink3` dashed ✓ unchanged
   - `node:selected` / `node.hovered` → `t.rule` (orange) ✓ unchanged
   - `node.filled` → `t.ink` bg / `t.paper2` label ✓ unchanged

All other graph styling (edge colors, opacity, arrows, fonts) flows from the same re-pointed tokens — no further edits.

- **`ConceptGraph.tsx`** — container `border-border bg-surface-2` (auto). The MutationObserver that rebuilds the Cytoscape stylesheet on `data-theme` flip stays.
- **`ClusterOverview.tsx`** — band segment bar `bg-band-strong/learning/slipping` + `bg-content-faint/50` auto-render emerald/amber/rose/gray. Path-mode status bar: `bg-feynman` (mastered, emerald), `bg-band-learning` (amber), `bg-rule` (ready, orange), `bg-content-faint/40` (locked). Complete flag `text-feynman` → emerald; start-here `text-rule` → orange. All auto via tokens.
- **`LearningPathTrajectory.tsx`** — you-are-here marker `bg-rule` → orange (auto); status dot `in_progress → bg-band-learning` (amber), else `bg-rule` (orange = ready/next); label colors `text-band-learning` / `text-rule` (auto). "ask" link neutral. Auto via tokens.
- **`DetailPanel.tsx`** — `<Card accent>` orange left rule (auto). Error `text-rule` → **re-point to `text-danger`** (rose). Other text token-driven (auto).
- **`NextUpPanel.tsx`** — complete check `text-feynman` → emerald (auto); blocked `text-content-faint` (auto).

---

## Non-chat screens

Every non-chat screen shares the page frame `graph-paper h-full overflow-y-auto` + `mx-auto max-w-* px-… py-…` + eyebrow + serif h1. With `--grid: transparent` the grid vanishes (clean). Eyebrow icon colors stay per-screen via tokens: graph/mastery `text-feynman` → emerald; decks/review/projects/settings `text-rule` → orange. The orange/emerald differentiation is intentional and tasteful.

- **`graph/page.tsx`** — coverage header "ready" count `text-rule` → orange ✓ (ready = accent, keep). Coverage bar fill `bg-feynman` → emerald ✓ (mastered). Error `text-rule` → **re-point `text-danger`**.
- **`mastery/page.tsx`** — `<Badge tone="slipping|learning|strong">` summary counts + per-row band badges auto-render rose/amber/emerald. Eyebrow `text-feynman` → emerald. Error → `text-danger`.
- **`decks/page.tsx`** / **`decks/[id]/page.tsx`** — Card/list/surface tokens auto. Delete `Button variant="danger"` → rose. Eyebrow `text-rule` → orange. Error → `text-danger`.
- **`review/page.tsx`** — tokens auto. Eyebrow orange. Empty states faint.
- **`projects/page.tsx`** — **status re-points:** material status `processing` and extraction chip `extracting` currently `text-feynman` → **re-point `text-amber`** (in-progress). Material `error`/extraction `error` currently `text-rule` → **re-point `text-danger`** (rose). Build-progress bar fill `bg-accent` (orange) ✓. Delete `Button variant="danger"` → rose. Eyebrow orange.
- **`settings/page.tsx`** — form tokens auto. "SETTINGS" label `tracking-[0.2em] text-rule` → orange ✓. Error → `text-danger`.
- **`print/[id]/page.tsx`** — root `bg-surface-2` (auto on screen); the `@media print` block keeps hardcoded whites (prints on physical paper). Update the print hex to neutral equivalents (see globals.css cleanup). Back-link/error `text-rule` → on-screen error `text-danger`; print stays black ink.
- **`app/(app)/page.tsx` (chat home)** — welcome `<Card accent>` orange rule (auto); "Feynman" highlight `text-feynman` → emerald (auto); suggestion chips tokens auto; **error bar** `border-rule/40 bg-rule/5 text-rule` → **re-point `border-danger/40 bg-danger/5 text-danger`** (rose). Header project chip `text-feynman` → emerald (auto).

---

## `app/globals.css` cleanup

- `:root` + `html[data-theme="dark"]`: swap all core/semantic/band values per the tables above; add `--amber`, `--rose`; add `--danger` alias; set `--grid: transparent`.
- `@theme inline`: add `--color-amber`, `--color-rose`, `--color-danger`.
- `.graph-paper`: now paints nothing (grid transparent). Keep the class (avoids editing every page wrapper) or simplify to a no-op.
- `.margin-rule`: dead code (zero usages) — **remove**.
- Scrollbar `::-webkit-scrollbar-thumb`: re-token to neutral — light `#c9c9cc` / hover `#b0b0b4`; dark `#3a3a3e` / hover `#4a4a4e`.
- `.prose-chat code` background: neutral — light `rgba(0,0,0,0.06)`, dark `rgba(255,255,255,0.08)`.
- `@media print` hardcoded hex: `#1f2020 → #18181b`, `#eae8dc → #f6f6f7`, `#8b8d83 → #8a8a93`; keep `#ffffff` page. (Print always renders on white paper regardless of theme.)
- Focus ring `outline: 2px solid var(--ink)` — keep (neutral ink ring).
- `.eyebrow` color `var(--rule)` → orange ✓; `.hero-title` / `.hero-lede` → ink/ink-2 ✓; `.mono` unchanged.

---

## Re-pointing rules (summary of the semantic class edits)

These are the places where a token's *meaning* changed and a class must be re-pointed (not auto-handled by value swaps):

| Where | Was | Becomes | Why |
|---|---|---|---|
| `Button` danger variant | `bg-rule text-paper-2 ring-ring-accent` | `bg-danger text-white ring-ring` | danger = rose now, not the orange accent |
| `Button` accent variant (send button) | `bg-ink` (primary) | `bg-rule text-white` (accent) | send is the orange action |
| `ChatMessage` status dot | `bg-feynman` | `bg-rule` | "working" = orange (active) |
| `ChatMessage` assistant header | mono "• studygpt · N tok" | removed | transcript has no bubble header |
| `SourcesPanel` title color | `text-feynman` | `text-content-muted` | citations neutral, not emerald |
| `SourcesPanel` top border | `border-t border-border` | removed (spacing only) | turn hairline already separates |
| All error texts (`settings`, `graph`, `decks/[id]`, `print`, `DetailPanel`) | `text-rule` | `text-danger` | error = rose, not orange |
| Chat home error bar | `border-rule/40 bg-rule/5 text-rule` | `…-danger/40 …-danger/5 text-danger` | error = rose |
| Projects material `processing` / extraction `extracting` | `text-feynman` | `text-amber` | in-progress = amber |
| Projects material `error` / extraction `error` | `text-rule` | `text-danger` | error = rose |
| `graph-tokens.ts` band-learning | `t.ink` | `t.amber` | learning = amber |
| `graph-tokens.ts` band-slipping | `t.rule` | `t.rose` | slipping = rose |
| `graph-tokens.ts` reads | 8 vars | add `--amber`, `--rose` | bind new band colors |

Everything else is automatic via the token value swaps.

---

## Verification

1. `npm run lint` (eslint) — 0 warnings/errors.
2. `npx tsc --noEmit` — 0 errors.
3. `npm test` — existing suite green (no logic changes; only presentational). The trajectory tests in `lib/graph/learning-path.test.ts` must stay 41/41.
4. Visual pass, both themes (toggle via the existing ThemeToggle):
   - **Chat:** no left/right bubbles; user prompts are italic mono query-lines with an orange left rule; assistant answers are full-width serif prose; a hairline divides turns; send button is orange; streaming shows an orange pulsing caret; citations sit below the answer without a second border.
   - **Shell:** rail + bottom-tab active indicators are orange; brand dot orange; conversation active rail orange.
   - **Graph:** nodes show emerald (mastered) / amber (learning) / rose (slipping) / gray (untested) bands; ready concept and selection are orange; coverage bar is emerald; "ready" count is orange. Verify the Cytoscape stylesheet rebuilds on theme toggle (no stale colors).
   - **Mastery:** summary badges and per-row badges render rose/amber/emerald correctly.
   - **Projects:** processing/extracting status is amber; errors are rose; build-progress bar is orange.
   - **Errors everywhere:** rose, not orange.
   - **Light vs dark:** light is clean white + near-black ink; dark is near-black + off-white ink; orange accent in both; no cream/brown; no graph-paper grid.
   - **Print:** open `/print/[id]`, print preview renders black ink on white paper regardless of theme.
5. Reduced-motion: toggle OS reduce-motion; per-turn enter and the streaming caret fall back to no animation.

---

## Open questions for review

- None expected. The status palette, the transcript layout, and the orange/near-black palette were all confirmed via the visual companion before this spec. If the muted emerald/amber/rose values read too vivid or too dull on the real surfaces, they're single-hex tweaks in `:root` / dark block — no structural rework.
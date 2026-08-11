# Minimal Orange Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Graph Paper Lab / Studio Notebook design with a minimal, polished system (clean white / near-black surfaces, single orange accent, muted emerald/amber/rose/gray status set) and convert the chat surface from left/right bubbles to a reading transcript.

**Architecture:** Pure presentational change. Token *names* are kept stable; only token *values* change in `app/globals.css`, plus two new core tokens (`--amber`, `--rose`) and one semantic alias (`--danger`). Most screens auto-recolor via the existing Tailwind utility classes. A small set of semantic re-points (errors → rose, processing → amber, graph bands, send → orange) are explicit class edits. Chat layout is a structural rewrite of `ChatMessage.tsx` + the list container. Graph Cytoscape colors are re-bound in `lib/graph/graph-tokens.ts`.

**Tech Stack:** Next.js 16 (Turbopack), Tailwind v4 (`@theme inline`), motion/react, Cytoscape, Radix UI primitives, Jest for the one pure module touched (`lib/graph/learning-path` — unchanged, must stay green).

**Branch:** `feat/minimal-orange-redesign` (already created). Baseline (current design) committed at `2d0a6d6` — rollback point.

## Global Constraints

- **Never `git add -A`/`.`/`package.json`.** Stage explicit paths per task. The working tree carries uncommitted backend/infra work (lib/db, lib/embed, lib/ingest, lib/concepts, lib/prompts, app/api/*, package*.json, usage.json) that must NOT be swept into redesign commits.
- **No logic changes.** Only presentational: tokens, classNames, JSX structure of the chat surface, and graph color bindings. No data/API/routing changes.
- **Keep token names stable.** Do not rename `--paper`, `--ink`, `--rule`, `--feynman`, `--band-*`, etc. Only change values. Add `--amber`, `--rose` (core) and `--danger` (alias). This keeps `lib/graph/graph-tokens.ts` reading `--feynman`/`--rule` by name working.
- **Theme mechanism untouched.** `data-theme` attribute, `app/ThemeScript.tsx`, `components/ThemeToggle.tsx`, `localStorage["studygpt-theme"]` + `/api/settings` — no edits.
- **Fonts untouched.** Inter / Newsreader / JetBrains Mono via `next/font/google` in `app/layout.tsx`.
- **Tests must stay green.** `npm test` (esp. `lib/graph/learning-path.test.ts`, 41 tests), `npx tsc --noEmit`, `npm run lint` — 0 errors/warnings after each task.
- Spec: `docs/superpowers/specs/2026-08-12-minimal-orange-redesign-design.md` (authoritative for values + semantics).

---

### Task 1: Rewrite the token system in `app/globals.css`

**Files:**
- Modify: `app/globals.css` (the `:root` block ~lines 10-53, the `html[data-theme="dark"]` block ~lines 55-92, the `@theme inline` block ~lines 94-140, helper classes ~lines 157-330, scrollbar ~319-324, print ~342-385)

**Interfaces:**
- Consumes: the spec's token tables.
- Produces: every Tailwind utility (`bg-paper`, `bg-surface`, `text-content`, `bg-band-*`, `text-feynman`, `bg-rule`, `text-amber`, `text-rose`, `bg-danger`, `text-danger`, …) now resolves to the new palette. All later tasks depend on this.

- [ ] **Step 1: Replace the `:root` core + semantic + band tokens**

Replace the entire `:root { ... }` custom-property block (the color + shadow + motion vars) with:

```css
:root {
  /* core */
  --paper: #ffffff;
  --paper-2: #f6f6f7;
  --paper-3: #ececef;
  --ink: #18181b;
  --ink-2: #52525b;
  --ink-3: #8a8a93;
  --rule: #f97316;        /* orange accent */
  --feynman: #0f9d76;     /* muted emerald — mastered/strong */
  --amber: #c08a00;       /* muted amber — learning */
  --rose: #c0445a;        /* muted rose — slipping / danger */
  --line: #e6e6e9;
  --grid: transparent;
  --shadow-card: 0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06);

  /* motion (unchanged values) */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast: 120ms;
  --dur: 200ms;
  --dur-slow: 320ms;

  /* semantic aliases */
  --surface: var(--paper-2);
  --surface-2: var(--paper-3);
  --border: var(--line);
  --border-strong: color-mix(in oklab, var(--ink) 16%, var(--line));
  --ring: var(--ink);
  --ring-accent: var(--rule);
  --content: var(--ink);
  --content-muted: var(--ink-2);
  --content-faint: var(--ink-3);
  --accent: var(--rule);
  --accent-2: var(--feynman);
  --danger: var(--rose);

  /* mastery bands */
  --band-strong: var(--feynman);
  --band-learning: var(--amber);
  --band-slipping: var(--rose);
  --band-untested: var(--ink-3);
  --band-unknown: var(--ink-3);
}
```

- [ ] **Step 2: Replace the `html[data-theme="dark"]` override block**

```css
html[data-theme="dark"] {
  --paper: #0b0b0c;
  --paper-2: #161618;
  --paper-3: #1f1f22;
  --ink: #e6e6ea;
  --ink-2: #9a9aa2;
  --ink-3: #6a6a72;
  --rule: #ff7a3d;
  --feynman: #34c896;
  --amber: #d9a441;
  --rose: #e06a7c;
  --line: #262629;
  --grid: transparent;
  --shadow-card: 0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.5);

  --surface: var(--paper-2);
  --surface-2: var(--paper-3);
  --border: var(--line);
  --border-strong: color-mix(in oklab, var(--ink) 20%, var(--line));
  --ring: var(--ink);
  --ring-accent: var(--rule);
  --content: var(--ink);
  --content-muted: var(--ink-2);
  --content-faint: var(--ink-3);
  --accent: var(--rule);
  --accent-2: var(--feynman);
  --danger: var(--rose);

  --band-strong: var(--feynman);
  --band-learning: var(--amber);
  --band-slipping: var(--rose);
  --band-untested: var(--ink-3);
  --band-unknown: var(--ink-3);
}
```

- [ ] **Step 3: Extend `@theme inline` with the new color utilities**

In the `@theme inline { ... }` block, add three lines next to the existing `--color-rule` / `--color-feynman` entries:

```css
  --color-amber: var(--amber);
  --color-rose: var(--rose);
  --color-danger: var(--danger);
```

(Leave all existing `--color-*`, `--font-*`, `--shadow-*`, `--ease-*`, `--duration-*`, `--breakpoint-tab` entries untouched.)

- [ ] **Step 4: Neutralize the hardcoded hex**

- Scrollbar (`::-webkit-scrollbar-thumb`): light thumb `#c9c9cc`, hover `#b0b0b4`; dark thumb `#3a3a3e`, hover `#4a4a4e`.
- `.prose-chat code` background: light `rgba(0,0,0,0.06)`, dark `rgba(255,255,255,0.08)`.
- `@media print`: replace `#1f2020 → #18181b`, `#eae8dc → #f6f6f7`, `#8b8d83 → #8a8a93`; keep `#ffffff` page background. (Print always renders black ink on white paper regardless of theme.)

- [ ] **Step 5: Remove dead `.margin-rule` helper**

Delete the `.margin-rule { border-right: 2px solid var(--rule); }` rule (zero usages in tsx). Leave `.graph-paper` in place — it now paints nothing because `--grid: transparent` (keeps every page wrapper working without editing them).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors, 0 warnings.
Then start the dev server (`npm run dev`) and toggle the theme (ThemeToggle): body should be clean white (light) / near-black (dark); no graph-paper grid; no red. (Visual spot check only — no automated assertion.)

- [ ] **Step 7: Commit**

```bash
git add app/globals.css
git commit -m "feat(ui): minimal-orange token system (white/near-black, orange accent, muted status set)"
```

---

### Task 2: Add `accent` variant and fix `danger` variant in `Button.tsx`

**Files:**
- Modify: `components/ui/Button.tsx` (variants map ~lines 8-18)

**Interfaces:**
- Consumes: new `--rule` (orange), `--danger` (rose) tokens.
- Produces: a `variant="accent"` button (orange) used by the chat send button in Task 3; a correct rose `danger` variant used by delete actions across screens.

- [ ] **Step 1: Add the `accent` variant and re-point `danger`**

In the `variants` object, add `accent` and change `danger`:

```ts
  accent:
    "bg-rule text-white hover:opacity-90 active:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring-accent focus-visible:ring-offset-paper",
  danger:
    "bg-danger text-white hover:opacity-90 active:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-paper",
```

Keep `primary` (`bg-ink text-paper-2 …`), `secondary`, `ghost` unchanged. (Note: `text-white` — fixed, not `text-paper-2` — because the accent/danger colors are bright in both themes and need white text in dark mode too.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add components/ui/Button.tsx
git commit -m "feat(ui): add orange accent variant; re-point danger to rose"
```

---

### Task 3: Convert chat to a reading transcript

**Files:**
- Modify: `components/ChatMessage.tsx` (full structure rewrite of all four branches)
- Modify: `app/(app)/page.tsx` (message list container ~line 743)
- Modify: `components/ChatInput.tsx` (send button variant + composer measure)
- Modify: `components/SourcesPanel.tsx` (drop double border, neutralize title)

**Interfaces:**
- Consumes: `Button` `accent` variant (Task 2); tokens `--rule` (orange query-line + caret + status dot), `--border` (hairline), `--content*`, `--surface-2`.
- Produces: a transcript chat surface — full-width serif prose, italic mono user query-lines, hairline turn dividers, orange send.

- [ ] **Step 1: Rewrite `ChatMessage.tsx` — remove bubbles, render transcript**

Replace the four rendering branches (user edit ~:128, user display ~:199, assistant document ~:246, assistant chat ~:306) so that NO branch uses `justify-end`/`justify-start`, `max-w-[80%]`/`max-w-[85%]`/`max-w-[680px]`, `bg-surface`/`bg-surface-2` card frames, `shadow-card`, or the mono "you · N tok" / "• studygpt · N tok" header rows. The new shapes:

**User display** (replace the `isUser` display branch):
```jsx
<motion.div {...m} variants={fadeUp} className="group relative">
  <div className="border-l-2 border-rule pl-3 font-mono text-[13px] leading-relaxed text-content">
    {content}
  </div>
  {attachments && attachments.length > 0 && (
    <div className="mt-2 flex flex-wrap gap-2 pl-5">{/* attachment chips — keep existing rendering, no card */}</div>
  )}
  {onEdit && (
    <div className="absolute -right-1 top-0 opacity-0 transition-opacity group-hover:opacity-100">
      <IconButton variant="ghost" size="sm" aria-label="Edit message" onClick={() => onEdit(content, attachments ?? [])}>
        <Pencil size={12} />
      </IconButton>
    </div>
  )}
</motion.div>
```

**User edit** (replace the `isUser && editing` branch): render an inline `<textarea>` in the same query-line measure (full width, `font-mono`, `bg-surface-2/40`, `border border-border rounded-[3px] px-3 py-2`) pre-filled with `content`, with Save / Cancel buttons below (`Button size="sm"`). No bubble, no `justify-end`.

**Assistant chat** (replace the `else` assistant branch):
```jsx
<motion.div {...m} variants={fadeUp} className="group relative">
  {status && (
    <div className="mono mb-2 flex items-center gap-1.5 text-[11px] text-content-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-rule animate-pulse" />
      {STATUS_LABELS[status] ?? status}
    </div>
  )}
  {reasoning && (
    <details className="mb-3 rounded-[3px] border border-border bg-surface-2/50 px-3 py-2">
      <summary className="mono text-[11px] text-content-faint">thinking</summary>
      <Markdown content={reasoning} className="prose-chat mt-2 text-[13px] text-content-muted" />
    </details>
  )}
  <Markdown content={content} className="prose-chat text-ink" streaming={streaming} conversationTitle={conversationTitle} conversationId={conversationId} />
  {streaming && (
    <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
  )}
  {!streaming && (
    <div className="absolute right-0 top-0 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <IconButton variant="ghost" size="sm" aria-label={copied ? "Copied" : "Copy"} onClick={onCopy}>{copied ? <Check size={13} /> : <Copy size={13} />}</IconButton>
      {canRegenerate && onRegenerate && (
        <IconButton variant="ghost" size="sm" aria-label="Regenerate" onClick={onRegenerate}><RefreshCw size={13} /></IconButton>
      )}
    </div>
  )}
  {!streaming && <SourcesPanel sources={sources ?? []} allMaterials={allMaterials} />}
</motion.div>
```

**Assistant document** (replace the `kind === "document"` branch): same as assistant chat, but after the `Markdown` (and before/after the PDF button) keep the existing "download PDF" `Button` linking to `/print/{id}`. No card; the body sits in the same transcript column.

Keep all imports, `STATUS_LABELS`, `useCopy`/`copied`/`onCopy` wiring, `motion`/`fadeUp`/`useMotion`, and prop handling unchanged — only the JSX shapes change. Remove now-unused imports (`shadow-card` isn't an import; verify no `max-w`-related dead locals — eslint will flag any unused).

- [ ] **Step 2: Update the message list container in `app/(app)/page.tsx`**

Find the list wrapper (currently `<div className="mx-auto flex max-w-3xl flex-col gap-5">`) and change it to a narrower reading measure with hairline turn dividers:

```jsx
<div className="mx-auto flex w-full max-w-[680px] flex-col">
  {messages.length === 0 && !streaming && (/* keep existing empty-state motion.div, unchanged */}
  {messages.map((m, i) => (
    <div key={m.id} className={i === 0 ? "pt-2" : "mt-6 border-t border-border pt-6"}>
      <ChatMessage /* existing props, unchanged */ />
    </div>
  ))}
</div>
```

(If the existing code already maps without an index, add `i` to the map callback. Keep the `key` on the outer wrapper, not on `ChatMessage`.)

- [ ] **Step 3: Make the composer's send button orange + match measure**

In `components/ChatInput.tsx`:
- Change the send button from `variant="primary"` to `variant="accent"` (the orange variant from Task 2). Keep the `ArrowUp` icon and label logic.
- Change the composer container's `max-w-3xl` (both the outer `gateMsg` line and the inner rounded box) to `max-w-[680px]` so it aligns with the transcript measure.

- [ ] **Step 4: Restyle `SourcesPanel.tsx`**

- Remove the top `border-t border-border pt-2` from the outer wrapper (both branches) — the turn hairline already separates turns; replace with `mt-4` spacing only.
- Change the panel header's bullet `bg-feynman` → keep (emerald dot is fine) OR `bg-content-faint` (neutral). Spec chose neutral citations: change the source title color from `text-feynman` to `text-content-muted`. Leave concept `Badge`s as-is (they auto-render band colors).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc 0, lint 0, tests green (41/41 in `lib/graph/learning-path.test.ts`).
Visual (dev server, both themes): no bubbles; user prompts are italic-ish mono lines with an orange left rule; assistant answers are full-width serif; hairline between turns; orange send; orange pulsing caret while streaming; citations sit below the answer without a second border.

- [ ] **Step 6: Commit**

```bash
git add components/ChatMessage.tsx "app/(app)/page.tsx" components/ChatInput.tsx components/SourcesPanel.tsx
git commit -m "feat(chat): reading transcript layout (no bubbles; query-line + full-width prose + hairline turns)"
```

---

### Task 4: Re-point error / processing / status semantics across screens

**Files:**
- Modify: `app/(app)/settings/page.tsx`, `app/(app)/graph/page.tsx`, `app/(app)/decks/[id]/page.tsx`, `app/print/[id]/page.tsx`, `components/graph/DetailPanel.tsx`, `app/(app)/page.tsx` (chat home error bar), `app/(app)/projects/page.tsx`

**Interfaces:**
- Consumes: new `--danger` (rose) and `--amber` utilities from Task 1.
- Produces: errors render rose (not orange), processing renders amber (not emerald), matching the spec's re-pointing table.

- [ ] **Step 1: Errors → `text-danger`**

In each file, change error-text occurrences of `text-rule` to `text-danger`:
- `app/(app)/settings/page.tsx` — error `<p>`/`<div>` `text-rule` → `text-danger`.
- `app/(app)/graph/page.tsx` — error `text-rule` → `text-danger`. (Leave the "ready" count `text-rule` — ready = orange accent, correct.)
- `app/(app)/decks/[id]/page.tsx` — error `text-rule` → `text-danger`.
- `app/print/[id]/page.tsx` — on-screen error `text-rule` → `text-danger`. (Print block stays black ink.)
- `components/graph/DetailPanel.tsx` — the two error lines `text-rule` → `text-danger`.

Do NOT blanket-replace `text-rule` everywhere — only error contexts. `text-rule` for "ready", the query-line, you-are-here, brand dot, etc. stays orange.

- [ ] **Step 2: Chat home error bar → danger**

In `app/(app)/page.tsx`, the error retry bar `border border-rule/40 bg-rule/5 text-rule` → `border border-danger/40 bg-danger/5 text-danger`.

- [ ] **Step 3: Projects processing → amber, errors → danger**

In `app/(app)/projects/page.tsx`:
- Material status: `processing` currently `text-feynman` → `text-amber`. `error`/other currently `text-rule` → `text-danger`. `ready` stays `text-content-muted`.
- Extraction chip: `extracting` currently `text-feynman` → `text-amber` (keep the spinner). `error` currently `text-rule` → `text-danger`. Success stays `text-content-muted`.
- Leave the build-progress bar fill `bg-accent` (orange) as-is.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: 0 errors, 0 warnings.
Visual: trigger an error state (e.g. bad model key in settings) — error text is rose, not orange. Projects: a processing material shows amber; an errored material shows rose.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/settings/page.tsx" "app/(app)/graph/page.tsx" "app/(app)/decks/[id]/page.tsx" "app/print/[id]/page.tsx" components/graph/DetailPanel.tsx "app/(app)/page.tsx" "app/(app)/projects/page.tsx"
git commit -m "feat(ui): re-point errors to rose, processing to amber across screens"
```

---

### Task 5: Re-bind graph colors in `lib/graph/graph-tokens.ts`

**Files:**
- Modify: `lib/graph/graph-tokens.ts` (`readGraphTokens` ~lines 39-51; `buildCytoscapeStyle` band selectors ~lines 63-165)

**Interfaces:**
- Consumes: new `--amber`, `--rose` core tokens (Task 1).
- Produces: Cytoscape node band borders render emerald (strong) / amber (learning) / rose (slipping) / gray (untested/unknown); ready + selection stay orange; mastered stays emerald. Theme-toggle rebuild still works.

- [ ] **Step 1: Read the two new tokens in `readGraphTokens()`**

Add two `readVar` calls alongside the existing 8, with fallbacks:
```ts
amber: readVar("--amber", "#c08a00"),
rose: readVar("--rose", "#c0445a"),
```
and add `amber`/`rose` to the returned object's type/shape (the `t` parameter type of `buildCytoscapeStyle`).

- [ ] **Step 2: Re-map the band borders in `buildCytoscapeStyle(t)`**

Find the band-class selectors and change their `border-color`:
- `node.band-learning` → `border-color: t.amber` (was `t.ink`)
- `node.band-slipping` → `border-color: t.rose` (was `t.rule`)
- Leave `node.band-strong` → `t.feynman` (emerald), `node.band-untested`/`band-unknown` → `t.ink3` (gray), unchanged.
- Leave status selectors unchanged: `status-ready` → `t.rule` (orange), `status-mastered` → `t.feynman` (emerald), `status-locked` → `t.ink3` dashed; `node:selected`/`node.hovered` → `t.rule` (orange).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 0 errors, 0 warnings, tests green.
Visual (dev server): open `/graph`, switch a cluster to path/overview — nodes show emerald/amber/rose/gray bands; the ready/selected concept is orange; mastered is emerald. Toggle theme — colors rebuild correctly (no stale light-mode colors in dark, via the existing MutationObserver).

- [ ] **Step 4: Commit**

```bash
git add lib/graph/graph-tokens.ts
git commit -m "feat(graph): re-bind band colors to amber/rose; ready stays orange, mastered emerald"
```

---

### Task 6: Whole-branch verification pass

**Files:** none modified (verification only).

- [ ] **Step 1: Lint, types, tests**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: lint 0, tsc 0, all tests green (incl. 41/41 `lib/graph/learning-path.test.ts`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds (Turbopack).

- [ ] **Step 3: Both-theme visual sweep (manual, against the spec's Verification section)**

Light + dark:
- Chat: transcript (no bubbles), orange query-line + send + caret + working dot, hairline turns, citations no double border.
- Shell: orange active indicators (rail + bottom tab), orange brand dot, orange conversation active rail.
- Graph: emerald/amber/rose/gray bands; orange ready + selection; emerald mastered; theme-toggle rebuilds.
- Mastery: rose/amber/emerald badges.
- Projects: amber processing, rose errors, orange build bar.
- Errors everywhere: rose.
- Light = clean white + near-black ink; dark = near-black + off-white ink; orange in both; no cream/brown; no grid.
- Print: `/print/[id]` renders black-on-white regardless of theme.
- Reduced motion: per-turn enter and caret fall back to no animation.

- [ ] **Step 4: Final review dispatch**

Dispatch the whole-branch code reviewer (`superpowers:requesting-code-review`'s code-reviewer.md) with `review-package 2d0a6d6 HEAD`. Resolve any Critical/Important findings.

- [ ] **Step 5: Finish the branch**

Run `superpowers:finishing-a-development-branch` (verify tests → present 4 options → execute choice). Reminder: rollback point is `2d0a6d6`.

---

## Notes for the implementer

- The working tree has uncommitted backend/infra work (lib/db, lib/embed, lib/ingest, lib/concepts, lib/prompts, app/api/*, package*.json, usage.json). Do NOT stage these. Stage only the explicit paths in each task's commit step.
- `.superpowers/` is gitignored — the SDD ledger and brainstorm mockups stay out of commits automatically.
- If a `text-rule` appears in an error context not listed in Task 4, apply the same rule (→ `text-danger`). If a `text-feynman` appears in a "processing/working" context (not mastered/complete/coverage), → `text-amber`. When in doubt, consult the spec's re-pointing table.
- `components/graph/ConceptGraph.tsx`, `ClusterOverview.tsx`, `LearningPathTrajectory.tsx`, `NextUpPanel.tsx` need NO code edits — they auto-recolor via tokens (band-* / feynman / rule). Verify visually only.
- All UI primitives except `Button` need no edits — they auto-recolor. Verify visually only.
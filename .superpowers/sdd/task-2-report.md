# Task 2 Report: Add `accent` variant and fix `danger` variant in Button.tsx

## What was implemented

In `components/ui/Button.tsx`:

1. Extended the `Variant` type union: `"primary" | "secondary" | "ghost" | "accent" | "danger"` (added `accent`).
2. Added the new `accent` variant to the `variants` map:
   ```ts
   accent:
     "bg-rule text-white hover:opacity-90 active:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring-accent focus-visible:ring-offset-paper",
   ```
3. Replaced the `danger` variant value (was `bg-rule text-paper-2 … focus-visible:ring-ring-accent`) with the rose-token version:
   ```ts
   danger:
     "bg-danger text-white hover:opacity-90 active:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-paper",
   ```

`primary`, `secondary`, and `ghost` were left unchanged. `text-white` (fixed) is used for both `accent` and `danger` (not `text-paper-2`), matching the brief's note that the bright orange/rose colors need white text in both themes.

## Verification

`npx tsc --noEmit` — 0 errors.

`npm run lint` — 0 errors, 3 warnings, all pre-existing `<img>` warnings in `components/ChatInput.tsx` and `components/ChatMessage.tsx`. No new warnings introduced; `components/ui/Button.tsx` produces no lint output.

Relevant lint tail:
```
✖ 3 problems (0 errors, 3 warnings)
```
(all 3 are `@next/next/no-img-element` in ChatInput.tsx / ChatMessage.tsx — pre-existing, unrelated to this task).

## Files changed

Exactly: `components/ui/Button.tsx` (1 file, 4 insertions, 2 deletions).

## Commit

- `74326a3` — `feat(ui): add orange accent variant; re-point danger to rose`
- Staged ONLY `components/ui/Button.tsx`. Verified via `git show --stat HEAD`: only `components/ui/Button.tsx` in the commit; no unrelated uncommitted backend/infra work was swept in.

## Self-review findings

- Other 3 variants intact? Yes — `primary`, `secondary`, `ghost` strings are byte-for-byte unchanged.
- `text-white` used (not `text-paper-2`)? Yes — both `accent` and `danger` use `text-white`.
- Variant type union includes `accent`? Yes — `"primary" | "secondary" | "ghost" | "accent" | "danger"`.
- Exact class strings match the brief? Yes — copied verbatim.
- Default variant remains `"secondary"` (unchanged, not in brief scope).

## Concerns

None. The new `bg-rule`, `bg-danger`, and `ring-ring-accent` utilities are provided by the Task 1 token system (commit a4dc99c) and resolve correctly under tsc/lint.
# Native Artifact System

## Goal

Make generated visuals feel like a first-class part of the study chat instead
of model-authored mini-websites. The platform owns the artifact frame,
typography, colour, spacing, responsive layout, and actions. The model supplies
only semantic content and visual data.

Existing saved HTML artifacts must continue to render.

## Current Problem

The `artifact` fence currently contains a complete HTML document and is mounted
in `components/Artifact.tsx` as a sandboxed iframe. This gives each generation
its own page styling, font stack, control design, spacing, and layout. It also
makes quality depend on ad-hoc model CSS rather than the application design
system.

Mermaid diagrams already render in the application, but have no shared artifact
frame or consistent metadata/actions.

## Design

### Artifact Envelope

New artifacts use a fenced JSON envelope:

```json
{
  "schema": "studygpt.artifact",
  "version": 1,
  "kind": "table",
  "title": "Selection pushdown",
  "summary": "Apply filters before the cross product.",
  "data": {}
}
```

The parser validates the envelope at the markdown boundary. Invalid JSON, an
unknown kind, or missing required fields does not render as an artifact; it
falls back to the ordinary code block. This prevents half-valid model output
from creating broken UI.

Supported initial kinds:

| Kind | `data` shape | Native renderer |
| --- | --- | --- |
| `diagram` | `{ mermaid: string }` | Inline Mermaid inside the artifact shell |
| `table` | `{ columns: string[], rows: (string | number)[][] }` | Responsive semantic table |
| `comparison` | `{ items: { label, value, detail? }[] }` | Side-by-side study comparison |
| `steps` | `{ items: { title, detail, emphasis? }[] }` | Ordered explanation sequence |
| `callout` | `{ label?, body, tone? }` | Focused concept card |
| `chart` | `{ chartType, labels, series }` | Native SVG chart for basic line/bar data |

No new generic runtime or chart dependency is required for v1. Interactivity
that cannot be represented by these kinds remains an explicit legacy/custom
HTML artifact.

### Parsing and Compatibility

`artifact` fences are classified in this order:

1. A JSON object whose `schema` is `studygpt.artifact` and whose `version` is `1`
   becomes a native artifact.
2. HTML content (`<!doctype`, `<html`, or an HTML fragment) uses the existing
   sandboxed iframe renderer as a legacy/custom artifact.
3. An `artifact-html` fence always uses the existing sandboxed iframe renderer.
4. Everything else uses the normal code-block fallback.

This means old conversations render unchanged, while new generations become
native without a data migration. A custom HTML artifact receives a subdued
platform-owned outer frame, but its document remains isolated.

### Native Shell

Every native artifact shares one `ArtifactFrame`:

- It uses the chat's existing `surface`, `surface-2`, `border`, content, and
  accent tokens rather than model-provided styles.
- The header contains a small semantic kind label, optional title/summary, and
  only relevant actions (copy data, expand/focus, download where applicable).
- The body is padded, responsive, and has a restrained enter animation. It
  does not imitate a separate browser window.
- Tables scroll horizontally only inside the body. Diagrams scale to their
  available width. Every kind remains usable in the print/PDF path.

Mermaid receives the same shell through a native `diagram` artifact, so static
diagrams, tables, and study cards share a visual language.

### Generation Contract

The general chat prompt changes from “emit a complete HTML document” to:

- Use `mermaid` for direct structural diagrams when no supporting artifact
  framing is needed.
- Use one `artifact` JSON envelope for tables, comparisons, diagrams with a
  title/summary, step-by-step visual explanations, or basic charts.
- Use `artifact-html` only when the user explicitly needs interaction that the
  v1 native kinds cannot express. The model must keep it self-contained and
  avoid page-like chrome.
- Never mix multiple artifact fences in one response unless explicitly asked.

The document/PDF prompt remains Markdown-first. It may keep direct Mermaid but
does not emit an interactive native artifact envelope.

### Component Boundaries

- `lib/artifacts/schema.ts`: pure types, validation, and legacy classification.
- `components/artifacts/ArtifactFrame.tsx`: shared native chrome and actions.
- `components/artifacts/NativeArtifact.tsx`: dispatches by validated kind.
- `components/artifacts/*Artifact.tsx`: small renderer per kind.
- `components/Artifact.tsx`: retained as `LegacyHtmlArtifact` behavior for
  HTML-only payloads; does not parse or decide payload type.
- `components/Markdown.tsx`: calls the classifier and routes to native, legacy,
  or code fallback.
- `lib/chat/conversation-context.ts`: reuses the classifier so the artifact
  rail shows native titles and kinds instead of a generic visualization label.

This isolates untrusted model payload handling from visual components and keeps
future artifact kinds additive.

## Error Handling

- Invalid structured payloads fall back to visible source code rather than a
  broken visual card.
- Mermaid parser error SVGs are rejected by the existing Mermaid recovery path.
- Unsupported chart types or malformed data produce a small in-shell error
  with the source available, never raw DOM/SVG error output.
- Legacy HTML remains sandboxed with `allow-scripts` and no same-origin access.
- Native envelopes accept data only: no HTML, CSS, JavaScript, arbitrary SVG,
  external URLs, or unbounded arrays/strings.

## Testing

- Unit-test payload classification and validation for every native kind,
  malformed JSON, unknown kinds, and legacy HTML detection.
- Static-render test each native renderer with representative content.
- Verify markdown routing for native, legacy, and invalid artifact blocks.
- Browser-check wide and narrow layouts, artifact focus, and a saved legacy
  artifact.
- Run targeted tests, type-check, diff check, and a production build.

## Rollout

1. Add parser/types and the shared shell with one native kind (`table`).
2. Add remaining v1 renderers and route `artifact` fences.
3. Update prompts to generate the JSON envelope.
4. Keep legacy HTML as a fallback while observing real generated outputs.
5. Later, add richer interactive kinds only when a real user request requires
   them.

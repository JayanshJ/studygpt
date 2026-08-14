# Native Artifact System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render model-generated study visuals as native, themed chat components while preserving saved HTML artifacts as sandboxed fallbacks.

**Architecture:** `artifact` fenced blocks become a versioned, validated JSON envelope with a fixed set of native kinds. A pure protocol classifier decides between native data, legacy HTML, and invalid source; React renderers own every pixel of native artifacts through a shared shell. Direct Mermaid diagrams use the same shell, while custom HTML stays isolated in the existing iframe.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, `react-markdown`, Mermaid v11, Node test runner with `tsx`.

**Spec:** `/Users/jayansh/Developer/Personal/chat/docs/superpowers/specs/2026-08-14-native-artifact-system-design.md`

## Global Constraints

- Preserve all saved `artifact` fences containing HTML without a database migration.
- Native payloads accept data only: no HTML, CSS, JavaScript, arbitrary SVG, external URLs, or unbounded arrays/strings.
- Use existing semantic tokens (`surface`, `surface-2`, `border`, content, `rule`) and existing UI primitives; do not introduce a parallel visual language.
- Keep legacy HTML sandboxed with `allow-scripts` and without same-origin access.
- Invalid payloads must show a compact themed fallback with expandable source, never broken DOM or raw Mermaid error graphics.
- Keep document/PDF turns Markdown-first; do not emit native interactive envelopes from document prompts.
- Do not commit or create branches unless the user explicitly requests it.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `lib/artifacts/schema.ts` | Native artifact types, limits, parser, and HTML/invalid classification. |
| `lib/artifacts/schema.test.ts` | Pure protocol regression coverage. |
| `components/artifacts/ArtifactFrame.tsx` | Platform-owned artifact heading, metadata, body, and actions. |
| `components/artifacts/NativeArtifact.tsx` | Native kind dispatcher and compact invalid-payload fallback. |
| `components/artifacts/TableArtifact.tsx` | Responsive semantic table renderer. |
| `components/artifacts/ComparisonArtifact.tsx` | Study comparison renderer. |
| `components/artifacts/StepsArtifact.tsx` | Ordered explanation-step renderer. |
| `components/artifacts/CalloutArtifact.tsx` | Key idea, warning, and formula-note renderer. |
| `components/artifacts/ChartArtifact.tsx` | Bounded native SVG line/bar chart renderer. |
| `components/artifacts/NativeArtifact.test.tsx` | Static markup coverage for every native kind and fallback. |
| `components/MermaidDiagram.tsx` | Split framed direct-fence adapter from reusable bare Mermaid graphic. |
| `components/Markdown.tsx` | Route `artifact`, `artifact-html`, Mermaid, legacy HTML, and invalid payloads. |
| `components/Markdown.test.tsx` | Verify artifact fence routing without browser-only rendering. |
| `lib/chat/conversation-context.ts` | Use protocol labels and kinds in the conversation artifact rail. |
| `lib/chat/conversation-context.test.ts` | Preserve existing rail behavior and add native labels. |
| `lib/prompts/index.ts` | Replace full-page HTML artifact instruction with the native JSON contract. |

## Task 1: Define and Validate the Artifact Protocol

**Files:**
- Create: `lib/artifacts/schema.ts`
- Test: `lib/artifacts/schema.test.ts`

**Interfaces:**
- Produces `classifyArtifact(source: string): ArtifactClassification`.
- Produces `NativeArtifact`, `NativeArtifactKind`, and `artifactKindLabel(kind)`.
- Consumers receive one of:
  ```ts
  type ArtifactClassification =
    | { type: "native"; artifact: NativeArtifact }
    | { type: "legacy-html"; html: string }
    | { type: "invalid"; source: string; reason: string };
  ```

- [ ] **Step 1: Write failing parser tests**

  Create `lib/artifacts/schema.test.ts` with fixtures for a valid table, valid Mermaid diagram, legacy `<!doctype html>`, unknown native kind, malformed JSON, a payload missing `schema`, and a table exceeding the row limit.

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";
  import { classifyArtifact } from "./schema";

  test("classifies a versioned table envelope as native", () => {
    const result = classifyArtifact(JSON.stringify({
      schema: "studygpt.artifact", version: 1, kind: "table",
      title: "Selection pushdown",
      data: { columns: ["Rule"], rows: [["Push σ down"]] },
    }));
    assert.equal(result.type, "native");
    assert.equal(result.type === "native" && result.artifact.kind, "table");
  });
  ```

- [ ] **Step 2: Run the parser tests and verify they fail**

  Run: `node --import tsx --test lib/artifacts/schema.test.ts`

  Expected: failure because `./schema` and `classifyArtifact` do not exist.

- [ ] **Step 3: Implement the strict discriminated schema**

  Add `lib/artifacts/schema.ts` with:

  ```ts
  export const NATIVE_ARTIFACT_SCHEMA = "studygpt.artifact" as const;
  export const NATIVE_ARTIFACT_VERSION = 1 as const;
  export type NativeArtifactKind = "diagram" | "table" | "comparison" | "steps" | "callout" | "chart";
  ```

  Validate plain JSON objects only. Require the exact schema and version. Limit title and summary to 160 and 320 characters, items/rows to 60, columns/series to 12, and all cell/detail strings to 1,000 characters. Reject keys that carry markup or executable content (`html`, `css`, `script`, `svg`, `url`, `href`, `src`). Accept only:

  ```ts
  type NativeArtifact =
    | { schema: "studygpt.artifact"; version: 1; kind: "diagram"; title?: string; summary?: string; data: { mermaid: string } }
    | { schema: "studygpt.artifact"; version: 1; kind: "table"; title?: string; summary?: string; data: { columns: string[]; rows: (string | number)[][] } }
    | { schema: "studygpt.artifact"; version: 1; kind: "comparison"; title?: string; summary?: string; data: { items: { label: string; value: string; detail?: string }[] } }
    | { schema: "studygpt.artifact"; version: 1; kind: "steps"; title?: string; summary?: string; data: { items: { title: string; detail: string; emphasis?: "default" | "key" }[] } }
    | { schema: "studygpt.artifact"; version: 1; kind: "callout"; title?: string; summary?: string; data: { label?: string; body: string; tone?: "idea" | "warning" | "formula" } }
    | { schema: "studygpt.artifact"; version: 1; kind: "chart"; title?: string; summary?: string; data: { chartType: "bar" | "line"; labels: string[]; series: { label: string; values: number[] }[] } };
  ```

  `classifyArtifact` must trim source, detect HTML only when it starts with `<!doctype`, `<html`, or an HTML tag, and return `invalid` otherwise. Export labels such as `Diagram`, `Data table`, and `Comparison`.

- [ ] **Step 4: Run parser tests and type-check**

  Run: `node --import tsx --test lib/artifacts/schema.test.ts && npx tsc --noEmit`

  Expected: all parser cases pass and TypeScript reports no errors.

## Task 2: Build the Platform-Owned Artifact Frame and Native Renderers

**Files:**
- Create: `components/artifacts/ArtifactFrame.tsx`
- Create: `components/artifacts/NativeArtifact.tsx`
- Create: `components/artifacts/TableArtifact.tsx`
- Create: `components/artifacts/ComparisonArtifact.tsx`
- Create: `components/artifacts/StepsArtifact.tsx`
- Create: `components/artifacts/CalloutArtifact.tsx`
- Create: `components/artifacts/ChartArtifact.tsx`
- Create: `components/artifacts/NativeArtifact.test.tsx`
- Modify: `components/MermaidDiagram.tsx`

**Interfaces:**
- Consumes `NativeArtifact` and `artifactKindLabel` from `lib/artifacts/schema.ts`.
- Produces `<NativeArtifact artifact={artifact} />`.
- Produces `<InvalidArtifact source={source} reason={reason} />`.
- Produces `<ArtifactFrame kind title summary>{children}</ArtifactFrame>`.
- Produces `<MermaidGraphic code={code} />`; existing `<MermaidDiagram code={code} />` remains the public adapter for direct Mermaid fences.

- [ ] **Step 1: Write failing static-render tests**

  In `components/artifacts/NativeArtifact.test.tsx`, use `renderToStaticMarkup` to assert that the frame renders title, semantic kind label, summary, table column headers, comparison labels, ordered steps, callout text, and chart accessible labels. Include an invalid-source fallback assertion:

  ```tsx
  test("renders a native table in platform chrome", () => {
    const markup = renderToStaticMarkup(<NativeArtifact artifact={tableArtifact} />);
    assert.match(markup, /Selection pushdown/);
    assert.match(markup, /Data table/);
    assert.match(markup, /<th[^>]*>Rule<\/th>/);
  });
  ```

- [ ] **Step 2: Run the renderer tests and verify they fail**

  Run: `node --import tsx --test components/artifacts/NativeArtifact.test.tsx`

  Expected: failure because the native artifact modules do not exist.

- [ ] **Step 3: Implement `ArtifactFrame`**

  Use the existing `Card`, `IconButton`, and semantic classes. The frame must be a message-width block with `rounded-card`, subtle `border-border/70`, `bg-surface-2`, `shadow-card`, a compact mono metadata row, optional title/summary, and a body slot. Keep actions platform-owned: copy the serialized native envelope, focus/expand only when an existing dialog callback is supplied. Do not render generated controls or model-provided HTML.

- [ ] **Step 4: Implement renderer components**

  - `TableArtifact`: semantic `<table>` inside an `overflow-x-auto` wrapper; strings and numbers are displayed as text.
  - `ComparisonArtifact`: responsive one-column-to-two-column grid of labeled items.
  - `StepsArtifact`: ordered list with tabular step markers; `key` emphasis uses existing `rule` token only.
  - `CalloutArtifact`: compact copy-led card whose tone changes only the existing accent border/text token.
  - `ChartArtifact`: render a bounded SVG `role="img"` with title/description, scale values from finite numeric arrays, and show a compact empty-state if all values are unavailable. Do not use CDN libraries.
  - `NativeArtifact`: dispatch exactly by `artifact.kind`; diagram content renders `<MermaidGraphic code={artifact.data.mermaid} />` inside the shared frame.
  - `InvalidArtifact`: render a compact `ArtifactFrame` with the reason and a closed `<details>` element containing the original source in a scrollable `<pre>`.

  Refactor `components/MermaidDiagram.tsx` so `MermaidGraphic` owns async SVG generation, parser-error recovery, print readiness, and responsive SVG sizing without adding its own card. `MermaidDiagram` wraps `MermaidGraphic` in `ArtifactFrame kind="diagram"`, preserving direct Mermaid fence behavior.

- [ ] **Step 5: Run renderer tests and inspect the narrow layout**

  Run: `node --import tsx --test components/artifacts/NativeArtifact.test.tsx && npx tsc --noEmit`

  Then use the local app at `http://localhost:3000` to render a table and a diagram at desktop and narrow widths. Confirm body content does not introduce a separate white page, a fixed width, or a nested horizontal page scrollbar.

## Task 3: Route Markdown Fences Through Native, Legacy, and Invalid Paths

**Files:**
- Modify: `components/Markdown.tsx`
- Modify: `components/Artifact.tsx`
- Create: `components/Markdown.test.tsx`

**Interfaces:**
- Consumes `classifyArtifact(source)` and `<NativeArtifact />`.
- Keeps `<Artifact html={html} />` as the legacy sandbox renderer.
- Adds `artifact-html` as an explicit legacy/custom fence while continuing to recognize saved HTML inside `artifact` fences.

- [ ] **Step 1: Write failing routing tests**

  Add static markup tests for all routes:

  ```tsx
  test("routes a native artifact fence into platform-owned chrome", () => {
    const markup = renderToStaticMarkup(<Markdown content={nativeArtifactFence} />);
    assert.match(markup, /Data table/);
    assert.doesNotMatch(markup, /visualization · html/);
  });
  ```

  Include legacy `<!doctype html>` under `artifact`, explicit `artifact-html`, malformed JSON, and direct Mermaid. The malformed case must contain a short “couldn’t render artifact” message and a collapsed `details` source element.

- [ ] **Step 2: Run routing tests and verify they fail**

  Run: `node --import tsx --test components/Markdown.test.tsx`

  Expected: native fence assertions fail because `Markdown` always mounts `Artifact` for `artifact`.

- [ ] **Step 3: Implement fence classification and compact fallback**

  In `PreBlock`, preserve the existing streaming placeholder. Once complete:

  ```tsx
  const classification = classifyArtifact(extractText(children));
  if (classification.type === "native") return <NativeArtifact artifact={classification.artifact} />;
  if (classification.type === "legacy-html") return <Artifact html={classification.html} />;
  return <InvalidArtifact source={classification.source} reason={classification.reason} />;
  ```

  Treat `artifact-html` as `legacy-html` directly. Keep `data-selection-excluded` around interactive/native cards so selection overlays do not anchor to generated control UI. In `Artifact.tsx`, change only platform-owned outer chrome copy from a generic “visualization · html” to “custom visualization”; do not alter its sandbox or resize logic.

- [ ] **Step 4: Run routing and existing Mermaid tests**

  Run:

  ```bash
  node --import tsx --test \
    components/Markdown.test.tsx \
    components/MermaidDiagram.test.ts \
    components/artifacts/NativeArtifact.test.tsx \
    lib/artifacts/schema.test.ts
  ```

  Expected: all artifact routes pass, including the Mermaid parser-error regression.

## Task 4: Update Artifact Discovery and Generation Instructions

**Files:**
- Modify: `lib/chat/conversation-context.ts`
- Modify: `lib/chat/conversation-context.test.ts`
- Modify: `lib/prompts/index.ts`

**Interfaces:**
- Consumes `classifyArtifact` and `artifactKindLabel`.
- Native artifact rail labels use `artifact.title ?? artifactKindLabel(artifact.kind)`.
- Prompts use `artifact` for JSON and `artifact-html` only for exceptional custom interaction.

- [ ] **Step 1: Write failing artifact-rail tests**

  Add a native comparison envelope to the fixture messages and assert:

  ```ts
  assert.deepEqual(context.artifacts.at(-1), {
    id: "native-message:visualization",
    messageId: "native-message",
    kind: "visualization",
    label: "Read/write conflicts",
  });
  ```

  Preserve assertions for direct Mermaid, documents, flashcards, legacy HTML, and malformed artifact fences.

- [ ] **Step 2: Run context tests and verify they fail**

  Run: `node --import tsx --test lib/chat/conversation-context.test.ts`

  Expected: the native envelope appears as generic `Visualization` or no recognized artifact.

- [ ] **Step 3: Reuse protocol classification in context extraction**

  Replace the artifact-fence-only label branch with fence payload extraction plus `classifyArtifact`. For native payloads, use title then semantic kind label. For legacy HTML, keep `Visualization`; for malformed `artifact` payloads, do not add a rail item because no usable visualization exists. Recognize `artifact-html` as legacy HTML.

- [ ] **Step 4: Replace the model’s HTML-page instruction**

  Rewrite `ARTIFACT_RULES` in `lib/prompts/index.ts` with the exact schema discriminator and one compact JSON example. State:

  - `artifact` always contains JSON only, with no Markdown around the JSON.
  - Pick only one supported kind and data shape.
  - `diagram` contains Mermaid source; direct `mermaid` remains preferred for simple structural diagrams.
  - `artifact-html` is allowed only for requested interaction unavailable in v1 native kinds.
  - Never emit full document chrome, style tags, scripts, HTML, SVG, URLs, or base64 data in an `artifact` JSON envelope.

  Do not add `ARTIFACT_RULES` to `documentSystemPrompt()`.

- [ ] **Step 5: Run context tests and inspect prompt exports**

  Run: `node --import tsx --test lib/chat/conversation-context.test.ts && npx tsc --noEmit`

  Confirm in a prompt snapshot/string assertion that `systemPromptFor("chat")` names `studygpt.artifact` and `artifact-html`, while `documentSystemPrompt()` does not contain either fence instruction.

## Task 5: End-to-End Regression Verification

**Files:**
- Modify only if verification finds a native-artifact-specific defect in the files above.

**Interfaces:**
- Verifies raw assistant markdown remains the persisted source; no database schema or SSE contract changes are introduced.

- [ ] **Step 1: Add a browser fixture through the existing chat flow**

  In a local conversation, generate or temporarily use one payload for each kind: table, comparison, steps, callout, bar chart, and Mermaid diagram. Include one saved legacy HTML artifact and one malformed native envelope.

- [ ] **Step 2: Verify visual and interaction requirements**

  At desktop and narrow widths confirm:

  - native artifacts align to the message column and composer axis;
  - typography, border, surface, and controls match chat cards;
  - no native artifact contains iframe/page chrome;
  - wide tables scroll only inside their body;
  - diagrams remain readable and Mermaid errors stay compact;
  - saved HTML still renders in a sandboxed iframe with subdued outer chrome;
  - the context rail exposes native title/kind metadata.

- [ ] **Step 3: Run the full focused verification set**

  Run:

  ```bash
  node --import tsx --test \
    lib/artifacts/schema.test.ts \
    components/artifacts/NativeArtifact.test.tsx \
    components/Markdown.test.tsx \
    components/MermaidDiagram.test.ts \
    lib/chat/conversation-context.test.ts
  npx tsc --noEmit
  git diff --check
  npm run build
  ```

  Expected: focused tests, type-check, and diff check pass. Record any pre-existing build issue separately rather than changing unrelated font/build configuration.

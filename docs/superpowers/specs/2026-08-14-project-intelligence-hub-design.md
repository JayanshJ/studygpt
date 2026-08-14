# Project Intelligence Hub Design

## Goal

Turn each course project into a trustworthy, recoverable study workspace: learners can verify an answer against its source page, revisit previous artifact versions, continue an interrupted generation, practise against cited material, and see the next best study action in one focused project view.

## Product Principles

- Keep chat as the primary study surface; advanced capability remains discoverable but collapsible.
- Prefer stored source evidence over model confidence language.
- Preserve immutable learning history. Regeneration and restoration never destroy a previous artifact or result.
- Separate deterministic learning data from model inference: FSRS controls card scheduling; assessments provide a distinct recommendation signal.
- Use only the active project's uploaded materials for practice-exam generation and grading.
- Never persist chain-of-thought, hidden reasoning, or artificial progress.

## Scope

### Source trust and preview

Every material-backed response, artifact, and assessment result exposes its existing `SourceEntry` citations with material name, page, concise snippet, and an inline preview of the stored PDF page image. A grounding label accurately distinguishes material-backed, web-backed, and uncited/general responses. No numerical confidence score is shown.

### Checkpoints and recovery

The server periodically persists partial assistant content and semantic generation state. A reload or provider failure presents an interrupted reply with retry; a retry starts from the original user request and preserves the partial response as history. Completed artifacts are checkpointed only after their fence/document output is structurally complete. The system never claims it can resume an unknown provider generation token-by-token.

### Immutable artifact versions

Artifacts are parsed from assistant output into separate immutable snapshots: documents, Mermaid diagrams, sandboxed visualizations, and flashcard decks. Each snapshot has a stable lineage and a version. Regeneration creates a child version where artifacts match by kind and ordinal; edit-and-resend begins a new lineage. Full snapshots are canonical; comparison is derived on request. Restoring a historical artifact creates a new latest version.

### Global learning search

Search expands from conversations/messages to artifact titles/content, saved overlays, project memory, material chunks, and completed assessment feedback. Results stay project-scoped where appropriate and open the exact conversation message, artifact version, overlay, or material page.

### Practice exams and adaptive recommendations

Practice-exam generation selects concepts with a priority of slipping, untested, learning, then strong. Every generated question stores its rubric and `SourceEntry[]` citations before it is shown. Grading is constrained to that stored rubric and cited project material. Low per-concept outcomes create an assessment signal and recommendations for existing relevant cards/concepts; they never write to `card_scheduling`, `review_log`, or FSRS stability.

### Project Intelligence Hub

The existing Projects page gains a concise project overview showing recent artifacts, material activity, due review count, weakest concepts, latest assessment result, saved overlay count, and active tutor memory. A learner can pin an artifact, cited page, overlay, or assessment result into a lightweight project collection. There is no infinite canvas, multi-user collaboration, or coding-agent task panel in this release.

## Data Model

### `artifact_versions`

Immutable artifact snapshot: `id`, `conversation_id`, nullable `source_message_id`, `lineage_id`, nullable `parent_version_id`, `ordinal`, `kind`, `title`, exact `content`, `content_hash`, `snapshot_json` (sources, grounding, model, activity summary), and `created_at`. Index by conversation, lineage, and source message. Deleting a message nulls the source reference; it never deletes its versions.

### `generation_checkpoints`

One latest checkpoint per assistant message: `message_id`, `conversation_id`, partial `content`, semantic `phase`, `kind`, `updated_at`. It is overwritten while streaming and removed/replaced when the completion is persisted. It stores no reasoning field.

### `exams`, `exam_questions`, `exam_question_concepts`, `exam_attempts`, `exam_responses`

Exam questions contain prompt, answer format, points, rubric JSON, and source JSON. Responses contain learner answer, criterion results, feedback, cited corrections, and per-concept outcome. Exam records are project-scoped and cascade safely when a project is deleted.

### `concept_assessment_signals`

Separate evidence per project/concept: recent score, attempt count, last assessed timestamp, and recommendation priority. It supplements existing FSRS mastery but never replaces it.

### `project_pins`

Lightweight project collection: `id`, `project_id`, `kind`, `target_id`, label, optional snapshot preview, created timestamp. It can reference an artifact version, material page, overlay thread, or exam attempt.

## Shared Boundaries

- `lib/chat/artifacts.ts` becomes the one parser for document and fenced artifact records. Context rails, artifact persistence, focus views, and search all consume it.
- Existing `SourceEntry` remains the citation exchange format across retrieval, response grounding, artifacts, and exams.
- Existing page-image persistence supplies PDF previews; no new OCR or PDF rendering path is introduced.
- Existing `ChatMessage`, `ConversationContextPanel`, and `ArtifactFocusDialog` receive small focused controls rather than being replaced.
- Existing review/FSRS routes remain the exclusive place that changes scheduling state.

## API Surface

- `GET /api/materials/[id]/pages/[page]` serves a checked project-material page preview.
- `GET /api/artifacts?conversationId=...`, `GET /api/artifacts/[lineageId]/versions`, and `POST /api/artifacts/versions/[versionId]/restore` support history and restoration.
- `GET /api/search` expands with typed result targets and project filters.
- `POST /api/projects/[id]/exams`, `GET /api/exams/[id]`, `POST /api/exams/[id]/attempts`, `POST /api/exam-attempts/[id]/responses`, and `POST /api/exam-attempts/[id]/grade` support practice flow.
- `GET /api/projects/[id]/intelligence` supplies hub summary, pins, assessment recommendations, and counts.
- `POST`/`DELETE /api/projects/[id]/pins` manages the project collection.

## UX

- Citations open a compact source preview, with a link to the full material when available.
- Artifact focus adds a small history action; history opens a revision selector with compare and restore actions.
- Search uses one keyboard-accessible dialog and direct navigation.
- Practice exam is launched from the selected project, runs one question at a time with autosave, then presents cited feedback and a “Review weak concepts” handoff.
- The hub uses cards and sections already present in Projects; it is responsive and remains a summary, not a second app shell.

## Non-Goals

- Timers, proctoring, anti-cheat, plagiarism detection, LMS integrations, class leaderboards, or collaboration.
- Web-sourced assessments for a course project.
- Automatic card scheduling changes from assessment grades.
- Pixel-perfect historical PDFs across renderer-version changes.
- Automatically storing hidden model reasoning.

## Verification

- Parser tests cover multiple same-kind artifacts, incomplete fences, and deterministic titles.
- Database tests cover immutable versions, source retention, checkpoint cleanup, attempt resume, and project-delete cascades.
- Route tests cover project scope, invalid IDs, source-less exam rejection, grading failures, and search target validation.
- UI tests cover source preview, artifact history navigation, restore confirmation, autosave/resume, and responsive hub cards.
- Regression tests prove exam results never mutate FSRS scheduling state.
- Each phase runs focused tests, TypeScript, `git diff --check`, lint triage, and a production build.

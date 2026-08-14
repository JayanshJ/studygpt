<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Product North Star

Every change must make StudyGPT easier to use **and** more intelligently aware
of the learner's situation. Prefer obvious, low-friction interactions over
manual steps, hidden modes, or extra configuration. Use the context already
available to the platform—conversation, selected text, project materials,
notation memory, and user intent—to provide the right help without making the
learner repeat themselves.

Before adding or changing a feature, check that it:

1. reduces effort or makes the interface easier to understand;
2. improves contextual understanding, answer quality, or useful automation;
3. preserves user control and explains consequential behavior clearly; and
4. avoids complexity that does not advance either goal.

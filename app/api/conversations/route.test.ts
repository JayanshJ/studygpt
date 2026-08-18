import assert from "node:assert/strict";
import test from "node:test";

// Set BEFORE any import of @/lib/db so the singleton opens an in-memory DB
// (a fresh one per test process). The require() is NOT hoisted, so it runs
// after this assignment. (Static `import` would hoist above the env set and
// open the on-disk DB; top-level `await import` is unavailable under the
// project's CJS tsx transpile.)
process.env.DATABASE_URL = ":memory:";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const db = require("@/lib/db") as typeof import("@/lib/db");

// The real route handlers, wired to the real (in-memory) DB + model config.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST, GET } = require("./route") as typeof import("./route");

// Regression guard for the bug fixed this session: the zod schema on
// POST /api/conversations used `projectId: z.string().optional()`, which
// accepts `undefined` (field omitted) but REJECTS an explicit `null`. The
// client's `newConversation` sends `{ projectId: activeProjectId }` where
// activeProjectId is `null` for a standalone conversation — so the create
// returned 400 (zod "invalid_type, expected string"), and the client pushed
// the error body into the conversation list, producing duplicate-`undefined`
// React keys and a broken new-conversation flow. The schema now accepts
// `string | null | undefined`.

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("POST creates a standalone conversation when projectId is null", async () => {
  const res = await post({ projectId: null });
  assert.equal(res.status, 201, "null projectId must create (201), not 400");
  const conv = (await res.json()) as { id: string; project_id: string | null; title: string };
  assert.ok(conv.id, "response must be a conversation with an id, not an error body");
  assert.equal(conv.project_id, null);
  assert.equal(conv.title, "New conversation");
});

test("POST creates a conversation when projectId is omitted", async () => {
  const res = await post({});
  assert.equal(res.status, 201);
  const conv = (await res.json()) as { id: string; project_id: string | null };
  assert.ok(conv.id);
  assert.equal(conv.project_id, null);
});

test("POST creates a conversation scoped to a project when projectId is a string", async () => {
  // conversations.project_id has a FK to projects(id), so create a real
  // project row first. The route itself does not validate the id — the DB
  // enforces it. This confirms the schema still ACCEPTS a string projectId
  // (the fix loosened null/undefined without breaking the string path).
  db.createProject("Test project");
  const projectId = db.listProjects()[0].id;
  const res = await post({ projectId, title: "My chat", mode: "feynman" });
  assert.equal(res.status, 201);
  const conv = (await res.json()) as { id: string; project_id: string; title: string; mode: string };
  assert.equal(conv.project_id, projectId);
  assert.equal(conv.title, "My chat");
  assert.equal(conv.mode, "feynman");
});

test("a created conversation appears in GET /api/conversations", async () => {
  await post({ projectId: null, title: "regression-check" });
  const listRes = await GET(new Request("http://localhost/api/conversations"));
  const list = (await listRes.json()) as { title: string }[];
  assert.ok(list.some((c) => c.title === "regression-check"));
});

test("POST rejects a malformed JSON body with a structured 400", async () => {
  const res = await POST(
    new Request("http://localhost/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    }),
  );
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, "Invalid JSON");
});
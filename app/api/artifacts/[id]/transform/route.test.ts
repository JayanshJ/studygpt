import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactTransformHandler } from "@/lib/chat/artifact-transform";
import type { Message, Conversation } from "@/lib/db/schema";
import type { NativeArtifact } from "@/lib/artifacts/schema";

// The transform handler is dependency-injected, so the route test stubs the
// model (generate), retrieval, and the version store — no DB, no mupdf, no
// real LLM. The route file wires the real deps; this tests the guard + persist
// logic that must hold regardless of the model.

const CALLOUT = `Here is the idea:

\`\`\`artifact
{"schema":"studygpt.artifact","version":1,"kind":"callout","title":"Key idea","data":{"body":"Selection reduces relation size.","tone":"idea"}}
\`\`\``;

const LEGACY = `Legacy viz:

\`\`\`artifact-html
<div id="viz">interactive</div>
\`\`\``;

const VALID_TRANSFORMED = `\`\`\`artifact
{"schema":"studygpt.artifact","version":1,"kind":"callout","title":"Key idea","data":{"body":"Selection cuts rows early.","tone":"idea"}}
\`\`\``;

const INVALID_TRANSFORMED = `\`\`\`artifact
{"schema":"studygpt.artifact","version":1,"kind":"chart","data":{"chartType":"line","labels":["a"],"series":[{"label":"x","values":["not-a-number"]}]}"}
\`\`\``;

const MULTI_FENCE = `\`\`\`artifact
{"schema":"studygpt.artifact","version":1,"kind":"callout","data":{"body":"one"}}
\`\`\`
\`\`\`artifact
{"schema":"studygpt.artifact","version":1,"kind":"callout","data":{"body":"two"}}
\`\`\``;

function makeMessage(id: string, content: string, conversationId = "c1"): Message {
  return {
    id,
    conversation_id: conversationId,
    role: "assistant",
    content,
    kind: "chat",
    delivery_state: "complete",
    attachments: null,
    tokens: null,
    created_at: 1_000,
  };
}

const CONVERSATION: Conversation = {
  id: "c1",
  title: "DB",
  mode: "chat",
  model: "glm-5.2:cloud",
  project_id: null,
  created_at: 1_000,
};

type Stored = { id: string; artifactId: string; payload: NativeArtifact; instruction: string | null };
function makeDeps(overrides: Partial<{
  getMessage: (id: string) => Message | null;
  generate: (prompt: string, signal: AbortSignal) => Promise<string>;
}> = {}) {
  const store: Stored[] = [];
  let counter = 0;
  const createArtifactVersion = (input: {
    artifactId: string; payload: NativeArtifact; instruction: string | null;
  }) => {
    const version = { id: `v${counter++}`, artifactId: input.artifactId, payload: input.payload, instruction: input.instruction };
    store.push(version);
    return version;
  };
  return {
    store,
    createArtifactVersion,
    getMessage: overrides.getMessage ?? ((id: string) => (id === "m1" ? makeMessage("m1", CALLOUT) : null)),
    getConversation: (_id: string) => CONVERSATION,
    getActiveArtifactVersion: (_artifactId: string) => null,
    buildContextBlock: async () => "",
    generate: overrides.generate ?? (async () => VALID_TRANSFORMED),
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/artifacts/m1:artifact:0/transform", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("returns 400 when the requested artifact is a legacy HTML fence", async () => {
  const deps = makeDeps({ getMessage: () => makeMessage("m1", LEGACY) });
  const POST = createArtifactTransformHandler(deps);
  const response = await POST(request({ artifactId: "m1:artifact:0", instruction: "simplify" }));
  assert.equal(response.status, 400);
});

test("persists a validated transformed native artifact as the active version", async () => {
  const deps = makeDeps();
  const POST = createArtifactTransformHandler(deps);
  const response = await POST(request({ artifactId: "m1:artifact:0", instruction: "make it shorter" }));
  assert.equal(response.status, 201);
  assert.equal(deps.store.length, 1);
  assert.equal(deps.store[0].payload.kind, "callout");
  assert.equal(deps.store[0].instruction, "make it shorter");
  const body = await response.json();
  assert.equal(body.artifact.kind, "callout");
  assert.ok(body.versionId);
});

test("rejects an invalid transformed payload without creating a version", async () => {
  const deps = makeDeps({ generate: async () => INVALID_TRANSFORMED });
  const POST = createArtifactTransformHandler(deps);
  const response = await POST(request({ artifactId: "m1:artifact:0", instruction: "simplify" }));
  assert.equal(response.status, 422);
  assert.equal(deps.store.length, 0);
});

test("rejects a multi-fence model response without creating a version", async () => {
  const deps = makeDeps({ generate: async () => MULTI_FENCE });
  const POST = createArtifactTransformHandler(deps);
  const response = await POST(request({ artifactId: "m1:artifact:0", instruction: "simplify" }));
  assert.equal(response.status, 502);
  assert.equal(deps.store.length, 0);
});

test("returns 404 for an unknown artifact id shape", async () => {
  const deps = makeDeps();
  const POST = createArtifactTransformHandler(deps);
  const response = await POST(request({ artifactId: "not-an-artifact-id", instruction: "simplify" }));
  assert.equal(response.status, 404);
});

test("returns 400 for a missing instruction", async () => {
  const deps = makeDeps();
  const POST = createArtifactTransformHandler(deps);
  const response = await POST(request({ artifactId: "m1:artifact:0", instruction: "   " }));
  assert.equal(response.status, 400);
});
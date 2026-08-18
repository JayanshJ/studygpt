import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactGetHandler, createArtifactPatchHandler } from "@/lib/chat/artifact-route";
import type { Message, ArtifactVersion } from "@/lib/db/schema";
import type { NativeArtifact } from "@/lib/artifacts/schema";

const CALLOUT = `\`\`\`artifact
{"schema":"studygpt.artifact","version":1,"kind":"callout","title":"Key idea","data":{"body":"Selection reduces relation size.","tone":"idea"}}
\`\`\``;

const LEGACY = `\`\`\`artifact-html
<div id="viz">interactive</div>
\`\`\``;

const CALLOUT_PAYLOAD: NativeArtifact = {
  schema: "studygpt.artifact",
  version: 1,
  kind: "callout",
  title: "Key idea",
  data: { body: "Selection cuts rows early.", tone: "idea" },
};

function makeMessage(id: string, content: string): Message {
  return {
    id,
    conversation_id: "c1",
    role: "assistant",
    content,
    kind: "chat",
    delivery_state: "complete",
    attachments: null,
    tokens: null,
    created_at: 1_000,
  };
}

function version(over: Partial<ArtifactVersion> = {}): ArtifactVersion {
  return {
    id: "v1",
    artifact_id: "m1:artifact:0",
    parent_version_id: null,
    source_message_id: "m1",
    payload: CALLOUT_PAYLOAD,
    instruction: "make it shorter",
    active: true,
    created_at: 2_000,
    ...over,
  };
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("GET returns the immutable payload when no active version exists", async () => {
  const GET = createArtifactGetHandler({
    getMessage: () => makeMessage("m1", CALLOUT),
    getActiveArtifactVersion: () => null,
    listArtifactVersions: () => [],
  });
  const response = await GET(new Request("http://localhost/api/artifacts/m1:artifact:0"), context("m1:artifact:0"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.active.versionId, null);
  assert.equal(body.active.payload.kind, "callout");
  assert.equal(body.entry.kind, "callout");
  assert.equal(body.ordinal, 0);
});

test("GET returns the active version payload plus bounded history", async () => {
  const GET = createArtifactGetHandler({
    getMessage: () => makeMessage("m1", CALLOUT),
    getActiveArtifactVersion: () => version({ id: "v2" }),
    listArtifactVersions: () => [version({ id: "v2", active: true }), version({ id: "v1", active: false, instruction: "orig" })],
  });
  const response = await GET(new Request("http://localhost/api/artifacts/m1:artifact:0"), context("m1:artifact:0"));
  const body = await response.json();
  assert.equal(body.active.versionId, "v2");
  assert.equal(body.history.length, 2);
  assert.equal(body.history[0].id, "v2");
  assert.equal(body.history[0].active, true);
});

test("GET returns 404 for a legacy HTML fence", async () => {
  const GET = createArtifactGetHandler({
    getMessage: () => makeMessage("m1", LEGACY),
    getActiveArtifactVersion: () => null,
    listArtifactVersions: () => [],
  });
  const response = await GET(new Request("http://localhost/api/artifacts/m1:artifact:0"), context("m1:artifact:0"));
  assert.equal(response.status, 404);
});

test("PATCH activates a known version and returns its payload", async () => {
  let activated: { artifactId: string; versionId: string } | null = null;
  const PATCH = createArtifactPatchHandler({
    getMessage: () => makeMessage("m1", CALLOUT),
    activateArtifactVersion: (artifactId, versionId) => {
      activated = { artifactId, versionId };
      return version({ id: versionId });
    },
  });
  const response = await PATCH(
    new Request("http://localhost/api/artifacts/m1:artifact:0", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: "v1" }),
    }),
    context("m1:artifact:0"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(activated, { artifactId: "m1:artifact:0", versionId: "v1" });
  const body = await response.json();
  assert.equal(body.versionId, "v1");
  assert.equal(body.artifact.kind, "callout");
});

test("PATCH returns 404 for an unknown version id", async () => {
  const PATCH = createArtifactPatchHandler({
    getMessage: () => makeMessage("m1", CALLOUT),
    activateArtifactVersion: () => null,
  });
  const response = await PATCH(
    new Request("http://localhost/api/artifacts/m1:artifact:0", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: "nope" }),
    }),
    context("m1:artifact:0"),
  );
  assert.equal(response.status, 404);
});

test("PATCH returns 404 for a legacy HTML fence", async () => {
  const PATCH = createArtifactPatchHandler({
    getMessage: () => makeMessage("m1", LEGACY),
    activateArtifactVersion: () => null,
  });
  const response = await PATCH(
    new Request("http://localhost/api/artifacts/m1:artifact:0", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: "v1" }),
    }),
    context("m1:artifact:0"),
  );
  assert.equal(response.status, 404);
});
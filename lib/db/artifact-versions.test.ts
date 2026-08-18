import { test } from "node:test";
import assert from "node:assert/strict";

// Set BEFORE any import of @/lib/db so the singleton opens an in-memory DB
// (a fresh one per test process). The require() below is NOT hoisted, so it
// runs after this assignment. (Static `import` would hoist above the env set
// and open the on-disk DB; top-level `await import` is unavailable under the
// project's CJS tsx transpile.)
process.env.DATABASE_URL = ":memory:";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const artifactVersionsModule = require("./artifact-versions") as typeof import("./artifact-versions");
const { createArtifactVersion, getActiveArtifactVersion, activateArtifactVersion, listArtifactVersions } = artifactVersionsModule;
import type { CreateArtifactVersionInput } from "./artifact-versions";
import type { NativeArtifact } from "@/lib/artifacts/schema";

const callout: NativeArtifact = {
  schema: "studygpt.artifact",
  version: 1,
  kind: "callout",
  data: { label: "Idea", body: "Cache the result", tone: "idea" },
};

const table: NativeArtifact = {
  schema: "studygpt.artifact",
  version: 1,
  kind: "table",
  title: "Selection pushdown",
  data: { columns: ["Rule"], rows: [["Push σ down"]] },
};

// The store uses a monotonic created_at (lib/db/artifact-versions.ts), so
// ordering is deterministic without a test clock — seeds only vary the
// payload/instruction, not the timestamp.
function seed(over: Partial<CreateArtifactVersionInput> = {}): CreateArtifactVersionInput {
  return {
    artifactId: "m1:artifact:0",
    parentVersionId: null,
    sourceMessageId: "m1",
    payload: callout,
    instruction: null,
    ...over,
  };
}

test("getActiveArtifactVersion returns the newly created version", () => {
  const v = createArtifactVersion(seed());
  assert.equal(getActiveArtifactVersion("m1:artifact:0")?.id, v.id);
  assert.equal(v.active, true);
  assert.equal(v.parent_version_id, null);
  assert.equal(v.artifact_id, "m1:artifact:0");
  assert.equal(v.source_message_id, "m1");
  assert.equal(v.payload.kind, "callout");
});

test("creating a second version deactivates the first and activates the new one", () => {
  const artifactId = "m2:artifact:0";
  const first = createArtifactVersion(seed({ artifactId, payload: callout }));
  const second = createArtifactVersion(seed({ artifactId, payload: table, parentVersionId: first.id }));
  assert.equal(getActiveArtifactVersion(artifactId)?.id, second.id);
  const list = listArtifactVersions(artifactId);
  assert.equal(list.find((v) => v.id === first.id)?.active, false);
  assert.equal(list.find((v) => v.id === second.id)?.active, true);
  assert.equal(second.parent_version_id, first.id);
});

test("activating a version makes it the only active version for the artifact", () => {
  const artifactId = "m3:artifact:0";
  const first = createArtifactVersion(seed({ artifactId, payload: callout }));
  const second = createArtifactVersion(seed({ artifactId, payload: table, parentVersionId: first.id }));
  // second is active now; activate first again
  const restored = activateArtifactVersion(artifactId, first.id);
  assert.equal(restored?.id, first.id);
  assert.equal(getActiveArtifactVersion(artifactId)?.id, first.id);
  assert.equal(
    listArtifactVersions(artifactId).find((v) => v.id === second.id)?.active,
    false,
  );
});

test("activateArtifactVersion returns null for an unknown version id", () => {
  const artifactId = "m4:artifact:0";
  createArtifactVersion(seed({ artifactId, payload: callout }));
  assert.equal(activateArtifactVersion(artifactId, "does-not-exist"), null);
  // the existing active version is unchanged
  assert.ok(getActiveArtifactVersion(artifactId));
});

test("rejects a payload that is not a canonical native artifact", () => {
  assert.throws(
    () => createArtifactVersion(seed({ payload: { kind: "chart" } as unknown as NativeArtifact })),
    /Invalid native artifact/,
  );
});

test("listArtifactVersions is bounded to 20 and keeps the newest", () => {
  const artifactId = "m5:artifact:0";
  const ids: string[] = [];
  for (let i = 0; i < 22; i++) {
    const v = createArtifactVersion(
      seed({ artifactId, payload: i % 2 === 0 ? callout : table, instruction: `v${i}` }),
    );
    ids.push(v.id);
  }
  const list = listArtifactVersions(artifactId);
  assert.equal(list.length, 20);
  // newest first → the last 20 created, ordered by created_at desc
  const expected = ids.slice(2); // first two evicted
  assert.deepEqual(
    list.map((v) => v.id),
    [...expected].reverse(),
  );
  // the just-active (newest) one is active
  assert.equal(list[0].active, true);
});

test("listArtifactVersions is newest first by created_at", () => {
  const artifactId = "m6:artifact:0";
  const a = createArtifactVersion(seed({ artifactId, payload: callout }));
  const b = createArtifactVersion(seed({ artifactId, payload: table }));
  const list = listArtifactVersions(artifactId);
  assert.deepEqual(
    list.map((v) => v.id),
    [b.id, a.id],
  );
});

test("payload is JSON-parsed into a NativeArtifact on read", () => {
  const v = createArtifactVersion(seed({ payload: table }));
  const active = getActiveArtifactVersion(v.artifact_id)!;
  assert.equal(active.payload.kind, "table");
  assert.deepEqual(active.payload.data.columns, ["Rule"]);
});
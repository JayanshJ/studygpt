import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("overlay resolver validates source context before resolving a durable thread", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

  assert.match(source, /\blistConversationMessagesThrough\b/);
  assert.match(source, /\bresolveOverlayThread\b/);
  assert.match(source, /\blistOverlayMessages\b/);
});

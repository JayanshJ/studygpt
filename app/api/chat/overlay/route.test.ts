import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("overlay stream persists only overlay turns, never normal chat messages", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

  assert.equal(
    /\b(addMessage|upsertMessage|setMessageSources|setMessageTokens|updateConversationTitle|deleteMessage|deleteMessagesAfter)\b/.test(source),
    false,
  );
  assert.match(source, /\baddOverlayMessage\b/);
  assert.match(source, /\blistOverlayMessages\b/);
});

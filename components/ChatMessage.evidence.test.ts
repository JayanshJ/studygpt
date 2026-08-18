import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("delegates persisted sources to the citation strip without fetching previews", async () => {
  const source = await readFile(new URL("./ChatMessage.tsx", import.meta.url), "utf8");

  assert.match(source, /onOpenSource\?: \(source: SourceEntry\) => void/);
  assert.match(source, /<SourceCitationStrip sources=\{sources \?\? \[\]\} onOpenSource=\{onOpenSource\} \/>/);
  assert.doesNotMatch(source, /\/evidence\?page=/);
});

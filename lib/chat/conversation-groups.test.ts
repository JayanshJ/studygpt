import assert from "node:assert/strict";
import test from "node:test";
import { groupConversationsByRecency } from "./conversation-groups";

// Fixed reference instant so the buckets are deterministic in any timezone:
// Saturday 2026-08-22, 15:00 local time.
const NOW = new Date(2026, 7, 22, 15, 0).getTime();

const convo = (id: string, created_at: number) => ({ id, title: id, created_at });

test("buckets conversations into Today / Yesterday / Previous 7 days / Earlier", () => {
  const groups = groupConversationsByRecency(
    [
      convo("week", new Date(2026, 7, 17, 12, 0).getTime()),
      convo("earlier", new Date(2026, 4, 1, 12, 0).getTime()),
      convo("yesterday", new Date(2026, 7, 21, 23, 30).getTime()),
      convo("today", new Date(2026, 7, 22, 9, 0).getTime()),
    ],
    NOW,
  );

  assert.deepEqual(
    groups.map((g) => g.label),
    ["Today", "Yesterday", "Previous 7 days", "Earlier"],
  );
  assert.deepEqual(groups[0].items.map((c) => c.id), ["today"]);
  assert.deepEqual(groups[1].items.map((c) => c.id), ["yesterday"]);
  assert.deepEqual(groups[2].items.map((c) => c.id), ["week"]);
  assert.deepEqual(groups[3].items.map((c) => c.id), ["earlier"]);
});

test("empty groups are omitted — headers only render when they have rows", () => {
  const groups = groupConversationsByRecency([convo("old", new Date(2025, 0, 1).getTime())], NOW);
  assert.deepEqual(groups.map((g) => g.label), ["Earlier"]);
});

test("a conversation from just after local midnight lands in Today", () => {
  const justAfterMidnight = new Date(2026, 7, 22, 0, 1).getTime();
  const groups = groupConversationsByRecency([convo("edge", justAfterMidnight)], NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Today");
});

test("input order is preserved within a bucket", () => {
  const groups = groupConversationsByRecency(
    [
      convo("second", new Date(2026, 7, 22, 10, 0).getTime()),
      convo("first", new Date(2026, 7, 22, 8, 0).getTime()),
    ],
    NOW,
  );
  assert.deepEqual(groups[0].items.map((c) => c.id), ["second", "first"]);
});

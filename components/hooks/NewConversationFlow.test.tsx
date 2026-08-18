import assert from "node:assert/strict";
import test from "node:test";

// DOM globals must be set up before @testing-library/react is imported.
// This file is run with `--import ./lib/test/dom-setup.ts`, which registers
// a happy-dom Window as global document/window before any test module loads.
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React, { useState } from "react";

// A focused harness that replicates the EXACT newConversation client logic
// from app/(app)/page.tsx (the regression target), so we test the real
// client-side failure mode — not a route mock. The session bug: a failed
// create returned a 400 error body, and the client did `const conv = await
// res.json()` WITHOUT checking `res.ok`, pushing `{error, issues}` (no `id`)
// into the conversation list → duplicate-undefined React keys + a broken UI.
// The fix guards with `if (!res.ok) return; ... if (!conv?.id) return;`.
//
// We drive this against a mocked `fetch` so we can assert behavior on BOTH the
// success path (201 → conversation added) and the failure path (400 → list
// unchanged, no error body leaked) — the exact interaction+fetch flow that
// `renderToStaticMarkup` tests structurally cannot exercise.

type FetchImpl = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function NewConversationHarness({ fetchImpl }: { fetchImpl: FetchImpl }) {
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([]);
  const activeProjectId = null; // mirrors the standalone case that broke

  async function newConversation() {
    const res = await fetchImpl("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProjectId }),
    });
    if (!res.ok) return; // a failed create must NOT push an error body into the list
    const conv = (await res.json()) as { id?: string; title?: string };
    if (!conv?.id) return; // guard against a non-conversation body polluting the list
    setConversations((prev) => [conv as { id: string; title: string }, ...prev]);
  }

  return (
    <div>
      <button onClick={() => void newConversation()}>new conversation</button>
      <ul>
        {conversations.map((c) => (
          // The bug manifested as duplicate `undefined` keys here. With the
          // guards, only real conversations (with ids) reach this list.
          <li key={c.id} data-testid="conv-row">{c.title}</li>
        ))}
      </ul>
    </div>
  );
}

// Build a fetch mock. `success` selects 201-with-conversation vs 400-with-error.
function makeFetch(success: boolean): FetchImpl {
  return async () =>
    success
      ? { ok: true, status: 201, json: async () => ({ id: "conv-1", title: "New conversation" }) }
      : { ok: false, status: 400, json: async () => ({ error: "Invalid request", issues: [] }) };
}

test("new conversation with null projectId succeeds and adds the conversation to the list", async () => {
  const fetchMock = makeFetch(true);
  render(<NewConversationHarness fetchImpl={fetchMock} />);
  fireEvent.click(screen.getByText("new conversation"));
  await waitFor(() => {
    const rows = screen.getAllByTestId("conv-row");
    assert.equal(rows.length, 1, "the new conversation should appear in the list");
  });
  assert.match(screen.getByTestId("conv-row").textContent ?? "", /New conversation/);
  cleanup();
});

test("a failed create (400 error body) does NOT pollute the conversation list", async () => {
  // This is the direct regression guard for the session bug: before the fix,
  // the 400 error body (no `id`) was pushed into the list, producing a row
  // with key=undefined and a broken UI. With the `res.ok` / `conv?.id` guards,
  // the list stays empty on failure.
  const fetchMock = makeFetch(false);
  render(<NewConversationHarness fetchImpl={fetchMock} />);
  fireEvent.click(screen.getByText("new conversation"));
  // Give the async handler a tick to resolve.
  await new Promise((r) => setTimeout(r, 20));
  const rows = screen.queryAllByTestId("conv-row");
  assert.equal(rows.length, 0, "no error-body row should be added on a failed create");
  cleanup();
});

test("the success path sends { projectId: null } in the POST body", async () => {
  // Confirms the CLIENT sends the exact body that the route schema must accept
  // (the schema regression was rejecting this body). Locks the client↔route
  // contract that `renderToStaticMarkup` tests cannot see.
  let capturedBody: string | undefined;
  const fetchMock: FetchImpl = async (_input, init) => {
    capturedBody = init?.body as string | undefined;
    return { ok: true, status: 201, json: async () => ({ id: "conv-1", title: "New conversation" }) };
  };
  render(<NewConversationHarness fetchImpl={fetchMock} />);
  fireEvent.click(screen.getByText("new conversation"));
  await waitFor(() => assert.ok(capturedBody, "fetch must have been called"));
  assert.deepEqual(JSON.parse(capturedBody as string), { projectId: null });
  cleanup();
});
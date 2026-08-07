import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreChunks, type ChunkEmb } from "./index";

function chunk(materialId: string, ordinal: number, text: string, emb: number[]): ChunkEmb {
  return {
    materialId,
    ordinal,
    text,
    materialTitle: materialId,
    embedding: Buffer.from(new Float32Array(emb).buffer),
  };
}
function vec(x: number, y: number): Float32Array {
  const v = new Float32Array([x, y]);
  const n = Math.hypot(x, y) || 1;
  v[0] /= n; v[1] /= n;
  return v;
}

test("scoreChunks ranks by cosine, applies floor, sorts desc", () => {
  const q = vec(1, 0);
  const chunks = [
    chunk("m1", 0, "low", [0, 1]),     // sim 0 → below floor
    chunk("m1", 1, "mid", [0.3, 0.95]), // sim ~0.3 → above floor
    chunk("m2", 0, "high", [1, 0.05]),  // sim ~0.998 → top
  ];
  const scored = scoreChunks(q, chunks, { floor: 0.22 });
  assert.equal(scored.length, 2); // the 0-sim chunk filtered out
  assert.equal(scored[0].c.materialId, "m2");
  assert.equal(scored[1].c.materialId, "m1");
  assert.ok(scored[0].sim >= scored[1].sim);
  // No-mastery baseline: score === sim.
  assert.ok(Math.abs(scored[0].score - scored[0].sim) < 1e-6);
});

test("scoreChunks default floor is 0.22", () => {
  const q = vec(1, 0);
  const chunks = [chunk("m1", 0, "x", [0.1, 0.995])]; // sim ~0.1
  assert.equal(scoreChunks(q, chunks).length, 0);
});

test("scoreChunks with no eligible chunks returns []", () => {
  const q = vec(1, 0);
  assert.equal(scoreChunks(q, []).length, 0);
});
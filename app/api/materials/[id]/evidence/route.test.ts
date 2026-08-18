import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceGetHandler } from "@/lib/chat/evidence-route";
import type { Material } from "@/lib/db/schema";

const PDF_MATERIAL = {
  id: "17a1d6d5-3f62-4d92-b0ca-1b9281f6c5e2",
  title: "Slides",
  source_type: "pdf",
} as Material;
const URL_MATERIAL = {
  id: "67fa29c2-52d4-4b9b-9d63-5fd8d26ba87b",
  title: "Article",
  source_type: "url",
} as Material;

function request(id: string, page = "7") {
  return new Request(`http://localhost/api/materials/${id}/evidence?page=${page}`);
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("returns a JPEG response for an available PDF page", async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const getEvidence = createEvidenceGetHandler({
    getMaterial: () => PDF_MATERIAL,
    ensurePageImages: async () => true,
    loadPageImage: () => image,
  });

  const response = await getEvidence(request(PDF_MATERIAL.id), context(PDF_MATERIAL.id));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
});

test("returns a generic 404 for unavailable pages and missing materials", async () => {
  const getEvidence = createEvidenceGetHandler({
    getMaterial: (id) => id === PDF_MATERIAL.id ? PDF_MATERIAL : undefined,
    ensurePageImages: async () => true,
    loadPageImage: () => null,
  });
  const unknownId = "cbcd9b5d-17d7-4655-9097-fd06e46c20f1";

  const unavailable = await getEvidence(request(PDF_MATERIAL.id), context(PDF_MATERIAL.id));
  const missing = await getEvidence(request(unknownId), context(unknownId));

  assert.equal(unavailable.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await unavailable.json(), { error: "Not found" });
  assert.deepEqual(await missing.json(), { error: "Not found" });
});

test("does not render pages for URL materials", async () => {
  let ensureCalls = 0;
  let loadCalls = 0;
  const getEvidence = createEvidenceGetHandler({
    getMaterial: () => URL_MATERIAL,
    ensurePageImages: async () => {
      ensureCalls++;
      return true;
    },
    loadPageImage: () => {
      loadCalls++;
      return Buffer.from([]);
    },
  });

  const response = await getEvidence(request(URL_MATERIAL.id), context(URL_MATERIAL.id));

  assert.equal(response.status, 404);
  assert.equal(ensureCalls, 0);
  assert.equal(loadCalls, 0);
});

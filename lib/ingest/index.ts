import { extractText, getMeta, getDocumentProxy } from "unpdf";
import { convert as htmlToText } from "html-to-text";
import { updateMaterialStatus, addChunks } from "@/lib/db/materials";
import { embedManyTexts, encodeEmbedding } from "@/lib/embed";
import { safeFetch } from "./ssrf";
import { chunkText } from "./chunk";
import { saveSourcePdf, renderPdfPages } from "./pdf-pages";

// Pure chunking lives in ./chunk (shared with the chunk-page back-fill
// migration). Re-exported here for existing callers.
export { chunkText };

// --- Extraction helpers (called by the materials route) ----------------------

export async function extractPdf(
  bytes: Uint8Array,
): Promise<{ text: string; title?: string }> {
  // unpdf exposes `extractText` (not `extractPdf`) and a separate `getMeta`
  // for document metadata. Reuse one parsed document proxy for both calls so we
  // don't parse the file twice.
  //
  // CRITICAL: extract the text PER PAGE (mergePages: false → string[]) and join
  // with a form feed (\f). mergePages: true joins pages with "\n" and loses the
  // page boundaries, so chunkText's form-feed split (chunk↔page 1:1) collapses
  // every chunk onto page 1 — which breaks the diagram notation pipeline's
  // ability to load the right slide image. The form feed is the durable page
  // boundary the chunker and the back-fill rely on.
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  let title: string | undefined;
  try {
    const { info } = await getMeta(pdf);
    const t = info?.Title;
    title = typeof t === "string" && t.trim() ? t.trim() : undefined;
  } catch {
    // Metadata is best-effort; ignore failures.
  }
  const pages = Array.isArray(text) ? text : [text ?? ""];
  return { text: pages.join("\f"), title };
}

// Extract the text of each PDF page as a separate string (1-indexed by array
// position). Used by the heal path to map existing chunks onto their page
// without re-ingesting: each chunk's text is matched against the per-page text
// to recover the page number the original (page-boundary-losing) extraction
// dropped.
export async function extractPdfPages(
  bytes: Uint8Array,
): Promise<{ pages: string[]; title?: string }> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  let title: string | undefined;
  try {
    const { info } = await getMeta(pdf);
    const t = info?.Title;
    title = typeof t === "string" && t.trim() ? t.trim() : undefined;
  } catch {
    // Metadata is best-effort; ignore failures.
  }
  const pages = Array.isArray(text) ? text : [text ?? ""];
  return { pages, title };
}

export async function extractUrl(
  url: string,
): Promise<{ text: string; title?: string }> {
  // SSRF guard: scheme allow-list + private/loopback/link-local/metadata
  // range blocking on every resolved address, with manual redirect handling
  // so a public URL can't 302 to an internal host. See lib/ingest/ssrf.ts.
  // Residual (documented there): DNS rebinding is not fully closed.
  const res = await safeFetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "StudyGPT/1.0 (study companion)" },
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  const html = await res.text();
  const text = htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" },
    ],
  });
  // Best-effort <title> extraction; fall back to undefined.
  let title: string | undefined;
  try {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    title = titleMatch?.[1]?.trim() || undefined;
  } catch {
    title = undefined;
  }
  return { text, title };
}

// Heal an existing material from its source PDF: retain the PDF on disk and
// render its page images. Used by heal-on-reupload (re-uploading a file whose
// name matches an existing deck that was ingested before page-image rendering
// existed). Does NOT re-ingest: chunks, embeddings, and the concept graph are
// left untouched. The notation pipeline then has page images to show the vision
// model (via the precise chunk→page mapping for new decks, or the spread
// fallback for old decks whose chunks are page-ambiguous). Returns the number
// of page images rendered.
export async function healMaterialFromPdf(materialId: string, bytes: Uint8Array): Promise<number> {
  saveSourcePdf(materialId, bytes);
  try {
    const pages = await renderPdfPages(bytes, materialId);
    return pages.length;
  } catch (e) {
    console.error(`[healMaterialFromPdf] ${materialId} render failed:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

// --- Ingestion: chunk, embed, store, set status ------------------------------
// Text-centric: the route has already extracted text (via extractPdf/extractUrl
// or otherwise). We chunk it, embed in batches, persist the chunks, and flip the
// material to `ready` (with charCount + text) or `error` (with a message) so a
// material is never left stuck in `processing`.
export async function ingestFromText(materialId: string, text: string): Promise<void> {
  try {
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      updateMaterialStatus(materialId, "error", {
        error: "No text could be extracted.",
      });
      return;
    }
    const embeddings = await embedManyTexts(chunks.map((c) => c.text));
    // Insert all chunks in one transaction so a mid-loop failure leaves no
    // partial chunks. A throw propagates to the catch → updateMaterialStatus(error).
    addChunks(
      materialId,
      chunks.map((c, i) => ({
        text: c.text,
        embedding: encodeEmbedding(embeddings[i]),
        ordinal: i,
        page: c.page,
      })),
    );
    updateMaterialStatus(materialId, "ready", { charCount: text.length, text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ingestion failed";
    updateMaterialStatus(materialId, "error", { error: msg });
  }
}
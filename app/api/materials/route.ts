import { NextResponse } from "next/server";
import { createMaterial, getMaterial, getProject, updateMaterialStatus, findPdfMaterialByRef } from "@/lib/db";
import { getModelConfig, getProvider } from "@/lib/llm/provider";
import { extractPdf, extractUrl, ingestFromText, healMaterialFromPdf } from "@/lib/ingest";
import { saveSourcePdf, renderPdfPages, hasSourcePdf } from "@/lib/ingest/pdf-pages";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// POST /api/materials — multipart/form-data: { projectId, title?, file? | url? }
// or JSON: { projectId, title?, url }. Creates a material (status=processing),
// extracts text, ingests (chunks+embeds) synchronously, and returns the material
// row (status will be `ready` or `error` by the time we respond).
//
// Multipart route: body is form-data (file upload) OR JSON, not a single JSON
// shape, so validateBody (JSON-only) does not apply. The existing formData/json
// parsing + projectId/url guards below are kept as-is; this wrapper only adds
// the error boundary (catch + sanitized 500).
export const POST = withRouteHandlerNoParams(async ({ request: req }) => {
  const contentType = req.headers.get("content-type") || "";
  let projectId: string | undefined;
  let title: string | undefined;
  let url: string | undefined;
  let pdfBytes: Uint8Array | undefined;
  let fileName: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    projectId = String(form.get("projectId") || "");
    title = (form.get("title") as string) || undefined;
    url = (form.get("url") as string) || undefined;
    const file = form.get("file");
    if (file && file instanceof File) {
      pdfBytes = new Uint8Array(await file.arrayBuffer());
      fileName = file.name;
    }
  } else {
    const body = await req.json().catch(() => ({}));
    projectId = body.projectId;
    title = body.title;
    url = body.url;
  }

  if (!projectId || !getProject(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }
  if (!pdfBytes && !url) {
    return NextResponse.json({ error: "Provide a pdf file or a url" }, { status: 400 });
  }

  const sourceType = pdfBytes ? "pdf" : "url";
  // For PDFs, prefer the uploaded filename (stripped of .pdf) as the reference
  // and title fallback — so materials are named after the file, not "uploaded.pdf".
  const baseName = fileName ? fileName.replace(/\.pdf$/i, "") : undefined;
  const sourceRef = pdfBytes ? baseName || title || "uploaded.pdf" : url!;

  // Heal-on-reupload: if a PDF is uploaded whose filename matches an EXISTING
  // deck in this project that was ingested before page-image rendering existed
  // (so it has no retained source PDF), heal that deck instead of creating a
  // duplicate. Healing = retain the PDF + render page images. No re-ingest, so
  // chunks/embeddings/concept graph stay intact (no rebuild). This is the
  // one-time, no-rebuild path to make old decks notation-aware.
  if (pdfBytes && baseName) {
    const existing = findPdfMaterialByRef(projectId, baseName);
    if (existing && !hasSourcePdf(existing.id)) {
      const rendered = await healMaterialFromPdf(existing.id, pdfBytes);
      console.log(`[heal] re-upload attached PDF to existing material ${existing.id}; rendered ${rendered} page images`);
      return NextResponse.json(getMaterial(existing.id), { status: 200 });
    }
  }

  const material = createMaterial({
    projectId,
    title: title?.trim() || sourceRef,
    sourceType,
    sourceRef,
  });

  // Retain the source PDF so page images can be (re-)rendered on demand later
  // (lazy render on first diagram turn, or future re-extraction). Without this,
  // a one-shot render failure or a feature added after upload leaves the
  // material with no page images and no way to recover short of re-uploading.
  if (pdfBytes) {
    try {
      saveSourcePdf(material.id, pdfBytes);
    } catch (e) {
      console.error(`[saveSourcePdf] ${material.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Preflight the embedding model before extraction+ingestion. If the
  // embedding model (default nomic-embed-text) isn't pulled, ingestion would
  // otherwise throw a messy Ollama API error; this surfaces the clean
  // "Pull it with `ollama pull nomic-embed-text`" message instead.
  try {
    const cfg = getModelConfig();
    const provider = getProvider(cfg.provider);
    if (provider.validateEmbedding) {
      await provider.validateEmbedding({ model: cfg.embeddingModel, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    }
  } catch (err) {
    updateMaterialStatus(material.id, "error", {
      error: err instanceof Error ? err.message : "Embedding model unavailable",
    });
    return NextResponse.json(getMaterial(material.id), { status: 502 });
  }

  // Extract + ingest synchronously. On failure, mark the material errored.
  try {
    const text = pdfBytes
      ? (await extractPdf(pdfBytes)).text
      : (await extractUrl(url!)).text;
    await ingestFromText(material.id, text);
  } catch (err) {
    updateMaterialStatus(material.id, "error", {
      error: err instanceof Error ? err.message : "Extraction failed",
    });
  }

  // Best-effort: render each PDF page to a JPEG on disk so the diagram vision
  // pipeline can feed the relevant slide pages to a vision model (text
  // extraction loses the diagram notation, which lives in the page images).
  // Non-fatal — a render failure never blocks text ingestion; the material is
  // already `ready`/`error` from ingestFromText above.
  if (pdfBytes) {
    // Best-effort, but LOG on failure: a silent catch here leaves the diagram
    // notation pipeline with no page images and the only symptom is "diagrams
    // don't follow my notation" — impossible to debug. Surface the error so a
    // mupdf/WASM runtime failure shows up in the server log.
    await renderPdfPages(pdfBytes, material.id).catch((e) => {
      console.error(`[renderPdfPages] ${material.id} failed:`, e instanceof Error ? e.message : e);
    });
  }

  // Re-read so the response reflects the final status/text/error.
  return NextResponse.json(getMaterial(material.id), { status: 201 });
});
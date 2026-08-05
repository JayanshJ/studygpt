import { NextResponse } from "next/server";
import { createMaterial, getMaterial, getProject, updateMaterialStatus } from "@/lib/db";
import { extractPdf, extractUrl, ingestFromText } from "@/lib/ingest";

// POST /api/materials — multipart/form-data: { projectId, title?, file? | url? }
// or JSON: { projectId, title?, url }. Creates a material (status=processing),
// extracts text, ingests (chunks+embeds) synchronously, and returns the material
// row (status will be `ready` or `error` by the time we respond).
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  let projectId: string | undefined;
  let title: string | undefined;
  let url: string | undefined;
  let pdfBytes: Uint8Array | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    projectId = String(form.get("projectId") || "");
    title = (form.get("title") as string) || undefined;
    url = (form.get("url") as string) || undefined;
    const file = form.get("file");
    if (file && file instanceof File) pdfBytes = new Uint8Array(await file.arrayBuffer());
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
  const sourceRef = pdfBytes ? title || "uploaded.pdf" : url!;
  const material = createMaterial({
    projectId,
    title: title?.trim() || sourceRef,
    sourceType,
    sourceRef,
  });

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

  // Re-read so the response reflects the final status/text/error.
  return NextResponse.json(getMaterial(material.id), { status: 201 });
}
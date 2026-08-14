import { NextResponse } from "next/server";
import { db, getMaterial } from "@/lib/db";
import { ingestFromText } from "@/lib/ingest";

// POST /api/materials/[id]/rechunk — re-chunk an existing material from its
// stored text without re-fetching the source. Used after the chunking
// granularity changes (e.g. TARGET raised to cut the per-chunk LLM call count):
// wipe the old chunks + extraction record, re-run chunkText+embed on the
// stored text, and flip back to ready. The next build re-extracts (the
// extraction record is gone, so it isn't skipped) using the new chunk shape.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const material = getMaterial(id);
  if (!material) return NextResponse.json({ error: "Material not found" }, { status: 404 });
  if (!material.text) return NextResponse.json({ error: "Material has no text to re-chunk" }, { status: 400 });

  // Drop old chunks + the extraction record so re-ingestion starts clean.
  // (material_extractions has no FK to materials, so delete it explicitly.)
  db.prepare("DELETE FROM chunks WHERE material_id = ?").run(id);
  db.prepare("DELETE FROM material_extractions WHERE material_id = ?").run(id);

  // ingestFromText chunks + embeds + sets status ready/error. It doesn't
  // delete old chunks, which is why we did that above.
  await ingestFromText(id, material.text);
  return NextResponse.json(getMaterial(id));
}
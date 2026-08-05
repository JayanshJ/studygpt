import { NextResponse } from "next/server";
import { getMessageSources } from "@/lib/db";

// GET /api/messages/[id] — sources for a message, fetched by the Sources panel
// after a live stream. Sources are keyed by message id, so no conversation
// lookup is needed.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ sources: getMessageSources(id) });
}
import { NextResponse } from "next/server";
import { addProjectMemory, deleteProjectMemory, getProject, listProjectMemory, setProjectMemoryActive } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entries: listProjectMemory(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const content = (await req.json().catch(() => ({}))).content;
  if (!getProject(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "Memory text is required" }, { status: 400 });
  return NextResponse.json(addProjectMemory(id, content.trim().slice(0, 500)), { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string" || typeof body.active !== "boolean") return NextResponse.json({ error: "Invalid memory update" }, { status: 400 });
  setProjectMemoryActive(body.id, body.active);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("entryId");
  if (!id) return NextResponse.json({ error: "Missing entryId" }, { status: 400 });
  deleteProjectMemory(id);
  return NextResponse.json({ ok: true });
}

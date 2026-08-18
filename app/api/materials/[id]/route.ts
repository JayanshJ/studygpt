import { NextResponse } from "next/server";
import { deleteMaterial } from "@/lib/db";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// DELETE /api/materials/[id] — cascades to chunks. No request body to validate;
// withRouteHandler provides the error boundary (catch + sanitized 500) and
// awaits the [id] param.
export const DELETE = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  await deleteMaterial(id);
  return NextResponse.json({ ok: true });
});
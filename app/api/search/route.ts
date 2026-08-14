import { NextResponse } from "next/server";
import { searchConversationHistory } from "@/lib/db";

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });
  return NextResponse.json({ results: searchConversationHistory(query.slice(0, 120)) });
}

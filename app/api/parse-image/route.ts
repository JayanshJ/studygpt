import { NextResponse } from "next/server";
import Tesseract from "tesseract.js";

// POST /api/parse-image — multipart { file }. OCRs an image to text via
// tesseract.js so non-vision chat models can still ingest images (the parsing
// layer): the client stores the returned text on the attachment, and the chat
// route inlines it in place of an image part when the active model isn't
// vision-capable. Vision-capable models still receive the raw image part.
//
// tesseract.js downloads its wasm core + `eng` traineddata to a cache dir on
// first run; subsequent calls are local and fast. Non-fatal best-effort: a
// failure or empty result returns an empty string so the chat route can mark
// the image "(no text detected)" rather than blocking the send.
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB cap, same as /api/extract

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `Image too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { data } = await Tesseract.recognize(buffer, "eng");
    const text = (data?.text ?? "").trim();
    return NextResponse.json({ text, charCount: text.length });
  } catch (err) {
    // OCR failure is non-fatal: return empty text so the send proceeds with a
    // "(no text detected)" placeholder rather than a hard error.
    return NextResponse.json({
      text: "",
      charCount: 0,
      warning: err instanceof Error ? err.message : "OCR failed",
    });
  }
}
import { NextResponse } from "next/server";
import { generateImage, isImageGenConfigured } from "@/lib/imageGen";

export const runtime = "nodejs";

/**
 * POST /api/image-gen/test
 * Verifies the configured image generation provider with a tiny test prompt.
 * No database writes, no character involvement.
 */
export async function POST() {
  try {
    if (!(await isImageGenConfigured())) {
      return NextResponse.json({ success: false, error: "No image generation provider selected." }, { status: 400 });
    }
    const result = await generateImage("A simple red circle centered on a plain white background.");
    return NextResponse.json({ success: true, contentType: result.contentType, byteLength: result.image.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Save custom tag overrides for preferences
export async function POST(req: Request) {
  try {
    const { tag, target, importance, confidence } = await req.json();

    if (!tag) {
      return NextResponse.json({ success: false, error: "Missing tag" }, { status: 400 });
    }

    // Load existing overrides
    const existing = await prisma.systemSetting.findUnique({
      where: { key: "preference_overrides" }
    });

    let overrides: Record<string, { target?: number; importance?: number; confidence?: number }> = {};
    if (existing && existing.value) {
      try {
        overrides = JSON.parse(existing.value);
      } catch (e) {
        overrides = {};
      }
    }

    // Set or merge override safely by merging with any existing values for this tag
    if (target === undefined && importance === undefined && confidence === undefined) {
      delete overrides[tag];
    } else {
      overrides[tag] = {
        ...overrides[tag],
        ...(target !== undefined ? { target: Number(target) } : {}),
        ...(importance !== undefined ? { importance: Number(importance) } : {}),
        ...(confidence !== undefined ? { confidence: Number(confidence) } : {}),
      };
    }

    await prisma.systemSetting.upsert({
      where: { key: "preference_overrides" },
      update: { value: JSON.stringify(overrides) },
      create: { key: "preference_overrides", value: JSON.stringify(overrides) }
    });

    return NextResponse.json({ success: true, overrides });
  } catch (error: any) {
    console.error("Save Preference Override Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

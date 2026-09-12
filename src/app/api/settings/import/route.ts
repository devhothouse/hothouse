import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applySettingsReplaceAll, normalizeImportedSettings } from "@/lib/settingsSnapshots";

export const runtime = "nodejs";

// Replace-all settings import used by Manager → My Data → "Import Settings".
// Accepts the wrapped export format ({ version, exportedAt, settings }) and
// legacy flat { key: value } backup files. Unknown keys are imported as-is;
// settings snapshots and per-profile preference-reset markers are never
// imported, overwritten, or deleted. Responds with imported/deleted counts.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Request body must be JSON." }, { status: 400 });
    }
    const normalized = normalizeImportedSettings(body);
    if (!normalized.ok) {
      return NextResponse.json(
        { success: false, error: "Invalid settings file: " + normalized.error },
        { status: 400 }
      );
    }
    const result = await applySettingsReplaceAll(prisma, normalized.settings);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

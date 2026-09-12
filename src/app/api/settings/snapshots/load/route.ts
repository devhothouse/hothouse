import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SETTINGS_SNAPSHOT_PREFIX, applySettingsReplaceAll, normalizeImportedSettings } from "@/lib/settingsSnapshots";

export const runtime = "nodejs";

// Restore a named snapshot: replace-all the current settings with the
// settings captured inside the snapshot (identical semantics to file import).
// Snapshots and preference-reset markers themselves are never touched.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const key = typeof body?.key === "string" ? body.key : "";
    if (!key.startsWith(SETTINGS_SNAPSHOT_PREFIX)) {
      return NextResponse.json({ success: false, error: "Not a settings snapshot key." }, { status: 400 });
    }
    const row = await prisma.systemSetting.findUnique({ where: { key } });
    if (!row) {
      return NextResponse.json({ success: false, error: "Snapshot not found (already deleted?)." }, { status: 404 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return NextResponse.json({ success: false, error: "Snapshot data is corrupted (not valid JSON)." }, { status: 500 });
    }
    const normalized = normalizeImportedSettings(parsed);
    if (!normalized.ok) {
      return NextResponse.json({ success: false, error: "Snapshot data is invalid: " + normalized.error }, { status: 500 });
    }
    const result = await applySettingsReplaceAll(prisma, normalized.settings);
    return NextResponse.json({ success: true, name: key.slice(SETTINGS_SNAPSHOT_PREFIX.length), ...result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

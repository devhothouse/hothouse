import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  SETTINGS_SNAPSHOT_PREFIX,
  isProtectedSettingsKey,
  sanitizeSnapshotName,
  snapshotKeyForName,
} from "@/lib/settingsSnapshots";

export const runtime = "nodejs";

// List settings snapshots (Manager → My Data → Settings Snapshots).
// Only metadata is returned — a snapshot's settings payload never leaves the
// server until it is explicitly loaded via /api/settings/snapshots/load.
export async function GET() {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { startsWith: SETTINGS_SNAPSHOT_PREFIX } },
      orderBy: { key: "asc" },
    });
    const snapshots = rows.map((row: any) => {
      let name = row.key.slice(SETTINGS_SNAPSHOT_PREFIX.length);
      let savedAt: string | null = null;
      let keyCount = 0;
      try {
        const parsed = JSON.parse(row.value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          if (typeof parsed.name === "string" && parsed.name.trim()) name = parsed.name;
          if (typeof parsed.savedAt === "string") savedAt = parsed.savedAt;
          if (parsed.settings && typeof parsed.settings === "object" && !Array.isArray(parsed.settings)) {
            keyCount = Object.keys(parsed.settings).length;
          }
        }
      } catch {
        // Corrupted snapshot row: still listed so it can be deleted from the UI.
      }
      return { key: row.key, name, savedAt, keyCount };
    });
    return NextResponse.json({ success: true, snapshots });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Create/update a named snapshot of the CURRENT database settings (captured
// server-side so the snapshot is always a full, fresh dump, never stale UI
// state). Snapshot rows and preference-reset markers are never captured.
// Posting an existing name overwrites that snapshot (the UI confirms first).
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const key = snapshotKeyForName(body?.name);
    if (!key) {
      return NextResponse.json({ success: false, error: "Please enter a snapshot name." }, { status: 400 });
    }
    const rows = await prisma.systemSetting.findMany();
    const settings: Record<string, string> = {};
    for (const row of rows) {
      if (isProtectedSettingsKey(row.key)) continue;
      settings[row.key] = row.value;
    }
    const payload = {
      name: sanitizeSnapshotName(body?.name),
      savedAt: new Date().toISOString(),
      settings,
    };
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: JSON.stringify(payload) },
      create: { key, value: JSON.stringify(payload) },
    });
    return NextResponse.json({
      success: true,
      snapshot: { key, name: payload.name, savedAt: payload.savedAt, keyCount: Object.keys(settings).length },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Delete one snapshot by its full key. Only settings_snapshot_* keys are
// deletable through this route; the current settings are never touched.
export async function DELETE(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const key = typeof body?.key === "string" ? body.key : "";
    if (!key.startsWith(SETTINGS_SNAPSHOT_PREFIX)) {
      return NextResponse.json({ success: false, error: "Not a settings snapshot key." }, { status: 400 });
    }
    const existing = await prisma.systemSetting.findUnique({ where: { key } });
    if (!existing) {
      return NextResponse.json({ success: false, error: "Snapshot not found (already deleted?)." }, { status: 404 });
    }
    await prisma.systemSetting.delete({ where: { key } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

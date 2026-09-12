import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { PROTECTED_SETTINGS_KEY_PREFIXES } from "@/lib/settingsSnapshots";

export const runtime = "nodejs";

// Fetch all settings. Runtime bookkeeping rows (settings snapshots and
// per-profile preference-reset markers) are excluded so the result is always
// a pure configuration dump for the UI state and the My Data export.
export async function GET() {
  try {
    const settingsList = await prisma.systemSetting.findMany({
      where: {
        AND: PROTECTED_SETTINGS_KEY_PREFIXES.map((prefix) => ({
          key: { not: { startsWith: prefix } },
        })),
      },
    });
    const settings = settingsList.reduce((acc: Record<string, string>, curr: { key: string; value: string }) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});

    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Update settings
export async function POST(req: Request) {
  try {
    const body = await req.json(); // Object containing key-value pairs

    for (const [key, value] of Object.entries(body)) {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

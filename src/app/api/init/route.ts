import { NextResponse } from "next/server";
import { syncAICPersonas, ensureDefaultSettingsAndProfiles } from "@/lib/sync";

export const runtime = "nodejs";

export async function POST() {
  try {
    await ensureDefaultSettingsAndProfiles();
    const syncedIds = await syncAICPersonas();
    return NextResponse.json({ success: true, syncedIds });
  } catch (error: any) {
    console.error("Init Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return POST();
}

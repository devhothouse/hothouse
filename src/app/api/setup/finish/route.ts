import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applyStarterSuitePreferences } from "@/lib/sync";

export const runtime = "nodejs";

// POST /api/setup/finish — finalizes the First-Time Setup modal.
// Body: { settings?: Record<string,string>, starterSuite?: { male: boolean, female: boolean } }
//  - `settings`      : arbitrary SystemSetting key/value pairs to upsert
//                      (e.g. first_time_setup_hide_button).
//  - `starterSuite`  : persists starter_suite_include_male/female and then
//                      disables every starter character (persona JSON field
//                      starterSet: "male" | "female") whose set was NOT
//                      selected. No-op while no starter characters exist.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const settings: Record<string, string> = body.settings || {};
    const starterSuite = body.starterSuite || null;

    // 1. Persist the provided settings (upsert per key — partial update).
    for (const [key, value] of Object.entries(settings)) {
      await prisma.systemSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }

    // 2. Apply the starter-suite choice (also persists the two include keys).
    let starterResult = null;
    if (starterSuite && typeof starterSuite === "object") {
      const male = starterSuite.male ? "true" : "false";
      const female = starterSuite.female ? "true" : "false";
      await prisma.systemSetting.upsert({ where: { key: "starter_suite_include_male" }, update: { value: male }, create: { key: "starter_suite_include_male", value: male } });
      await prisma.systemSetting.upsert({ where: { key: "starter_suite_include_female" }, update: { value: female }, create: { key: "starter_suite_include_female", value: female } });
      starterResult = await applyStarterSuitePreferences();
    }

    return NextResponse.json({
      success: true,
      savedSettings: Object.keys(settings).length,
      starterSuite: starterResult,
    });
  } catch (error: any) {
    console.error("Setup finish API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: "gossip_badges_catalog" },
    });

    let badges = [];
    if (setting?.value) {
      try {
        badges = JSON.parse(setting.value);
      } catch (e) {}
    }

    return NextResponse.json({ success: true, badges });
  } catch (error: any) {
    console.error("Gossip Badges GET Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { badges } = body;

    if (!Array.isArray(badges)) {
      return NextResponse.json({ success: false, error: "Badges must be an array." }, { status: 400 });
    }

    await prisma.systemSetting.upsert({
      where: { key: "gossip_badges_catalog" },
      update: { value: JSON.stringify(badges) },
      create: { key: "gossip_badges_catalog", value: JSON.stringify(badges) },
    });

    return NextResponse.json({ success: true, badges });
  } catch (error: any) {
    console.error("Gossip Badges POST Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

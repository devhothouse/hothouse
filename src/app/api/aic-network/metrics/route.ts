import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const metrics = await prisma.aicCallMetric.findMany({
      include: {
        character: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: { totalCalls: "desc" },
    });

    return NextResponse.json({ success: true, metrics });
  } catch (err: any) {
    console.error("Error fetching AIC call metrics:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { characterId, resetAll } = body;

    if (resetAll) {
      await prisma.aicCallMetric.deleteMany({});
      return NextResponse.json({ success: true, message: "All metrics reset." });
    }

    if (characterId) {
      await prisma.aicCallMetric.deleteMany({
        where: { characterId },
      });
      return NextResponse.json({ success: true, message: `Metrics for ${characterId} reset.` });
    }

    return NextResponse.json({ success: false, error: "Invalid parameters." });
  } catch (err: any) {
    console.error("Error resetting AIC call metrics:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

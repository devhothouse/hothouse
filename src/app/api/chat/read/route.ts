import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Marks a chat interaction as read (resets unreadCount to 0)
export async function POST(req: Request) {
  try {
    const { interactionId } = await req.json();

    if (!interactionId) {
      return NextResponse.json({ success: false, error: "Missing interactionId" }, { status: 400 });
    }

    await prisma.interaction.update({
      where: { id: interactionId },
      data: { unreadCount: 0 },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Mark Read Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

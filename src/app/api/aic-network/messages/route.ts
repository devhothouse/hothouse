import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const interactionId = searchParams.get("interactionId");

    if (!interactionId) {
      return NextResponse.json({ success: false, error: "Interaction ID required." });
    }

    const messages = await prisma.aicMessage.findMany({
      where: { aicInteractionId: interactionId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, messages });
  } catch (err: any) {
    console.error("Error fetching AIC messages:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, aicInteractionId, senderId, messageId, content } = body;

    if (action === "add") {
      if (!aicInteractionId || !senderId || !content) {
        return NextResponse.json({
          success: false,
          error: "Interaction ID, Sender ID, and content are required.",
        });
      }

      const msg = await prisma.aicMessage.create({
        data: {
          aicInteractionId,
          senderId,
          content: content.trim(),
        },
      });

      return NextResponse.json({ success: true, message: msg });
    }

    if (action === "edit") {
      if (!messageId || !content) {
        return NextResponse.json({
          success: false,
          error: "Message ID and content are required.",
        });
      }

      const msg = await prisma.aicMessage.update({
        where: { id: messageId },
        data: { content: content.trim() },
      });

      return NextResponse.json({ success: true, message: msg });
    }

    if (action === "delete") {
      if (!messageId) {
        return NextResponse.json({ success: false, error: "Message ID required." });
      }

      await prisma.aicMessage.delete({
        where: { id: messageId },
      });

      return NextResponse.json({ success: true, message: "Deleted successfully." });
    }

    return NextResponse.json({ success: false, error: "Invalid action specified." });
  } catch (err: any) {
    console.error("Error modifying AIC message:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

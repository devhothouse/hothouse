import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const interactions = await prisma.aicInteraction.findMany({
      include: {
        characterA: true,
        characterB: true,
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const characters = await prisma.character.findMany({
      where: { deleted: false, disabled: false },
      include: {
        callMetric: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      success: true,
      interactions,
      characters,
    });
  } catch (err: any) {
    console.error("Error fetching AIC interactions:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { characterAId, characterBId, interactionId, action, unmatchedBy } = body;

    // Handle bulk delete all interactions
    if (action === "delete_all") {
      await prisma.aicMessage.deleteMany({});
      const deleteResult = await prisma.aicInteraction.deleteMany({});
      return NextResponse.json({
        success: true,
        message: "All AIC-to-AIC interactions have been deleted.",
        count: deleteResult.count,
      });
    }

    // Handle unmatch action
    if (action === "unmatch") {
      const targetId = interactionId;
      if (targetId) {
        const updated = await prisma.aicInteraction.update({
          where: { id: targetId },
          data: {
            unmatched: true,
            unmatchedBy: unmatchedBy || "admin",
          },
        });
        return NextResponse.json({ success: true, interaction: updated });
      } else if (characterAId && characterBId) {
        const [c1, c2] = [characterAId, characterBId].sort();
        const updated = await prisma.aicInteraction.update({
          where: {
            characterAId_characterBId: { characterAId: c1, characterBId: c2 },
          },
          data: {
            unmatched: true,
            unmatchedBy: unmatchedBy || "admin",
          },
        });
        return NextResponse.json({ success: true, interaction: updated });
      } else {
        return NextResponse.json({ success: false, error: "Interaction ID required for unmatch." });
      }
    }

    // Handle rematch action
    if (action === "rematch") {
      const targetId = interactionId;
      if (targetId) {
        const updated = await prisma.aicInteraction.update({
          where: { id: targetId },
          data: {
            unmatched: false,
            unmatchedBy: null,
            matched: true,
          },
        });
        return NextResponse.json({ success: true, interaction: updated });
      }
    }

    if (!characterAId || !characterBId || characterAId === characterBId) {
      return NextResponse.json({
        success: false,
        error: "Valid distinct character IDs are required.",
      });
    }

    // Ensure deterministic ordering for unique composite key
    const [c1, c2] = [characterAId, characterBId].sort();

    if (action === "manual_match") {
      const [char1, char2] = await Promise.all([
        prisma.character.findUnique({ where: { id: c1 } }),
        prisma.character.findUnique({ where: { id: c2 } }),
      ]);

      if (!char1 || !char2) {
        return NextResponse.json({ success: false, error: "One or both characters not found." });
      }

      if (char1.deleted || char2.deleted) {
        return NextResponse.json({
          success: false,
          error: `Cannot manually match deleted characters (${char1.deleted ? char1.name : char2.name} is deleted).`,
        });
      }

      const interaction = await prisma.aicInteraction.upsert({
        where: {
          characterAId_characterBId: {
            characterAId: c1,
            characterBId: c2,
          },
        },
        create: {
          characterAId: c1,
          characterBId: c2,
          statusA: "like",
          statusB: "like",
          matched: true,
          disabled: false,
          unmatched: false,
          unmatchedBy: null,
          reasoningA: "Manually matched by administrator.",
          reasoningB: "Manually matched by administrator.",
        },
        update: {
          statusA: "like",
          statusB: "like",
          matched: true,
          disabled: false,
          unmatched: false,
          unmatchedBy: null,
        },
      });

      return NextResponse.json({ success: true, interaction });
    }

    if (action === "reset") {
      // Clear messages and reset match state
      const existing = await prisma.aicInteraction.findUnique({
        where: {
          characterAId_characterBId: {
            characterAId: c1,
            characterBId: c2,
          },
        },
      });

      if (existing) {
        await prisma.aicMessage.deleteMany({
          where: { aicInteractionId: existing.id },
        });

        await prisma.aicInteraction.update({
          where: { id: existing.id },
          data: {
            statusA: null,
            statusB: null,
            matched: false,
            disabled: false,
            unmatched: false,
            unmatchedBy: null,
            summary: null,
            reasoningA: null,
            reasoningB: null,
          },
        });
      }

      return NextResponse.json({ success: true, message: "Interaction reset successfully." });
    }

    return NextResponse.json({ success: false, error: "Invalid action specified." });
  } catch (err: any) {
    console.error("Error modifying AIC interaction:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { interactionId, disabled, summary, unmatched, unmatchedBy } = body;

    if (!interactionId) {
      return NextResponse.json({ success: false, error: "Interaction ID required." });
    }

    const dataToUpdate: any = {};
    if (typeof disabled === "boolean") dataToUpdate.disabled = disabled;
    if (typeof summary === "string") dataToUpdate.summary = summary;
    if (typeof unmatched === "boolean") dataToUpdate.unmatched = unmatched;
    if (unmatchedBy !== undefined) dataToUpdate.unmatchedBy = unmatchedBy;

    const updated = await prisma.aicInteraction.update({
      where: { id: interactionId },
      data: dataToUpdate,
    });

    return NextResponse.json({ success: true, interaction: updated });
  } catch (err: any) {
    console.error("Error updating AIC interaction:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const all = searchParams.get("all") === "true" || searchParams.get("deleteAll") === "true";

    if (all) {
      await prisma.aicMessage.deleteMany({});
      const deleteResult = await prisma.aicInteraction.deleteMany({});
      return NextResponse.json({
        success: true,
        message: "All interactions deleted successfully.",
        count: deleteResult.count,
      });
    }

    if (!id) {
      return NextResponse.json({ success: false, error: "ID required." });
    }

    await prisma.aicInteraction.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, message: "Deleted successfully." });
  } catch (err: any) {
    console.error("Error deleting AIC interaction:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

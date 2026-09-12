import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// GET all interactions unfiltered for the active profile
export async function GET() {
  try {
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });

    if (!activeProfile) {
      return NextResponse.json({ success: true, interactions: [] });
    }

    const interactions = await prisma.interaction.findMany({
      where: {
        profileId: activeProfile.id,
      },
      include: {
        character: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // Map to ledger-friendly format
    const formatted = interactions.map((inter) => ({
      id: inter.id,
      characterId: inter.characterId,
      characterName: inter.character.name,
      aicStatus: inter.aicStatus,
      internalReasoning: inter.internalReasoning,
      matched: inter.matched,
    }));

    return NextResponse.json({ success: true, interactions: formatted });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// DELETE all interactions & messages for the active profile
export async function DELETE() {
  try {
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });

    if (!activeProfile) {
      return NextResponse.json({ success: false, error: "No active profile found." }, { status: 400 });
    }

    // Cascade delete handles Message deletions
    await prisma.interaction.deleteMany({
      where: {
        profileId: activeProfile.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}


// PUT handler to update the internal reasoning (evaluation rationale) of a specific interaction
export async function PUT(req: Request) {
  try {
    const { id, internalReasoning } = await req.json();
    if (!id) {
      return NextResponse.json({ success: false, error: "Missing interaction id" }, { status: 400 });
    }
    const updated = await prisma.interaction.update({
      where: { id },
      data: { internalReasoning }
    });
    return NextResponse.json({ success: true, interaction: updated });
  } catch (error: any) {
    console.error("Error updating interaction reasoning:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}


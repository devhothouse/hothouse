import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateUserReview } from "@/lib/llm";

export const runtime = "nodejs";

/**
 * POST /api/unmatch
 * Handles user-initiated or assistant-initiated unmatching.
 */
export async function POST(req: Request) {
  try {
    const { interactionId, unmatchedBy } = await req.json();

    if (!interactionId) {
      return NextResponse.json({ success: false, error: "Missing interactionId" }, { status: 400 });
    }

    const unmatcher = unmatchedBy || "user";

    // Set unmatched = true and record who did it
    const interaction = await prisma.interaction.update({
      where: { id: interactionId },
      data: {
        unmatched: true,
        unmatchedBy: unmatcher,
        updatedAt: new Date()
      },
      include: {
        profile: true,
        character: true,
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // Check if gossip review should be triggered on unmatch
    try {
      const triggerKey = unmatcher === "user" ? "gossip_trigger_unmatch_user" : "gossip_trigger_unmatch_aic";
      const setting = await prisma.systemSetting.findUnique({ where: { key: triggerKey } });
      const enabled = setting ? setting.value !== "false" : true;

      const chanceSetting = await prisma.systemSetting.findUnique({ where: { key: "gossip_unmatch_trigger_chance" } });
      const triggerChance = parseFloat(chanceSetting?.value ?? "1.0");
      const passRoll = Math.random() <= triggerChance;

      if (enabled && passRoll && interaction && interaction.profile && interaction.character) {
        const triggerReason = unmatcher === "user" ? "unmatch_user" : "unmatch_aic";
        
        // Check if an unmatch review already exists for this interaction
        const existing = await prisma.userReview.findFirst({
          where: { interactionId: interaction.id, triggerReason },
        });

        if (!existing) {
          const recentMsgs = interaction.messages.slice(-12);
          const transcript = recentMsgs.length > 0
            ? recentMsgs.map((m) => `${m.role === "user" ? interaction.profile.name : interaction.character.name}: ${m.content.replace(/\n+/g, " ")}`).join("\n")
            : `[Interaction unmatched with no prior chat history]`;

          const reviewResult = await generateUserReview({
            characterName: interaction.character.name,
            privatePersona: interaction.character.privatePersona,
            publicBio: interaction.character.publicBio,
            userName: interaction.profile.name,
            triggerReason: unmatcher === "user" ? `User abruptly unmatched with you.` : `You decided to unmatch this user.`,
            chatTranscript: transcript,
            profileId: interaction.profile.id,
            characterId: interaction.character.id,
          });

          await prisma.userReview.create({
            data: {
              profileId: interaction.profile.id,
              characterId: interaction.character.id,
              interactionId: interaction.id,
              content: reviewResult.content,
              sentiment: reviewResult.sentiment,
              rating: reviewResult.rating,
              badges: JSON.stringify(reviewResult.badges),
              isAnonymous: reviewResult.is_anonymous,
              anonymousAlias: reviewResult.anonymous_alias,
              triggerReason,
            },
          });
        }
      }
    } catch (gossipErr) {
      console.error("Failed to generate unmatch gossip review:", gossipErr);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Unmatch Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}


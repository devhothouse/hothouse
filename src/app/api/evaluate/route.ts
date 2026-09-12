import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { evaluateUserProfile } from "@/lib/llm";
import { recordAicCallMetric } from "@/lib/crossChatMemory";
import { getGossipContextForEvaluation } from "@/lib/gossip";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // 1. Find active profile
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });

    if (!activeProfile) {
      return NextResponse.json({ success: false, error: "No active user profile found." }, { status: 400 });
    }

    // 2. Fetch all non-disabled characters (filtered in JS to satisfy compile-time types)
    const allCharacters = await prisma.character.findMany() as any[];
    const characters = allCharacters.filter(c => c.disabled !== true);

    const results = [];

    const body = await req.json().catch(() => ({}));
    const onlyUnseen = body.onlyUnseen === true;

    // 3. For each character, evaluate if we don't have an evaluation, or re-evaluate
    for (const char of characters) {
      try {
        // Fetch gossip context per character so each evaluator sees which board posts
        // are their own (including anonymous ones and older posts pushed out of the window)
        const gossipContext = await getGossipContextForEvaluation(activeProfile.id, activeProfile.name, char.id);

        // Skip if onlyUnseen is true and an interaction already exists with an aicStatus
        if (onlyUnseen) {
          const existing = await prisma.interaction.findUnique({
            where: { profileId_characterId: { profileId: activeProfile.id, characterId: char.id } }
          });
          if (existing?.aicStatus) continue;
        }

        const evalResult = await evaluateUserProfile(char.privatePersona, {
          name: activeProfile.name,
          bio: activeProfile.bio,
          gender: activeProfile.gender,
          lookingFor: activeProfile.lookingFor,
          avatarDescription: activeProfile.avatar,
          userAvatar: activeProfile.avatar,
          characterAvatar: char.avatar,
        }, gossipContext);

        await recordAicCallMetric(char.id, "eval");

        // Determine matching / DM status
        const isSlideIn = evalResult.decision === "slide-in";
        
        // Let's upsert the interaction
        const interaction = await prisma.interaction.upsert({
          where: {
            profileId_characterId: {
              profileId: activeProfile.id,
              characterId: char.id,
            },
          },
          update: {
            aicStatus: evalResult.decision,
            dmMessage: isSlideIn ? evalResult.opening_message : null,
            internalReasoning: evalResult.internal_reasoning,
            // If mutual like was already established before triggering evaluation
            matched: evalResult.decision === "like" && (await prisma.interaction.findUnique({
              where: { profileId_characterId: { profileId: activeProfile.id, characterId: char.id } }
            }))?.userStatus === "like" ? true : false,
          },
          create: {
            profileId: activeProfile.id,
            characterId: char.id,
            aicStatus: evalResult.decision,
            dmMessage: isSlideIn ? evalResult.opening_message : null,
            internalReasoning: evalResult.internal_reasoning,
            matched: false,
          },
        });

        results.push({
          characterId: char.id,
          characterName: char.name,
          decision: evalResult.decision,
          reasoning: evalResult.internal_reasoning,
          opening_message: evalResult.opening_message,
        });
      } catch (err: any) {
        console.error(`Failed evaluation for ${char.name}:`, err);
        results.push({
          characterId: char.id,
          characterName: char.name,
          error: err.message,
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Evaluation Route Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

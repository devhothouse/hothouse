import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { recordAicCallMetric } from "@/lib/crossChatMemory";

export const runtime = "nodejs";

// Helper to evaluate one character towards another
export async function evaluateSingleAic(
  charA: any,
  charB: any,
  evalPromptTemplate: string
): Promise<{ decision: string; internal_reasoning: string; opening_message: string }> {
  const [includeImagesSetting, inlineImagesSetting] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "aic_aic_include_images" } }),
    prisma.systemSetting.findUnique({ where: { key: "inline_images" } }),
  ]);
  const includeImages =
    (includeImagesSetting ? includeImagesSetting.value !== "false" : true) &&
    (inlineImagesSetting ? inlineImagesSetting.value !== "false" : true);

  let imagePromptBlock = "";
  if (includeImages && (charA.avatar || charB.avatar)) {
    imagePromptBlock = `
Here are the reference profile images for this evaluation:
- Your (${charA.name}) Avatar Image: ![char_a_avatar](${charA.avatar || ""})
- Other Character (${charB.name}) Profile Picture: ![char_b_avatar](${charB.avatar || ""})
Please evaluate their physical appearance if visible in the picture and incorporate it into your compatibility choice.`;
  }

  let prompt = evalPromptTemplate
    .replace(/{character_a_name}/g, charA.name)
    .replace(/{character_a_gender}/g, charA.gender || "Female")
    .replace(/{character_a_looking_for}/g, charA.lookingFor || "Everyone")
    .replace(/{character_a_private_persona}/g, charA.privatePersona || "")
    .replace(/{character_a_public_bio}/g, charA.publicBio || "No bio specified.")
    .replace(/{character_a_avatar}/g, charA.avatar ? `![char_a_avatar](${charA.avatar})` : "")
    .replace(/{character_b_name}/g, charB.name)
    .replace(/{character_b_gender}/g, charB.gender || "Female")
    .replace(/{character_b_looking_for}/g, charB.lookingFor || "Everyone")
    .replace(/{character_b_public_bio}/g, charB.publicBio || "No bio available.")
    .replace(/{character_b_avatar}/g, charB.avatar ? `![char_b_avatar](${charB.avatar})` : "");

  if (prompt.includes("{image_prompt_block}")) {
    prompt = prompt.replace(/{image_prompt_block}/g, imagePromptBlock);
  } else if (imagePromptBlock) {
    prompt = `${prompt}\n\n${imagePromptBlock}`;
  }

  const responseText = await callLLM(
    "You are a helpful simulation assistant that evaluates dating app profiles and strictly outputs valid JSON.",
    [{ role: "user", content: prompt }],
    undefined,
    false,
    "aic_match"
  );

  await recordAicCallMetric(charA.id, "eval");

  try {
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
    }
    const parsed = JSON.parse(cleanJson);
    return {
      decision: ["pass", "like", "slide-in"].includes(parsed.decision) ? parsed.decision : "pass",
      internal_reasoning: parsed.internal_reasoning || "",
      opening_message: parsed.opening_message || "",
    };
  } catch (err) {
    return {
      decision: "like",
      internal_reasoning: "Interested in connecting.",
      opening_message: "Hey, saw your profile and had to say hi!",
    };
  }
}

export async function POST(req: Request) {
  try {
    // AIC Social Network master switch (Network tab header / Manager → Global
    // Settings): when off, no AIC↔AIC match evaluations may run.
    const networkEnabledSetting = await prisma.systemSetting.findUnique({ where: { key: "aic_network_enabled" } });
    if (networkEnabledSetting?.value === "false") {
      return NextResponse.json({ success: false, error: "The AIC Social Network feature is turned off (toggle it back on in the Network tab or Manager → Global Settings)." }, { status: 403 });
    }
    const body = await req.json();
    const { characterAId, characterBId } = body;

    const emergencyStopSetting = await prisma.systemSetting.findUnique({
      where: { key: "aic_aic_emergency_stop" },
    });
    if (emergencyStopSetting?.value === "true") {
      return NextResponse.json({
        success: false,
        error: "Simulation is paused because the AIC-AIC Emergency Stop is active.",
      });
    }

    const evalPromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_aic_aic_eval" },
    });
    const evalPromptTemplate = evalPromptSetting?.value || "Evaluate {character_b_name}";

    const maxMatchesSetting = await prisma.systemSetting.findUnique({
      where: { key: "aic_aic_max_matches_per_char" },
    });
    const maxMatchesPerChar = parseInt(maxMatchesSetting?.value || "3", 10) || 3;

    if (!characterAId || !characterBId) {
      return NextResponse.json({ success: false, error: "Character IDs required." });
    }

    const [c1Id, c2Id] = [characterAId, characterBId].sort();
    const [char1, char2] = await Promise.all([
      prisma.character.findUnique({ where: { id: c1Id } }),
      prisma.character.findUnique({ where: { id: c2Id } }),
    ]);

    if (!char1 || !char2) {
      return NextResponse.json({ success: false, error: "Characters not found." });
    }

    if (char1.deleted || char2.deleted) {
      return NextResponse.json({
        success: false,
        error: `Cannot evaluate pairings with deleted characters (${char1.deleted ? char1.name : char2.name} is deleted).`,
      });
    }

    if (char1.disabled || char2.disabled) {
      return NextResponse.json({
        success: false,
        error: `Cannot evaluate pairings with disabled characters (${char1.disabled ? char1.name : char2.name} is disabled).`,
      });
    }

    // Check active match limits
    const [matches1, matches2] = await Promise.all([
      prisma.aicInteraction.count({
        where: {
          OR: [{ characterAId: char1.id }, { characterBId: char1.id }],
          matched: true,
          disabled: false,
        },
      }),
      prisma.aicInteraction.count({
        where: {
          OR: [{ characterAId: char2.id }, { characterBId: char2.id }],
          matched: true,
          disabled: false,
        },
      }),
    ]);

    if (matches1 >= maxMatchesPerChar || matches2 >= maxMatchesPerChar) {
      return NextResponse.json({
        success: false,
        error: `One of the characters has reached the active match limit (${maxMatchesPerChar}).`,
      });
    }

    const eval1to2 = await evaluateSingleAic(char1, char2, evalPromptTemplate);
    const eval2to1 = await evaluateSingleAic(char2, char1, evalPromptTemplate);

    const isMatched =
      (eval1to2.decision === "like" || eval1to2.decision === "slide-in") &&
      (eval2to1.decision === "like" || eval2to1.decision === "slide-in");

    const interaction = await prisma.aicInteraction.upsert({
      where: {
        characterAId_characterBId: {
          characterAId: c1Id,
          characterBId: c2Id,
        },
      },
      create: {
        characterAId: c1Id,
        characterBId: c2Id,
        statusA: eval1to2.decision,
        statusB: eval2to1.decision,
        reasoningA: eval1to2.internal_reasoning,
        reasoningB: eval2to1.internal_reasoning,
        matched: isMatched,
        disabled: false,
      },
      update: {
        statusA: eval1to2.decision,
        statusB: eval2to1.decision,
        reasoningA: eval1to2.internal_reasoning,
        reasoningB: eval2to1.internal_reasoning,
        matched: isMatched,
      },
    });

    if (isMatched) {
      const msgCount = await prisma.aicMessage.count({
        where: { aicInteractionId: interaction.id },
      });

      if (msgCount === 0) {
        if (eval1to2.decision === "slide-in" && eval1to2.opening_message) {
          await prisma.aicMessage.create({
            data: {
              aicInteractionId: interaction.id,
              senderId: char1.id,
              content: eval1to2.opening_message,
            },
          });
        } else if (eval2to1.decision === "slide-in" && eval2to1.opening_message) {
          await prisma.aicMessage.create({
            data: {
              aicInteractionId: interaction.id,
              senderId: char2.id,
              content: eval2to1.opening_message,
            },
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      interaction,
      eval1to2,
      eval2to1,
    });
  } catch (err: any) {
    console.error("Error in AIC-to-AIC evaluation:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

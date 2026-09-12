import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { getCrossChatMemoryContext, recordAicCallMetric } from "@/lib/crossChatMemory";
import { evaluateSingleAic } from "../evaluate/route";

export const runtime = "nodejs";

// Execute a single turn between two AICs
async function executeAicChatTurn(interactionId: string) {
  const interaction = await prisma.aicInteraction.findUnique({
    where: { id: interactionId },
    include: {
      characterA: true,
      characterB: true,
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!interaction || !interaction.matched || interaction.disabled) {
    throw new Error("Interaction is not matched or is disabled.");
  }

  if (interaction.unmatched) {
    throw new Error("Interaction is unmatched.");
  }

  if (!interaction.characterA || !interaction.characterB) {
    throw new Error("One or both characters could not be found.");
  }

  if (interaction.characterA.deleted || interaction.characterB.deleted) {
    throw new Error(
      `Cannot simulate turn: ${interaction.characterA.deleted ? interaction.characterA.name : interaction.characterB.name} is deleted.`
    );
  }

  if (interaction.characterA.disabled || interaction.characterB.disabled) {
    throw new Error(
      `Cannot simulate turn: ${interaction.characterA.disabled ? interaction.characterA.name : interaction.characterB.name} is disabled.`
    );
  }

  // Determine who should speak next
  const lastMsg =
    interaction.messages.length > 0
      ? interaction.messages[interaction.messages.length - 1]
      : null;

  let speaker = interaction.characterA;
  let partner = interaction.characterB;

  if (lastMsg) {
    if (lastMsg.senderId === interaction.characterAId) {
      speaker = interaction.characterB;
      partner = interaction.characterA;
    } else {
      speaker = interaction.characterA;
      partner = interaction.characterB;
    }
  }

  // Retrieve cross-chat memories for speaker
  const memoryInfo = await getCrossChatMemoryContext(speaker.id, {
    targetType: "aic",
    targetId: partner.id,
  });

  // Fetch settings for prompt, unmatching, and image inclusion
  const [
    chatPromptSetting,
    includeImagesSetting,
    inlineImagesSetting,
    unmatchAllowedSetting,
    hintThresholdSetting,
    reluctantThresholdSetting,
    unmatchPromptSetting,
  ] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "prompt_aic_aic_chat" } }),
    prisma.systemSetting.findUnique({ where: { key: "aic_aic_include_images" } }),
    prisma.systemSetting.findUnique({ where: { key: "inline_images" } }),
    prisma.systemSetting.findUnique({ where: { key: "aic_aic_allow_unmatch" } }),
    prisma.systemSetting.findUnique({ where: { key: "aic_aic_unmatch_msg_threshold_hint" } }),
    prisma.systemSetting.findUnique({ where: { key: "aic_aic_unmatch_msg_threshold_reluctant" } }),
    prisma.systemSetting.findUnique({ where: { key: "prompt_aic_aic_unmatch_rule" } }),
  ]);

  const includeImages =
    (includeImagesSetting ? includeImagesSetting.value !== "false" : true) &&
    (inlineImagesSetting ? inlineImagesSetting.value !== "false" : true);

  const allowUnmatch = unmatchAllowedSetting ? unmatchAllowedSetting.value !== "false" : true;
  let unmatchRule = "";
  if (allowUnmatch) {
    const hintThreshold = hintThresholdSetting?.value || "8";
    const reluctantThreshold = reluctantThresholdSetting?.value || "30";
    const unmatchPromptTemplate =
      unmatchPromptSetting?.value ||
      "\n3. If you feel this connection is absolutely not working and you want to permanently unmatch {partner_name}, you MUST append the exact tag \"[UNMATCH]\" at the very end of your reply.\n- Before unmatching: if you have exchanged more than {hint_threshold} messages (there are currently {total_messages} messages in this chat), you must have already hinted at or mentioned the possibility of parting ways or unmatching in previous messages.\n- If you have exchanged more than {reluctant_threshold} messages, you must be extremely reluctant to unmatch, and only do so in severe cases of irreconcilable personality conflict or insult.";

    unmatchRule = unmatchPromptTemplate
      .replace(/{partner_name}/g, partner.name)
      .replace(/{hint_threshold}/g, hintThreshold)
      .replace(/{reluctant_threshold}/g, reluctantThreshold)
      .replace(/{total_messages}/g, String(interaction.messages.length));
  }

  let systemPrompt =
    chatPromptSetting?.value ||
    "You are roleplaying as {character_name} in a direct chat on a social dating simulation app talking with another character, {partner_name}.\nStay strictly in character at all times. Keep your message punchy, conversational, and natural (1-3 sentences).\n\nYour Private Persona:\n{private_persona}\n\nYour Public Bio:\n{character_public_bio}\n\n{other_chats_memory_block}\n\nPartner Character Profile:\n- Name: {partner_name}\n- Public Bio: {partner_public_bio}{unmatch_rule}";

  systemPrompt = systemPrompt
    .replace(/{character_name}/g, speaker.name)
    .replace(/{speaker_name}/g, speaker.name)
    .replace(/{partner_name}/g, partner.name)
    .replace(/{private_persona}/g, speaker.privatePersona || "")
    .replace(/{character_public_bio}/g, speaker.publicBio || "No bio specified.")
    .replace(/{speaker_public_bio}/g, speaker.publicBio || "No bio specified.")
    .replace(/{your_public_bio}/g, speaker.publicBio || "No bio specified.")
    .replace(/{partner_public_bio}/g, partner.publicBio || "No bio specified.");

  if (systemPrompt.includes("{unmatch_rule}")) {
    systemPrompt = systemPrompt.replace(/{unmatch_rule}/g, unmatchRule);
  } else if (unmatchRule) {
    systemPrompt = `${systemPrompt}\n${unmatchRule}`;
  }

  if (systemPrompt.includes("{other_chats_memory_block}")) {
    systemPrompt = systemPrompt.replace(
      /{other_chats_memory_block}/g,
      memoryInfo.memoryBlock || ""
    );
  } else if (memoryInfo.hasContent) {
    if (memoryInfo.location === "system_prompt_top") {
      systemPrompt = `${memoryInfo.memoryBlock}\n\n${systemPrompt}`;
    } else if (memoryInfo.location === "system_prompt_bottom") {
      systemPrompt = `${systemPrompt}\n\n${memoryInfo.memoryBlock}`;
    }
  }

  // Reference messages containing profile images
  const referenceMessages: any[] = [];
  if (includeImages && (speaker.avatar || partner.avatar)) {
    referenceMessages.push({
      role: "user" as const,
      content: `[Dating App Profiles Reference Images]
Your (${speaker.name}) Profile Picture: ![your_avatar](${speaker.avatar || ""})
Partner (${partner.name}) Profile Picture: ![partner_avatar](${partner.avatar || ""})
Please keep these pictures in mind. They are for your reference to visualize who you are chatting with.`,
    });
    referenceMessages.push({
      role: "assistant" as const,
      content: `[Dating App Profiles Reference Acknowledged. I see both of our profile pictures now!]`,
    });
  }

  // Build conversation history for LLM
  const historyForLlm: { role: "user" | "assistant"; content: string }[] = [];

  if (memoryInfo.hasContent && memoryInfo.location === "before_recent_messages") {
    historyForLlm.push({ role: "user", content: `[Context Note: ${memoryInfo.memoryBlock}]` });
    historyForLlm.push({ role: "assistant", content: "[Understood, keeping this in mind.]" });
  }

  for (const m of interaction.messages) {
    const isAssistant = m.senderId === speaker.id;
    historyForLlm.push({
      role: isAssistant ? "assistant" : "user",
      content: m.content,
    });
  }

  if (historyForLlm.length === 0) {
    historyForLlm.push({
      role: "user",
      content: `Hi ${speaker.name}, excited to connect with you!`,
    });
  }

  const allMessagesForLlm = [...referenceMessages, ...historyForLlm];

  const responseText = await callLLM(
    systemPrompt,
    allMessagesForLlm,
    undefined,
    false,
    "aic_chat"
  );

  let cleanReply = responseText.trim();
  // Remove accidental hallucinated sender prefixes like "Emma: ..."
  cleanReply = cleanReply.replace(new RegExp(`^${speaker.name}:\\s*`, "i"), "").trim();

  const hasUnmatchTag = cleanReply.includes("[UNMATCH]");
  const finalContent = cleanReply.replace(/\[UNMATCH\]/gi, "").trim();

  // Create message in database
  const createdMessage = await prisma.aicMessage.create({
    data: {
      aicInteractionId: interaction.id,
      senderId: speaker.id,
      content: finalContent || cleanReply,
    },
  });

  await recordAicCallMetric(speaker.id, "aicChat");

  let wasUnmatched = false;
  if (hasUnmatchTag && allowUnmatch) {
    wasUnmatched = true;
    await prisma.aicInteraction.update({
      where: { id: interaction.id },
      data: {
        unmatched: true,
        unmatchedBy: speaker.id,
      },
    });
  }

  return {
    message: createdMessage,
    speakerName: speaker.name,
    unmatched: wasUnmatched,
    unmatchedBy: wasUnmatched ? speaker.name : null,
  };
}

export async function POST(req: Request) {
  try {
    // AIC Social Network master switch (Network tab header / Manager → Global
    // Settings): when off, no match discovery, simulation rounds, or AIC↔AIC
    // conversation turns may run. Existing chats stay viewable.
    const networkEnabledSetting = await prisma.systemSetting.findUnique({ where: { key: "aic_network_enabled" } });
    if (networkEnabledSetting?.value === "false") {
      return NextResponse.json({ success: false, error: "The AIC Social Network feature is turned off (toggle it back on in the Network tab or Manager → Global Settings)." }, { status: 403 });
    }
    const body = await req.json();
    const { interactionId, turnsCount = 1, runSimulationRound = false } = body;

    // Check emergency stop setting
    const emergencyStopSetting = await prisma.systemSetting.findUnique({
      where: { key: "aic_aic_emergency_stop" },
    });
    if (emergencyStopSetting?.value === "true") {
      return NextResponse.json({
        success: false,
        error: "Simulation is paused because the AIC-AIC Emergency Stop is active.",
      });
    }

    const maxMsgsSetting = await prisma.systemSetting.findUnique({
      where: { key: "aic_aic_max_messages_per_chat" },
    });
    const maxMessagesPerChat = parseInt(maxMsgsSetting?.value || "16", 10) || 16;

    if (runSimulationRound) {
      const settingsList = await prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              "sim_round_eval_attempts",
              "sim_round_messages_per_chat",
              "sim_round_max_total_messages",
              "aic_aic_max_matches_per_char",
              "aic_aic_max_messages_per_chat",
              "prompt_aic_aic_eval",
            ],
          },
        },
      });
      const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));

      const evalAttempts =
        parseInt(body.evalAttempts || settingsMap.get("sim_round_eval_attempts") || "2", 10) || 2;
      const messagesPerChat =
        parseInt(body.messagesPerChat || settingsMap.get("sim_round_messages_per_chat") || "1", 10) || 1;
      const maxTotalMessages =
        parseInt(body.maxTotalMessages || settingsMap.get("sim_round_max_total_messages") || "12", 10) || 12;
      const maxMatchesPerChar =
        parseInt(settingsMap.get("aic_aic_max_matches_per_char") || "3", 10) || 3;
      const maxMessagesPerChat =
        parseInt(settingsMap.get("aic_aic_max_messages_per_chat") || "16", 10) || 16;
      const evalPromptTemplate =
        settingsMap.get("prompt_aic_aic_eval") || "Evaluate {character_b_name}";

      let newMatchesFormed = 0;
      let evaluationsAttempted = 0;

      if (evalAttempts > 0) {
        const characters = await prisma.character.findMany({
          where: { disabled: false, deleted: false },
        });

        const existingInteractions = await prisma.aicInteraction.findMany({});
        const interactionSet = new Set(
          existingInteractions.map((i) => `${i.characterAId}_${i.characterBId}`)
        );

        const activeMatchesCountMap = new Map<string, number>();
        for (const inter of existingInteractions) {
          if (inter.matched && !inter.disabled) {
            activeMatchesCountMap.set(inter.characterAId, (activeMatchesCountMap.get(inter.characterAId) || 0) + 1);
            activeMatchesCountMap.set(inter.characterBId, (activeMatchesCountMap.get(inter.characterBId) || 0) + 1);
          }
        }

        const candidatePairs: [any, any][] = [];
        for (let i = 0; i < characters.length; i++) {
          for (let j = i + 1; j < characters.length; j++) {
            const c1 = characters[i];
            const c2 = characters[j];
            const [c1Id, c2Id] = [c1.id, c2.id].sort();
            const pairKey = `${c1Id}_${c2Id}`;

            const c1Matches = activeMatchesCountMap.get(c1.id) || 0;
            const c2Matches = activeMatchesCountMap.get(c2.id) || 0;

            if (!interactionSet.has(pairKey) && c1Matches < maxMatchesPerChar && c2Matches < maxMatchesPerChar) {
              candidatePairs.push([c1, c2]);
            }
          }
        }

        candidatePairs.sort(() => Math.random() - 0.5);
        const pairsToEvaluate = candidatePairs.slice(0, evalAttempts);

        for (const [char1, char2] of pairsToEvaluate) {
          evaluationsAttempted++;
          const [c1Id, c2Id] = [char1.id, char2.id].sort();
          try {
            const eval1to2 = await evaluateSingleAic(char1, char2, evalPromptTemplate);
            const eval2to1 = await evaluateSingleAic(char2, char1, evalPromptTemplate);

            const isMatched =
              (eval1to2.decision === "like" || eval1to2.decision === "slide-in") &&
              (eval2to1.decision === "like" || eval2to1.decision === "slide-in");

            if (isMatched) newMatchesFormed++;

            const createdInter = await prisma.aicInteraction.upsert({
              where: {
                characterAId_characterBId: { characterAId: c1Id, characterBId: c2Id },
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
              if (eval1to2.decision === "slide-in" && eval1to2.opening_message) {
                await prisma.aicMessage.create({
                  data: { aicInteractionId: createdInter.id, senderId: char1.id, content: eval1to2.opening_message },
                });
              } else if (eval2to1.decision === "slide-in" && eval2to1.opening_message) {
                await prisma.aicMessage.create({
                  data: { aicInteractionId: createdInter.id, senderId: char2.id, content: eval2to1.opening_message },
                });
              }
            }
          } catch (err) {
            console.error(`Evaluation failed between ${char1.name} and ${char2.name}:`, err);
          }
        }
      }
      // Phase 2: Advance Active Conversations
      const activeInteractions = await prisma.aicInteraction.findMany({
        where: {
          matched: true,
          disabled: false,
          unmatched: false,
          characterA: { deleted: false, disabled: false },
          characterB: { deleted: false, disabled: false },
        },
        include: {
          characterA: true,
          characterB: true,
          messages: true,
        },
        orderBy: { updatedAt: "asc" },
      });

      let totalRoundMessagesGenerated = 0;
      const conversationResults = [];

      for (const inter of activeInteractions) {
        if (totalRoundMessagesGenerated >= maxTotalMessages) break;

        let chatMessageCount = inter.messages.length;
        const turnsToRunForThisChat = Math.min(messagesPerChat, maxTotalMessages - totalRoundMessagesGenerated);

        for (let turn = 0; turn < turnsToRunForThisChat; turn++) {
          if (chatMessageCount >= maxMessagesPerChat || totalRoundMessagesGenerated >= maxTotalMessages) break;

          try {
            const turnRes = await executeAicChatTurn(inter.id);
            totalRoundMessagesGenerated++;
            chatMessageCount++;
            conversationResults.push({ interactionId: inter.id, success: true, ...turnRes });
            if (turnRes.unmatched) {
              break;
            }
          } catch (e: any) {
            conversationResults.push({ interactionId: inter.id, success: false, error: e.message });
            break;
          }
        }
      }

      const reachedRoundCap = totalRoundMessagesGenerated >= maxTotalMessages;

      return NextResponse.json({
        success: true,
        evaluationsAttempted,
        newMatchesFormed,
        totalMessagesGenerated: totalRoundMessagesGenerated,
        reachedRoundCap,
        conversationResults,
      });
    }

    if (!interactionId) {
      return NextResponse.json({ success: false, error: "Interaction ID required." });
    }

    // Check current message count against limit
    const currentCount = await prisma.aicMessage.count({
      where: { aicInteractionId: interactionId },
    });

    if (currentCount >= maxMessagesPerChat) {
      return NextResponse.json({
        success: false,
        error: `This conversation has reached the configured limit of ${maxMessagesPerChat} messages.`,
      });
    }

    const safeTurns = Math.min(Math.max(turnsCount, 1), 10);
    const messagesCreated = [];

    for (let i = 0; i < safeTurns; i++) {
      const currentMsgs = await prisma.aicMessage.count({
        where: { aicInteractionId: interactionId },
      });
      if (currentMsgs >= maxMessagesPerChat) break;

      const res = await executeAicChatTurn(interactionId);
      messagesCreated.push(res);
      if (res.unmatched) {
        break;
      }
    }

    return NextResponse.json({
      success: true,
      messagesCreated,
      totalTurns: messagesCreated.length,
    });
  } catch (err: any) {
    console.error("Error in AIC-to-AIC chat turn:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

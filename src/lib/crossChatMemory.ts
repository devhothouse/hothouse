import { prisma } from "@/lib/db";

export interface CrossChatMemoryConfig {
  mode: "disabled" | "summary_only" | "transcript_only" | "both";
  location: "system_prompt_top" | "system_prompt_bottom" | "before_recent_messages";
  maxOtherChats: number;
  maxTranscriptMessages: number;
  includeAicInUser: boolean;
  includeUserInAic: boolean;
  includeAicInAic: boolean;
}

// Increment call metrics for the AIC Network call ledger
export async function recordAicCallMetric(
  characterId: string,
  type: "userChat" | "aicChat" | "eval" | "summary"
) {
  try {
    const updateData: any = {
      totalCalls: { increment: 1 },
      lastCallAt: new Date(),
    };
    if (type === "userChat") updateData.userChatCalls = { increment: 1 };
    if (type === "aicChat") updateData.aicChatCalls = { increment: 1 };
    if (type === "eval") updateData.evalCalls = { increment: 1 };
    if (type === "summary") updateData.summaryCalls = { increment: 1 };

    await prisma.aicCallMetric.upsert({
      where: { characterId },
      create: {
        characterId,
        userChatCalls: type === "userChat" ? 1 : 0,
        aicChatCalls: type === "aicChat" ? 1 : 0,
        evalCalls: type === "eval" ? 1 : 0,
        summaryCalls: type === "summary" ? 1 : 0,
        totalCalls: 1,
        lastCallAt: new Date(),
      },
      update: updateData,
    });
  } catch (err) {
    console.error(`Failed to record call metric for ${characterId}:`, err);
  }
}

// Retrieve cross-chat memory context block for an AIC
export async function getCrossChatMemoryContext(
  characterId: string,
  currentContext: { targetType: "user" | "aic"; targetId: string }
): Promise<{ memoryBlock: string; location: string; hasContent: boolean }> {
  try {
    const settingsList = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            "cross_chat_injection_mode",
            "cross_chat_injection_location",
            "cross_chat_max_other_chats",
            "cross_chat_max_transcript_messages",
            "cross_chat_include_aic_in_user",
            "cross_chat_include_user_in_aic",
            "cross_chat_include_aic_in_aic",
            `cross_chat_override_${characterId}`,
          ],
        },
      },
    });

    const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));

    let perCharOverride: any = null;
    const overrideJson = settingsMap.get(`cross_chat_override_${characterId}`);
    if (overrideJson) {
      try {
        perCharOverride = JSON.parse(overrideJson);
      } catch (e) {}
    }

    const mode =
      perCharOverride?.mode && perCharOverride.mode !== "inherit"
        ? perCharOverride.mode
        : settingsMap.get("cross_chat_injection_mode") || "summary_only";

    if (mode === "disabled") {
      return { memoryBlock: "", location: "system_prompt_bottom", hasContent: false };
    }

    const location =
      perCharOverride?.location && perCharOverride.location !== "inherit"
        ? perCharOverride.location
        : settingsMap.get("cross_chat_injection_location") || "system_prompt_bottom";

    const maxOtherChats =
      perCharOverride?.maxOtherChats ||
      parseInt(settingsMap.get("cross_chat_max_other_chats") || "3", 10) || 3;

    const maxTranscriptMessages =
      perCharOverride?.maxTranscriptMessages ||
      parseInt(settingsMap.get("cross_chat_max_transcript_messages") || "6", 10) || 6;

    const includeAicInUser = settingsMap.get("cross_chat_include_aic_in_user") !== "false";
    const includeUserInAic = settingsMap.get("cross_chat_include_user_in_aic") !== "false";
    const includeAicInAic = settingsMap.get("cross_chat_include_aic_in_aic") !== "false";

    const chatSnippets: string[] = [];

    // Fetch other AIC-to-AIC chats
    const shouldFetchAicChats =
      (currentContext.targetType === "user" && includeAicInUser) ||
      (currentContext.targetType === "aic" && includeAicInAic);

    if (shouldFetchAicChats) {
      const aicInteractions = await prisma.aicInteraction.findMany({
        where: {
          OR: [{ characterAId: characterId }, { characterBId: characterId }],
          matched: true,
          disabled: false,
          NOT:
            currentContext.targetType === "aic"
              ? {
                  OR: [
                    { characterAId: currentContext.targetId },
                    { characterBId: currentContext.targetId },
                  ],
                }
              : undefined,
        },
        include: {
          characterA: true,
          characterB: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: maxTranscriptMessages,
          },
        },
        orderBy: { updatedAt: "desc" },
        take: maxOtherChats,
      });

      for (const inter of aicInteractions) {
        const otherChar = inter.characterAId === characterId ? inter.characterB : inter.characterA;
        const parts: string[] = [];

        if ((mode === "summary_only" || mode === "both") && inter.summary) {
          parts.push(`- Summary / Dynamic: ${inter.summary}`);
        }

        if (mode === "transcript_only" || mode === "both") {
          const sortedMsgs = [...inter.messages].reverse();
          if (sortedMsgs.length > 0) {
            const transcript = sortedMsgs
              .map((m) => `  * ${m.senderId === characterId ? "You" : otherChar.name}: ${m.content.replace(/\n+/g, " ")}`)
              .join("\n");
            parts.push(`- Recent Dialogue Transcript:\n${transcript}`);
          }
        }

        if (parts.length > 0) {
          chatSnippets.push(`### Connection with ${otherChar.name} (Fellow AI Character):\n${parts.join("\n")}`);
        }
      }
    }

    // Fetch other AIC-to-User chats
    if (currentContext.targetType === "aic" && includeUserInAic) {
      const userInteractions = await prisma.interaction.findMany({
        where: {
          characterId: characterId,
          matched: true,
          unmatched: false,
        },
        include: {
          profile: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: maxTranscriptMessages,
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 2,
      });

      for (const uInter of userInteractions) {
        const parts: string[] = [];
        if (mode === "transcript_only" || mode === "both") {
          const sortedMsgs = [...uInter.messages].reverse();
          if (sortedMsgs.length > 0) {
            const transcript = sortedMsgs
              .map((m) => `  * ${m.role === "assistant" ? "You" : uInter.profile.name}: ${m.content.replace(/\n+/g, " ")}`)
              .join("\n");
            parts.push(`- Recent Dialogue with Human User ${uInter.profile.name}:\n${transcript}`);
          }
        }

        if (parts.length > 0) {
          chatSnippets.push(`### Conversation with ${uInter.profile.name} (Human User):\n${parts.join("\n")}`);
        }
      }
    }

    if (chatSnippets.length === 0) {
      return { memoryBlock: "", location, hasContent: false };
    }

    const memoryBlock = `
[MEMORY & AWARENESS OF YOUR OTHER CONNECTIONS & CONVERSATIONS]
You are a social individual with a life and active connections with other people and AI characters on this dating platform.
Use these memories naturally when appropriate (e.g. referencing experiences, dates, conversations, or inside jokes if relevant), but do not awkwardly force them into every sentence:

${chatSnippets.join("\n\n")}
[END OF OTHER CONNECTIONS MEMORY]
`.trim();

    return { memoryBlock, location, hasContent: true };
  } catch (err) {
    console.error("Error generating cross-chat memory:", err);
    return { memoryBlock: "", location: "system_prompt_bottom", hasContent: false };
  }
}

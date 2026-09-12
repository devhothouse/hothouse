import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
import { callLLM } from "@/lib/llm";
import { getCrossChatMemoryContext, recordAicCallMetric } from "@/lib/crossChatMemory";
import { getGossipContextForChat, checkAndTriggerMilestoneGossip } from "@/lib/gossip";
import { materializePendingMatches } from "@/lib/matchDelay";
import { resolveElevenV3Prompting } from "@/lib/ttsPrompting";
import { processChatImageTags, DEFAULT_PROMPT_CHAT_IMAGE_GEN, DEFAULT_PROMPT_CHAT_IMAGE_GEN_REFS } from "@/lib/imageGen";

export async function GET() {
  try {
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });

    if (!activeProfile) {
      return NextResponse.json({ success: true, matches: [] });
    }

    // Materialize any due delayed matches before listing (Match Delay feature).
    // newMatches contains only the matches that flipped in this call, letting the
    // frontend raise exactly one "You have a new match" push notification per match.
    const newMatches = await materializePendingMatches(activeProfile.id);

    const interactions = await prisma.interaction.findMany({
      where: {
        profileId: activeProfile.id,
        OR: [
          { matched: true },
          { aicStatus: "slide-in" },
          { unmatched: true }, // Include unmatched chats so they can be viewed in unmatched sections
        ],
      },
      include: {
        character: true,
        messages: {
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // Format matches
    const matches = interactions.map((inter: any) => {
      let history = inter.messages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.createdAt.toISOString()
      }));

      // If slide-in and history is empty (not yet matched), show the dmMessage as the starting item in the history preview
      if (inter.aicStatus === "slide-in" && inter.dmMessage && history.length === 0) {
        history = [
          {
            id: "temp",
            role: "assistant",
            content: inter.dmMessage,
            timestamp: inter.updatedAt.toISOString(),
          },
        ];
      }

      return {
        interactionId: inter.id,
        characterId: inter.characterId,
        characterName: inter.character.name,
        characterAvatar: inter.character.avatar,
        characterPublicBio: inter.character.publicBio,
        characterVoiceId: inter.character.voiceId,
        characterGender: inter.character.gender,
        characterLookingFor: inter.character.lookingFor,
        characterDisabled: inter.character.disabled, // Expose disabled status (Feature #2)
        characterOutdated: inter.character.outdated, // Expose outdated status (Feature #2)
        matched: inter.matched,
        aicStatus: inter.aicStatus,
        dmMessage: inter.dmMessage,
        unreadCount: inter.unreadCount, // Track number of unread messages from this AIC
        unmatched: inter.unmatched, // Track if connection is unmatched
        unmatchedBy: inter.unmatchedBy, // Track who unmatched
        chatHistory: history,
        updatedAt: inter.updatedAt,
      };
    });

    // Sort matches by recency of the last message in chatHistory, falling back to updatedAt
    matches.sort((a, b) => {
      const timeA = a.chatHistory.length > 0 
        ? new Date(a.chatHistory[a.chatHistory.length - 1].timestamp).getTime() 
        : new Date(a.updatedAt).getTime();
      const timeB = b.chatHistory.length > 0 
        ? new Date(b.chatHistory[b.chatHistory.length - 1].timestamp).getTime() 
        : new Date(b.updatedAt).getTime();
      return timeB - timeA; // Descending (most recent first)
    });

    return NextResponse.json({ success: true, matches, newMatches });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { characterId, message } = body;

    if (!characterId || !message) {
      return NextResponse.json({ success: false, error: "characterId and message are required." }, { status: 400 });
    }

    // 1. Get active profile
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });

    if (!activeProfile) {
      return NextResponse.json({ success: false, error: "No active profile found." }, { status: 400 });
    }

    // 2. Get the character
    const character = await prisma.character.findUnique({
      where: { id: characterId },
    });

    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
    }

    // 3. Get interaction
    const interaction = await prisma.interaction.findUnique({
      where: {
        profileId_characterId: {
          profileId: activeProfile.id,
          characterId,
        },
      },
    });

    if (!interaction) {
      return NextResponse.json({ success: false, error: "No interaction found." }, { status: 404 });
    }

    // Get active configuration settings
    const systemPrefixSetting = await prisma.systemSetting.findUnique({
      where: { key: "system_prompt_prefix" },
    });
    const systemPromptPrefix = systemPrefixSetting?.value || "";

    // Build Dating App Interaction Record
    let swipeRecord = "";
    if (interaction) {
      swipeRecord = `
Dating App Match Details:
- Match Status: ${interaction.matched ? "Matched" : "Pending"}
- User Status: ${interaction.userStatus ? `Swiped ${interaction.userStatus}` : "Not swiped yet"}
- Character Decision: ${interaction.aicStatus ? `Swiped ${interaction.aicStatus}` : "Not swiped yet"}
`;
      if (interaction.internalReasoning) {
        swipeRecord += `- Character's Internal Compatibility Evaluation Rationale (This is why you liked/slid-in on this user): "${interaction.internalReasoning}"\n`;
      }
    }

    // Read unmatch thresholds (Topic C #1)
    const hintThresholdSetting = await prisma.systemSetting.findUnique({ where: { key: "unmatch_msg_threshold_hint" } });
    const hintThreshold = hintThresholdSetting?.value || "8";
    
    const reluctantThresholdSetting = await prisma.systemSetting.findUnique({ where: { key: "unmatch_msg_threshold_reluctant" } });
    const reluctantThreshold = reluctantThresholdSetting?.value || "30";

    const totalMsgsCount = await prisma.message.count({
      where: { interactionId: interaction.id }
    });

    const unmatchPromptSetting = await prisma.systemSetting.findUnique({ where: { key: "prompt_unmatch_rule" } });
    const unmatchPromptTemplate = unmatchPromptSetting?.value || "";

    const unmatchRule = unmatchPromptTemplate
      .replace(/{hint_threshold}/g, hintThreshold)
      .replace(/{reluctant_threshold}/g, reluctantThreshold)
      .replace(/{total_messages}/g, String(totalMsgsCount));

    // Retrieve Cross-Chat Memories if configured
    const memoryInfo = await getCrossChatMemoryContext(character.id, {
      targetType: "user",
      targetId: activeProfile.id,
    });

    // Retrieve Community Gossip Context if configured
    const gossipInfo = await getGossipContextForChat(
      activeProfile.id,
      character.id,
      activeProfile.name
    );

    // Build Character System Prompt
    let finalSystemPrompt = `${systemPromptPrefix}
    
Your Name: ${character.name}
Your Role/Private Persona:
${character.privatePersona}

Your Public Profile/Bio (What the user sees on your dating profile):
${character.publicBio}

${swipeRecord}

Context of Conversation:
You are chatting with a user named "${activeProfile.name}".
User's Bio: "${activeProfile.bio}"
User's Gender: ${activeProfile.gender}
User's Looking For preference: ${activeProfile.lookingFor}

CRITICAL RULES:
1. Stay strictly in character. Do not break character. Do not act like an assistant. Be conversational, reactive, and true to your personality.
2. In the chat history, you will see timestamps in the format "[Sent at HH:MM AM/PM]". These are system metadata injected for your awareness. Do NOT include any timestamp or "[Sent at ...]" prefix in your replies. Just write your natural response content directly.${unmatchRule}`;

    if (memoryInfo.hasContent) {
      if (memoryInfo.location === "system_prompt_top") {
        finalSystemPrompt = `${memoryInfo.memoryBlock}\n\n${finalSystemPrompt}`;
      } else if (memoryInfo.location === "system_prompt_bottom") {
        finalSystemPrompt = `${finalSystemPrompt}\n\n${memoryInfo.memoryBlock}`;
      }
    }

    if (gossipInfo.hasContent) {
      if (gossipInfo.location === "system_prompt_top") {
        finalSystemPrompt = `${gossipInfo.gossipBlock}\n\n${finalSystemPrompt}`;
      } else if (gossipInfo.location === "system_prompt_bottom") {
        finalSystemPrompt = `${finalSystemPrompt}\n\n${gossipInfo.gossipBlock}`;
      }
    }

    // Resolve {eleven_v3_prompting} placeholders in the assembled system prompt
    // (ElevenLabs v3 voice-tag prompting; resolves to "" unless the TTS model is v3)
    const ttsProviderSetting = await prisma.systemSetting.findUnique({ where: { key: "tts_provider" } });
    const ttsModelSetting = await prisma.systemSetting.findUnique({ where: { key: "elevenlabs_model_id" } });
    const v3PromptingSetting = await prisma.systemSetting.findUnique({ where: { key: "eleven_v3_prompting" } });
    finalSystemPrompt = resolveElevenV3Prompting(finalSystemPrompt, ttsModelSetting?.value, v3PromptingSetting?.value, ttsProviderSetting?.value);

    // If slide-in and there are no messages yet, insert the slide-in message as the first message before user's message
    const messageCount = await prisma.message.count({
      where: { interactionId: interaction.id }
    });
    if (interaction.aicStatus === "slide-in" && interaction.dmMessage && messageCount === 0) {
      await prisma.message.create({
        data: {
          interactionId: interaction.id,
          role: "assistant",
          content: interaction.dmMessage,
          createdAt: new Date(Date.now() - 5000) // 5 seconds ago
        }
      });
    }

    // Fetch last message to check if this is a consecutive user follow-up BEFORE appending (Feature #6)
    const lastMessage = await prisma.message.findFirst({
      where: { interactionId: interaction.id },
      orderBy: { createdAt: "desc" },
    });
    const isFollowUp = lastMessage && lastMessage.role === "user";

    // Append user's message
    const userMessage = await prisma.message.create({
      data: {
        interactionId: interaction.id,
        role: "user",
        content: message,
      }
    });

    // If we were in a slide-in state, the user's reply automatically unlocks/
    // matches us. This must happen immediately — BEFORE the delayed-response
    // early return below — otherwise a slide-in AIC who delays their second
    // message would leave the conversation stuck in Slides with a stale
    // "your turn" instead of moving to Matches.
    let interactionMatched = interaction.matched;
    if (!interaction.matched && interaction.aicStatus === "slide-in") {
      await prisma.interaction.update({
        where: { id: interaction.id },
        data: { matched: true, matchTimestamp: new Date() },
      });
      interactionMatched = true;
    }

    // Determine if the AIC should delay/ignore the response (Feature #6 / Topic B #4)
    let shouldDelay = false;
    if (isFollowUp) {
      // Follow-up messages trigger responses right away ONLY according to follow-up response chance
      const responseChance = character.userFollowUpResponseChance ?? 0.5;
      shouldDelay = Math.random() >= responseChance;
    } else {
      // Standard initial delay probability check
      const delayCoeffSetting = await prisma.systemSetting.findUnique({
        where: { key: "async_global_delay_coeff" },
      });
      const delayCoeffStr = delayCoeffSetting?.value || "";
      const globalCoeff = parseFloat(delayCoeffStr) || 1.0;
      
      // Base delay chance unique to character, scaled globally
      let finalDelayChance = (character.delayChance || 0.02) * globalCoeff;
      if (totalMsgsCount <= 2) { 
        // Multiplied significantly on first message to AIC (5x, capped at 80% delay rate)
        finalDelayChance = Math.min(0.8, finalDelayChance * 5.0);
      }
      shouldDelay = Math.random() < finalDelayChance;
    }
    
    if (shouldDelay) {
      // Return immediately with the user's message saved in database but NO assistant reply generated
      const finalMessages = await prisma.message.findMany({
        where: { interactionId: interaction.id },
        orderBy: { createdAt: "asc" }
      });

      const mappedHistory = finalMessages.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.createdAt.toISOString()
      }));

      // Reply is set to null, indicating the character is currently away/busy
      return NextResponse.json({
        success: true,
        reply: null,
        history: mappedHistory,
      });
    }

    // Re-fetch all messages to send to LLM
    const dbMessages = await prisma.message.findMany({
      where: { interactionId: interaction.id },
      orderBy: { createdAt: "asc" }
    });

    // Fetch timestamp passing configuration
    const passTimestampsSetting = await prisma.systemSetting.findUnique({
      where: { key: "pass_timestamps" },
    });
    const passTimestamps = passTimestampsSetting ? passTimestampsSetting.value !== "false" : true;

    // Reference messages containing profile images
    const referenceMessages: any[] = [];
    if (activeProfile.avatar || character.avatar) {
      referenceMessages.push({
        role: "user" as const,
        content: `[Dating App Profiles Reference Images]
User (${activeProfile.name}) Profile Picture: ![user_avatar](${activeProfile.avatar})
Character (${character.name}) Profile Picture: ![char_avatar](${character.avatar})
Please keep these pictures in mind. They are for your reference to visualize who you are chatting with.`
      });
      referenceMessages.push({
        role: "assistant" as const,
        content: `[Dating App Profiles Reference Acknowledged. I see both of our profile pictures now!]`
      });
    }

    // Map history to standard message formats for LLM call
    const llmMessages = [
      ...referenceMessages,
      ...dbMessages.map((h: any) => {
        let content = h.content;
        if (passTimestamps && h.createdAt) {
          // Format with full date and time so that the AIC has exact context of time gaps and days between chats
          const timeStr = new Date(h.createdAt).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
          content = `[Sent at ${timeStr}] ${content}`;
        }
        return {
          role: h.role as "user" | "assistant",
          content,
        };
      })
    ];

    // AI Image Generation (Use 2): when enabled, append the [GENERATE_IMAGE: ...]
    // instruction block so the character can send pictures mid-conversation.
    const chatImageGenSetting = await prisma.systemSetting.findUnique({
      where: { key: "chat_image_generation_enabled" },
    });
    if (chatImageGenSetting?.value === "true") {
      const chatImageGenPromptSetting = await prisma.systemSetting.findUnique({
        where: { key: "prompt_chat_image_gen" },
      });
      const chatImageGenInstruction = chatImageGenPromptSetting?.value || DEFAULT_PROMPT_CHAT_IMAGE_GEN;
      finalSystemPrompt = `${finalSystemPrompt}\n\n${chatImageGenInstruction}`;
      // Image References (advanced): teach the reference syntax only when enabled
      const refsEnabledSetting = await prisma.systemSetting.findUnique({
        where: { key: "image_gen_refs_enabled" },
      });
      if (refsEnabledSetting?.value === "true") {
        const refsPromptSetting = await prisma.systemSetting.findUnique({
          where: { key: "prompt_chat_image_gen_refs" },
        });
        finalSystemPrompt = `${finalSystemPrompt}\n\n${refsPromptSetting?.value || DEFAULT_PROMPT_CHAT_IMAGE_GEN_REFS}`;
      }
    }

    // Call LLM with isChat = true to support dedicated Chat LLM Routing (Topic E #1)
    const assistantReply = await callLLM(finalSystemPrompt, llmMessages, undefined, true);
    await recordAicCallMetric(character.id, "userChat");

    // Excises any bracketed [Sent at ...] time headers the LLM might have hallucinated to match previous message metadata
    const parsedReply = assistantReply.replace(/\[Sent\s+at\s+[^\]]+\]/gi, "").trim();

    // Detect if the AIC decided to unmatch (Topic C #1)
    const hasUnmatchTag = parsedReply.includes("[UNMATCH]");
    const cleanedReply = parsedReply.replace("[UNMATCH]", "").trim();

    // AI Image Generation (Use 2): detect & fulfill [GENERATE_IMAGE: ...] tags —
    // the tag is stripped from the visible reply and the generated image is saved
    // locally and appended as markdown (vision models receive it inline on later
    // turns via the existing multimodal pipeline). Disabled → zero effect.
    let finalReply = cleanedReply;
    if (chatImageGenSetting?.value === "true") {
      // Local image paths already present in the recent chat history (for the
      // optional "chat" reference keyword)
      const chatImagePaths: string[] = [];
      for (const m of dbMessages.slice(-50)) {
        const imgPathRegex = /!\[[^\]]*\]\((\/[^)]+)\)/g;
        let im: RegExpExecArray | null;
        while ((im = imgPathRegex.exec(m.content || "")) !== null) {
          if (!chatImagePaths.includes(im[1])) chatImagePaths.push(im[1]);
        }
      }
      finalReply = await processChatImageTags(cleanedReply, {
        characterId: character.id,
        characterName: character.name,
        visualDescription: (character as any).imageGenPrompt || "",
        selfAvatar: character.avatar,
        userAvatar: activeProfile.avatar,
        chatImagePaths,
      });
    }

    // Append assistant's reply
    const assistantMessage = await prisma.message.create({
      data: {
        interactionId: interaction.id,
        role: "assistant",
        content: finalReply,
      }
    });

    // Check message milestones for automatic gossip review generation
    checkAndTriggerMilestoneGossip(interaction.id).catch((err: any) =>
      console.error("Async milestone gossip trigger error:", err)
    );

    if (hasUnmatchTag) {
      // Mark connection as unmatched by assistant
      await prisma.interaction.update({
        where: { id: interaction.id },
        data: {
          unmatched: true,
          unmatchedBy: "assistant",
          updatedAt: new Date()
        }
      });
    }

    // Slide-in unlock is handled immediately after the user's message is saved
    // (see the early unlock above), so it also applies when the AIC's response
    // is delayed — `interactionMatched` tracks it.

    // Return the updated history
    const finalMessages = await prisma.message.findMany({
      where: { interactionId: interaction.id },
      orderBy: { createdAt: "asc" }
    });

    const mappedHistory = finalMessages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt.toISOString()
    }));

    return NextResponse.json({
      success: true,
      reply: finalReply,
      history: mappedHistory,
      unmatched: hasUnmatchTag // Signal to frontend that unmatch happened
    });
  } catch (error: any) {
    console.error("Chat API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

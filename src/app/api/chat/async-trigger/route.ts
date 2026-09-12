import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { resolveElevenV3Prompting } from "@/lib/ttsPrompting";

export const runtime = "nodejs";

/**
 * POST /api/chat/async-trigger
 * Triggers an asynchronous message from a random matched AIC character.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { forcedCharacterId } = body; // Optional: let the admin force a specific character for testing

    // 1. Get active profile
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });
    if (!activeProfile) {
      return NextResponse.json({ success: false, error: "No active profile found." }, { status: 400 });
    }

    // 2. Fetch matched, active, non-deleted interactions for this profile
    const interactions = await prisma.interaction.findMany({
      where: {
        profileId: activeProfile.id,
        matched: true,
        unmatched: false,
        character: {
          disabled: false,
          deleted: false,
        },
      },
      include: {
        character: true,
        messages: {
          orderBy: { createdAt: "asc" }
        }
      },
    });

    if (interactions.length === 0) {
      return NextResponse.json({ success: false, error: "You have no active matches yet! Keep swiping to match first." }, { status: 400 });
    }

    // 3. Filter characters based on max consecutive message limit
    const filteredInteractions = interactions.filter(i => {
      const maxCap = i.character.maxConsecutiveMessages ?? 3;
      
      // Count consecutive assistant messages at the end of the conversation history
      let consecutiveAssistantCount = 0;
      for (let idx = i.messages.length - 1; idx >= 0; idx--) {
        if (i.messages[idx].role === "assistant") {
          consecutiveAssistantCount++;
        } else if (i.messages[idx].role === "user") {
          break; // Hit a user message, stop counting
        }
      }
      
      // Disqualify if the character has reached or exceeded their cap
      return consecutiveAssistantCount < maxCap;
    });

    if (filteredInteractions.length === 0) {
      return NextResponse.json({ success: false, error: "All matched characters have reached their consecutive message limits. Waiting for user response." });
    }

    // 4. Select which matched AIC will message the user from the eligible candidates
    let chosenInteraction = null;

    if (forcedCharacterId) {
      chosenInteraction = filteredInteractions.find(i => i.characterId === forcedCharacterId) || null;
    }

    if (!chosenInteraction) {
      // Implement the 1/3 unread messages probability bias multiplied by custom async weight (1 to 5):
      const weightedCandidates = filteredInteractions.map(i => {
        const baseWeight = i.unreadCount > 0 ? 1.0 : 3.0; // 3x more likely if no unread messages
        const weightFactor = i.character.asyncMessageWeight ?? 3; // 1 to 5 weight multiplier
        const weight = baseWeight * weightFactor;
        return { interaction: i, weight };
      });

      const totalWeight = weightedCandidates.reduce((acc, c) => acc + c.weight, 0);
      let randomVal = Math.random() * totalWeight;

      for (const candidate of weightedCandidates) {
        randomVal -= candidate.weight;
        if (randomVal <= 0) {
          chosenInteraction = candidate.interaction;
          break;
        }
      }
    }

    if (!chosenInteraction) {
      chosenInteraction = filteredInteractions[0];
    }

    const character = chosenInteraction.character;

    // 5. Fetch the asynchronous message prompt or use a fallback
    const asyncPromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_async_message" },
    });
    const defaultAsyncPrompt = `[SPECIAL INSTRUCTION: You are taking the initiative to message the user asynchronously. You are busy with your own life, but a thought or event reminded you of them. Write a short, highly in-character message (1-3 sentences) starting a new topic or continuing a previous vibe. Do not wait for them to say hello first.]`;
    const asyncPromptContext = asyncPromptSetting?.value || defaultAsyncPrompt;

    // 5. Build system prompt prefix
    const systemPrefixSetting = await prisma.systemSetting.findUnique({
      where: { key: "system_prompt_prefix" },
    });
    const systemPromptPrefix = systemPrefixSetting?.value || "";

    const finalSystemPrompt = `${systemPromptPrefix}
    
Your Name: ${character.name}
Your Role/Private Persona:
${character.privatePersona}

Your Public Profile/Bio (What the user sees on your dating profile):
${character.publicBio}

Context of Conversation:
You are chatting with a user named "${activeProfile.name}".
User's Bio: "${activeProfile.bio}"
User's Gender: ${activeProfile.gender}
User's Looking For preference: ${activeProfile.lookingFor}

CRITICAL RULES:
1. Stay strictly in character. Do not break character. Do not act like an assistant. Be conversational, reactive, and true to your personality.
2. In the chat history, you will see timestamps in the format "[Sent at HH:MM AM/PM]". These are system metadata injected for your awareness. Do NOT include any timestamp or "[Sent at ...]" prefix in your replies. Just write your natural response content directly.
3. Apply this messaging context to your message choice:
${asyncPromptContext}`;

    // 6. Map message history
    const passTimestampsSetting = await prisma.systemSetting.findUnique({
      where: { key: "pass_timestamps" },
    });
    const passTimestamps = passTimestampsSetting ? passTimestampsSetting.value !== "false" : true;

    // Reference images context
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

    const historyPayload = [
      ...referenceMessages,
      ...chosenInteraction.messages.map((h: any) => {
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

    // 7. Query LLM to write the initiative message (Asynchronous Messaging task routing)
    // Resolve {eleven_v3_prompting} placeholders (ElevenLabs v3 voice-tag prompting;
    // resolves to "" unless the TTS model is ElevenLabs v3)
    const ttsProviderSetting = await prisma.systemSetting.findUnique({ where: { key: "tts_provider" } });
    const ttsModelSetting = await prisma.systemSetting.findUnique({ where: { key: "elevenlabs_model_id" } });
    const v3PromptingSetting = await prisma.systemSetting.findUnique({ where: { key: "eleven_v3_prompting" } });
    const resolvedSystemPrompt = resolveElevenV3Prompting(finalSystemPrompt, ttsModelSetting?.value, v3PromptingSetting?.value, ttsProviderSetting?.value);
    const reply = await callLLM(resolvedSystemPrompt, historyPayload, undefined, false, "async");

    if (!reply || reply.trim() === "") {
      throw new Error("LLM failed to output a message content");
    }

    // Excises any bracketed [Sent at ...] time headers the LLM might have hallucinated to match previous message metadata
    const cleanedReply = reply.replace(/\[Sent\s+at\s+[^\]]+\]/gi, "").trim();

    // 8. Save the message to DB and increment unreadCount
    await prisma.message.create({
      data: {
        interactionId: chosenInteraction.id,
        role: "assistant",
        content: cleanedReply,
      }
    });

    await prisma.interaction.update({
      where: { id: chosenInteraction.id },
      data: {
        unreadCount: { increment: 1 },
        updatedAt: new Date(),
      }
    });

    return NextResponse.json({
      success: true,
      characterName: character.name,
      characterId: character.id,
      characterAvatar: character.avatar,
      message: cleanedReply,
    });
  } catch (error: any) {
    console.error("Async Trigger Route Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

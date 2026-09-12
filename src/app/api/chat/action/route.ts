import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { interactionId, messageId, action, newContent } = body;

    if (!interactionId || !messageId || !action) {
      return NextResponse.json({ success: false, error: "Missing parameters" }, { status: 400 });
    }

    if (action === "delete") {
      // Find the message
      const targetMessage = await prisma.message.findUnique({
        where: { id: messageId }
      });

      if (!targetMessage) {
        return NextResponse.json({ success: false, error: "Message not found" }, { status: 404 });
      }

      // If it's a user message, we might want to delete the assistant's reply right after it too to keep history clean, 
      // but most chat apps just delete the exact message selected.
      await prisma.message.delete({ where: { id: messageId } });

    } else if (action === "edit") {
      if (!newContent) return NextResponse.json({ success: false, error: "New content required for edit" }, { status: 400 });
      
      await prisma.message.update({
        where: { id: messageId },
        data: { content: newContent }
      });

    } else if (action === "regenerate") {
      // Regenerating an assistant message:
      // 1. Delete the current assistant message
      // 2. Fetch history up to that point
      // 3. Call LLM again
      
      const targetMessage = await prisma.message.findUnique({
        where: { id: messageId }
      });

      if (!targetMessage || targetMessage.role !== "assistant") {
        return NextResponse.json({ success: false, error: "Can only regenerate assistant messages" }, { status: 400 });
      }

      // Delete target message
      await prisma.message.delete({ where: { id: messageId } });

      // Fetch all messages strictly older than the target message's creation time
      const priorMessages = await prisma.message.findMany({
        where: { 
          interactionId,
          createdAt: { lt: targetMessage.createdAt }
        },
        orderBy: { createdAt: "asc" }
      });

      // Fetch interaction, active profile, character context
      const interaction = await prisma.interaction.findUnique({
        where: { id: interactionId },
        include: { character: true, profile: true }
      });

      if (!interaction) {
        return NextResponse.json({ success: false, error: "Interaction not found" }, { status: 404 });
      }

      // Build context
      const systemPrefixSetting = await prisma.systemSetting.findUnique({
        where: { key: "system_prompt_prefix" },
      });
      const systemPromptPrefix = systemPrefixSetting?.value || "";

      const finalSystemPrompt = `${systemPromptPrefix}
      
Your Name: ${interaction.character.name}
Your Role/Private Persona:
${interaction.character.privatePersona}

Your Public Profile/Bio (What the user sees on your dating profile):
${interaction.character.publicBio}

Context of Conversation:
You are chatting with a user named "${interaction.profile.name}".
User's Bio: "${interaction.profile.bio}"
User's Gender: ${interaction.profile.gender}
User's Looking For preference: ${interaction.profile.lookingFor}

      Ensure you stay strictly in character. Do not break character. Do not act like an assistant. Be conversational, reactive, and true to your personality.`;

      const llmMessages = priorMessages.map((h: any) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      }));

      // Call LLM with isChat = true to support dedicated Chat LLM Routing (Topic E #1)
      const assistantReply = await callLLM(finalSystemPrompt, llmMessages, undefined, true);

      // Excises any bracketed [Sent at ...] time headers the LLM might have hallucinated to match previous message metadata
      const cleanedReply = assistantReply.replace(/\[Sent\s+at\s+[^\]]+\]/gi, "").trim();

      // Create new message with identical created timestamp to preserve ordering if other messages exist after it
      await prisma.message.create({
        data: {
          id: messageId, // reuse ID to avoid React re-renders breaking keys
          interactionId,
          role: "assistant",
          content: cleanedReply,
          createdAt: targetMessage.createdAt 
        }
      });
    }

    // Return the updated history
    const finalMessages = await prisma.message.findMany({
      where: { interactionId },
      orderBy: { createdAt: "asc" }
    });

    const mappedHistory = finalMessages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt.toISOString()
    }));

    return NextResponse.json({ success: true, history: mappedHistory });

  } catch (error: any) {
    console.error("Chat Action Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

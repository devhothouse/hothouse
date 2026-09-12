import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { recordAicCallMetric } from "@/lib/crossChatMemory";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { interactionId } = body;

    if (!interactionId) {
      return NextResponse.json({ success: false, error: "Interaction ID required." });
    }

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

    if (!interaction) {
      return NextResponse.json({ success: false, error: "Interaction not found." });
    }

    if (interaction.messages.length === 0) {
      return NextResponse.json({
        success: false,
        error: "Cannot generate summary without any chat messages.",
      });
    }

    const transcript = interaction.messages
      .map((m) => {
        const sender =
          m.senderId === interaction.characterAId
            ? interaction.characterA.name
            : interaction.characterB.name;
        return `${sender}: ${m.content}`;
      })
      .join("\n");

    const summaryPromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_aic_aic_summary" },
    });
    let promptTemplate =
      summaryPromptSetting?.value ||
      "Summarize the conversation between {character_a_name} and {character_b_name}:\n{chat_transcript}";

    const finalPrompt = promptTemplate
      .replace(/{character_a_name}/g, interaction.characterA.name)
      .replace(/{character_b_name}/g, interaction.characterB.name)
      .replace(/{chat_transcript}/g, transcript);

    const summaryResponse = await callLLM(
      "You are a concise relationship summary writer. Output only the concise summary paragraph.",
      [{ role: "user", content: finalPrompt }],
      undefined,
      false,
      "aic_summary"
    );

    const cleanSummary = summaryResponse.trim();

    const updated = await prisma.aicInteraction.update({
      where: { id: interactionId },
      data: { summary: cleanSummary },
    });

    await recordAicCallMetric(interaction.characterAId, "summary");
    await recordAicCallMetric(interaction.characterBId, "summary");

    return NextResponse.json({ success: true, summary: cleanSummary, interaction: updated });
  } catch (err: any) {
    console.error("Error generating AIC summary:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

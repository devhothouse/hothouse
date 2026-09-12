import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { getActiveVoiceCatalog } from "@/lib/tts";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { allCharacters = false, onlyEmpty = false, characterId = null } = body;

    // 1. Fetch target characters based on filters
    let targetCharacters: any[] = [];
    if (characterId) {
      const char = await prisma.character.findUnique({ where: { id: characterId } });
      if (char) targetCharacters.push(char);
    } else {
      const all = await prisma.character.findMany({ where: { disabled: false, deleted: false } });
      if (onlyEmpty) {
        targetCharacters = all.filter(c => !c.voiceId || c.voiceId.trim() === "");
      } else if (allCharacters) {
        targetCharacters = all;
      }
    }

    if (targetCharacters.length === 0) {
      return NextResponse.json({ success: true, processedCount: 0, results: [] });
    }

    const results: any[] = [];

    // Load the ACTIVE TTS provider's editable voice catalog (its `voices_catalog_*`
    // setting, falling back to that provider's built-in default library when
    // missing/invalid). Same fallback behavior as the old ElevenLabs-only catalog.
    const voiceCatalog = await getActiveVoiceCatalog();

    // Nothing shipped / nothing configured: skip the picker entirely instead of
    // asking the LLM to choose from an empty list. Users add voices in
    // Manager → TTS Settings → Voice Library; the background process just
    // leaves those characters untouched.
    if (voiceCatalog.length === 0) {
      return NextResponse.json({
        success: true,
        processedCount: 0,
        results: [],
        message: "The active TTS provider's voice library is empty — no voices to pick from. Add voices in Manager → TTS Settings → Voice Library.",
      });
    }

    // Load the editable Voice Picker prompt template (falls back to the built-in default).
    const promptTemplateSetting = await prisma.systemSetting.findUnique({ where: { key: "prompt_voice_picker" } });
    const promptTemplate = promptTemplateSetting?.value || "";

    // 2. Process each target character sequentially
    for (const char of targetCharacters) {
      try {
        // Query current voice counts of active (non-disabled, non-deleted) characters dynamically
        const activeChars = await prisma.character.findMany({ where: { disabled: false, deleted: false } });
        const usageMap: Record<string, number> = {};
        
        // Initialize usage count for all known voice IDs to 0
        voiceCatalog.forEach(v => {
          usageMap[v.id] = 0;
        });

        // Count occurrences
        activeChars.forEach((c: any) => {
          if (c.voiceId && c.voiceId.trim() !== "") {
            usageMap[c.voiceId] = (usageMap[c.voiceId] || 0) + 1;
          }
        });

        // Format voices list with current usage stats
        const formattedVoices = voiceCatalog.map(v => {
          const count = usageMap[v.id] || 0;
          return `- ID: "${v.id}"\n  Description: ${v.description}\n  Current Usage: used by ${count} other characters.`;
        }).join("\n\n");

        const systemPrompt = "You are an advanced character helper system that outputs strictly valid JSON.";

        const defaultPrompt = `You are running a voice selection assistant for the following character:

Character Profile:
- Name: {character_name}
- Gender: {gender}
- Public Bio: {public_bio}
- Private Persona: {private_persona}

Available Voice IDs and Descriptions:
{voice_catalog}

Instructions:
choose a voice that you would like (definitely don’t choose a voice that you feel doesn’t match your persona), but be mindful that AICs don’t all choose only a handful of voices. That is, if a voice is used by fewer characters, value that slightly higher in making your decision. Ultimately, though, pick a voice you think would be best.

You MUST respond with a strictly formatted, raw JSON object. Do not wrap the JSON in markdown formatting (like \`\`\`json). The schema must match exactly:
{
  "voiceId": "one_of_the_above_voice_ids",
  "reasoning": "Brief explanation of why this voice perfectly fits your character's persona, gender, and why you selected it while considering other voices' current usage."
}`;

        // Substitute placeholders into the editable template (or built-in default)
        const prompt = (promptTemplate || defaultPrompt)
          .replace(/{character_name}/g, char.name)
          .replace(/{gender}/g, char.gender || "")
          .replace(/{public_bio}/g, char.publicBio || "None")
          .replace(/{private_persona}/g, char.privatePersona || "")
          .replace(/{voice_catalog}/g, formattedVoices);

        // Call LLM with the Voice Picker task scope
        const rawResult = await callLLM(systemPrompt, [{ role: "user", content: prompt }], undefined, false, "voice_picker");

        // Parse JSON output
        let parsed: { voiceId: string; reasoning: string };
        try {
          const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
          const cleaned = jsonMatch ? jsonMatch[0] : rawResult;
          parsed = JSON.parse(cleaned);
        } catch (e) {
          console.error("Failed to parse voice-picker response:", rawResult, e);
          throw new Error("LLM failed to output valid JSON for voice-picker.");
        }

        const selectedVoiceId = parsed.voiceId?.trim();
        const isValidVoice = voiceCatalog.some(v => v.id === selectedVoiceId);

        if (!selectedVoiceId || !isValidVoice) {
          throw new Error(`LLM selected invalid or missing voiceId: "${selectedVoiceId}"`);
        }

        // 3. Save voice selection to SQLite database
        await prisma.character.update({
          where: { id: char.id },
          data: { voiceId: selectedVoiceId }
        });

        // 4. Update the character's physical JSON file in "AIC personas/"
        const filePath = path.join(process.cwd(), "AIC personas", `${char.id}.json`);
        if (fs.existsSync(filePath)) {
          try {
            const contentStr = fs.readFileSync(filePath, "utf-8");
            const data = JSON.parse(contentStr);
            data.voiceId = selectedVoiceId;
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
          } catch (err) {
            console.error(`Error updating physical JSON file for ${char.id}:`, err);
          }
        }

        results.push({
          characterId: char.id,
          characterName: char.name,
          voiceId: selectedVoiceId,
          reasoning: parsed.reasoning
        });
      } catch (err: any) {
        console.error(`Error selecting voice for ${char.name}:`, err);
        results.push({
          characterId: char.id,
          characterName: char.name,
          error: err.message
        });
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: targetCharacters.length,
      results
    });
  } catch (error: any) {
    console.error("Voice-Picker Endpoint Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { isImageGenConfigured, generateAndAssignPortrait } from "@/lib/imageGen";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

/**
 * POST /api/portraits/assign
 * Runs the intelligent, LLM-driven image-picker process for AICs.
 * It reads all available processed, unused portraits from the database,
 * then calls the LLM with the character's details (privatePersona, tags, etc.)
 * to have the LLM pick the best matching portrait.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { characterId, allEmpty } = body;

    // AI Image Generation (Use 1): when the portrait-generation toggle is on AND an
    // image generation provider is configured, this endpoint generates portraits
    // instead of picking from the library — every existing caller (manual trigger,
    // per-character repick, generation pipelines, background processes runner)
    // switches over automatically with no changes. Toggle off or no provider
    // configured → identical library-picking behavior as before.
    const useGenerationSetting = await prisma.systemSetting.findUnique({
      where: { key: "portrait_assign_generate_enabled" },
    });
    if (useGenerationSetting?.value === "true" && (await isImageGenConfigured())) {
      let generationTargets: any[] = [];
      if (characterId) {
        const genChar = await prisma.character.findUnique({ where: { id: characterId } });
        if (!genChar) {
          return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
        }
        generationTargets.push(genChar);
      } else if (allEmpty) {
        const allChars = await prisma.character.findMany({ where: { disabled: false } });
        generationTargets = allChars.filter((c) => !c.avatar || c.avatar === "");
      } else {
        return NextResponse.json({ success: false, error: "Missing parameter characterId or allEmpty" }, { status: 400 });
      }
      const generated: any[] = [];
      for (const genChar of generationTargets) {
        try {
          const result = await generateAndAssignPortrait(genChar);
          generated.push({ characterId: genChar.id, characterName: genChar.name, filepath: result.filepath, reasoning: "AI-generated portrait." });
        } catch (err: any) {
          console.error(`Error generating portrait for character ${genChar.name}:`, err);
          generated.push({ characterId: genChar.id, characterName: genChar.name, error: err.message });
        }
      }
      const okCount = generated.filter((g) => !g.error).length;
      // Keep the picker's response shape (selectedCount/selected) so existing callers
      // keep working, and expose the generation results alongside.
      return NextResponse.json({ success: true, selectedCount: okCount, selected: generated, generatedCount: okCount, generated });
    }

    let charactersToProcess: any[] = [];

    // Identify which characters need processing
    if (characterId) {
      const char = await prisma.character.findUnique({ where: { id: characterId } });
      if (char) {
        charactersToProcess.push(char);
      } else {
        return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
      }
    } else if (allEmpty) {
      // Find active characters who do not have an avatar/image assigned yet
      const allChars = await prisma.character.findMany({
        where: { disabled: false },
      });
      charactersToProcess = allChars.filter((c) => !c.avatar || c.avatar === "");
    } else {
      return NextResponse.json({ success: false, error: "Missing parameter characterId or allEmpty" }, { status: 400 });
    }

    if (charactersToProcess.length === 0) {
      return NextResponse.json({ success: true, message: "No characters required photo selection.", selectedCount: 0 });
    }

    // Fetch selection prompt template or use a fallback
    const selectionPromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_portrait_selection" },
    });
    const defaultSelectionPrompt = `You are {character_name}.
Your private persona instructions: "{private_persona}"

Here is a list of available profile photos you can pick from:
{portraits_list}

Select the single photo that best matches your personality, style, and private persona.
Return a strictly valid JSON object with this exact schema:
{
  "selected_portrait_id": "the exact ID of the chosen photo",
  "reasoning": "A concise 1-2 sentence explanation of why you selected this photo in character"
}

Do not write markdown blocks (like \`\`\`json) or other meta-text. Output only raw, valid JSON.`;
    const selectionPromptTemplate = selectionPromptSetting?.value || defaultSelectionPrompt;

    const selectedList = [];

    for (const char of charactersToProcess) {
      // Find ALL available, processed, unused portraits in DB
      const availablePortraits = await (prisma as any).portrait.findMany({
        where: { processed: true, in_use: false },
      });

      if (availablePortraits.length === 0) {
        return NextResponse.json({
          success: false,
          error: "No unused processed portraits available in the library. Please add and process some portraits first.",
          selectedCount: selectedList.length,
          selected: selectedList,
        }, { status: 400 });
      }

      // Filter available portraits by gender to avoid context overflow/timeout and improve matching quality
      let filteredPortraits = availablePortraits.filter((p: any) => {
        try {
          const parsedTags = JSON.parse(p.tags || "{}");
          const pGender = (parsedTags.gender || "").toLowerCase();
          const cGender = char.gender.toLowerCase();
          if (cGender === "female" && pGender !== "female") return false;
          if (cGender === "male" && pGender !== "male") return false;
          return true;
        } catch (e) {
          return true;
        }
      });

      // Limit selection set to a random sample of portraits of the matching gender
      // (sample size configurable: portrait_assign_sample_count, default 40)
      const sampleCountSetting = await prisma.systemSetting.findUnique({ where: { key: "portrait_assign_sample_count" } });
      const sampleCount = Math.max(1, parseInt(sampleCountSetting?.value || "40", 10) || 40);
      filteredPortraits = filteredPortraits.sort(() => Math.random() - 0.5).slice(0, sampleCount);

      // Format available portraits list for the LLM to read
      const portraitsListStr = (filteredPortraits as any[]).map((p: any) => {
        const parsedTags = JSON.parse(p.tags || "{}");
        const parsedCustomTags = JSON.parse(p.customTags || "[]");
        const tagsStr = Object.entries(parsedTags).map(([k, v]) => `${k}: ${v}`).join(", ");
        const customTagsStr = parsedCustomTags.join(", ");

        return `[ID: ${p.id}]
- Description: ${p.description}
- Predefined Tags: ${tagsStr}
- Additional Tags: ${customTagsStr}`;
      }).join("\n\n");

      // Build the final prompt
      const finalPrompt = selectionPromptTemplate
        .replace(/{character_name}/g, char.name)
        .replace(/{private_persona}/g, char.privatePersona)
        .replace(/{portraits_list}/g, portraitsListStr);

      try {
        // Call the LLM with the AIC Image Picker task scope to make the choice
        const responseText = await callLLM(
          `You are roleplaying as ${char.name} selecting your profile photo.`,
          [{ role: "user", content: finalPrompt }],
          undefined,
          false,
          "portrait_assign"
        );

        // Parse response cleanly
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const cleanedJson = jsonMatch ? jsonMatch[0] : responseText;
        const parsed = JSON.parse(cleanedJson);

        const chosenId = parsed.selected_portrait_id;
        const chosenPortrait = (availablePortraits as any[]).find((p: any) => p.id === chosenId);

        if (!chosenPortrait) {
          console.error(`Character ${char.name} picked an invalid or unavailable portrait ID: ${chosenId}`);
          continue;
        }

        // If there was an old avatar, release it back into the portrait library pool
        if (char.avatar) {
          await (prisma as any).portrait.updateMany({
            where: { filepath: char.avatar },
            data: { in_use: false },
          });
        }

        // 1. Assign portrait filepath to Character.avatar in SQLite
        await prisma.character.update({
          where: { id: char.id },
          data: { avatar: chosenPortrait.filepath },
        });

        // 2. Mark portrait as in_use in DB
        await (prisma as any).portrait.update({
          where: { id: chosenPortrait.id },
          data: { in_use: true },
        });

        // 3. Update physical JSON file to maintain sync
        const directoryPath = path.join(process.cwd(), "AIC personas");
        const filePath = path.join(directoryPath, `${char.id}.json`);
        if (fs.existsSync(filePath)) {
          try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            const fileData = JSON.parse(fileContent);
            fileData.avatar = chosenPortrait.filepath;
            fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), "utf-8");
          } catch (fileErr) {
            console.error(`Error saving avatar to character JSON file ${filePath}:`, fileErr);
          }
        }

        selectedList.push({
          characterId: char.id,
          characterName: char.name,
          portraitId: chosenPortrait.id,
          filepath: chosenPortrait.filepath,
          reasoning: parsed.reasoning || "",
        });
      } catch (err: any) {
        console.error(`Error matching photo for character ${char.name}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      selectedCount: selectedList.length,
      selected: selectedList,
    });
  } catch (error: any) {
    console.error("Error in intelligent portraits assignment endpoint:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

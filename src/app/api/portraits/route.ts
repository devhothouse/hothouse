import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

// GET handler to retrieve portraits from the database
export async function GET() {
  try {
    const portraits = await (prisma as any).portrait.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, portraits });
  } catch (error: any) {
    console.error("Error retrieving portraits:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST handler to orchestrate scan, tag, and choose-photo actions
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, limit = 5, characterId, allEmpty } = body;

    const portraitLibraryPath = path.join(process.cwd(), "public", "portrait-library");

    // Action 1: SCAN the local portrait-library folder
    if (action === "scan") {
      if (!fs.existsSync(portraitLibraryPath)) {
        fs.mkdirSync(portraitLibraryPath, { recursive: true });
        return NextResponse.json({ success: true, scannedCount: 0, addedCount: 0, message: "Folder created. Please upload some portrait images first." });
      }

      const files = fs.readdirSync(portraitLibraryPath);
      const validExtensions = [".jpg", ".jpeg", ".png", ".webp"];
      const imageFiles = files.filter((file) => validExtensions.includes(path.extname(file).toLowerCase()));

      let addedCount = 0;
      const currentFilepaths = new Set<string>();

      for (const file of imageFiles) {
        const filepath = `/portrait-library/${file}`;
        currentFilepaths.add(filepath);

        // Check if already in DB
        const existing = await (prisma as any).portrait.findUnique({
          where: { filepath },
        });

        if (!existing) {
          await (prisma as any).portrait.create({
            data: {
              filepath,
              tags: "{}",
              customTags: "[]",
              description: "",
              in_use: false,
              processed: false,
            },
          });
          addedCount++;
        }
      }

      // Cleanup: Delete DB records of portraits that no longer exist on disk
      const allPortraitsInDb = await (prisma as any).portrait.findMany();
      let deletedCount = 0;
      for (const p of allPortraitsInDb as any[]) {
        if (!currentFilepaths.has(p.filepath)) {
          await (prisma as any).portrait.delete({
            where: { id: p.id },
          });
          deletedCount++;
        }
      }

      return NextResponse.json({
        success: true,
        scannedCount: imageFiles.length,
        addedCount,
        deletedCount,
        message: `Scan complete. Found ${imageFiles.length} images. Registered ${addedCount} new, deleted ${deletedCount} obsolete.`,
      });
    }

    // Action 2: TAG unprocessed portraits using the Vision LLM
    if (action === "tag") {
      // Find unprocessed portraits
      const unprocessed = await (prisma as any).portrait.findMany({
        where: { processed: false },
        take: limit,
      });

      if (unprocessed.length === 0) {
        return NextResponse.json({ success: true, message: "No unprocessed portraits found.", processedCount: 0 });
      }

      // Fetch predefined tags configuration
      const predefinedTagsSetting = await prisma.systemSetting.findUnique({
        where: { key: "portrait_predefined_tags" },
      });
      const predefinedTagsList = predefinedTagsSetting ? JSON.parse(predefinedTagsSetting.value) : [];

      // Fetch prompt template
      const taggingPromptSetting = await prisma.systemSetting.findUnique({
        where: { key: "prompt_portrait_tagging" },
      });
      const defaultTaggingPrompt = "You are an expert AI image analysis assistant. Your task is to analyze the provided portrait image and output a structured JSON response...";
      const taggingPromptTemplate = taggingPromptSetting?.value || defaultTaggingPrompt;

      const processedList = [];

      for (const portrait of unprocessed as any[]) {
        // Construct detailed prompt
        const predefinedTagsStr = predefinedTagsList.map((tag: string) => `- "${tag}"`).join("\n");
        const formattedPrompt = taggingPromptTemplate
          .replace(/{predefined_tags}/g, predefinedTagsStr) + `\n\nImage to analyze: ![portrait](${portrait.filepath})`;

        try {
          // Call LLM with Vision support (Portrait Auto-Tagging task scope)
          const responseText = await callLLM(
            "You are a helpful assistant that outputs strictly valid JSON objects for image tagging.",
            [{ role: "user", content: formattedPrompt }],
            undefined,
            false,
            "portrait_tagging"
          );

          // Clean up the JSON output (in case model outputs markdown JSON blocks)
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          const cleanedJson = jsonMatch ? jsonMatch[0] : responseText;
          const parsed = JSON.parse(cleanedJson);

          // Update database
          const updated = await (prisma as any).portrait.update({
            where: { id: portrait.id },
            data: {
              tags: JSON.stringify(parsed.tags || {}),
              customTags: JSON.stringify(parsed.customTags || []),
              description: parsed.description || "",
              processed: true,
            },
          });

          processedList.push(updated);
        } catch (err: any) {
          console.error(`Error processing portrait ${portrait.filepath}:`, err);
          // Feature #7: Mark the portrait as processed with empty tags to gracefully skip it so the processing loop doesn't stall on it
          try {
            const failedPortrait = await (prisma as any).portrait.update({
              where: { id: portrait.id },
              data: {
                processed: true,
                tags: "{}",
                customTags: "[]",
                description: `Analysis failed: ${err.message || "Invalid JSON or API error"}`
              }
            });
            processedList.push(failedPortrait);
          } catch (dbErr) {
            console.error(`Failed to mark portrait ${portrait.id} as processed in DB:`, dbErr);
          }
        }
      }

      return NextResponse.json({
        success: true,
        processedCount: processedList.length,
        processedPortraits: processedList,
      });
    }

    // Action 3: CHOOSE-PHOTO for characters
    if (action === "choose-photo") {
      let charactersToProcess: any[] = [];

      if (characterId) {
        const char = await prisma.character.findUnique({ where: { id: characterId } });
        if (char) {
          charactersToProcess.push(char);
        } else {
          return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
        }
      } else if (allEmpty) {
        // Find characters whose avatar doesn't start with /portrait-library/
        const allChars = await prisma.character.findMany({
          where: { disabled: false },
        });
        charactersToProcess = allChars.filter((c) => !c.avatar || !c.avatar.startsWith("/portrait-library/"));
      } else {
        return NextResponse.json({ success: false, error: "Missing parameter characterId or allEmpty" }, { status: 400 });
      }

      if (charactersToProcess.length === 0) {
        return NextResponse.json({ success: true, message: "No characters required photo selection.", selectedCount: 0 });
      }

      // Fetch selection prompt template
      const selectionPromptSetting = await prisma.systemSetting.findUnique({
        where: { key: "prompt_portrait_selection" },
      });
      const defaultSelectionPrompt = "You are {character_name}... Choose the single portrait that best matches...";
      const selectionPromptTemplate = selectionPromptSetting?.value || defaultSelectionPrompt;

      const selectedList = [];

      for (const char of charactersToProcess) {
        // Find ALL available, processed, unused portraits
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

        // Format available portraits as a list for the LLM
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

        // Format prompt for character decision
        const finalPrompt = selectionPromptTemplate
          .replace(/{character_name}/g, char.name)
          .replace(/{private_persona}/g, char.privatePersona)
          .replace(/{portraits_list}/g, portraitsListStr);

        try {
          // Call LLM with the AIC Image Picker task scope
          const responseText = await callLLM(
            `You are roleplaying as ${char.name} selecting your profile photo.`,
            [{ role: "user", content: finalPrompt }],
            undefined,
            false,
            "portrait_assign"
          );

          // Parse response
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          const cleanedJson = jsonMatch ? jsonMatch[0] : responseText;
          const parsed = JSON.parse(cleanedJson);

          const chosenId = parsed.selected_portrait_id;
          const chosenPortrait = (availablePortraits as any[]).find((p: any) => p.id === chosenId);

          if (!chosenPortrait) {
            console.error(`Character ${char.name} picked an invalid or unavailable portrait ID: ${chosenId}`);
            continue;
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

          // 3. Update the physical JSON file to maintain sync
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
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (error: any) {
    console.error("Error in portraits endpoint:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

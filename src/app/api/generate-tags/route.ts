import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { parseTagVisibility, filterMasterTagsByGender } from "@/lib/masterTags";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

// Generate a JSON tag evaluation table (scores 1-10) for AICs
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { characterId, allEmpty, force } = body;

    // Fetch master tags
    const tSetting = await prisma.systemSetting.findUnique({
      where: { key: "tags_master" },
    });
    const masterTags = tSetting ? JSON.parse(tSetting.value) : [];

    if (masterTags.length === 0) {
      return NextResponse.json({ success: false, error: "Master tags library is empty." }, { status: 400 });
    }

    // Per-gender tag list visibility: each character is only scored against the
    // tags visible for their own gender's list. Tags without an explicit
    // visibility entry stay visible for every gender (backward compatible default).
    const tagVisibilitySetting = await prisma.systemSetting.findUnique({
      where: { key: "tags_gender_visibility" },
    });
    const tagVisibility = parseTagVisibility(tagVisibilitySetting?.value);

    let charactersToProcess: any[] = [];

    if (characterId) {
      const char = await prisma.character.findUnique({ where: { id: characterId } }) as any;
      if (char) {
        charactersToProcess.push(char);
      } else {
        return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
      }
    } else if (allEmpty) {
      const allChars = await prisma.character.findMany() as any[];
      charactersToProcess = allChars.filter(
        (c) => (c.disabled !== true) && (!c.tags || c.tags === "{}" || c.tags === "null" || force)
      );
    } else {
      return NextResponse.json({ success: false, error: "Missing parameter characterId or allEmpty" }, { status: 400 });
    }

    if (charactersToProcess.length === 0) {
      return NextResponse.json({ success: true, message: "No characters required tag generation.", generatedCount: 0 });
    }

    // Load custom base prompt if any
    const tagPromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_self_tagging" },
    });
    const defaultTagBasePrompt = "You are a character rating system. Analyze the personality profile, private persona, and bio of the character below, and rate them on a scale of 1 to 10 for each tag in the Master Tags list.\n\nRating Scale:\n1: The tag does not fit the character at all.\n5: The character somewhat fits the tag / neutral.\n10: The tag perfectly represents the character; they are the living embodiment of it.\n\nCharacter: {character_name}\nPublic Bio:\n{public_bio}\n\nPrivate Persona:\n{private_persona}\n\nMultimodal visual input: Look at their avatar profile picture below to align your tags with their visual look:\n{avatar_image}\n\nMaster Tags list to evaluate:\n{master_tags}\n\nYou MUST output a single, strictly valid JSON object. Every tag in the Master Tags list must be included as a key with an integer value from 1 to 10. Do not include any markdown code blocks, explanation, or extra characters.";
    const basePrompt = tagPromptSetting?.value || defaultTagBasePrompt;

    const generated = [];

    for (const char of charactersToProcess) {
      // Restrict the evaluated list to this character's gender tag list
      const charMasterTags = filterMasterTagsByGender(masterTags, tagVisibility, char.gender);
      if (charMasterTags.length === 0) {
        console.warn(`Skipping self-tagging for ${char.name} (${char.id}): no tags visible for gender "${char.gender}".`);
        generated.push({ id: char.id, name: char.name, skipped: true, reason: `No tags visible for gender "${char.gender}".` });
        continue;
      }

      // Fill placeholders in prompt templates
      const avatarMarkdown = char.avatar ? `![avatar](${char.avatar})` : "[No Avatar Picture]";
      
      const prompt = basePrompt
        .replace(/{character_name}/g, char.name)
        .replace(/{public_bio}/g, char.publicBio || "No public bio set.")
        .replace(/{private_persona}/g, char.privatePersona)
        .replace(/{avatar_image}/g, avatarMarkdown)
        .replace(/{master_tags}/g, JSON.stringify(charMasterTags));

      // Call the LLM with the Self-Tagging task scope. We ask for JSON.
      const response = await callLLM(
        "You are a strict data assistant. You evaluate profiles and output only pure, valid JSON objects containing tag-score pairs.",
        [{ role: "user", content: prompt }],
        undefined,
        false,
        "self_tagging"
      );

      let scores: Record<string, number> = {};
      try {
        // Clean markdown backticks if any
        const cleaned = response.replace(/```json/g, "").replace(/```/g, "").trim();
        scores = JSON.parse(cleaned);
      } catch (parseError) {
        console.error("JSON parse error on LLM tag generation output:", response);
        // Fallback: build default map
        charMasterTags.forEach((tag: string) => {
          scores[tag] = 5;
        });
      }

      // Ensure every tag is scored
      charMasterTags.forEach((tag: string) => {
        if (typeof scores[tag] !== "number") {
          scores[tag] = 5;
        } else {
          // Clamp 1 to 10
          scores[tag] = Math.max(1, Math.min(10, Math.round(scores[tag])));
        }
      });

      const tagsStr = JSON.stringify(scores);

      // 1. Update SQLite DB
      await prisma.character.update({
        where: { id: char.id },
        data: { tags: tagsStr },
      });

      // 2. Save back to character JSON file
      const directoryPath = path.join(process.cwd(), "AIC personas");
      const filePath = path.join(directoryPath, `${char.id}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const fileContent = fs.readFileSync(filePath, "utf-8");
          const fileData = JSON.parse(fileContent);
          fileData.tags = scores;
          fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), "utf-8");
        } catch (fileErr) {
          console.error(`Error saving tags to file ${filePath}:`, fileErr);
        }
      }

      generated.push({ id: char.id, name: char.name, tagsCount: Object.keys(scores).length });
    }

    return NextResponse.json({ success: true, generatedCount: generated.length, generated });
  } catch (error: any) {
    console.error("Error generating tags:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Reset character tags
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const characterId = url.searchParams.get("characterId");

    if (!characterId) {
      return NextResponse.json({ success: false, error: "Missing parameter characterId" }, { status: 400 });
    }

    // 1. Update SQLite DB to empty JSON
    await prisma.character.update({
      where: { id: characterId },
      data: { tags: "{}" },
    });

    // 2. Update character file to empty tags
    const directoryPath = path.join(process.cwd(), "AIC personas");
    const filePath = path.join(directoryPath, `${characterId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        const fileData = JSON.parse(fileContent);
        fileData.tags = {};
        fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), "utf-8");
      } catch (fileErr) {
        console.error(`Error resetting tags in file ${filePath}:`, fileErr);
      }
    }

    return NextResponse.json({ success: true, message: `Successfully reset tags for ${characterId}.` });
  } catch (error: any) {
    console.error("Error resetting tags:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

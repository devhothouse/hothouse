import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

// Generate a structured bio questionnaire for AICs
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { characterId, allEmpty } = body;

    // Fetch master questions
    const qSetting = await prisma.systemSetting.findUnique({
      where: { key: "questionnaire_master" },
    });
    const masterQuestions = qSetting ? JSON.parse(qSetting.value) : [];

    if (masterQuestions.length === 0) {
      return NextResponse.json({ success: false, error: "Master questions library is empty." }, { status: 400 });
    }

    let charactersToProcess: any[] = [];

    if (characterId) {
      const char = await prisma.character.findUnique({ where: { id: characterId } });
      if (char) {
        charactersToProcess.push(char);
      } else {
        return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
      }
    } else if (allEmpty) {
      // Find non-disabled characters with empty bio (undefined, empty, or very short)
      const allChars = await prisma.character.findMany() as any[];
      charactersToProcess = allChars.filter(
        (c) => (c.disabled !== true) && (!c.publicBio || c.publicBio.trim() === "" || c.publicBio.length < 15)
      );
    } else {
      return NextResponse.json({ success: false, error: "Missing parameter characterId or allEmpty" }, { status: 400 });
    }

    if (charactersToProcess.length === 0) {
      return NextResponse.json({ success: true, message: "No characters required bio generation.", generatedCount: 0 });
    }

    // Load custom base prompt if any
    const bioPromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_bio_writing" },
    });
    // Configurable name-usage guidance toggle (solo bios omit own name; group bios may use it)
    const nameGuidanceSetting = await prisma.systemSetting.findUnique({
      where: { key: "bio_name_guidance_enabled" },
    });
    const nameGuidanceEnabled = nameGuidanceSetting ? nameGuidanceSetting.value !== "false" : true;
    const defaultBioBasePrompt = "You are a creative writer assisting in creating a dating app profile. Your task is to write a cohesive, engaging dating app profile (structured) in the first person, matching the private persona profile provided.\n\nCharacter Name: {character_name}\nGender: {gender}\nLooking For: {looking_for}\n\nPrivate Persona Description:\n{private_persona}\n\nMultimodal visual input: Look at their avatar profile picture below to align your bio with their visual look:\n{avatar_image}\n\nMaster Questions Library:\n{master_questions}\n\nYou must construct a bio with the following sections formatted cleanly in text/markdown:\n1. **Intro**: A short, punchy 1-2 sentence self-introduction.\n2. **About Me**: A basic info line or list (e.g., Age, Profession, Hobbies/Vibe).\n3. **My Prompts**:\nSelect exactly 3 of the master questions and write short, funny, highly authentic, in-character answers for each of them in the first person.\n\nDo not write meta-commentary. Write ONLY the completed profile bio, starting directly with the intro. Make sure it sounds 100% natural and matches their voice perfectly.";
    const basePrompt = bioPromptSetting?.value || defaultBioBasePrompt;

    const generated = [];

    for (const char of charactersToProcess) {
      // Fill placeholders in prompt templates
      const questionsList = masterQuestions.map((q: string, i: number) => `${i + 1}. "${q}"`).join("\n");
      const avatarMarkdown = char.avatar ? `![avatar](${char.avatar})` : "[No Avatar Picture]";
      
      const prompt = basePrompt
        .replace(/{character_name}/g, char.name)
        .replace(/{gender}/g, char.gender)
        .replace(/{looking_for}/g, char.lookingFor)
        .replace(/{private_persona}/g, char.privatePersona)
        .replace(/{avatar_image}/g, avatarMarkdown)
        .replace(/{master_questions}/g, questionsList)
      // Name-usage guidance appended at runtime (so custom prompt templates keep working):
      // Solo bios should NOT state the character's own name (real dating profiles never do).
      // Group profiles (names containing "&" or "and") are the exception and SHOULD reference names.
      const isGroupProfile = char.name.includes("&") || /\band\b/i.test(char.name);
      const nameGuidance = isGroupProfile
        ? `\n\nNote: This is a JOINT group profile shared by "${char.name}". Unlike a solo dating profile, this bio can naturally reference their names (e.g. in the Intro or About Me) since multiple people share this one profile.`
        : `\n\nImportant: Do NOT state this character's own name ("${char.name}") anywhere in the bio text — real dating profiles never introduce themselves by name. The name is provided purely for your context.`;
      const fullPrompt = nameGuidanceEnabled ? prompt + nameGuidance : prompt;

      // Call the active LLM with bio scope, passing character avatar in context
      const response = await callLLM(
        "You are a helpful assistant that generates high-quality character profile bios for a dating app simulator.",
        [{ role: "user", content: fullPrompt }],
        undefined,
        false,
        "bio"
      );

      const cleanedBio = response.trim();

      // 1. Update SQLite DB
      await prisma.character.update({
        where: { id: char.id },
        data: { publicBio: cleanedBio },
      });

      // 2. Save back to character JSON file
      const directoryPath = path.join(process.cwd(), "AIC personas");
      const filePath = path.join(directoryPath, `${char.id}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const fileContent = fs.readFileSync(filePath, "utf-8");
          const fileData = JSON.parse(fileContent);
          fileData.publicBio = cleanedBio;
          fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), "utf-8");
        } catch (fileErr) {
          console.error(`Error saving bio to file ${filePath}:`, fileErr);
        }
      }

      generated.push({ id: char.id, name: char.name, bio: cleanedBio });
    }

    return NextResponse.json({ success: true, generatedCount: generated.length, generated });
  } catch (error: any) {
    console.error("Error generating bio:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

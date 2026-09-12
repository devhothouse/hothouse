import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import fs from "fs";
import path from "path";
import { DEFAULT_PROMPT_IMAGE_PROMPT_WRITER } from "@/lib/imageGen";

export const runtime = "nodejs";

/**
 * POST /api/image-gen/prompts
 * Image Prompt Writer: writes each character's visual appearance description
 * (Character.imageGenPrompt) with an LLM, vision-assisted by the character's
 * portrait when one is assigned. The description replaces the raw persona
 * excerpt as the {persona_summary} input for AI image generation, and is
 * injected into chat image generation so text-only providers can still draw
 * the character consistently.
 * Targets: { characterId } or { allEmpty: true } (characters without one yet).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { characterId, allEmpty } = body;

    let charactersToProcess: any[] = [];
    if (characterId) {
      const char = await prisma.character.findUnique({ where: { id: characterId } });
      if (!char) {
        return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
      }
      charactersToProcess.push(char);
    } else if (allEmpty) {
      const allChars = await prisma.character.findMany({ where: { disabled: false } });
      charactersToProcess = allChars.filter((c) => !(c as any).imageGenPrompt || (c as any).imageGenPrompt.trim() === "");
    } else {
      return NextResponse.json({ success: false, error: "Missing parameter characterId or allEmpty" }, { status: 400 });
    }

    if (charactersToProcess.length === 0) {
      return NextResponse.json({ success: true, message: "All characters already have image prompts.", writtenCount: 0, results: [] });
    }

    const templateSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_image_prompt_writer" },
    });
    const template = templateSetting?.value || DEFAULT_PROMPT_IMAGE_PROMPT_WRITER;

    const results: any[] = [];
    for (const char of charactersToProcess) {
      try {
        const avatarMarkdown = char.avatar && char.avatar.startsWith("/") ? `![avatar](${char.avatar})` : "[No Avatar Picture]";
        const prompt = template
          .replace(/{character_name}/g, char.name || "")
          .replace(/{gender}/g, char.gender || "")
          .replace(/{avatar_image}/g, avatarMarkdown)
          .replace(/{persona}/g, char.privatePersona || "");

        const responseText = await callLLM(
          "You write concise visual appearance descriptions for image generation.",
          [{ role: "user", content: prompt }],
          undefined,
          false,
          "image_prompt_writer"
        );
        const visual = (responseText || "").trim();
        if (!visual) throw new Error("The LLM returned an empty visual description.");

        // Save on the character (DB) and mirror into the persona JSON file
        await prisma.character.update({ where: { id: char.id }, data: { imageGenPrompt: visual } });
        const filePath = path.join(process.cwd(), "AIC personas", `${char.id}.json`);
        if (fs.existsSync(filePath)) {
          try {
            const fileData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            fileData.imageGenPrompt = visual;
            fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), "utf-8");
          } catch (fileErr: any) {
            console.error(`Error saving imageGenPrompt to character JSON file ${filePath}:`, fileErr);
          }
        }

        results.push({ characterId: char.id, characterName: char.name, imageGenPrompt: visual });
      } catch (err: any) {
        // One character's failure never aborts the batch
        console.error(`Error writing image prompt for character ${char.name}:`, err);
        results.push({ characterId: char.id, characterName: char.name, error: err.message });
      }
    }

    const okCount = results.filter((r) => !r.error).length;
    return NextResponse.json({ success: true, writtenCount: okCount, results });
  } catch (error: any) {
    console.error("Error in image prompt writer endpoint:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

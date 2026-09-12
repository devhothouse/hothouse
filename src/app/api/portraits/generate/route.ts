import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isImageGenConfigured, generateAndAssignPortrait } from "@/lib/imageGen";

export const runtime = "nodejs";

/**
 * POST /api/portraits/generate
 * AI Image Generation (Use 1): generates a portrait for characters instead of
 * picking one from the library. Target selection follows the same rules as
 * /api/portraits/assign: { characterId } or { allEmpty: true }, plus an optional
 * { limit } to cap cost. Generated images are saved locally under
 * public/portrait-library/generated/ and registered in the Portrait table.
 */
export async function POST(req: Request) {
  try {
    if (!(await isImageGenConfigured())) {
      return NextResponse.json(
        { success: false, error: "AI Image Generation is disabled. Pick a provider in the Manager tab → Image Generation first." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { characterId, allEmpty, limit } = body;

    let charactersToProcess: any[] = [];
    if (characterId) {
      const char = await prisma.character.findUnique({ where: { id: characterId } });
      if (!char) {
        return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
      }
      charactersToProcess.push(char);
    } else if (allEmpty) {
      // Same target rule as the library picker: active characters without an avatar
      const allChars = await prisma.character.findMany({ where: { disabled: false } });
      charactersToProcess = allChars.filter((c) => !c.avatar || c.avatar === "");
    } else {
      return NextResponse.json({ success: false, error: "Missing parameter characterId or allEmpty" }, { status: 400 });
    }

    const maxCount = parseInt(limit, 10);
    if (Number.isFinite(maxCount) && maxCount >= 1) {
      charactersToProcess = charactersToProcess.slice(0, maxCount);
    }

    if (charactersToProcess.length === 0) {
      return NextResponse.json({ success: true, message: "No characters required portrait generation.", generatedCount: 0, generated: [] });
    }

    const generated: any[] = [];
    for (const char of charactersToProcess) {
      try {
        const result = await generateAndAssignPortrait(char);
        generated.push({ characterId: char.id, characterName: char.name, filepath: result.filepath, prompt: result.prompt });
      } catch (err: any) {
        // One character's failure never aborts the batch
        console.error(`Error generating portrait for character ${char.name}:`, err);
        generated.push({ characterId: char.id, characterName: char.name, error: err.message });
      }
    }

    const okCount = generated.filter((g) => !g.error).length;
    return NextResponse.json({ success: true, generatedCount: okCount, generated });
  } catch (error: any) {
    console.error("Error in portrait generation endpoint:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

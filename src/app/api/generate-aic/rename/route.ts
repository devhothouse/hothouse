import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

// Resolve duplicate or empty character names using LLM
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { characterId } = body;

    const namePromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_name_generation" },
    });
    
    const basePromptTemplate = namePromptSetting?.value || `You are generating a highly fitting name for an AI Character on a dating app.
Analyze their private persona and tags:
Private Persona: {private_persona}
Tags: {tags_specification}

NAME SELECTION GUIDELINES:
- Choose a name that perfectly fits the character's generated traits and private persona.
- For standard characters, lean towards realistic, natural dating app names.
- For unusual, royal, or robotic characters, choose creative, wild, poetic, or unique names matching their specific vibe.
- CRITICAL UNIQUENESS RULE: The following names are taken and MUST NOT be used: {taken_names}. You MUST choose a name NOT on this list.

Respond in strictly valid JSON:
{ "name": "The Chosen Name" }`;

    let characters = await prisma.character.findMany({
      where: { deleted: false, outdated: false },
    });

    let toRename = [];
    if (characterId) {
      const char = characters.find(c => c.id === characterId);
      if (char) toRename.push(char);
    } else {
      const nameCounts: Record<string, number> = {};
      for (const char of characters) {
        const name = char.name.trim();
        nameCounts[name] = (nameCounts[name] || 0) + 1;
      }
      toRename = characters.filter(char => {
        const name = char.name.trim();
        return (
          nameCounts[name] > 1 || 
          name === "" || 
          name.toLowerCase() === "unnamed" || 
          name.toLowerCase() === "generated"
        );
      });
    }

    if (toRename.length === 0) {
      return NextResponse.json({ success: true, message: "No duplicate or unnamed characters found.", renamed: [] });
    }

    const renamedResults = [];

    for (const char of toRename) {
      try {
        const currentTakenNames = characters
          .map(c => c.name.trim())
          .filter(n => n !== "" && n.toLowerCase() !== "unnamed" && n.toLowerCase() !== "generated");

        const finalPrompt = basePromptTemplate
          .replace(/{private_persona}/g, char.privatePersona || "")
          .replace(/{tags_specification}/g, char.tags || "{}")
          .replace(/{taken_names}/g, currentTakenNames.join(", "));

        const rawResult = await callLLM(
          "You are a backend server that generates high-quality character names in strictly valid JSON format.",
          [{ role: "user", content: finalPrompt }],
          undefined,
          false,
          "name_generation"
        );

        let newName = "";
        try {
          const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawResult);
          newName = parsed.name || parsed.newName;
        } catch (e) {
          console.error("Name parse failed:", rawResult);
        }

        newName = (newName || "").trim();
        if (!newName || currentTakenNames.includes(newName)) {
          newName = (char.name && char.name.toLowerCase() !== "unnamed" ? char.name : "Character") + "_" + Math.floor(Math.random() * 900 + 100);
        }

        const oldName = char.name;

        await prisma.character.update({
          where: { id: char.id },
          data: { name: newName },
        });

        const directoryPath = path.join(process.cwd(), "AIC personas");
        const filePath = path.join(directoryPath, `${char.id}.json`);
        if (fs.existsSync(filePath)) {
          try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            const data = JSON.parse(fileContent);
            data.name = newName;
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
          } catch (fileErr) {
            console.error("JSON update failed:", fileErr);
          }
        }

        char.name = newName;
        characters = characters.map(c => c.id === char.id ? { ...c, name: newName } : c);

        renamedResults.push({ id: char.id, oldName, newName });
      } catch (err) {
        console.error("Rename failed:", char.id, err);
      }
    }

    return NextResponse.json({ success: true, message: `Resolved ${renamedResults.length} character names.`, renamed: renamedResults });
  } catch (error: any) {
    console.error("Rename Route Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
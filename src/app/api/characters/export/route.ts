import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMimeTypeFromBuffer } from "@/lib/llm";

export const runtime = "nodejs";
import fs from "fs";
import path from "path";

// =========================================================
// CHARACTER EXPORT (Roadmap A3)
// ---------------------------------------------------------
// GET /api/characters/export?characterId=<id>
// Returns the character's portable persona JSON — the exact same shape as the
// files in the `AIC personas/` folder — with the avatar image embedded as a
// base64 data-URL so the file is fully self-contained on other machines.
// No Message / Interaction / AIC-chat data is ever included (owner decision).
// =========================================================

// Avatar values referencing local files (served from public/) can be embedded;
// external http(s) URLs are already portable and data URLs already are embedded.
const LOCAL_AVATAR_PREFIXES = ["/portrait-library/", "/uploads/"];

// Normalizes a stored JSON-string field (tags / developedTags) into an object,
// mirroring the tolerant parsing in /api/characters POST.
function parseJsonField(raw: any, fallback: any): any {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return typeof raw === "string" ? String(raw).split(",").map((t) => t.trim()).filter(Boolean) : fallback;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const characterId = url.searchParams.get("characterId");
    if (!characterId) {
      return NextResponse.json({ success: false, error: "Missing parameter characterId" }, { status: 400 });
    }

    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) {
      return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
    }

    // Portable persona — identical field shape to the /api/characters POST
    // write-back (and therefore the AIC personas/ templates).
    const persona: any = {
      id: character.id,
      name: character.name,
      gender: character.gender,
      lookingFor: character.lookingFor,
      avatar: character.avatar || "",
      voiceId: character.voiceId,
      publicBio: character.publicBio,
      privatePersona: character.privatePersona,
      delayChance: character.delayChance,
      userFollowUpResponseChance: character.userFollowUpResponseChance,
      maxConsecutiveMessages: character.maxConsecutiveMessages,
      asyncMessageWeight: character.asyncMessageWeight,
      tags: parseJsonField(character.tags, {}),
      developedTags: parseJsonField(character.developedTags, null),
      imageGenPrompt: character.imageGenPrompt ?? null,
      disabled: character.disabled ?? false,
      outdated: character.outdated ?? false,
    };

    // Embed the portrait as a base64 data URL so the export works on machines
    // that do not have this portrait library. Magic bytes decide the mime type
    // (same vision-compliance logic as the multimodal pipeline).
    const avatar = typeof persona.avatar === "string" ? persona.avatar : "";
    if (avatar && !avatar.startsWith("data:") && !avatar.startsWith("http")) {
      const rel = avatar.split("?")[0].split("#")[0];
      if (LOCAL_AVATAR_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
        const publicDir = path.resolve(process.cwd(), "public");
        const localPath = path.resolve(publicDir, "." + rel);
        const relCheck = path.relative(publicDir, localPath);
        const withinPublic = relCheck !== "" && !relCheck.startsWith("..");
        if (withinPublic && fs.existsSync(localPath)) {
          const buffer = fs.readFileSync(localPath);
          const mimeType = getMimeTypeFromBuffer(buffer);
          if (mimeType !== "application/octet-stream") {
            persona.avatar = `data:${mimeType};base64,${buffer.toString("base64")}`;
          }
        }
      }
    }

    return NextResponse.json({ success: true, persona });
  } catch (error: any) {
    console.error("Error exporting character:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMimeTypeFromBuffer } from "@/lib/llm";

export const runtime = "nodejs";
import fs from "fs";
import path from "path";

// =========================================================
// CHARACTER IMPORT (Roadmap A3)
// ---------------------------------------------------------
// POST /api/characters/import   body: { persona, resolve? }
// Validates a portable persona JSON (as produced by /api/characters/export),
// saves any embedded avatar image into public/portrait-library/imported/,
// writes the persona file into `AIC personas/`, and upserts the Character row.
// Collision handling: when the character ID already exists and no `resolve`
// decision was sent, the route answers success:false with `collision: true` and
// a suggested new ID / name so the UI can offer "overwrite" vs "import as new"
// (200 + success:false so the shared safeFetch client keeps the extra fields).
// No chat data is ever imported or modified.
// =========================================================

const PERSONA_DIR = "AIC personas";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // refuse to decode anything unreasonable

function optionalNumber(value: any): number | undefined {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

type ValidateResult =
  | { ok: true; persona: any; tagsStr: string; developedTagsStr: string | null; delayChance: number | undefined; userFollowUpResponseChance: number | undefined; maxConsecutiveMessages: number | undefined; asyncMessageWeight: number | undefined }
  | { ok: false; error: string };

function validatePersona(body: any): ValidateResult {
  const persona = body?.persona;
  if (!persona || typeof persona !== "object" || Array.isArray(persona)) {
    return { ok: false, error: "This file is not a Hothouse persona file (missing 'persona' object)." };
  }
  if (typeof persona.id !== "string" || !ID_PATTERN.test(persona.id)) {
    return { ok: false, error: "Character ID is missing or invalid (letters, numbers, dashes and underscores only)." };
  }
  for (const field of ["name", "gender", "lookingFor", "publicBio", "privatePersona"]) {
    if (typeof persona[field] !== "string") {
      return { ok: false, error: `Character field "${field}" is missing or is not text.` };
    }
  }
  if (!persona.name.trim()) {
    return { ok: false, error: "Character name is empty." };
  }
  const avatar = persona.avatar ?? "";
  if (typeof avatar !== "string") {
    return { ok: false, error: "Avatar field must be text (an embedded image, an image URL, or empty)." };
  }
  if (avatar.length > 12 * 1024 * 1024) {
    return { ok: false, error: "The embedded portrait is too large (over ~12 MB)." };
  }
  let tagsStr = "{}";
  if (persona.tags !== undefined && persona.tags !== null) {
    tagsStr = typeof persona.tags === "string" ? persona.tags : JSON.stringify(persona.tags);
  }
  let developedTagsStr: string | null = null;
  if (persona.developedTags !== undefined && persona.developedTags !== null) {
    developedTagsStr = typeof persona.developedTags === "string" ? persona.developedTags : JSON.stringify(persona.developedTags);
  }
  return {
    ok: true,
    persona,
    tagsStr,
    developedTagsStr,
    delayChance: optionalNumber(persona.delayChance),
    userFollowUpResponseChance: optionalNumber(persona.userFollowUpResponseChance),
    maxConsecutiveMessages: optionalNumber(persona.maxConsecutiveMessages),
    asyncMessageWeight: optionalNumber(persona.asyncMessageWeight),
  };
}

// Decodes a data-URL avatar into a buffer + file extension, or null when the
// avatar is not an embedded image. Magic bytes decide the real type.
function decodeEmbeddedAvatar(avatar: string): { buffer: Buffer; ext: string } | null {
  const match = typeof avatar === "string" ? avatar.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/) : null;
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  const realMime = getMimeTypeFromBuffer(buffer);
  if (realMime === "application/octet-stream") return null; // payload is not a real image
  const ext = realMime === "image/gif" ? "gif" : realMime === "image/webp" ? "webp" : realMime === "image/png" ? "png" : "jpg";
  return { buffer, ext };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const validated = validatePersona(body);
    if (!validated.ok) {
      return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    }
    const persona = validated.persona;

    // ---- Collision handling (existing ID → overwrite vs import-as-new) ----
    const existing = await prisma.character.findUnique({ where: { id: persona.id } });
    let finalId = persona.id;
    let mode: "created" | "overwritten" = "created";

    if (existing) {
      const resolve = body?.resolve;
      if (resolve?.overwrite === true) {
        // Overwrite the existing character with this persona. Same identity, so
        // its interactions/messages are preserved (and a deleted character is
        // revived with deleted: false below).
        finalId = persona.id;
        mode = "overwritten";
      } else if (typeof resolve?.id === "string" && resolve.id.trim()) {
        // Import as a NEW character under the previously suggested ID.
        finalId = resolve.id.trim();
        if (!ID_PATTERN.test(finalId)) {
          return NextResponse.json({ success: false, error: "The new character ID is invalid (letters, numbers, dashes and underscores only)." }, { status: 400 });
        }
        if (await prisma.character.findUnique({ where: { id: finalId } })) {
          return NextResponse.json({ success: false, error: `A character with ID "${finalId}" already exists.` });
        }
      } else {
        // No decision yet — report the collision with suggestions.
        let suggestedId = persona.id;
        let counter = 2;
        while (await prisma.character.findUnique({ where: { id: suggestedId } })) {
          suggestedId = `${persona.id}-${counter}`;
          counter += 1;
        }
        let suggestedName = persona.name;
        let nameTaken = !!(await prisma.character.findFirst({
          where: { name: persona.name, deleted: false, outdated: false },
          select: { id: true },
        }));
        if (nameTaken) {
          let nameCounter = 2;
          suggestedName = `${persona.name} (Imported)`;
          while (
            await prisma.character.findFirst({
              where: { name: suggestedName, deleted: false, outdated: false },
              select: { id: true },
            })
          ) {
            suggestedName = `${persona.name} (Imported ${nameCounter})`;
            nameCounter += 1;
          }
        }
        return NextResponse.json(
          {
            success: false,
            collision: true,
            existingId: existing.id,
            existingName: existing.name,
            existingDeleted: existing.deleted,
            suggestedId,
            suggestedName,
            nameTaken,
          }
        );
      }
    }

    // ---- Final name (uniqueness per the name-generation rules) ------------
    let finalName = String(persona.name).trim().slice(0, 100);
    const excludeId = mode === "overwritten" ? finalId : null;
    const nameFilter = { name: finalName, deleted: false, outdated: false, ...(excludeId ? { id: { not: excludeId } } : {}) };
    if (await prisma.character.findFirst({ where: nameFilter, select: { id: true } })) {
      const base = typeof body?.resolve?.name === "string" && body.resolve.name.trim()
        ? String(body.resolve.name).trim().slice(0, 100)
        : finalName;
      let candidate = `${base} (Imported)`;
      let counter = 2;
      while (
        await prisma.character.findFirst({
          where: { name: candidate, deleted: false, outdated: false, ...(excludeId ? { id: { not: excludeId } } : {}) },
          select: { id: true },
        })
      ) {
        candidate = `${base} (Imported ${counter})`;
        counter += 1;
      }
      finalName = candidate;
    }

    // ---- Avatar: save an embedded image into portrait-library/imported ----
    let finalAvatar = typeof persona.avatar === "string" ? persona.avatar : "";
    const embedded = decodeEmbeddedAvatar(finalAvatar);
    if (embedded) {
      const importedDir = path.join(process.cwd(), "public", "portrait-library", "imported");
      fs.mkdirSync(importedDir, { recursive: true });
      const fileName = `${finalId}.${embedded.ext}`;
      fs.writeFileSync(path.join(importedDir, fileName), embedded.buffer);
      finalAvatar = `/portrait-library/imported/${fileName}`;
    }

    // ---- Upsert the Character row (same defaults as /api/characters POST) --
    const character = await prisma.character.upsert({
      where: { id: finalId },
      update: {
        name: finalName,
        gender: persona.gender,
        lookingFor: persona.lookingFor,
        avatar: finalAvatar,
        voiceId: persona.voiceId ?? "",
        publicBio: persona.publicBio,
        privatePersona: persona.privatePersona,
        tags: validated.tagsStr,
        developedTags: validated.developedTagsStr,
        disabled: persona.disabled ?? false,
        outdated: persona.outdated ?? false,
        deleted: false,
        delayChance: validated.delayChance,
        userFollowUpResponseChance: validated.userFollowUpResponseChance,
        maxConsecutiveMessages: validated.maxConsecutiveMessages,
        asyncMessageWeight: validated.asyncMessageWeight,
        imageGenPrompt: persona.imageGenPrompt ?? null,
      },
      create: {
        id: finalId,
        name: finalName,
        gender: persona.gender,
        lookingFor: persona.lookingFor,
        avatar: finalAvatar,
        voiceId: persona.voiceId ?? "",
        publicBio: persona.publicBio,
        privatePersona: persona.privatePersona,
        tags: validated.tagsStr,
        developedTags: validated.developedTagsStr,
        disabled: persona.disabled ?? false,
        outdated: persona.outdated ?? false,
        deleted: false,
        delayChance: validated.delayChance ?? 0.02,
        userFollowUpResponseChance: validated.userFollowUpResponseChance ?? 0.5,
        maxConsecutiveMessages: validated.maxConsecutiveMessages ?? 3,
        asyncMessageWeight: validated.asyncMessageWeight ?? 3,
        imageGenPrompt: persona.imageGenPrompt ?? null,
      },
    }) as any;

    // ---- Write the persona file (mirrors /api/characters POST format) ------
    const directoryPath = path.join(process.cwd(), PERSONA_DIR);
    fs.mkdirSync(directoryPath, { recursive: true });
    let tagsObj: any = {};
    try {
      tagsObj = JSON.parse(validated.tagsStr);
    } catch {
      tagsObj = {};
    }
    let finalDevelopedTags: any = null;
    if (validated.developedTagsStr) {
      try {
        finalDevelopedTags = JSON.parse(validated.developedTagsStr);
      } catch {
        finalDevelopedTags = null;
      }
    }
    const jsonContent = JSON.stringify(
      {
        id: finalId,
        name: finalName,
        gender: persona.gender,
        lookingFor: persona.lookingFor,
        avatar: finalAvatar,
        voiceId: persona.voiceId ?? "",
        publicBio: persona.publicBio,
        privatePersona: persona.privatePersona,
        delayChance: character.delayChance,
        userFollowUpResponseChance: character.userFollowUpResponseChance,
        maxConsecutiveMessages: character.maxConsecutiveMessages,
        asyncMessageWeight: character.asyncMessageWeight,
        tags: tagsObj,
        developedTags: finalDevelopedTags,
        imageGenPrompt: character.imageGenPrompt ?? null,
        disabled: character.disabled ?? false,
        outdated: character.outdated ?? false,
      },
      null,
      2
    );
    fs.writeFileSync(path.join(directoryPath, `${finalId}.json`), jsonContent, "utf-8");

    return NextResponse.json({ success: true, mode, id: finalId, name: finalName, character });
  } catch (error: any) {
    console.error("Error importing character:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

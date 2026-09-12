import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
import fs from "fs";
import path from "path";

// Get all active, non-deleted characters, optionally including interactions for a specific profile
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const profileId = url.searchParams.get("profileId");

    const characters = await prisma.character.findMany({
      where: { deleted: false },
      orderBy: { name: "asc" },
      include: profileId ? {
        interactions: {
          where: { profileId },
          include: {
            _count: {
              select: { messages: true }
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1
            }
          }
        }
      } : undefined
    });
    return NextResponse.json({ success: true, characters });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Permanently delete a character from active lists while preserving past chats (Topic C #3)
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const characterId = url.searchParams.get("characterId");

    if (!characterId) {
      return NextResponse.json({ success: false, error: "Missing parameter characterId" }, { status: 400 });
    }

    const char = await prisma.character.findUnique({
      where: { id: characterId }
    });

    if (!char) {
      return NextResponse.json({ success: false, error: "Character not found." }, { status: 404 });
    }

    // 0. Release the character's library portrait (same pattern as the
    // /api/portraits/assign repick path) so other characters can pick it again.
    // Without this, the Portrait row stays in_use forever after deletion and
    // the picker (which only considers in_use: false) can never reuse it.
    if (char.avatar) {
      await (prisma as any).portrait.updateMany({
        where: { filepath: char.avatar },
        data: { in_use: false },
      });
    }

    // 1. Mark character as deleted and disabled, clearing avatar and voiceId to free them up
    await prisma.character.update({
      where: { id: characterId },
      data: {
        deleted: true,
        disabled: true,
        avatar: "", // frees up bio pic
        voiceId: "", // frees up/updates voice counts
      }
    });

    // 2. Safely delete physical JSON file from 'AIC personas' folder so it doesn't re-seed
    const directoryPath = path.join(process.cwd(), "AIC personas");
    const filePath = path.join(directoryPath, `${characterId}.json`);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`Error deleting physical file ${filePath}:`, err);
      }
    }

    return NextResponse.json({ success: true, message: `Permanently deleted character ${characterId} from active lists. Chats preserved.` });
  } catch (error: any) {
    console.error("Error deleting character:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Edit a character's persona and write back to JSON file
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, name, gender, lookingFor, avatar, voiceId, publicBio, privatePersona, tags, disabled, outdated, userFollowUpResponseChance, delayChance, maxConsecutiveMessages, asyncMessageWeight, developedTags } = body;

    if (!id || !name) {
      return NextResponse.json({ success: false, error: "Character ID and name are required." }, { status: 400 });
    }

    let tagsStr = undefined;
    if (tags !== undefined) {
      tagsStr = typeof tags === "string" ? tags : JSON.stringify(tags);
    }

    let developedTagsStr = undefined;
    if (developedTags !== undefined) {
      developedTagsStr = typeof developedTags === "string" ? developedTags : JSON.stringify(developedTags);
    }

    // 1. Update SQLite DB using upsert
    const character = await prisma.character.upsert({
      where: { id },
      update: {
        name,
        gender,
        lookingFor,
        avatar,
        voiceId,
        publicBio,
        privatePersona,
        ...(tagsStr !== undefined ? { tags: tagsStr } : {}),
        ...(developedTagsStr !== undefined ? { developedTags: developedTagsStr } : {}),
        disabled: disabled ?? false,
        outdated: outdated ?? false,
        delayChance: delayChance !== undefined ? parseFloat(delayChance) : undefined,
        userFollowUpResponseChance: userFollowUpResponseChance !== undefined ? parseFloat(userFollowUpResponseChance) : undefined,
        maxConsecutiveMessages: maxConsecutiveMessages !== undefined ? parseInt(maxConsecutiveMessages) : undefined,
        asyncMessageWeight: asyncMessageWeight !== undefined ? parseInt(asyncMessageWeight) : undefined,
      },
      create: {
        id,
        name,
        gender,
        lookingFor,
        avatar,
        voiceId,
        publicBio,
        privatePersona,
        tags: tagsStr || "{}",
        developedTags: developedTagsStr || null,
        disabled: disabled ?? false,
        outdated: outdated ?? false,
        delayChance: delayChance !== undefined ? parseFloat(delayChance) : 0.02,
        userFollowUpResponseChance: userFollowUpResponseChance !== undefined ? parseFloat(userFollowUpResponseChance) : 0.5,
        maxConsecutiveMessages: maxConsecutiveMessages !== undefined ? parseInt(maxConsecutiveMessages) : 3,
        asyncMessageWeight: asyncMessageWeight !== undefined ? parseInt(asyncMessageWeight) : 3,
      }
    }) as any;

    // 2. Write back to physical JSON file in 'AIC personas' folder
    const directoryPath = path.join(process.cwd(), "AIC personas");
    const filePath = path.join(directoryPath, `${id}.json`);

    // Read existing tags if not provided in the request to avoid overwriting them in the file
    let finalTagsObj = {};
    if (tags !== undefined) {
      finalTagsObj = typeof tags === "string" ? JSON.parse(tags) : tags;
    } else if (character.tags) {
      try {
        finalTagsObj = JSON.parse(character.tags);
      } catch (e) {
        finalTagsObj = {};
      }
    }

    let finalDevelopedTags = null;
    if (developedTags !== undefined) {
      if (typeof developedTags === "string") {
        try {
          finalDevelopedTags = JSON.parse(developedTags);
        } catch (e) {
          finalDevelopedTags = developedTags.split(",").map(t => t.trim());
        }
      } else {
        finalDevelopedTags = developedTags;
      }
    } else if (character.developedTags) {
      try {
        finalDevelopedTags = JSON.parse(character.developedTags);
      } catch (e) {
        finalDevelopedTags = String(character.developedTags).split(",").map(t => t.trim());
      }
    }

    const jsonContent = JSON.stringify(
      {
        id,
        name,
        gender,
        lookingFor,
        avatar,
        voiceId,
        publicBio,
        privatePersona,
        delayChance: character.delayChance,
        userFollowUpResponseChance: character.userFollowUpResponseChance,
        maxConsecutiveMessages: character.maxConsecutiveMessages,
        asyncMessageWeight: character.asyncMessageWeight,
        tags: finalTagsObj,
        developedTags: finalDevelopedTags,
        imageGenPrompt: character.imageGenPrompt ?? null,
        disabled: disabled ?? false,
        outdated: outdated ?? false,
      },
      null,
      2
    );

    fs.writeFileSync(filePath, jsonContent, "utf-8");

    return NextResponse.json({ success: true, character });
  } catch (error: any) {
    console.error("Error editing character:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

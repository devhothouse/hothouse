import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMatchDelaySettings, rollDelayedMatch } from "@/lib/matchDelay";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { characterId, userStatus } = body; // userStatus is 'pass' or 'like'

    if (!characterId || !userStatus) {
      return NextResponse.json({ success: false, error: "characterId and userStatus are required." }, { status: 400 });
    }

    // 1. Get active profile
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });

    if (!activeProfile) {
      return NextResponse.json({ success: false, error: "No active profile found." }, { status: 400 });
    }

    // 2. Fetch existing interaction
    const existing = await prisma.interaction.findUnique({
      where: {
        profileId_characterId: {
          profileId: activeProfile.id,
          characterId,
        },
      },
    });

    const aicStatus = existing?.aicStatus;
    
    // 3. Determine if it's a match
    let matched = false;
    if (userStatus === "like" && (aicStatus === "like" || aicStatus === "slide-in")) {
      matched = true;
    }

    // If AIC slid in, user's response can match them
    if (existing?.aicStatus === "slide-in" && userStatus === "like") {
      matched = true;
    }

    // 3b. Match Delay (AIC Evaluation Delay feature): a mutual like — the AIC
    // already "liked" the profile — may be scheduled into the future instead of
    // matching instantly. Slide-ins are exempt (the AIC already messaged first).
    let pendingMatchAt: Date | null = null;
    let matchDelayed = false;
    let delayMinutes: number | null = null;
    if (matched && aicStatus === "like") {
      const delaySettings = await getMatchDelaySettings();
      const scheduled = rollDelayedMatch(delaySettings);
      if (scheduled) {
        pendingMatchAt = scheduled;
        matched = false; // No instant "It's a Match!" overlay; materializes later
        matchDelayed = true;
        delayMinutes = Math.max(1, Math.round((scheduled.getTime() - Date.now()) / 60000));
      }
    }

    // 4. Update ledger
    const interaction = await prisma.interaction.upsert({
      where: {
        profileId_characterId: {
          profileId: activeProfile.id,
          characterId,
        },
      },
      update: {
        userStatus,
        matched,
        matchTimestamp: matched ? new Date() : existing?.matchTimestamp,
        pendingMatchAt, // Scheduled future match; immediate/clear outcomes null any stale pending value
      },
      create: {
        profileId: activeProfile.id,
        characterId,
        userStatus,
        matched,
        matchTimestamp: matched ? new Date() : null,
        pendingMatchAt,
      },
    });

    // Initialize chat history with the slide-in opener if matched and slide-in occurred
    // But check if we already have messages
    const messageCount = await prisma.message.count({
      where: { interactionId: interaction.id }
    });

    if (matched && interaction.aicStatus === "slide-in" && interaction.dmMessage && messageCount === 0) {
      await prisma.message.create({
        data: {
          interactionId: interaction.id,
          role: "assistant",
          content: interaction.dmMessage,
        }
      });
    }

    return NextResponse.json({
      success: true,
      interaction,
      matched, // lets the frontend know to pop up "It's a Match!"
      matchDelayed, // true when the mutual match was scheduled into the future (Match Delay feature)
      delayMinutes,
    });
  } catch (error: any) {
    console.error("Interact API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

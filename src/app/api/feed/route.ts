import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { materializePendingMatches } from "@/lib/matchDelay";

export const runtime = "nodejs";

export async function GET() {
  try {
    // 1. Get active profile
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });

    if (!activeProfile) {
      return NextResponse.json({ success: true, queue: [] });
    }

    // Materialize any due delayed matches while loading the feed (Match Delay feature)
    const newMatches = await materializePendingMatches(activeProfile.id);

    // 2. Fetch characters matching user's lookingFor preference
    // If user's lookingFor is "Everyone", we can fetch all.
    const genderFilter: any = {
      disabled: false,
    };
    if (activeProfile.lookingFor !== "Everyone") {
      genderFilter.gender = activeProfile.lookingFor;
    }

    const allMatchingCharacters = await prisma.character.findMany({
      where: genderFilter,
    });

    // 3. Fetch existing interactions to filter out swiped/slide-in ones
    const interactions = await prisma.interaction.findMany({
      where: {
        profileId: activeProfile.id,
      },
    });

    const swipedCharacterIds = interactions
      .filter((inter: any) => inter.userStatus !== null || inter.aicStatus === "slide-in")
      .map((inter: any) => inter.characterId);

    // 4. Exclude swiped/slide-in character IDs from the feed queue
    const queue = allMatchingCharacters.filter(
      (char: any) => !swipedCharacterIds.includes(char.id)
    );

    // 5. Randomize the order (as per instruction: "the user will be shown AICs in a random order")
    const randomizedQueue = queue.sort(() => Math.random() - 0.5);

    return NextResponse.json({
      success: true,
      queue: randomizedQueue,
      newMatches,
    });
  } catch (error: any) {
    console.error("Feed API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

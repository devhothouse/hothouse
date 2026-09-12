import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateUserReview } from "@/lib/llm";
import { checkAndTriggerMilestoneGossip, checkAndTriggerSlideInIgnoredGossip } from "@/lib/gossip";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const profileIdParam = url.searchParams.get("profileId");
    const sentimentFilter = url.searchParams.get("sentiment");
    const authorFilter = url.searchParams.get("authorId");
    const badgeFilter = url.searchParams.get("badge");
    const searchQuery = url.searchParams.get("q") || "";

    let profile = null;
    if (profileIdParam) {
      profile = await prisma.profile.findUnique({ where: { id: profileIdParam } });
    } else {
      profile = await prisma.profile.findFirst({ where: { isActive: true } });
    }

    if (!profile) {
      return NextResponse.json({
        success: true,
        reviews: [],
        stats: { totalReviews: 0, avgRating: 0, sentimentCounts: {}, topBadges: [] },
      });
    }

    const allProfileReviews = await prisma.userReview.findMany({
      where: { profileId: profile.id },
      include: { character: true },
      orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
    });

    const totalReviews = allProfileReviews.length;
    const avgRating =
      totalReviews > 0
        ? (allProfileReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews).toFixed(1)
        : 0;

    const sentimentCounts: Record<string, number> = {
      green_flag: 0,
      red_flag: 0,
      tea_spill: 0,
      kink_friendly: 0,
      wholesome: 0,
      neutral: 0,
    };

    const badgeCounts: Record<string, number> = {};

    allProfileReviews.forEach((r) => {
      if (sentimentCounts[r.sentiment] !== undefined) {
        sentimentCounts[r.sentiment]++;
      } else {
        sentimentCounts[r.sentiment] = 1;
      }

      try {
        const badgesArr = JSON.parse(r.badges);
        if (Array.isArray(badgesArr)) {
          badgesArr.forEach((b: string) => {
            badgeCounts[b] = (badgeCounts[b] || 0) + 1;
          });
        }
      } catch (e) {}
    });

    const topBadges = Object.entries(badgeCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    let filtered = allProfileReviews;

    if (sentimentFilter && sentimentFilter !== "all") {
      filtered = filtered.filter((r) => r.sentiment === sentimentFilter);
    }

    if (authorFilter && authorFilter !== "all") {
      filtered = filtered.filter((r) => r.characterId === authorFilter);
    }

    if (badgeFilter && badgeFilter !== "all") {
      filtered = filtered.filter((r) => {
        try {
          const badgesArr = JSON.parse(r.badges);
          return Array.isArray(badgesArr) && badgesArr.includes(badgeFilter);
        } catch {
          return false;
        }
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.content.toLowerCase().includes(q) ||
          (r.anonymousAlias && r.anonymousAlias.toLowerCase().includes(q)) ||
          (r.character && r.character.name.toLowerCase().includes(q)) ||
          r.badges.toLowerCase().includes(q)
      );
    }

    return NextResponse.json({
      success: true,
      profile: { id: profile.id, name: profile.name },
      reviews: filtered,
      stats: {
        totalReviews,
        avgRating: Number(avgRating),
        sentimentCounts,
        topBadges,
      },
    });
  } catch (error: any) {
    console.error("Gossip GET Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "check_all") {
      await checkAndTriggerSlideInIgnoredGossip();
      
      const activeProfile = await prisma.profile.findFirst({ where: { isActive: true } });
      if (activeProfile) {
        const interactions = await prisma.interaction.findMany({
          where: { profileId: activeProfile.id },
        });
        for (const inter of interactions) {
          await checkAndTriggerMilestoneGossip(inter.id);
        }
      }
      return NextResponse.json({ success: true, message: "Checked and updated gossip milestones." });
    }

    if (action === "generate") {
      const { characterId, interactionId, triggerReason = "manual_evaluation" } = body;

      let inter = null;
      if (interactionId) {
        inter = await prisma.interaction.findUnique({
          where: { id: interactionId },
          include: { profile: true, character: true, messages: { orderBy: { createdAt: "asc" } } },
        });
      } else if (characterId) {
        const activeProfile = await prisma.profile.findFirst({ where: { isActive: true } });
        if (!activeProfile) {
          return NextResponse.json({ success: false, error: "No active profile found." }, { status: 400 });
        }
        inter = await prisma.interaction.findUnique({
          where: {
            profileId_characterId: { profileId: activeProfile.id, characterId },
          },
          include: { profile: true, character: true, messages: { orderBy: { createdAt: "asc" } } },
        });
      }

      if (!inter || !inter.character || !inter.profile) {
        return NextResponse.json({ success: false, error: "Interaction not found." }, { status: 404 });
      }

      const recentMsgs = inter.messages.slice(-14);
      let transcript = recentMsgs
        .map((m) => `${m.role === "user" ? inter.profile.name : inter.character.name}: ${m.content.replace(/\n+/g, " ")}`)
        .join("\n");

      if (!transcript.trim()) {
        transcript = `[User and ${inter.character.name} matched or interacted on the platform, with no direct messages exchanged yet.]`;
      }

      // Surface real generation failures to the UI instead of silently saving a placeholder post
      let reviewResult;
      try {
        reviewResult = await generateUserReview({
          characterName: inter.character.name,
          privatePersona: inter.character.privatePersona,
          publicBio: inter.character.publicBio,
          userName: inter.profile.name,
          triggerReason: String(triggerReason),
          chatTranscript: transcript,
          profileId: inter.profile.id,
          characterId: inter.character.id,
        });
      } catch (genErr: any) {
        console.error("Manual gossip generation failed:", genErr);
        return NextResponse.json(
          { success: false, error: `Gossip generation failed: ${genErr?.message || genErr}` },
          { status: 500 }
        );
      }

      const newReview = await prisma.userReview.create({
        data: {
          profileId: inter.profile.id,
          characterId: inter.character.id,
          interactionId: inter.id,
          content: reviewResult.content,
          sentiment: reviewResult.sentiment,
          rating: reviewResult.rating,
          badges: JSON.stringify(reviewResult.badges),
          isAnonymous: reviewResult.is_anonymous,
          anonymousAlias: reviewResult.anonymous_alias,
          triggerReason: String(triggerReason),
        },
        include: {
          character: true,
        },
      });

      return NextResponse.json({ success: true, review: newReview });
    }

    if (action === "create") {
      const {
        profileId,
        characterId,
        interactionId,
        content,
        sentiment = "neutral",
        rating = 3,
        badges = [],
        isAnonymous = true,
        anonymousAlias,
        triggerReason = "manual",
      } = body;

      let targetProfileId = profileId;
      if (!targetProfileId) {
        const activeProfile = await prisma.profile.findFirst({ where: { isActive: true } });
        if (!activeProfile) {
          return NextResponse.json({ success: false, error: "No active profile found." }, { status: 400 });
        }
        targetProfileId = activeProfile.id;
      }

      const newReview = await prisma.userReview.create({
        data: {
          profileId: targetProfileId,
          characterId,
          interactionId,
          content,
          sentiment,
          rating: Math.max(1, Math.min(5, Number(rating))),
          badges: JSON.stringify(badges),
          isAnonymous: Boolean(isAnonymous),
          anonymousAlias: anonymousAlias || "Anonymous Reviewer",
          triggerReason,
        },
        include: {
          character: true,
        },
      });

      return NextResponse.json({ success: true, review: newReview });
    }

    return NextResponse.json({ success: false, error: "Invalid action." }, { status: 400 });
  } catch (error: any) {
    console.error("Gossip POST Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, content, sentiment, rating, badges, isAnonymous, anonymousAlias } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "Review id is required." }, { status: 400 });
    }

    const updated = await prisma.userReview.update({
      where: { id },
      data: {
        content,
        sentiment,
        rating: typeof rating === "number" ? Math.max(1, Math.min(5, rating)) : undefined,
        badges: badges ? JSON.stringify(badges) : undefined,
        isAnonymous: typeof isAnonymous === "boolean" ? isAnonymous : undefined,
        anonymousAlias,
      },
      include: {
        character: true,
      },
    });

    return NextResponse.json({ success: true, review: updated });
  } catch (error: any) {
    console.error("Gossip PUT Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const all = url.searchParams.get("all") === "true";
    const profileId = url.searchParams.get("profileId");

    if (all) {
      let targetProfileId = profileId;
      if (!targetProfileId) {
        const activeProfile = await prisma.profile.findFirst({ where: { isActive: true } });
        if (activeProfile) targetProfileId = activeProfile.id;
      }

      if (targetProfileId) {
        await prisma.userReview.deleteMany({
          where: { profileId: targetProfileId },
        });
      } else {
        await prisma.userReview.deleteMany();
      }
      return NextResponse.json({ success: true, message: "Cleared all reviews." });
    }

    if (!id) {
      return NextResponse.json({ success: false, error: "Review ID required." }, { status: 400 });
    }

    await prisma.userReview.delete({ where: { id } });
    return NextResponse.json({ success: true, message: "Review deleted." });
  } catch (error: any) {
    console.error("Gossip DELETE Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

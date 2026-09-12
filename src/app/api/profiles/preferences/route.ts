import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Helper to get active profile
async function getActiveProfile() {
  return await prisma.profile.findFirst({
    where: { isActive: true },
  });
}

// Fetch preference analytics for the active profile
export async function GET() {
  try {
    const profile = await getActiveProfile();
    if (!profile) {
      return NextResponse.json({ success: false, error: "No active profile found." }, { status: 404 });
    }

    // Check if there is a reset timestamp
    const resetSetting = await prisma.systemSetting.findUnique({
      where: { key: `preferences_reset_at_${profile.id}` },
    });
    const resetDate = resetSetting ? new Date(resetSetting.value) : new Date(0);

    // Fetch all interactions since reset date
    const interactions = await prisma.interaction.findMany({
      where: {
        profileId: profile.id,
        updatedAt: { gte: resetDate },
      },
      include: {
        character: true,
        messages: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    }) as any[];

    // Extract master tags list
    const tagsSetting = await prisma.systemSetting.findUnique({
      where: { key: "tags_master" },
    });
    let masterTags: string[] = [];
    if (tagsSetting && tagsSetting.value) {
      try {
        masterTags = JSON.parse(tagsSetting.value);
      } catch (e) {
        console.error("Error parsing tags_master:", e);
      }
    }

    // Collect all tags from active characters as well
    const activeCharacters = await prisma.character.findMany({
      where: { disabled: false, deleted: false } as any,
    }) as any[];

    const tagsRegistry = new Set<string>(masterTags);
    activeCharacters.forEach((char: any) => {
      if (char.tags) {
        try {
          const parsed = JSON.parse(char.tags);
          Object.keys(parsed).forEach((t) => tagsRegistry.add(t));
        } catch (e) {}
      }
    });

    const allTags = Array.from(tagsRegistry);

    // Count only characters that still exist in the app (deleted characters are
    // excluded entirely — they must not be referenced as active OR inactive
    // AICs in the tag usage lists). Disabled-but-present characters count as
    // inactive, matching the UI's active/inactive split.
    const allCharactersFull = (await prisma.character.findMany() as any[]).filter((c) => !c.deleted);
    const activeCounts: Record<string, number> = {};
    const inactiveCounts: Record<string, number> = {};

    // A tag counts as "used" only when it is one of the character's developedTags
    // (the gen traits actively used to build their persona) — not merely present in
    // their full 100-tag self-scored dictionary, which almost every character has.
    const getGenTraits = (char: any): string[] => {
      if (!char.developedTags) return [];
      if (Array.isArray(char.developedTags)) {
        return char.developedTags.map((t: any) => String(t).trim()).filter(Boolean);
      }
      try {
        const parsed = JSON.parse(char.developedTags);
        if (Array.isArray(parsed)) {
          return parsed.map((t: any) => String(t).trim()).filter(Boolean);
        }
      } catch (e) {}
      return String(char.developedTags).split(",").map((t) => t.trim()).filter(Boolean);
    };

    allCharactersFull.forEach((char: any) => {
      const isActiveChar = !char.deleted && !char.disabled;
      getGenTraits(char).forEach((t) => {
        if (isActiveChar) {
          activeCounts[t] = (activeCounts[t] || 0) + 1;
        } else {
          inactiveCounts[t] = (inactiveCounts[t] || 0) + 1;
        }
      });
    });

    // Event weights map:
    // - User Like: +1.0
    // - User Pass: -0.1
    // - AIC Like/Slide-In: +1.0
    // - AIC Pass: -0.5
    // - Match: +3.0
    // - User Unmatches: -0.1 (same as pass)
    // - AIC Unmatches: -0.5 (same as pass)
    // - Messages >= 50: +10.0, >= 10: +5.0 (non-cumulative)
    const calculatedInteractions = interactions.map((inter) => {
      let weight = 0;
      if (inter.userStatus === "like") weight += 1.0;
      if (inter.userStatus === "pass") weight -= 0.1;
      if (inter.aicStatus === "like" || inter.aicStatus === "slide-in") weight += 1.0;
      if (inter.aicStatus === "pass") weight -= 0.5;
      if (inter.matched) weight += 3.0;

      // Unmatching events Preference Weights (Topic C #3)
      if (inter.unmatched) {
        if (inter.unmatchedBy === "user") {
          weight -= 0.1; // Equivalent weight as user pass (-0.1)
        } else if (inter.unmatchedBy === "assistant") {
          weight -= 0.5; // Equivalent weight as AIC pass (-0.5)
        }
      }

      const msgCount = inter.messages.length;
      if (msgCount >= 50) {
        weight += 10.0;
      } else if (msgCount >= 10) {
        weight += 5.0;
      }

      return {
        id: inter.id,
        characterName: inter.character.name,
        tags: (inter.character as any).tags,
        developedTags: inter.character.developedTags,
        weight,
        updatedAt: inter.updatedAt,
      };
    });

    // Helper to calculate target value, importance, and confidence for a tag
    const getTagMetrics = (tag: string, targetInteractions: typeof calculatedInteractions) => {
      let sumOfWeights = 0;
      let weightedSumOfValues = 0;
      let tagInteractionsCount = 0;
      const values: { impliedVal: number; absWeight: number }[] = [];

      targetInteractions.forEach((inter) => {
        if (!inter.tags) return;
        try {
          const parsedTags = JSON.parse(inter.tags);
          const rawVal = parsedTags[tag];
          if (rawVal === undefined || rawVal === null) return;

          // Weight non-developing traits by a factor of 0.1
          let weightMultiplier = 1.0;
          let isDeveloped = true;
          if (inter.developedTags) {
            try {
              const developedArray = JSON.parse(inter.developedTags);
              if (Array.isArray(developedArray)) {
                if (!developedArray.includes(tag)) {
                  weightMultiplier = 0.1;
                  isDeveloped = false;
                }
              } else {
                const developedArrayFallback = String(inter.developedTags).split(",").map(t => t.trim());
                if (!developedArrayFallback.includes(tag)) {
                  weightMultiplier = 0.1;
                  isDeveloped = false;
                }
              }
            } catch (err) {
              const developedArray = String(inter.developedTags).split(",").map(t => t.trim());
              if (!developedArray.includes(tag)) {
                weightMultiplier = 0.1;
                isDeveloped = false;
              }
            }
          }

          const charTagScore = Number(rawVal);
          if (isDeveloped) {
            tagInteractionsCount++;
          }

          const absWeight = Math.abs(inter.weight) * weightMultiplier;
          let impliedVal = charTagScore;

          // If the engagement was negative (Pass / Unmatch), flip the value to imply the opposite desire
          if (inter.weight < 0) {
            impliedVal = 10 - charTagScore + 1; // E.g., Pass on 9 implies wanting a 2
          }

          values.push({ impliedVal, absWeight });
          weightedSumOfValues += absWeight * impliedVal;
          sumOfWeights += absWeight;
        } catch (e) {}
      });

      // Target (Sweet Spot)
      const target = sumOfWeights > 0 ? (weightedSumOfValues / sumOfWeights) : 5.0;

      // Variance & Importance calculation
      let weightedVarianceSum = 0;
      values.forEach((v) => {
        weightedVarianceSum += v.absWeight * Math.pow(v.impliedVal - target, 2);
      });
      const variance = sumOfWeights > 0 ? (weightedVarianceSum / sumOfWeights) : 8.0;

      // Importance: Normalized 0.000 to 1.000 based on exponential variance decay
      // Low variance = High Importance (very rigid preference)
      const importance = sumOfWeights > 0 ? Math.exp(-variance / 12.0) : 0.0;

      // Confidence: Normalized 0.000 to 1.000 based on interaction sample count
      const confidence = 1.0 - Math.exp(-tagInteractionsCount / 8.0);

      return {
        target: Math.round(target * 1000) / 1000,
        importance: Math.round(importance * 1000) / 1000,
        confidence: Math.round(confidence * 1000) / 1000,
      };
    };

    // Load existing preference overrides (Topic D #1)
    const overridesSetting = await prisma.systemSetting.findUnique({
      where: { key: "preference_overrides" }
    });
    let overrides: Record<string, { target?: number; importance?: number; confidence?: number }> = {};
    if (overridesSetting && overridesSetting.value) {
      try {
        overrides = JSON.parse(overridesSetting.value);
      } catch (e) {}
    }

    // Calculate metrics for Historical (all interactions since reset)
    // and Recent (last 15 interactions since reset)
    const combinedScores = allTags.map((tag) => {
      const histMetrics = getTagMetrics(tag, calculatedInteractions);
      const recentMetrics = getTagMetrics(tag, calculatedInteractions.slice(0, 15));

      // Combine: 30% Historical + 70% Recent
      let combinedTarget = histMetrics.target * 0.3 + recentMetrics.target * 0.7;
      let combinedImportance = histMetrics.importance * 0.3 + recentMetrics.importance * 0.7;
      let combinedConfidence = histMetrics.confidence * 0.3 + recentMetrics.confidence * 0.7;

      const override = overrides[tag];
      const isOverridden = !!override;
      if (override) {
        if (override.target !== undefined) combinedTarget = override.target;
        if (override.importance !== undefined) combinedImportance = override.importance;
        if (override.confidence !== undefined) combinedConfidence = override.confidence;
      }

      const isActiveTag = masterTags.includes(tag);
      const activeAicCount = activeCounts[tag] || 0;
      const inactiveAicCount = inactiveCounts[tag] || 0;

      return {
        tag,
        isOverridden,
        isActiveTag,
        activeAicCount,
        inactiveAicCount,
        historicalTarget: histMetrics.target,
        recentTarget: recentMetrics.target,
        combinedTarget: Math.round(combinedTarget * 1000) / 1000,
        historicalImportance: histMetrics.importance,
        recentImportance: recentMetrics.importance,
        combinedImportance: Math.round(combinedImportance * 1000) / 1000,
        historicalConfidence: histMetrics.confidence,
        recentConfidence: recentMetrics.confidence,
        combinedConfidence: Math.round(combinedConfidence * 1000) / 1000,
      };
    }).sort((a, b) => b.combinedImportance - a.combinedImportance);

    return NextResponse.json({
      success: true,
      profileName: profile.name,
      resetDate: resetDate.toISOString(),
      interactionCount: interactions.length,
      preferences: combinedScores,
    });
  } catch (error: any) {
    console.error("Error fetching preferences:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Reset preferences (Danger Zone)
export async function POST(req: Request) {
  try {
    const profile = await getActiveProfile();
    if (!profile) {
      return NextResponse.json({ success: false, error: "No active profile found." }, { status: 404 });
    }

    const body = await req.json();
    const { action } = body;

    if (action === "reset") {
      const now = new Date().toISOString();
      await prisma.systemSetting.upsert({
        where: { key: `preferences_reset_at_${profile.id}` },
        update: { value: now },
        create: { key: `preferences_reset_at_${profile.id}`, value: now },
      });

      return NextResponse.json({ success: true, message: "Preferences reset successfully." });
    }

    return NextResponse.json({ success: false, error: "Invalid action." }, { status: 400 });
  } catch (error: any) {
    console.error("Error resetting preferences:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { materializePendingMatches } from "@/lib/matchDelay";

export const runtime = "nodejs";

/**
 * POST /api/chat/async-auto
 * Handles occasional auto-triggers of asynchronous messaging based on user actions.
 * Computes probabilities, hard cutoffs, soft limits, and proportional scaling on the backend safely.
 */
export async function POST(req: Request) {
  try {
    const { eventType } = await req.json();

    if (!eventType || !["tab_switch", "swipe", "interval"].includes(eventType)) {
      return NextResponse.json({ success: false, error: "Invalid or missing eventType" }, { status: 400 });
    }

    // 1. Fetch active profile
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });
    if (!activeProfile) {
      return NextResponse.json({ success: false, triggered: false, reason: "No active profile" });
    }

    // 1b. Materialize due delayed matches first (Match Delay feature) so fresh
    // matches count toward active matches/unreads and are reported to the frontend.
    const newMatches = await materializePendingMatches(activeProfile.id);

    // 2. Check if async messaging is enabled globally
    const enabledSetting = await prisma.systemSetting.findUnique({ where: { key: "async_messaging_enabled" } });
    if (enabledSetting?.value === "false") {
      return NextResponse.json({ success: true, triggered: false, reason: "Disabled globally", newMatches });
    }

    // 3. Count active matches and sum total unread messages
    const interactions = await prisma.interaction.findMany({
      where: {
        profileId: activeProfile.id,
        matched: true,
        unmatched: false,
        character: { disabled: false, deleted: false }
      }
    });

    const activeMatchesCount = interactions.length;
    if (activeMatchesCount === 0) {
      return NextResponse.json({ success: true, triggered: false, reason: "No active matches", newMatches });
    }

    const totalUnreads = interactions.reduce((sum, i) => sum + i.unreadCount, 0);

    // 4. Fetch limits from configuration
    const hardCutoffSetting = await prisma.systemSetting.findUnique({ where: { key: "async_hard_cutoff" } });
    const softLimitSetting = await prisma.systemSetting.findUnique({ where: { key: "async_soft_limit" } });
    const hardCutoff = parseInt(hardCutoffSetting?.value || "20") || 20;
    const softLimit = parseInt(softLimitSetting?.value || "5") || 5;

    // Hard Limit Check: Total unreads across matches exceeds cutoff
    if (totalUnreads >= hardCutoff) {
      return NextResponse.json({ success: true, triggered: false, reason: "Hard cutoff reached", newMatches });
    }

    // 5. Fetch probability for this event type
    let probabilityKey = "async_chance_tab_switch";
    if (eventType === "swipe") probabilityKey = "async_chance_swipe";
    if (eventType === "interval") probabilityKey = "async_chance_interval";

    const probSetting = await prisma.systemSetting.findUnique({ where: { key: probabilityKey } });
    let baseChance = parseFloat(probSetting?.value || "0.02") || 0.02;

    // 6. Apply Soft Falloff Coefficient if total unread messages exceeds soft limit
    let limitMultiplier = 1.0;
    if (totalUnreads > softLimit) {
      // Linear falloff: declines to 0 as unreads approach hard cutoff
      limitMultiplier = Math.max(0.01, (hardCutoff - totalUnreads) / (hardCutoff - softLimit));
    }

    // 7. Apply Proportional Match Scaling
    // If user has small number of matched AICs, scale chance down to avoid flooding
    let matchScalingMultiplier = 1.0;
    if (activeMatchesCount < 5) {
      matchScalingMultiplier = activeMatchesCount / 5.0; // E.g., if only 2 matches, reduces probability by 60%
    }

    // Calculate final calculated probability
    const finalTriggerChance = baseChance * limitMultiplier * matchScalingMultiplier;

    const roll = Math.random();
    const shouldTrigger = roll < finalTriggerChance;

    if (!shouldTrigger) {
      return NextResponse.json({
        success: true,
        triggered: false,
        reason: `Roll failed. Rolled ${roll.toFixed(4)} against final chance ${finalTriggerChance.toFixed(4)}`,
        newMatches,
      });
    }

    // 8. Trigger asynchronous message generation (internal POST query to async-trigger endpoint)
    // We fetch our async-trigger handler directly to prevent redundant fetch HTTP latency
    const triggerUrl = `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host") || "localhost:3000"}/api/chat/async-trigger`;
    const triggerRes = await fetch(triggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const triggerData = await triggerRes.json();
    return NextResponse.json({
      success: triggerData.success,
      triggered: true,
      characterName: triggerData.characterName,
      characterId: triggerData.characterId,
      characterAvatar: triggerData.characterAvatar,
      message: triggerData.message,
      newMatches,
    });

  } catch (error: any) {
    console.error("Async Auto Trigger Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

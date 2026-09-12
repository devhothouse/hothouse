import { prisma } from "./db";
import { generateUserReview } from "./llm";

/**
 * Retrieves formatted gossip context for swipe compatibility evaluations.
 * Optional viewerCharacterId: when provided, the evaluating character's own board posts
 * (including anonymous ones and older ones pushed out of the top-N window) are included
 * and explicitly labeled as their own.
 */
export async function getGossipContextForEvaluation(
  profileId: string,
  userName: string,
  viewerCharacterId?: string
): Promise<string> {
  try {
    const settingsList = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            "gossip_inject_in_evaluations",
            "gossip_eval_inject_chance",
            "gossip_eval_max_reviews",
            "prompt_gossip_eval_injection",
          ],
        },
      },
    });

    const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
    const enabled = settingsMap.get("gossip_inject_in_evaluations") !== "false";
    if (!enabled) return "";

    const injectChance = parseFloat(settingsMap.get("gossip_eval_inject_chance") || "1.0");
    if (Math.random() > injectChance) return "";

    const maxReviews = parseInt(settingsMap.get("gossip_eval_max_reviews") || "3", 10) || 3;

    // Fetch top reviews for profile, ordered by upvotes desc, createdAt desc
    const reviews = await prisma.userReview.findMany({
      where: { profileId },
      include: {
        character: true,
      },
      orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
      take: maxReviews,
    });

    // When a viewer character is provided, also fetch their own posts (latest few) so they can
    // recognize their own board activity even if newer posts pushed theirs out of the top window
    let ownOutOfWindow: typeof reviews = [];
    if (viewerCharacterId) {
      const ownReviews = await prisma.userReview.findMany({
        where: { profileId, characterId: viewerCharacterId },
        include: {
          character: true,
        },
        orderBy: [{ createdAt: "desc" }],
        take: 3,
      });
      const windowedIds = new Set(reviews.map((r) => r.id));
      ownOutOfWindow = ownReviews.filter((r) => !windowedIds.has(r.id));
    }

    const merged = [...reviews, ...ownOutOfWindow];
    if (merged.length === 0) return "";

    const formattedList = merged
      .map((r) => {
        const isOwnPost = !!viewerCharacterId && r.characterId === viewerCharacterId;
        let authorLabel: string;
        if (isOwnPost) {
          authorLabel = r.isAnonymous
            ? `YOU (this is your own post, published anonymously as "${r.anonymousAlias || "Anonymous"}")`
            : "YOU (this is your own post, published under your real name)";
        } else {
          authorLabel = `Anonymous Reviewer (${r.anonymousAlias || "Community Member"})`;
          if (!r.isAnonymous && r.character) {
            authorLabel = `${r.character.name} (${r.character.gender}, "${r.character.publicBio.slice(0, 80).replace(/\n/g, " ")}...")`;
          }
        }
        let parsedBadges: string[] = [];
        try {
          parsedBadges = JSON.parse(r.badges);
        } catch (e) {
          parsedBadges = [r.badges];
        }
        const badgeStr = parsedBadges.length > 0 ? ` [Tags: ${parsedBadges.join(", ")}]` : "";
        return `- [${r.rating}/5 ⭐ | Sentiment: ${r.sentiment}] Posted by ${authorLabel}:\n  "${r.content}"${badgeStr}`;
      })
      .join("\n\n");

    const template =
      settingsMap.get("prompt_gossip_eval_injection") ||
      `\n[COMMUNITY DATING BOARD & GOSSIP LEDGER ON {user_name}]\nThe following are recent peer reviews and gossip posts shared by other women on the local dating board about {user_name}:\n{gossip_reviews_list}\n[END OF COMMUNITY GOSSIP LEDGER - Take these peer reviews, ratings, and flags into account when deciding whether to pass, like, or slide-in!]\n`;

    return template
      .replace(/{user_name}/g, userName)
      .replace(/{gossip_reviews_list}/g, formattedList);
  } catch (err) {
    console.error("Error retrieving evaluation gossip context:", err);
    return "";
  }
}

/**
 * Retrieves formatted gossip context for live AIC-to-User chat
 */
export async function getGossipContextForChat(
  profileId: string,
  characterId: string,
  userName: string
): Promise<{ gossipBlock: string; location: string; hasContent: boolean }> {
  try {
    const settingsList = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            "gossip_inject_in_chat",
            "gossip_chat_inject_chance",
            "gossip_chat_max_reviews",
            "gossip_injection_location",
            "prompt_gossip_chat_injection",
          ],
        },
      },
    });

    const settingsMap = new Map(settingsList.map((s) => [s.key, s.value]));
    const enabled = settingsMap.get("gossip_inject_in_chat") !== "false";
    const location = settingsMap.get("gossip_injection_location") || "system_prompt_bottom";

    if (!enabled) {
      return { gossipBlock: "", location, hasContent: false };
    }

    const injectChance = parseFloat(settingsMap.get("gossip_chat_inject_chance") || "0.4");
    if (Math.random() > injectChance) {
      return { gossipBlock: "", location, hasContent: false };
    }

    const maxReviews = parseInt(settingsMap.get("gossip_chat_max_reviews") || "2", 10) || 2;

    // Fetch reviews by other characters (top-window selection)
    const reviews = await prisma.userReview.findMany({
      where: {
        profileId,
        characterId: { not: characterId },
      },
      include: {
        character: true,
      },
      orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
      take: maxReviews,
    });

    // Also include this character's own board posts, explicitly labeled, so they always recognize
    // their own (possibly anonymous) reviews — even old ones that newer posts pushed out of the window
    const ownReviews = await prisma.userReview.findMany({
      where: {
        profileId,
        characterId,
      },
      include: {
        character: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 3,
    });

    if (reviews.length === 0 && ownReviews.length === 0) {
      return { gossipBlock: "", location, hasContent: false };
    }

    const formattedList = [...reviews, ...ownReviews]
      .map((r) => {
        let authorLabel: string;
        if (r.characterId === characterId) {
          authorLabel = r.isAnonymous
            ? `YOU (your own post, published anonymously as "${r.anonymousAlias || "Anonymous"}")`
            : "YOU (your own post, published under your real name)";
        } else if (!r.isAnonymous && r.character) {
          authorLabel = `Your peer ${r.character.name}`;
        } else {
          authorLabel = `Anonymous Member (${r.anonymousAlias || "Anonymous"})`;
        }
        let parsedBadges: string[] = [];
        try {
          parsedBadges = JSON.parse(r.badges);
        } catch (e) {
          parsedBadges = [r.badges];
        }
        const badgeStr = parsedBadges.length > 0 ? ` [Badges: ${parsedBadges.join(", ")}]` : "";
        return `- Post by ${authorLabel} (Rating: ${r.rating}/5 ⭐, Flag: ${r.sentiment}): "${r.content}"${badgeStr}`;
      })
      .join("\n");

    const template =
      settingsMap.get("prompt_gossip_chat_injection") ||
      `\n[COMMUNITY GOSSIP & REPUTATION AWARENESS]\nYou have heard or read the following peer buzz/reviews on the dating community board regarding {user_name}:\n{gossip_reviews_list}\nUse this knowledge subtly and playfully when relevant (e.g. teasing them about a quirk, calling out a green/red flag, or testing them), but do not unnaturally force it into every reply.\n`;

    const gossipBlock = template
      .replace(/{user_name}/g, userName)
      .replace(/{gossip_reviews_list}/g, formattedList);

    return { gossipBlock, location, hasContent: true };
  } catch (err) {
    console.error("Error retrieving chat gossip context:", err);
    return { gossipBlock: "", location: "system_prompt_bottom", hasContent: false };
  }
}

/**
 * Gossip feature master switch (`gossip_enabled`). When disabled, no new
 * reviews are generated (automatic and manual); the existing board stays
 * viewable. Missing key = enabled for backward compatibility.
 */
export async function isGossipEnabled(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({ where: { key: "gossip_enabled" } });
  return setting?.value !== "false";
}

/**
 * Checks message milestones on chat updates and automatically triggers reviews
 */
export async function checkAndTriggerMilestoneGossip(interactionId: string) {
  try {
    if (!(await isGossipEnabled())) return;
    const chanceSetting = await prisma.systemSetting.findUnique({
      where: { key: "gossip_milestone_trigger_chance" },
    });
    const triggerChance = parseFloat(chanceSetting?.value ?? "1.0");
    if (Math.random() > triggerChance) return;

    const interaction = await prisma.interaction.findUnique({
      where: { id: interactionId },
      include: {
        profile: true,
        character: true,
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!interaction || !interaction.profile || !interaction.character) return;

    const milestonesSetting = await prisma.systemSetting.findUnique({
      where: { key: "gossip_message_milestones" },
    });

    let milestones: number[] = [40, 100];
    if (milestonesSetting?.value) {
      try {
        const parsed = JSON.parse(milestonesSetting.value);
        if (Array.isArray(parsed)) {
          milestones = parsed.map((m: any) => parseInt(m, 10)).filter((n: number) => !isNaN(n));
        }
      } catch (e) {}
    }

    const messageCount = interaction.messages.length;

    for (const milestone of milestones) {
      if (messageCount >= milestone) {
        const triggerReason = `milestone_${milestone}_msgs`;

        // Check if review already exists for this milestone and interaction
        const existingReview = await prisma.userReview.findFirst({
          where: {
            interactionId,
            triggerReason,
          },
        });

        if (!existingReview) {
          // Build transcript of recent messages (up to 12)
          const recentMsgs = interaction.messages.slice(-12);
          const transcript = recentMsgs
            .map((m) => `${m.role === "user" ? interaction.profile.name : interaction.character.name}: ${m.content.replace(/\n+/g, " ")}`)
            .join("\n");

          // Per-interaction guard: a failed LLM generation must not abort the remaining
          // milestone checks. No review row is written on failure (no placeholder posts),
          // so this milestone is naturally retried on a later check.
          try {
            const reviewResult = await generateUserReview({
              characterName: interaction.character.name,
              privatePersona: interaction.character.privatePersona,
              publicBio: interaction.character.publicBio,
              userName: interaction.profile.name,
              triggerReason: `Reached ${milestone} messages exchanged in private chat.`,
              chatTranscript: transcript,
              profileId: interaction.profile.id,
              characterId: interaction.character.id,
            });

            await prisma.userReview.create({
              data: {
                profileId: interaction.profile.id,
                characterId: interaction.character.id,
                interactionId: interaction.id,
                content: reviewResult.content,
                sentiment: reviewResult.sentiment,
                rating: reviewResult.rating,
                badges: JSON.stringify(reviewResult.badges),
                isAnonymous: reviewResult.is_anonymous,
                anonymousAlias: reviewResult.anonymous_alias,
                triggerReason,
              },
            });
          } catch (reviewErr) {
            console.error(`Skipping milestone gossip review for interaction ${interactionId}:`, reviewErr);
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to check and trigger milestone gossip:", err);
  }
}

/**
 * Checks for slide-in messages where the user did not reply after configurable delay (e.g. 24h)
 */
export async function checkAndTriggerSlideInIgnoredGossip() {
  try {
    if (!(await isGossipEnabled())) return;
    const ignoredSetting = await prisma.systemSetting.findUnique({
      where: { key: "gossip_trigger_slide_in_ignored" },
    });
    if (ignoredSetting && ignoredSetting.value === "false") return;

    const chanceSetting = await prisma.systemSetting.findUnique({
      where: { key: "gossip_slide_in_ignored_trigger_chance" },
    });
    const triggerChance = parseFloat(chanceSetting?.value ?? "1.0");
    if (Math.random() > triggerChance) return;

    const delayHoursSetting = await prisma.systemSetting.findUnique({
      where: { key: "gossip_slide_in_ignore_delay_hours" },
    });
    const delayHours = parseFloat(delayHoursSetting?.value || "24") || 24;
    const thresholdDate = new Date(Date.now() - delayHours * 60 * 60 * 1000);

    const slideIns = await prisma.interaction.findMany({
      where: {
        aicStatus: "slide-in",
        updatedAt: { lte: thresholdDate },
        matched: false,
        unmatched: false,
      },
      include: {
        profile: true,
        character: true,
        messages: true,
      },
    });

    for (const inter of slideIns) {
      const userMsgCount = inter.messages.filter((m) => m.role === "user").length;
      if (userMsgCount === 0) {
        const triggerReason = "slide_in_ignored";
        const existing = await prisma.userReview.findFirst({
          where: {
            interactionId: inter.id,
            triggerReason,
          },
        });

        if (!existing) {
          // Per-interaction guard: a failed LLM generation must not abort the remaining
          // slide-in checks. No review row is written on failure (no placeholder posts),
          // so this interaction is naturally retried on a later check.
          try {
            const reviewResult = await generateUserReview({
              characterName: inter.character.name,
              privatePersona: inter.character.privatePersona,
              publicBio: inter.character.publicBio,
              userName: inter.profile.name,
              triggerReason: `Slid into their DMs with opening line: "${inter.dmMessage || ""}", but user has not responded after over ${delayHours} hours.`,
              chatTranscript: `[You slid in with: "${inter.dmMessage || ""}"]\n[User has not replied after ${delayHours}+ hours]`,
              profileId: inter.profile.id,
              characterId: inter.character.id,
            });

            await prisma.userReview.create({
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
                triggerReason,
              },
            });
          } catch (reviewErr) {
            console.error(`Skipping slide-in-ignored gossip review for interaction ${inter.id}:`, reviewErr);
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to check slide-in delayed gossip:", err);
  }
}


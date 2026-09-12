import { prisma } from "@/lib/db";

// =========================================================
// MATCH DELAY ENGINE (AIC Evaluation Delay feature)
// ---------------------------------------------------------
// When a user likes a character who has already "liked" them, the mutual
// match can be scheduled into the future instead of materializing instantly
// (realistic "gets back to you" response lag).
//
// Mechanics:
// - `/api/interact` rolls the configurable chance and, on success, stores the
//   scheduled wall-clock time in `Interaction.pendingMatchAt` (matched stays
//   false, so no "It's a Match!" overlay and nothing appears in the UI yet).
// - The timer is wall-clock based: nothing needs to run while the app is
//   closed. Due matches are materialized by `materializePendingMatches()`,
//   which is invoked by the app's existing polling surfaces (`/api/chat` GET,
//   `/api/feed` GET, and the 1-minute `/api/chat/async-auto` heartbeat), so a
//   delayed match fires — with its push notification — the first time any of
//   those surfaces is fetched after the delay has elapsed.
// - Configuration (seeded create-if-missing in `ensureDefaultSettingsAndProfiles`,
//   editable in Manager tab → Task Settings & Prompts → Match Delay):
//     match_delay_enabled    "true"/"false"        (default "true")
//     match_delay_chance     float 0-1             (default "0.6")
//     match_delay_durations  comma minutes list    (default "1,5,10,30,60")
// =========================================================

export const MATCH_DELAY_SETTING_KEYS = [
  "match_delay_enabled",
  "match_delay_chance",
  "match_delay_durations",
] as const;

// Default delay options in minutes (one is picked uniformly at random per delayed match)
export const MATCH_DELAY_DEFAULT_DURATIONS = [1, 5, 10, 30, 60];

// Parses the comma-separated duration list. A missing/blank setting falls back
// to the defaults; a present-but-unparseable list yields [] which disables
// delays (all mutual likes match instantly) — a deliberate admin escape hatch.
export function parseMatchDelayDurations(raw: string | undefined | null): number[] {
  if (raw === undefined || raw === null || raw.trim() === "") {
    return [...MATCH_DELAY_DEFAULT_DURATIONS];
  }
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export interface MatchDelaySettings {
  enabled: boolean;
  chance: number;
  durations: number[];
}

// Reads the three configuration keys with backward-compatible defaults
// (missing settings behave exactly like the seeded defaults).
export async function getMatchDelaySettings(): Promise<MatchDelaySettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [...MATCH_DELAY_SETTING_KEYS] } },
  });
  const valueOf = (key: string) => rows.find((r) => r.key === key)?.value;
  const enabled = valueOf("match_delay_enabled") !== "false"; // Default: enabled
  const chanceRaw = Number(valueOf("match_delay_chance") ?? "0.6");
  const chance = Number.isFinite(chanceRaw) ? Math.min(1, Math.max(0, chanceRaw)) : 0.6;
  const durations = parseMatchDelayDurations(valueOf("match_delay_durations"));
  return { enabled, chance, durations };
}

// Rolls for a delayed match. Returns the scheduled materialization time,
// or null when the match should happen immediately.
export function rollDelayedMatch(settings: MatchDelaySettings): Date | null {
  if (!settings.enabled || settings.durations.length === 0) return null;
  if (Math.random() >= settings.chance) return null;
  const minutes = settings.durations[Math.floor(Math.random() * settings.durations.length)];
  return new Date(Date.now() + minutes * 60 * 1000);
}

export interface NewMatchInfo {
  interactionId: string;
  characterId: string;
  characterName: string;
  characterAvatar: string;
}

// Materializes every due delayed match for (optionally) one profile.
// Returns ONLY the matches materialized by this call, so the frontend raises
// exactly one "You have a new match" push notification per match. Conditional
// updateMany guards make concurrent calls (chat/feed/async-auto surfaces)
// race-safe — count === 1 means this call won the materialization.
export async function materializePendingMatches(profileId?: string): Promise<NewMatchInfo[]> {
  const now = new Date();
  const pending = await prisma.interaction.findMany({
    where: {
      pendingMatchAt: { not: null },
      ...(profileId ? { profileId } : {}),
    },
    include: { character: true },
  });

  const newlyMatched: NewMatchInfo[] = [];
  for (const inter of pending) {
    const scheduledAt = inter.pendingMatchAt as Date;
    if (scheduledAt > now) continue; // Not due yet

    // Stale pending rows (unmatched while pending, character deleted, or
    // matched through another path) are cleared without materializing.
    if (inter.matched || inter.unmatched || inter.character?.deleted) {
      await prisma.interaction.updateMany({
        where: { id: inter.id, pendingMatchAt: { not: null } },
        data: { pendingMatchAt: null },
      });
      continue;
    }

    const result = await prisma.interaction.updateMany({
      where: { id: inter.id, matched: false, pendingMatchAt: { not: null } },
      data: {
        matched: true,
        matchTimestamp: scheduledAt, // The AIC "decided" at the scheduled time
        pendingMatchAt: null,
      },
    });
    if (result.count === 1) {
      newlyMatched.push({
        interactionId: inter.id,
        characterId: inter.characterId,
        characterName: inter.character.name,
        characterAvatar: inter.character.avatar,
      });
    }
  }
  return newlyMatched;
}
// =========================================================
// MASTER TAGS LIBRARY HELPERS
// ---------------------------------------------------------
// Pure, dependency-free helpers shared by server routes and client
// components for the Master Tags Library (`tags_master`) and its
// per-gender visibility map (`tags_gender_visibility`).
//
// Backward/forward compatibility rules:
//   - `tags_master` remains the flat JSON string array (the full union of
//     tags) that all legacy consumers read. It is never replaced.
//   - `tags_gender_visibility` is an optional JSON object:
//       { "tag_name": { "male": true, "female": true, "nonbinary": false } }
//     A missing key, a missing gender flag, or a missing/invalid setting
//     all mean "visible on every list" — so old databases (without the
//     setting) and unrecognized gender strings behave exactly as before.
// =========================================================

export const MASTER_TAGS_KEY = "tags_master";
export const TAGS_GENDER_VISIBILITY_KEY = "tags_gender_visibility";

export const TAG_GENDER_KEYS = ["male", "female", "nonbinary"] as const;
export type TagGenderKey = (typeof TAG_GENDER_KEYS)[number];
export type TagVisibility = { male: boolean; female: boolean; nonbinary: boolean };
export type TagVisibilityMap = Record<string, TagVisibility | undefined>;

// Tolerant parser for the tags_master JSON string array. Never throws.
export function parseMasterTags(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((t) => String(t).trim()).filter((t: string) => t.length > 0);
    }
  } catch (e) {}
  return [];
}

// Tolerant parser for the tags_gender_visibility JSON object. Never throws.
// Invalid entries are dropped (which means "visible everywhere" downstream).
export function parseTagVisibility(raw: string | undefined | null): TagVisibilityMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: TagVisibilityMap = {};
      for (const [tag, val] of Object.entries(parsed as Record<string, any>)) {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          out[String(tag)] = {
            male: val.male === undefined ? true : Boolean(val.male),
            female: val.female === undefined ? true : Boolean(val.female),
            nonbinary: val.nonbinary === undefined ? true : Boolean(val.nonbinary),
          };
        }
      }
      return out;
    }
  } catch (e) {}
  return {};
}

export function serializeTagVisibility(map: TagVisibilityMap): string {
  return JSON.stringify(map);
}

// Expands a possibly-partial visibility entry into a complete one
// (missing flags default to visible, matching the backward-compatible default).
export function normalizeTagVisibility(entry: TagVisibility | undefined): TagVisibility {
  return {
    male: entry?.male !== false,
    female: entry?.female !== false,
    nonbinary: entry?.nonbinary !== false,
  };
}

// Maps a free-text character gender ("Female", "Male", "Non-binary", ...) to a
// visibility list key. Returns null for unrecognized genders, which callers
// treat as "no restriction" so custom future gender strings keep working.
// Order matters: "female" and "woman" contain "male"/"man" as substrings.
export function genderToTagKey(gender: string | undefined | null): TagGenderKey | null {
  const g = String(gender || "").trim().toLowerCase();
  if (!g) return null;
  if (g.includes("female") || g === "f" || g.includes("woman")) return "female";
  if ((g.includes("non") && g.includes("bin")) || g.includes("enby") || g === "nb" || g.includes("androgyn")) return "nonbinary";
  if (g.includes("male") || g === "m" || g.includes("man")) return "male";
  return null;
}

// Core check against a concrete list key. Anything not explicitly hidden is visible.
export function isTagVisibleForKey(tag: string, visibility: TagVisibilityMap, key: TagGenderKey): boolean {
  const entry = visibility[tag];
  if (!entry) return true; // No explicit entry → visible on every list (backward compatible)
  return entry[key] !== false;
}

// Convenience wrapper taking a free-text gender string. Unknown genders
// (genderToTagKey === null) see every tag — identical to the pre-feature behavior.
export function isTagVisibleForGender(tag: string, visibility: TagVisibilityMap, gender: string | undefined | null): boolean {
  const key = genderToTagKey(gender);
  if (!key) return true;
  return isTagVisibleForKey(tag, visibility, key);
}

// Filters a master tags array down to the tags visible for a gender string.
export function filterMasterTagsByGender(tags: string[], visibility: TagVisibilityMap, gender: string | undefined | null): string[] {
  const key = genderToTagKey(gender);
  if (!key) return [...tags];
  return tags.filter((t) => isTagVisibleForKey(t, visibility, key));
}
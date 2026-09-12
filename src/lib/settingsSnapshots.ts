// =========================================================
// SETTINGS EXPORT / IMPORT / SNAPSHOTS (shared helpers)
// ---------------------------------------------------------
// Pure helpers backing the Manager → My Data backup features.
// Client-safe: this file must never import Prisma or Node-only modules
// (the Manager tab imports the pure helpers directly).
//
// Settings export file format (version 1):
//   { "version": 1, "exportedAt": "<ISO date>", "settings": { key: value } }
// Import accepts this wrapped format (unknown wrapper fields are ignored,
// keeping forward compatibility) and legacy flat { key: value } backups.
// =========================================================

// Bump when the export envelope itself changes shape. The importer ignores
// unknown wrapper fields, so older files keep importing on newer apps.
export const SETTINGS_EXPORT_VERSION = 1;

// Snapshots are stored as SystemSetting rows prefixed with this marker
// (e.g. settings_snapshot_Before TTS overhaul).
export const SETTINGS_SNAPSHOT_PREFIX = "settings_snapshot_";

// SystemSetting rows that are runtime bookkeeping, not configuration.
// They are excluded from GET /api/settings (and therefore from every export),
// never imported, never captured in snapshots, and never deleted by a
// replace-all restore.
export const PROTECTED_SETTINGS_KEY_PREFIXES = [
  SETTINGS_SNAPSHOT_PREFIX,
  "preferences_reset_at_", // per-profile recommendation-reset markers (Danger Zone)
];

export function isProtectedSettingsKey(key: string): boolean {
  return PROTECTED_SETTINGS_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

// Snapshot display names are trimmed, cleaned of control/forbidden filename
// characters, whitespace-collapsed, and capped at 60 characters.
export function sanitizeSnapshotName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Maps a snapshot display name to its storage key; null when nothing usable remains.
export function snapshotKeyForName(raw: unknown): string | null {
  const name = sanitizeSnapshotName(raw);
  if (!name) return null;
  return SETTINGS_SNAPSHOT_PREFIX + name;
}

// Builds the wrapped export payload from a settings key/value map.
// Only string values are exported, and protected runtime keys are stripped
// defensively (GET /api/settings already excludes them).
export function buildSettingsExport(settings: Record<string, unknown>) {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings || {})) {
    if (typeof value === "string" && !isProtectedSettingsKey(key)) clean[key] = value;
  }
  return {
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: clean,
  };
}

type NormalizeResult =
  | { ok: true; settings: Record<string, string> }
  | { ok: false; error: string };

// Validates & normalizes an imported settings payload: the wrapped export
// format ({ version, exportedAt, settings }) or a legacy flat { key: value }
// backup. Values are coerced to strings exactly like POST /api/settings does,
// so export → import round-trips are byte-identical. Unknown keys are imported
// as-is; protected runtime keys are never imported.
export function normalizeImportedSettings(input: unknown): NormalizeResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "expected a JSON object." };
  }
  const wrapper = input as Record<string, unknown>;
  let raw: unknown = wrapper;
  if (Object.prototype.hasOwnProperty.call(wrapper, "settings")) {
    raw = wrapper.settings;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "the 'settings' field must be a JSON object." };
    }
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (isProtectedSettingsKey(key)) continue;
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") {
      out[key] = String(value);
      continue;
    }
    return { ok: false, error: `the value of "${key}" is not a text setting.` };
  }
  return { ok: true, settings: out };
}

// Replace-all restore shared by file import and snapshot load. After this
// runs, every non-protected SystemSetting row exactly matches `incoming`.
// Protected rows (snapshots, preference-reset markers) are never deleted
// here. Values are written exactly like POST /api/settings upserts them.
export async function applySettingsReplaceAll(prisma: any, incoming: Record<string, string>) {
  const existing = await prisma.systemSetting.findMany({ select: { key: true } });
  const incomingKeys = new Set(Object.keys(incoming));
  const toDelete = existing
    .map((row: any) => row.key as string)
    .filter((key: string) => !incomingKeys.has(key) && !isProtectedSettingsKey(key));
  if (toDelete.length > 0) {
    await prisma.systemSetting.deleteMany({ where: { key: { in: toDelete } } });
  }
  for (const [key, value] of Object.entries(incoming)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
  return { imported: Object.keys(incoming).length, deleted: toDelete.length };
}

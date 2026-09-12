export interface VoiceOption {
  id: string;
  description: string;
}

export const VOICES: VoiceOption[] = [
  // INTENTIONALLY EMPTY: the previous built-in ElevenLabs library was the
  // owner's personal voice set and must not ship with the app. Add voice
  // IDs + descriptions in Manager → TTS Settings → Voice Library (or let
  // users configure their own); nothing is offered by the Voice Picker
  // until at least one entry exists here or in the voices_catalog setting.
];

export function serializeVoiceCatalog(voices: VoiceOption[]): string {
  return JSON.stringify(voices);
}

// Tolerant parser for the `voices_catalog` setting (JSON array of {id, description}).
// Never throws: invalid/missing input yields an empty array, which tells
// consumers to fall back to the built-in VOICES library (existing behavior).
export function parseVoiceCatalog(raw: string | undefined | null): VoiceOption[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v: any) => v && typeof v.id === "string" && v.id.trim() !== "")
      .map((v: any) => ({ id: String(v.id).trim(), description: String(v.description ?? "") }));
  } catch {
    return [];
  }
}

// =========================================================
// TTS PROVIDER REGISTRY (pure data + helpers)
// ---------------------------------------------------------
// Catalog of every supported TTS provider. Pure data only (no
// database imports) so client components (Manager tab) and
// server routes can both import it.
//
// ElevenLabs remains the DEFAULT provider: a blank, missing, or
// unrecognized `tts_provider` setting always resolves to
// "elevenlabs" so existing setups are completely unaffected.
// =========================================================

export type TtsProviderId = "elevenlabs" | "openai" | "google" | "cartesia" | "fish" | "custom";

export const TTS_PROVIDER_IDS: TtsProviderId[] = ["elevenlabs", "openai", "google", "cartesia", "fish", "custom"];

export const TTS_PROVIDER_LABELS: Record<TtsProviderId, string> = {
  elevenlabs: "ElevenLabs",
  openai: "OpenAI / OpenAI-Compatible (local servers OK)",
  google: "Google Cloud Text-to-Speech",
  cartesia: "Cartesia",
  fish: "Fish Audio",
  custom: "Custom Bridge (any HTTP TTS endpoint)",
};

// SystemSetting keys holding each provider's editable voice catalog
// (JSON array of {id, description} consumed by the AI Voice Picker).
export const TTS_PROVIDER_CATALOG_KEYS: Record<TtsProviderId, string> = {
  elevenlabs: "voices_catalog",
  openai: "voices_catalog_openai",
  google: "voices_catalog_google",
  cartesia: "voices_catalog_cartesia",
  fish: "voices_catalog_fish",
  custom: "voices_catalog_custom",
};

// Built-in default catalogs, used when a provider's catalog setting is
// missing, invalid, or empty (same fallback behavior as the ElevenLabs
// catalog has always had).
export const BUILTIN_TTS_CATALOGS: Record<TtsProviderId, VoiceOption[]> = {
  elevenlabs: VOICES,
  openai: [
    { id: "alloy", description: "Balanced, neutral voice. A versatile all-rounder." },
    { id: "ash", description: "Warm, steady voice with a grounded, relaxed tone." },
    { id: "ballad", description: "Soft, expressive storyteller voice." },
    { id: "coral", description: "Bright, energetic, friendly voice." },
    { id: "echo", description: "Calm, composed, even-toned voice." },
    { id: "fable", description: "Expressive, storybook voice with a British lilt." },
    { id: "onyx", description: "Deep, authoritative, resonant voice." },
    { id: "nova", description: "Friendly, upbeat, youthful voice." },
    { id: "sage", description: "Gentle, wise, even-keeled voice." },
    { id: "shimmer", description: "Light, cheerful, airy voice." },
    { id: "verse", description: "Versatile, expressive voice for creative reads." }
  ],
  google: [
    { id: "en-US-Neural2-A", description: "US English female-leaning neural voice, warm and versatile." },
    { id: "en-US-Neural2-C", description: "US English female neural voice, clear and friendly." },
    { id: "en-US-Neural2-D", description: "US English male neural voice, calm and steady." },
    { id: "en-US-Neural2-F", description: "US English female neural voice, bright and conversational." },
    { id: "en-US-Studio-O", description: "US English studio-grade female voice for long-form narration." },
    { id: "en-GB-Neural2-B", description: "British English male neural voice." }
  ],
  cartesia: [
    { id: "YOUR_CARTESIA_VOICE_ID", description: "Placeholder — replace with a voice ID from play.cartesia.ai → Voices (preset and cloned voice IDs both work)." }
  ],
  fish: [
    { id: "YOUR_FISH_AUDIO_VOICE_ID", description: "Placeholder — replace with a Fish Audio voice/model ID (reference_id) from fish.audio → My Voices." }
  ],
  custom: [
    { id: "default", description: "The default voice your bridge endpoint exposes. Rename to match your server's voice IDs and add more as needed." }
  ]
};

// Whether a provider has enough configuration to attempt synthesis.
// Used by the Manager tab's TTS settings to gate the voice library
// editor (mirrors the old ElevenLabs-only API-key gate).
export function isTtsProviderConfigured(settings: any, provider: string): boolean {
  const s = settings || {};
  const val = (k: string) => String(s[k] ?? "").trim();
  switch (normalizeTtsProvider(provider)) {
    case "elevenlabs": return val("elevenlabs_api_key") !== "";
    case "openai": return val("tts_openai_api_key") !== "" || val("tts_openai_base_url") !== "";
    case "google": return val("tts_google_api_key") !== "";
    case "cartesia": return val("tts_cartesia_api_key") !== "";
    case "fish": return val("tts_fish_api_key") !== "";
    case "custom": return val("tts_custom_url") !== "";
    default: return false;
  }
}

// Tolerant provider resolution: blank, missing, or unknown values all
// resolve to ElevenLabs (backward compatible with pre-multi-provider
// databases, which have no tts_provider setting at all).
export function normalizeTtsProvider(raw: string | undefined | null): TtsProviderId {
  const v = String(raw || "").trim().toLowerCase();
  return (TTS_PROVIDER_IDS as string[]).includes(v) ? (v as TtsProviderId) : "elevenlabs";
}

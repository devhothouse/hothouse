// =========================================================
// ELEVENLABS V3 VOICE-TAG PROMPTING (extracted v3 prompting field)
// ---------------------------------------------------------
// The ElevenLabs v3 voice-tag instructions (the bracketed [tag] guidance)
// previously lived hardcoded inside each character's private persona. They
// now also exist as a configurable setting (`eleven_v3_prompting`, editable
// in Manager → TTS Settings) that any prompt field can reference with the
// {eleven_v3_prompting} placeholder.
//
// The placeholder resolves to the setting's contents ONLY when the TTS model
// (`elevenlabs_model_id` in TTS Settings) is set to ElevenLabs v3; with any
// other model it resolves to an empty string, so non-v3 setups are unaffected.
// =========================================================

export const ELEVEN_V3_PROMPTING_PLACEHOLDER = "{eleven_v3_prompting}";

// Tolerant v3 detection: "eleven_v3", "eleven_v3(expressive)", "ELEVEN_V3", etc.
export function isElevenLabsV3Model(modelId: string | undefined | null): boolean {
  return String(modelId || "").trim().toLowerCase().startsWith("eleven_v3");
}

// Resolves {eleven_v3_prompting} inside any prompt string. The placeholder
// resolves to the setting's text ONLY when the active TTS provider is
// ElevenLabs AND the TTS model is ElevenLabs v3; with any other provider or
// model it resolves to "" (fully backward compatible: an omitted ttsProvider
// argument keeps the historical model-only behavior for existing callers).
export function resolveElevenV3Prompting(
  template: string | undefined | null,
  modelId: string | undefined | null,
  v3PromptingText: string | undefined | null,
  ttsProvider?: string | undefined | null,
): string {
  const provider = String(ttsProvider ?? "").trim().toLowerCase();
  const isElevenLabsProvider = !provider || provider === "elevenlabs";
  const replacement = isElevenLabsProvider && isElevenLabsV3Model(modelId) ? String(v3PromptingText ?? "") : "";
  return String(template ?? "").replace(/\{eleven_v3_prompting\}/g, replacement);
}
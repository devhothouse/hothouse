// =========================================================
// LLM TASK REGISTRY & MODEL SLOT CONFIGURATION
// ---------------------------------------------------------
// Central definition of every distinct type of LLM call the app
// makes ("tasks") and the Model Config slots (A-Z) that can be
// assigned to each task ("AI Model Task Assignment"). A task
// with no assigned Model Config falls back to the Global LLM
// Default settings (the single fallback).
//
// IMPORTANT: This module is pure data + helpers (no database
// imports) so it can safely be imported from server routes AND
// client components (e.g. the Manager tab UI).
// =========================================================

export const MODEL_SLOT_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// SystemSetting keys backing the AI Model Manager / Task Assignment
export const MODEL_SLOT_IDS_KEY = "model_slot_ids"; // e.g. "A,B,C"
export const TASK_ASSIGNMENT_KEY = "llm_task_assignment"; // JSON: { [taskId]: { slots: ["A","C"], weights: { A: 3, C: 1 } } }

export type SlotField = "label" | "provider" | "model" | "api_key" | "temperature" | "max_tokens" | "base_url";
export const SLOT_FIELDS: SlotField[] = ["label", "provider", "model", "api_key", "temperature", "max_tokens", "base_url"];

// Settings key for a single field of a Model Config slot, e.g. model_slot_a_api_key
export function slotKey(letter: string, field: SlotField): string {
  return `model_slot_${letter.toLowerCase()}_${field}`;
}

// Parses stored slot ids ("A,B,C" or JSON array) into a validated letter list
export function parseSlotIds(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const cleaned = raw.replace(/[\[\]"]/g, "");
  return cleaned
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => MODEL_SLOT_LETTERS.includes(s));
}

export function serializeSlotIds(letters: string[]): string {
  return letters.join(",");
}

// ---------------------------------------------------------
// Task definitions (one per distinct LLM call type)
// ---------------------------------------------------------

export interface LlmTaskDef {
  id: string; // Matches the callLLM scope parameter
  label: string; // UI display name
  description: string; // What this task does / where it fires
  group: string; // UI grouping in the Task Assignment view
}

export const LLM_TASKS: LlmTaskDef[] = [
  // ==== TASKS PART 1 ====
  {
    id: "chat",
    label: "AIC-User Chat Messaging",
    description: "In-character replies when you message a matched character, plus Regenerate & Edit rewrites.",
    group: "Messaging",
  },
  {
    id: "async",
    label: "Asynchronous Messaging",
    description: "Spontaneous/unread messages AICs initiate on their own (tab switches, timers, background triggers).",
    group: "Messaging",
  },
  {
    id: "evaluation",
    label: "User Profile Evaluation",
    description: "The Decision Engine: AICs evaluating your human profile to pass, like, or slide-in.",
    group: "Evaluation",
  },
  {
    id: "aic_match",
    label: "AIC↔AIC Match Evaluation",
    description: "AIC Network: characters evaluating other characters' profiles for mutual matches.",
    group: "Evaluation",
  },
  {
    id: "persona_generation",
    label: "AIC Generation",
    description: "Creating brand-new character personas (preference-driven and manual generation).",
    group: "AIC Creation & Maintenance",
  },
  {
    id: "name_generation",
    label: "AIC Name Generation",
    description: "The AI Name Resolver: only runs when a newly generated character's name conflicts with an existing one (duplicates/placeholders), generating a unique, contextually appropriate name.",
    group: "AIC Creation & Maintenance",
  },
  {
    id: "self_tagging",
    label: "AIC Self-Tagging",
    description: "Characters rating themselves 1-10 across the 100 master traits (vision-assisted). Mostly a legacy feature — only needed for manually created AICs that were made without tags.",
    group: "AIC Creation & Maintenance",
  },
  // ==== TASKS PART 2 ====
  {
    id: "portrait_tagging",
    label: "Utility: Portrait Auto-Tagging",
    description: "Vision analysis of unprocessed library portraits (tags + 3-sentence descriptions).",
    group: "AIC Creation & Maintenance",
  },
  {
    id: "portrait_assign",
    label: "AIC Image Picker",
    description: "Characters choosing their own profile picture from the processed portrait library.",
    group: "AIC Creation & Maintenance",
  },
  {
    id: "voice_picker",
    label: "AIC Voice Picker",
    description: "Characters choosing their own ElevenLabs voice from the catalog with usage balancing.",
    group: "AIC Creation & Maintenance",
  },
  {
    id: "bio",
    label: "AIC Bio Writer",
    description: "Writing structured public bios and prompt answers for characters (vision-assisted).",
    group: "AIC Creation & Maintenance",
  },
  {
    id: "image_prompt_writer",
    label: "AIC Image Prompt Writer",
    description: "Writes each character's visual appearance description, used as the basis for AI-generated portraits and chat images.",
    group: "AIC Creation & Maintenance",
  },
  {
    id: "gossip",
    label: "Gossip Review Generation",
    description: "The community review board: characters writing peer reviews of their matches.",
    group: "Community",
  },
  {
    id: "aic_chat",
    label: "AIC↔AIC Chat Messaging",
    description: "Character-to-character conversations inside the AIC Network simulation.",
    group: "Community",
  },
  {
    id: "aic_summary",
    label: "AIC↔AIC Summary",
    description: "Concise relationship summaries of AIC↔AIC conversations (cross-chat memory).",
    group: "Community",
  },
];

// ---------------------------------------------------------
// Global LLM settings key group (the single fallback for unassigned tasks)
// ---------------------------------------------------------

export interface ScopeKeyGroup {
  provider: string;
  temperature: string;
  gemini_api_key: string;
  gemini_model: string;
  anthropic_api_key: string;
  anthropic_model: string;
  openrouter_api_key: string;
  openrouter_model: string;
  openai_api_key: string;
  openai_model: string;
  openai_base_url: string;
}

// The original global LLM settings (the classic top-of-Editor config)
export const GLOBAL_KEY_GROUP: ScopeKeyGroup = {
  provider: "llm_provider",
  temperature: "temperature",
  gemini_api_key: "gemini_api_key",
  gemini_model: "gemini_model",
  anthropic_api_key: "anthropic_api_key",
  anthropic_model: "anthropic_model",
  openrouter_api_key: "openrouter_api_key",
  openrouter_model: "openrouter_model",
  openai_api_key: "openai_api_key",
  openai_model: "openai_model",
  openai_base_url: "openai_base_url",
};


// Every valid callLLM scope id (all registered tasks + the global fallback scope)
export const LLM_SCOPE_IDS = [...LLM_TASKS.map((t) => t.id), "global"];

// Settings key + sensible defaults for the per-provider model name field used
// by the legacy scope UIs (the "Model Name" input rebinds when the provider
// changes: gemini_model / anthropic_model / openrouter_model / openai_model).
export function providerModelKey(prefix: string, provider: string): string {
  const normalized = normalizeLlmProvider(provider);
  const suffix = normalized === "claude" ? "anthropic_model" : normalized === "openrouter" ? "openrouter_model" : normalized === "openai" ? "openai_model" : "gemini_model";
  return `${prefix}${suffix}`;
}

export const PROVIDER_MODEL_DEFAULTS: Record<string, string> = {
  gemini: "gemini-3.7-flash",
  claude: "claude-3-5-sonnet-latest",
  openrouter: "meta-llama/llama-3.1-8b-instruct:free",
  openai: "gpt-4o-mini",
};

export function providerModelPlaceholder(provider: string): string {
  const normalized = normalizeLlmProvider(provider);
  return normalized === "claude"
    ? "e.g. claude-3-5-sonnet-latest"
    : normalized === "openrouter"
      ? "e.g. meta-llama/llama-3.1-8b-instruct:free"
      : normalized === "openai"
        ? "e.g. gpt-4o-mini"
        : "e.g. gemini-3.7-flash";
}

// =========================================================
// LOCAL / SELF-HOSTED LLM SUPPORT (first-class "local" provider)
// ---------------------------------------------------------
// "local" is a first-class provider VALUE offered in every provider picker
// (AI Model Manager slots, Global LLM Default, first-time setup). It reuses
// the OpenAI-compatible pipeline (standard wire format for local runners):
// blank API key works when a Base URL points at a keyless local server.
// All runtime code normalizes "local" → "openai" via normalizeLlmProvider.
// =========================================================
export const LOCAL_LLM_PROVIDER_ID = "local";

export function normalizeLlmProvider(provider: string | null | undefined): string {
  const v = String(provider || "").trim().toLowerCase();
  return v === "local" ? "openai" : v;
}

// Common local OpenAI-compatible server presets for the Base URL field.
export const LOCAL_LLM_BASE_URL_PRESETS: { label: string; url: string }[] = [
  { label: "Ollama", url: "http://localhost:11434/v1" },
  { label: "LM Studio", url: "http://localhost:1234/v1" },
  { label: "llama.cpp server", url: "http://localhost:8080/v1" },
  { label: "vLLM", url: "http://localhost:8000/v1" },
  { label: "KoboldCpp", url: "http://localhost:5001/v1" },
  { label: "LocalAI", url: "http://localhost:8080/v1" },
];

// Full scope union type for callLLM's scope parameter
export type LlmScope =
  | "global" | "chat" | "async" | "evaluation" | "persona" | "bio"
  | "aic_match" | "aic_chat" | "aic_summary" | "gossip"
  | "persona_generation" | "name_generation" | "self_tagging"
  | "portrait_tagging" | "portrait_assign" | "voice_picker"
  | "image_prompt_writer";

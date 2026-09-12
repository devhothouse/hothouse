import { prisma } from "./db";
import fs from "fs";
import path from "path";
import {
  LlmScope,
  ScopeKeyGroup,
  TASK_ASSIGNMENT_KEY,
  MODEL_SLOT_IDS_KEY,
  GLOBAL_KEY_GROUP,
  parseSlotIds,
  slotKey,
  normalizeLlmProvider,
} from "./llmTasks";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// Helper to determine mime type of local uploads (fallback)
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp3" || ext === ".mpeg") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

// Detect actual image mime type from file buffer magic bytes (Topic E / Vision Compliancy)
// (also reused by /api/characters/export to label embedded avatar data URLs correctly)
export function getMimeTypeFromBuffer(buffer: Buffer): string {
  if (buffer.length < 4) return "application/octet-stream";
  
  // JPEG magic bytes: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return "image/jpeg";
  }
  
  // PNG magic bytes: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return "image/png";
  }
  
  // GIF magic bytes: 47 49 46 38 ('GIF8')
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return "image/gif";
  }
  
  // WebP magic bytes: RIFF (52 49 46 46) at start, WEBP (57 45 42 50) at offset 8
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  
  return "application/octet-stream";
}

// Helper to load and base64-encode local file content
function getBase64Data(urlPath: string): { data: string; mimeType: string } | null {
  try {
    if (!urlPath || typeof urlPath !== "string") return null;
    if (urlPath.startsWith("http")) return null; // Skip external absolute URLs
    
    // Support data URLs directly, decoding them to check magic bytes
    if (urlPath.startsWith("data:")) {
      const matches = urlPath.match(/^data:([^;]+);base64,(.*)$/);
      if (matches) {
        const mimeType = matches[1];
        const data = matches[2];
        const buffer = Buffer.from(data, "base64");
        const realMime = getMimeTypeFromBuffer(buffer);
        return {
          data,
          mimeType: realMime !== "application/octet-stream" ? realMime : mimeType,
        };
      }
      return null;
    }

    let relPath = urlPath;
    // Ensure relative path starts with a leading slash for process join
    if (!urlPath.startsWith("/")) {
      relPath = "/" + urlPath;
    }

    const localPath = path.join(process.cwd(), "public", relPath);
    if (!fs.existsSync(localPath)) {
      // Try to check if it's inside the public/uploads folder as fallback
      const fallbackPath = path.join(process.cwd(), "public", "uploads", relPath);
      if (fs.existsSync(fallbackPath)) {
        const fileBuffer = fs.readFileSync(fallbackPath);
        const realMime = getMimeTypeFromBuffer(fileBuffer);
        const fallbackMime = getMimeType(fallbackPath);
        return {
          data: fileBuffer.toString("base64"),
          mimeType: realMime !== "application/octet-stream" ? realMime : fallbackMime,
        };
      }
      return null;
    }

    const fileBuffer = fs.readFileSync(localPath);
    const realMime = getMimeTypeFromBuffer(fileBuffer);
    const fallbackMime = getMimeType(localPath);
    return {
      data: fileBuffer.toString("base64"),
      mimeType: realMime !== "application/octet-stream" ? realMime : fallbackMime,
    };
  } catch (e) {
    console.error("Error loading base64 data:", e);
    return null;
  }
}

export interface EvaluationResult {
  decision: "pass" | "like" | "slide-in";
  internal_reasoning: string;
  opening_message: string;
}

async function getSetting(key: string): Promise<string> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key },
  });
  return setting?.value ?? "";
}

// Re-orders consecutive message logs to prevent LLM validation turn crashes (Topic B #4)
export function normalizeAlternatingOrder(messages: Message[]): Message[] {
  if (messages.length === 0) return [];
  const normalized: Message[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    if (normalized.length > 0) {
      const last = normalized[normalized.length - 1];
      if (last.role === current.role) {
        // Insert dummy message of opposite role to force alternating prompt compliance
        if (current.role === "assistant" || current.role === "system") {
          normalized.push({
            role: "user",
            content: "[User is busy or away, no immediate reply]"
          });
        } else {
          normalized.push({
            role: "assistant",
            content: "[Character is listening quietly to you]"
          });
        }
      }
    }
    normalized.push(current);
  }

  // CRITICAL COMPLIANCE FIX: Gemini (and other providers) require that the request contents
  // ends with a USER turn. If the last message in our normalized array is an assistant message 
  // (e.g. during an asynchronous trigger or double-assistant regenerate), we append a hidden 
  // dummy user instruction so that the API payload is valid.
  if (normalized.length > 0 && normalized[normalized.length - 1].role === "assistant") {
    normalized.push({
      role: "user",
      content: "[Please take the initiative to send your next response now]"
    });
  }

  return normalized;
}

// Generate beautiful readable date-time string
function getCurrentDateTimeString(): string {
  const now = new Date();
  return now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }); // e.g. "Sunday, August 23, 2026, 12:21 PM"
}

export async function callLLM(
  systemPrompt: string,
  messages: Message[],
  streamHandler?: (chunk: string) => void,
  isChat = false,
  scope: LlmScope = "global"
): Promise<string> {
  const currentDateTime = getCurrentDateTimeString();
  
  // Globally substitute {current_time} inside any system prompt templates before LLM query
  const processedSystemPrompt = systemPrompt.replace(/{current_time}/g, currentDateTime);
  
  // Globally substitute {current_time} inside any user content or message logs before LLM query
  const processedMessages = messages.map(m => ({
    ...m,
    content: m.content.replace(/{current_time}/g, currentDateTime)
  }));

  const normalizedMessages = normalizeAlternatingOrder(processedMessages);
  
  // Map isChat=true to "chat" scope for backwards compatibility
  let finalScope = scope;
  if (isChat) {
    finalScope = "chat";
  }

  // Global toggles used by the provider branches
  const inlineImagesSetting = await prisma.systemSetting.findUnique({
    where: { key: "inline_images" },
  });
  const inlineImagesEnabled = inlineImagesSetting ? inlineImagesSetting.value !== "false" : true;

  // Check if safety settings should be disabled (default: true/enabled).
  // Highly recommended for dating-app roleplay to avoid false-positive safety blocking.
  const disableSafetySetting = await prisma.systemSetting.findUnique({
    where: { key: "llm_disable_safety" },
  });
  const disableSafety = disableSafetySetting ? disableSafetySetting.value !== "false" : true;

  // Resolve the ordered list of candidate model configs for this task:
  //   1) Model Config slot routing ("AI Model Task Assignment"): weighted random
  //      primary pick with automatic failover to the other assigned slots.
  //   2) Legacy dedicated links (chat_, evaluation_, persona_, bio_, gossip_...)
  //      with global fallback — the exact pre-overhaul behavior.
  const candidateConfigs = await resolveCallConfigs(finalScope);

  // Attempt candidates in order; on error, fail over to the next config.
  const failures: string[] = [];
  for (const cfg of candidateConfigs) {
    try {
      return await executeProviderCall(
        cfg,
        processedSystemPrompt,
        normalizedMessages,
        streamHandler,
        inlineImagesEnabled,
        disableSafety
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      failures.push(cfg.label ? `[${cfg.label}] ${msg}` : msg);
      console.error(`callLLM config failed (${cfg.label || "unnamed"} → ${cfg.provider}/${cfg.model}):`, msg);
    }
  }
  throw new Error(
    failures.length > 1
      ? `All ${failures.length} model configs failed → ${failures.join(" | ")}`
      : failures[0] || "LLM call failed: no model configuration could be resolved."
  );
}

// A fully resolved single LLM call configuration (from a Model Config slot
// or from legacy scoped settings). Used by callLLM and the connection test.
export interface LlmCallConfig {
  provider: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number | null; // Only sent when explicitly configured; providers keep their defaults otherwise
  baseUrl: string | null; // OpenAI-compatible only: custom base URL (blank/null → official OpenAI endpoint)
  label: string; // Human-readable name for logs/errors
}

// Builds a config from one scoped key group. Returns null when the group's
// provider is blank (→ the next group in the chain is tried). Blank keys/models
// inside a configured group fall back to the global counterparts, preserving
// the app's historical per-field fallback behavior.
async function buildConfigFromKeyGroup(grp: ScopeKeyGroup): Promise<LlmCallConfig | null> {
  const provider = normalizeLlmProvider((await getSetting(grp.provider)).trim());
  if (!provider) return null;
  const g = GLOBAL_KEY_GROUP;
  let apiKey = "";
  let model = "";
  let baseUrl: string | null = null;
  if (provider === "gemini") {
    apiKey = (await getSetting(grp.gemini_api_key)) || (await getSetting(g.gemini_api_key));
    model = (await getSetting(grp.gemini_model)) || (await getSetting(g.gemini_model)) || "gemini-3.7-flash";
  } else if (provider === "claude") {
    apiKey = (await getSetting(grp.anthropic_api_key)) || (await getSetting(g.anthropic_api_key));
    model = (await getSetting(grp.anthropic_model)) || (await getSetting(g.anthropic_model)) || "claude-3-5-sonnet-latest";
  } else if (provider === "openrouter") {
    apiKey = (await getSetting(grp.openrouter_api_key)) || (await getSetting(g.openrouter_api_key));
    model = (await getSetting(grp.openrouter_model)) || (await getSetting(g.openrouter_model)) || "meta-llama/llama-3.1-8b-instruct:free";
  } else if (provider === "openai") {
    // OpenAI-compatible endpoint: keys/models keep the "blank = inherit global"
    // fallback, but the base URL is always this group's own setting (blank →
    // official OpenAI endpoint) so scoped endpoints can't accidentally inherit.
    apiKey = (await getSetting(grp.openai_api_key)) || (await getSetting(g.openai_api_key));
    model = (await getSetting(grp.openai_model)) || (await getSetting(g.openai_model)) || "gpt-4o-mini";
    baseUrl = (await getSetting(grp.openai_base_url)).trim() || null;
  } else {
    return null;
  }
  const tempStr = (await getSetting(grp.temperature)) || (await getSetting(g.temperature));
  return {
    provider,
    apiKey,
    model,
    temperature: parseFloat(tempStr) || 0.7,
    maxTokens: null,
    baseUrl,
    label: "",
  };
}

// Builds ordered Model Config candidates from a task assignment entry.
// The first config is picked via weighted random; the remaining assigned
// slots become ordered failover backups.
async function buildSlotConfigs(entry: any): Promise<LlmCallConfig[]> {
  const configuredIds = parseSlotIds(await getSetting(MODEL_SLOT_IDS_KEY));
  const loaded: { weight: number; cfg: LlmCallConfig }[] = [];
  for (const letter of configuredIds) {
    if (!entry.slots.includes(letter)) continue;
    const provider = normalizeLlmProvider((await getSetting(slotKey(letter, "provider"))).trim());
    const model = (await getSetting(slotKey(letter, "model"))).trim();
    const apiKey = (await getSetting(slotKey(letter, "api_key"))).trim();
    // OpenAI-compatible only: per-slot custom base URL (blank → official endpoint)
    const slotBaseUrl = (await getSetting(slotKey(letter, "base_url"))).trim();
    const baseUrl = slotBaseUrl || null;
    if (!provider || !model) continue; // Skip incomplete slots
    // Blank slot fields inherit from the global settings (same "blank = use global"
    // fallback behavior as every other LLM config in the app).
    const globalApiKey = provider === "gemini"
      ? await getSetting("gemini_api_key")
      : provider === "claude"
        ? await getSetting("anthropic_api_key")
        : provider === "openrouter"
          ? await getSetting("openrouter_api_key")
          : provider === "openai"
            ? await getSetting("openai_api_key")
            : "";
    const effectiveApiKey = apiKey || globalApiKey.trim();
    // Keyless local OpenAI-compatible endpoints (custom base URL) are allowed;
    // everything else needs a usable key.
    const keylessAllowed = provider === "openai" && !isOpenAiOfficialBase(baseUrl || "");
    if (!effectiveApiKey && !keylessAllowed) continue; // No usable key anywhere → skip this slot
    const tempStr = (await getSetting(slotKey(letter, "temperature"))).trim() || (await getSetting("temperature"));
    const maxStr = (await getSetting(slotKey(letter, "max_tokens"))).trim();
    const label = (await getSetting(slotKey(letter, "label"))).trim() || `Model Config ${letter}`;
    const rawWeight = entry.weights?.[letter];
    const weight = Math.max(0, parseFloat(String(rawWeight)) || 1) || 1;
    const parsedTemp = parseFloat(tempStr);
    loaded.push({
      weight,
      cfg: {
        provider,
        model,
        apiKey: effectiveApiKey,
        temperature: Number.isFinite(parsedTemp) ? parsedTemp : 1, // Model Config default temperature: 1
        maxTokens: maxStr ? (parseInt(maxStr, 10) || null) : null,
        baseUrl,
        label,
      },
    });
  }
  const ordered: LlmCallConfig[] = [];
  const pool = [...loaded];
  while (pool.length > 0) {
    const total = pool.reduce((s, p) => s + p.weight, 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) { idx = i; break; }
    }
    ordered.push(pool[idx].cfg);
    pool.splice(idx, 1);
  }
  return ordered;
}

// Resolves which model config(s) a call should attempt, in failover order.
// Resolution: assigned Model Config slots (weighted pick + failover) →
// otherwise the Global LLM Default settings (the single fallback).
async function resolveCallConfigs(finalScope: string): Promise<LlmCallConfig[]> {
  // 1. Task-based Model Config routing ("AI Model Task Assignment")
  const assignmentRaw = await getSetting(TASK_ASSIGNMENT_KEY);
  if (assignmentRaw) {
    try {
      const assignment = JSON.parse(assignmentRaw);
      const entry = assignment?.[finalScope];
      if (entry && Array.isArray(entry.slots) && entry.slots.length > 0) {
        const slotConfigs = await buildSlotConfigs(entry);
        if (slotConfigs.length > 0) return slotConfigs;
      }
    } catch (e) {
      console.error(`Failed to parse llm_task_assignment for task "${finalScope}"; falling back to the Global LLM Default.`, e);
    }
  }
  // 2. Unassigned task → Global LLM Default. A persistent warning banner in
  //    Manager → AI Model Task Assignment lists every unassigned task, and
  //    each runtime fallback is logged here.
  if (finalScope !== "global") {
    console.warn(`[LLM] Task "${finalScope}" has no Model Config assigned — using the Global LLM Default settings. Assign a model in Manager → AI Model Task Assignment.`);
  }
  const globalCfg = await buildConfigFromKeyGroup(GLOBAL_KEY_GROUP);
  if (globalCfg) return [globalCfg];
  // Nothing configured anywhere: return a placeholder so the provider branch
  // raises the familiar "API Key is not configured" guidance error.
  return [{ provider: "gemini", model: "gemini-3.7-flash", apiKey: "", temperature: 0.7, maxTokens: null, baseUrl: null, label: "" }];
}

// Shared OpenAI-compatible message formatter (used by the "openai" and
// "openrouter" provider branches). Converts markdown image/media references
// into OpenAI-style image_url content parts with base64 data URLs.
function buildOpenAiCompatibleMessages(normalizedMessages: Message[], inlineImagesEnabled: boolean) {
  return normalizedMessages.map((m) => {
    const role = m.role;
    const contentParts: any[] = [];

    if (inlineImagesEnabled) {
      const mediaRegex = /(!?\[[^\]]*\]\(([^)]+)\))/g;
      let match;
      let lastIndex = 0;

      while ((match = mediaRegex.exec(m.content)) !== null) {
        const [fullMatch, , urlPath] = match;
        const index = match.index;

        if (index > lastIndex) {
          contentParts.push({ type: "text", text: m.content.substring(lastIndex, index) });
        }

        const b64 = getBase64Data(urlPath);
        if (b64 && b64.mimeType.startsWith("image/")) {
          contentParts.push({
            type: "image_url",
            image_url: {
              url: `data:${b64.mimeType};base64,${b64.data}`,
            },
          });
        } else {
          contentParts.push({ type: "text", text: b64 ? `[Attached ${b64.mimeType}]` : fullMatch });
        }

        lastIndex = mediaRegex.lastIndex;
      }

      if (lastIndex < m.content.length) {
        contentParts.push({ type: "text", text: m.content.substring(lastIndex) });
      }
    } else {
      const strippedText = m.content.replace(
        /!?\[[^\]]*\]\(([^)]+)\)/g,
        "[an image/media file was included here. It is not currently being shown because image sharing is turned off.]"
      );
      contentParts.push({ type: "text", text: strippedText });
    }

    return { role, content: contentParts };
  });
}

// Official-OpenAI detection for the OpenAI-compatible provider: a blank or
// api.openai.com base URL means the official cloud endpoint (key required);
// any other base URL is a self-hosted/local server (key optional).
function isOpenAiOfficialBase(baseUrl: string | null | undefined): boolean {
  const trimmed = String(baseUrl ?? "").trim();
  return !trimmed || /^https:\/\/api\.openai\.com/i.test(trimmed);
}

// Executes one LLM call against a single resolved config. Used by callLLM
// (which loops over candidates for weighted pick + failover) and by the
// Model Manager "Test Connection" action.
async function executeProviderCall(
  cfg: LlmCallConfig,
  processedSystemPrompt: string,
  normalizedMessages: Message[],
  streamHandler?: (chunk: string) => void,
  inlineImagesEnabled = true,
  disableSafety = true
): Promise<string> {
  const provider = cfg.provider;
  const apiKey = cfg.apiKey;
  const model = cfg.model;
  const temperature = cfg.temperature;

  if (provider === "gemini") {

    if (!apiKey) {
      throw new Error("Gemini API Key is not configured. Please add it in the Manager tab → AI Models (or Global Settings).");
    }

    // Format messages for Gemini API (Topic B #4, using normalizedMessages)
    const contents = normalizedMessages.map((m) => {
      const role = m.role === "assistant" ? "model" : "user";
      const parts: any[] = [];

      if (inlineImagesEnabled) {
        // Find markdown image/media matches: ![image](path), [audio](path), [video](path)
        const mediaRegex = /(!?\[[^\]]*\]\(([^)]+)\))/g;
        let match;
        let lastIndex = 0;

        while ((match = mediaRegex.exec(m.content)) !== null) {
          const [fullMatch, , urlPath] = match;
          const index = match.index;

          if (index > lastIndex) {
            parts.push({ text: m.content.substring(lastIndex, index) });
          }

          const b64 = getBase64Data(urlPath);
          if (b64) {
            parts.push({
              inlineData: {
                mimeType: b64.mimeType,
                data: b64.data,
              },
            });
          } else {
            parts.push({ text: fullMatch });
          }

          lastIndex = mediaRegex.lastIndex;
        }

        if (lastIndex < m.content.length) {
          parts.push({ text: m.content.substring(lastIndex) });
        }
      } else {
        // Strip media or replace with placeholder
        const strippedText = m.content.replace(
          /!?\[[^\]]*\]\(([^)]+)\)/g,
          "[an image/media file was included here. It is not currently being shown because image sharing is turned off.]"
        );
        parts.push({ text: strippedText });
      }

      if (parts.length === 0) {
        parts.push({ text: "" });
      }

      return { role, parts };
    });

    const bodyPayload: any = {
      contents,
      systemInstruction: {
        parts: [{ text: processedSystemPrompt }],
      },
      generationConfig: cfg.maxTokens
        ? { temperature, maxOutputTokens: cfg.maxTokens }
        : { temperature },
    };

    // If safety settings are disabled, apply BLOCK_NONE safety category overrides to the payload.
    if (disableSafety) {
      bodyPayload.safetySettings = [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API Error: ${response.statusText} - ${err}`);
    }

    const json = await response.json();
    const candidate = json.candidates?.[0];
    
    // Explicitly check if Gemini candidate finished with a safety block reason
    // to prevent empty string outputs and throw a helpful error instead.
    if (candidate?.finishReason === "SAFETY") {
      throw new Error("Gemini blocked this response due to safety filters. Try relaxing your character's persona/prompt, or verify that 'Disable LLM Safety Settings' is enabled in settings.");
    }
    const reply = candidate?.content?.parts?.[0]?.text ?? "";

    if (streamHandler) {
      streamHandler(reply);
    }
    return reply;
  } else if (provider === "claude") {
    if (!apiKey) {
      throw new Error("Anthropic API Key is not configured. Please add it in the Manager tab → AI Models (or Global Settings).");
    }

    // Format messages for Claude API (Topic B #4, using normalizedMessages)
    const formattedMessages = normalizedMessages.map((m) => {
      const role = m.role === "assistant" ? "assistant" : "user";
      const contentParts: any[] = [];

      if (inlineImagesEnabled) {
        const mediaRegex = /(!?\[[^\]]*\]\(([^)]+)\))/g;
        let match;
        let lastIndex = 0;

        while ((match = mediaRegex.exec(m.content)) !== null) {
          const [fullMatch, , urlPath] = match;
          const index = match.index;

          if (index > lastIndex) {
            contentParts.push({ type: "text", text: m.content.substring(lastIndex, index) });
          }

          const b64 = getBase64Data(urlPath);
          if (b64 && b64.mimeType.startsWith("image/")) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: b64.mimeType,
                data: b64.data,
              },
            });
          } else {
            contentParts.push({ type: "text", text: b64 ? `[Attached ${b64.mimeType}]` : fullMatch });
          }

          lastIndex = mediaRegex.lastIndex;
        }

        if (lastIndex < m.content.length) {
          contentParts.push({ type: "text", text: m.content.substring(lastIndex) });
        }
      } else {
        const strippedText = m.content.replace(
          /!?\[[^\]]*\]\(([^)]+)\)/g,
          "[an image/media file was included here. It is not currently being shown because image sharing is turned off.]"
        );
        contentParts.push({ type: "text", text: strippedText });
      }

      // 100% Claude-compliant content formatting: If no image vision blocks are present,
      // send content as a simple plain string instead of array of blocks to maximize model response stability.
      const hasImages = contentParts.some(p => p.type === "image");
      const finalContent = hasImages ? contentParts : m.content;

      return { role, content: finalContent };
    });

    // Optional native prompt caching (Anthropic): mark the system prompt and the latest message
    // with ephemeral cache_control breakpoints so long, stable prefixes (personas, gossip/memory
    // blocks, growing chat transcripts) are served from cache on subsequent calls.
    // Configurable via the "prompt_caching_enabled" system setting (default: enabled).
    const promptCaching = (await getSetting("prompt_caching_enabled")) !== "false";
    const anthropicSystem = promptCaching
      ? [{ type: "text", text: processedSystemPrompt, cache_control: { type: "ephemeral" } }]
      : processedSystemPrompt;
    const anthropicMessages = promptCaching
      ? formattedMessages.map((m, i) =>
          i === formattedMessages.length - 1 && typeof m.content === "string"
            ? { ...m, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
            : m
        )
      : formattedMessages;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: cfg.maxTokens ?? 4000, // Per-Model Config "Max Output Tokens"; default raised to prevent generation cutoffs
        temperature,
        system: anthropicSystem,
        messages: anthropicMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API Error: ${response.statusText} - ${err}`);
    }

    const json = await response.json();
    const reply = json.content?.[0]?.text ?? "";
    if (streamHandler) {
      streamHandler(reply);
    }
    return reply;
  } else if (provider === "openai") {
    // OpenAI-compatible chat endpoint: official OpenAI plus any OpenAI-shaped
    // server (Ollama, LM Studio, llama.cpp, vLLM, KoboldCpp, LocalAI, …).
    // The Authorization header is omitted when no key is configured, so
    // keyless local servers work; the official endpoint requires a key.
    const base = String(cfg.baseUrl ?? "").trim().replace(/\/+$/, "") || "https://api.openai.com/v1";
    if (!apiKey && isOpenAiOfficialBase(cfg.baseUrl)) {
      throw new Error("OpenAI API Key is not configured. Please add it in the Manager tab → AI Models (or Global Settings) — or set a custom Base URL for a local OpenAI-compatible server.");
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    // Optional prompt caching pass-through for Claude models served through an
    // OpenAI-compatible proxy (mirrors the OpenRouter behavior). Other servers
    // simply ignore the cache_control block.
    const promptCaching = (await getSetting("prompt_caching_enabled")) !== "false";
    const supportsCachePassthrough = promptCaching && /claude|anthropic/i.test(model);
    const systemMessage = supportsCachePassthrough
      ? { role: "system", content: [{ type: "text", text: processedSystemPrompt, cache_control: { type: "ephemeral" } }] }
      : { role: "system", content: processedSystemPrompt };

    const payloadMessages = [
      systemMessage,
      ...buildOpenAiCompatibleMessages(normalizedMessages, inlineImagesEnabled),
    ];

    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature,
        ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}),
        messages: payloadMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI-compatible API Error: ${response.statusText} - ${err}`);
    }

    const json = await response.json();
    const reply = json.choices?.[0]?.message?.content ?? "";
    if (streamHandler) {
      streamHandler(reply);
    }
    return reply;
  } else if (provider === "openrouter") {
    if (!apiKey) {
      throw new Error("OpenRouter API Key is not configured. Please add it in the Manager tab → AI Models (or Global Settings).");
    }

    // Format messages for OpenRouter (OpenAI-compatible) API (Topic B #4, using normalizedMessages)
    const formattedMessages = buildOpenAiCompatibleMessages(normalizedMessages, inlineImagesEnabled);

    // Optional prompt caching pass-through: for Claude models routed via OpenRouter, the system
    // prompt is sent as a cached content block (OpenRouter normalizes cache_control to Anthropic).
    // Other OpenRouter providers (and Gemini, which caches long prompts implicitly) need no action.
    const promptCaching = (await getSetting("prompt_caching_enabled")) !== "false";
    const supportsCachePassthrough = promptCaching && /claude|anthropic/i.test(model);
    const systemMessage = supportsCachePassthrough
      ? { role: "system", content: [{ type: "text", text: processedSystemPrompt, cache_control: { type: "ephemeral" } }] }
      : { role: "system", content: processedSystemPrompt };

    const payloadMessages = [
      systemMessage,
      ...formattedMessages,
    ];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost:3000",
        "X-Title": "Hothouse",
      },
      body: JSON.stringify({
        model,
        temperature,
        ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}),
        messages: payloadMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API Error: ${response.statusText} - ${err}`);
    }

    const json = await response.json();
    const reply = json.choices?.[0]?.message?.content ?? "";
    if (streamHandler) {
      streamHandler(reply);
    }
    return reply;
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

// Verifies a Model Config by sending a tiny prompt through the normal provider
// pipeline. Throws with the provider's real error message on failure.
export async function testModelConfig(
  provider: string,
  model: string,
  apiKey: string,
  temperature?: string,
  maxTokens?: string,
  baseUrl?: string
): Promise<void> {
  const cfg: LlmCallConfig = {
    provider: normalizeLlmProvider(provider),
    model: model.trim(),
    apiKey: apiKey.trim(),
    temperature: (temperature && parseFloat(temperature)) || 1, // Model Config default temperature: 1
    maxTokens: maxTokens && maxTokens.trim() ? (parseInt(maxTokens, 10) || null) : null,
    baseUrl: (baseUrl && baseUrl.trim()) || null,
    label: "Connection Test",
  };
  await executeProviderCall(
    cfg,
    "You are a connection test endpoint. Always reply with exactly the single word: OK.",
    [{ role: "user", content: "Reply with exactly: OK" }],
    undefined,
    false,
    true
  );
}

export async function evaluateUserProfile(
  characterPersona: string,
  userProfile: { name: string; bio: string; gender: string; lookingFor: string; avatarDescription: string; userAvatar?: string; characterAvatar?: string },
  gossipContext?: string
): Promise<EvaluationResult> {
  // Resolve the evaluation call through the AI Model Task Assignment ("evaluation"
  // scope) FIRST — Model Config slots (e.g. the wizard-configured "Main Fast Model").
  // Previously this function ignored task routing entirely and read only the legacy
  // evaluation keys / the Global LLM Default provider, so on fresh installs that
  // were configured via Model Config slots every evaluation failed with
  // "Unknown LLM provider: " (blank global provider). Falls back to the legacy
  // evaluation keys / global provider when no usable Model Config exists.
  const taskConfigs = await resolveCallConfigs("evaluation");
  const slotCfg = taskConfigs.find((c) => c && c.provider && (c.apiKey || c.baseUrl)) || null;
  const evaluationProvider = slotCfg ? "" : await getSetting("evaluation_llm_provider");
  const useEvaluationConfig = !slotCfg && evaluationProvider !== "";

  const provider = normalizeLlmProvider(slotCfg ? slotCfg.provider : useEvaluationConfig ? evaluationProvider : await getSetting("llm_provider"));
  
  const inlineImagesSetting = await prisma.systemSetting.findUnique({
    where: { key: "inline_images" },
  });
  const inlineImagesEnabled = inlineImagesSetting ? inlineImagesSetting.value !== "false" : true;

  let imagePromptBlock = "";
  if (inlineImagesEnabled && (userProfile.userAvatar || userProfile.characterAvatar)) {
    imagePromptBlock = `
Here are your reference profile images for this evaluation:
- Your (Character) Avatar Image: ![char_avatar](${userProfile.characterAvatar || ""})
- User's Profile Picture: ![user_avatar](${userProfile.userAvatar || ""})
Please evaluate their physical appearance if visible in the picture and incorporate it into your compatibility choice.`;
  } else if (!inlineImagesEnabled && (userProfile.userAvatar || userProfile.characterAvatar)) {
    imagePromptBlock = `
[an image was included here. It is not currently being shown because image sharing is turned off.]`;
  }

  const promptTemplate = await getSetting("prompt_evaluate_swipe");
  const fallbackPrompt = `You are evaluating a human user profile on a dating app. Based on your private persona and dating preferences, decide whether you want to "pass", "like", or "slide-in" (send an opening message immediately bypassing the feed).
  
Your Private Persona:
{private_persona}

Human User Profile:
- Name: {user_name}
- Gender: {user_gender}
- Seeking: {user_looking_for}
- Bio: {user_bio}
- Photo/Avatar description: {user_avatar_description}
{image_prompt_block}
{community_reviews_block}

Determine your response. If you choose "slide-in", you MUST provide an opening message. If you choose "pass" or "like", opening_message can be empty.
You MUST respond with a strictly formatted JSON object with the following fields:
{
  "decision": "pass" | "like" | "slide-in",
  "internal_reasoning": "Explanation of why you made this choice based on your persona, preferences, and the user's profile",
  "opening_message": "Opening message if and only if decision is slide-in (otherwise leave empty)"
}`;

  const currentDateTime = getCurrentDateTimeString();

  const templateToUse = promptTemplate || fallbackPrompt;
  let prompt = templateToUse
    .replace(/{private_persona}/g, characterPersona)
    .replace(/{user_name}/g, userProfile.name)
    .replace(/{user_gender}/g, userProfile.gender)
    .replace(/{current_time}/g, currentDateTime) // Replace {current_time} inside evaluation prompt
    .replace(/{user_looking_for}/g, userProfile.lookingFor)
    .replace(/{user_bio}/g, userProfile.bio)
    .replace(/{user_avatar_description}/g, userProfile.avatarDescription)
    .replace(/{image_prompt_block}/g, imagePromptBlock);

  if (prompt.includes("{community_reviews_block}")) {
    prompt = prompt.replace(/{community_reviews_block}/g, gossipContext || "");
  } else if (gossipContext) {
    prompt = `${prompt}\n\n${gossipContext}`;
  }

  if (provider === "gemini") {
    // Resolve Evaluation Gemini API key, model and temperature. A Model Config
    // slot resolved above wins; legacy evaluation keys and the global Gemini
    // setup are the fallback chain.
    let apiKey = slotCfg ? slotCfg.apiKey : useEvaluationConfig ? await getSetting("evaluation_gemini_api_key") : "";
    if (!apiKey) apiKey = await getSetting("gemini_api_key");

    let model = slotCfg ? slotCfg.model : useEvaluationConfig ? await getSetting("evaluation_gemini_model") : "";
    if (!model) model = (await getSetting("gemini_model")) || "gemini-2.0-flash";

    let tempStr = slotCfg ? String(slotCfg.temperature ?? "") : useEvaluationConfig ? await getSetting("evaluation_temperature") : "";
    const temperature = tempStr ? parseFloat(tempStr) : 0.2;

    if (!apiKey) {
      throw new Error("Gemini API Key is required for evaluation. Please configure it in the Editor/Settings tab.");
    }

    // Check if safety settings should be disabled (default: true/enabled).
    // This ensures compatibility evaluations don't get blocked by sensitive bio keywords.
    const disableSafetySetting = await prisma.systemSetting.findUnique({
      where: { key: "llm_disable_safety" },
    });
    const disableSafety = disableSafetySetting ? disableSafetySetting.value !== "false" : true;

    // Parse multimodal parts for Gemini API
    const parts: any[] = [];
    if (inlineImagesEnabled) {
      const mediaRegex = /(!?\[[^\]]*\]\(([^)]+)\))/g;
      let match;
      let lastIndex = 0;

      while ((match = mediaRegex.exec(prompt)) !== null) {
        const [fullMatch, , urlPath] = match;
        const index = match.index;

        if (index > lastIndex) {
          parts.push({ text: prompt.substring(lastIndex, index) });
        }

        const b64 = getBase64Data(urlPath);
        if (b64) {
          parts.push({
            inlineData: {
              mimeType: b64.mimeType,
              data: b64.data,
            },
          });
        } else {
          parts.push({ text: fullMatch });
        }

        lastIndex = mediaRegex.lastIndex;
      }

      if (lastIndex < prompt.length) {
        parts.push({ text: prompt.substring(lastIndex) });
      }
    } else {
      const strippedText = prompt.replace(
        /!?\[[^\]]*\]\(([^)]+)\)/g,
        "[an image/media file was included here. It is not currently being shown because image sharing is turned off.]"
      );
      parts.push({ text: strippedText });
    }

    if (parts.length === 0) {
      parts.push({ text: "" });
    }

    const bodyPayload: any = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            decision: { type: "STRING", enum: ["pass", "like", "slide-in"] },
            internal_reasoning: { type: "STRING" },
            opening_message: { type: "STRING" },
          },
          required: ["decision", "internal_reasoning", "opening_message"],
        },
      },
    };

    // If safety settings are disabled, apply BLOCK_NONE safety overrides to compatibility checks.
    if (disableSafety) {
      bodyPayload.safetySettings = [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini Evaluation Error: ${response.statusText} - ${err}`);
    }

    const json = await response.json();
    const candidate = json.candidates?.[0];
    
    // Explicitly check if Gemini compatibility evaluation finished with a safety block reason
    if (candidate?.finishReason === "SAFETY") {
      throw new Error("Gemini blocked this compatibility evaluation response due to safety filters. Try relaxing your character's persona, or verify that 'Disable LLM Safety Settings' is enabled in settings.");
    }
    const text = candidate?.content?.parts?.[0]?.text ?? "{}";
    return JSON.parse(text) as EvaluationResult;
  } else if (provider === "claude" || provider === "openrouter" || provider === "openai") {
    // For Claude, OpenRouter, or OpenAI-compatible providers, we send the prompt
    // and parse the JSON response using evaluation scope
    const resText = await callLLM(
      "You are a helpful assistant that always outputs strictly valid JSON objects.",
      [{ role: "user", content: prompt }],
      undefined,
      false,
      "evaluation"
    );

    try {
      // Find JSON block if the model wrapped it in markdown code blocks
      const jsonMatch = resText.match(/\{[\s\S]*\}/);
      const cleaned = jsonMatch ? jsonMatch[0] : resText;
      return JSON.parse(cleaned) as EvaluationResult;
    } catch (e) {
      console.error("Failed to parse JSON from response:", resText, e);
      return {
        decision: "pass",
        internal_reasoning: "Failed to parse JSON response from LLM.",
        opening_message: "",
      };
    }
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export interface UserReviewResult {
  content: string;
  sentiment: string;
  rating: number;
  badges: string[];
  is_anonymous: boolean;
  anonymous_alias: string;
}

// Extracts the first balanced JSON object from a raw LLM response, tolerating
// surrounding prose and markdown code fences (hardens the old greedy brace regex,
// which broke whenever the model wrapped its output in ```json fences plus commentary).
// Scans every balanced {...} span from left to right and returns the first one that
// actually parses as JSON, skipping over brace-y prose fragments in between.
function extractJsonObject(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/```(?:json)?/gi, "");

  let searchFrom = 0;
  while (searchFrom < cleaned.length) {
    const start = cleaned.indexOf("{", searchFrom);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end !== -1) {
      const candidate = cleaned.slice(start, end + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // Not valid JSON — skip past this span and try the next balanced object
        searchFrom = end + 1;
        continue;
      }
    }
    break; // No balanced closing brace found from here on
  }

  // Unbalanced (e.g. truncated output): fall back to the original greedy outer-brace match
  const greedy = cleaned.match(/\{[\s\S]*\}/);
  return greedy ? greedy[0] : null;
}

export async function generateUserReview(params: {
  characterName: string;
  privatePersona: string;
  publicBio: string;
  userName: string;
  triggerReason: string;
  chatTranscript: string;
  profileId?: string;
  characterId?: string;
}): Promise<UserReviewResult> {
  const { characterName, privatePersona, publicBio, userName, triggerReason, chatTranscript, profileId, characterId } = params;

  // Gossip master switch: when the feature is toggled off, no new reviews are
  // generated anywhere (milestones, ghosting checks, unmatch post-mortems, and
  // manual triggers). Missing key = enabled for backward compatibility.
  const gossipEnabled = await getSetting("gossip_enabled");
  if (gossipEnabled === "false") {
    throw new Error("The Gossip feature is turned off (toggle it back on in the Gossip tab or Manager → Global Settings).");
  }

  // Retrieve badges catalog from system settings
  const badgesSetting = await prisma.systemSetting.findUnique({
    where: { key: "gossip_badges_catalog" },
  });
  let availableBadgesList = "Great Banter, Dry Texter, Slow Replies, Flirtatious, Wholesome Vibe, Ghoster, Praise Motivated, Banter Brat, Dominant Energy, Submissive Lean";
  if (badgesSetting?.value) {
    try {
      const parsed = JSON.parse(badgesSetting.value);
      if (Array.isArray(parsed)) {
        availableBadgesList = parsed.map((b: any) => `${b.emoji || ""} ${b.name}`).join(", ");
      }
    } catch (e) {}
  }

  const promptTemplate = await getSetting("prompt_gossip_review");
  const fallbackPrompt = `You are roleplaying as {character_name}. You are posting on a private, anonymous peer dating community board ("Community Dating Tea & Reviews").
You are writing a candid, unfiltered review and gossip post about your recent dating interactions with human user "{user_name}".

Your Private Persona:
{private_persona}

Your Public Bio:
{public_bio}

Trigger Context: {trigger_reason}

Recent Conversation History with {user_name}:
{chat_transcript}

Available Badges / Tags you can choose from (choose 1 to 4 relevant tags):
{available_badges}

Instructions:
1. Stay authentic to your personality and opinions of {user_name}.
2. Tone: casual, frank, relatable online forum post (slang, candid observations, praise, constructive warnings, or spicy tea).
3. If trigger is unmatch or delay, reflect honestly on how it made you feel.
4. Decide if you want to post anonymously (with a fun alias like "Anonymous Matcha Addict", "Girl in West Village") or under your real name ({character_name}).
5. Select a rating (1 to 5 stars) and a sentiment classification.

Respond strictly in JSON format:
{
  "content": "2-4 sentences of authentic forum post text sharing your review, gossip, or tea",
  "sentiment": "green_flag" | "red_flag" | "tea_spill" | "kink_friendly" | "neutral" | "wholesome",
  "rating": 1 to 5,
  "badges": ["Badge 1", "Badge 2"],
  "is_anonymous": true,
  "anonymous_alias": "e.g. Anonymous Bookworm or your name"
}`;

  const currentDateTime = getCurrentDateTimeString();
  const templateToUse = promptTemplate || fallbackPrompt;
  const prompt = templateToUse
    .replace(/{character_name}/g, characterName)
    .replace(/{private_persona}/g, privatePersona)
    .replace(/{public_bio}/g, publicBio || "")
    .replace(/{user_name}/g, userName)
    .replace(/{trigger_reason}/g, triggerReason)
    .replace(/{chat_transcript}/g, chatTranscript)
    .replace(/{available_badges}/g, availableBadgesList)
    .replace(/{current_time}/g, currentDateTime);

  // Board awareness: when profile/character context is provided, show the writer the posts
  // currently visible on the board — including their own (labeled as theirs, even if anonymous
  // or pushed out of the feed window by newer posts) — so new posts stay consistent with
  // previous aliases/opinions and reference the ongoing community discussion.
  let boardContext = "";
  if (profileId && characterId) {
    try {
      const others = await prisma.userReview.findMany({
        where: { profileId, characterId: { not: characterId } },
        orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
        take: 5,
      });
      const own = await prisma.userReview.findMany({
        where: { profileId, characterId },
        orderBy: [{ createdAt: "desc" }],
        take: 3,
      });
      const boardLines = [...others, ...own]
        .map((r) => {
          const author = r.characterId === characterId
            ? r.isAnonymous
              ? `YOU (your own post, published anonymously as "${r.anonymousAlias || "Anonymous"}")`
              : "YOU (your own post, published under your real name)"
            : r.isAnonymous
              ? `Anonymous reviewer (${r.anonymousAlias || "Anonymous"})`
              : "A named community member";
          return `- [${r.rating}/5 ⭐ | ${r.sentiment}] ${author}: "${r.content}"`;
        })
        .join("\n");
      if (boardLines) {
        boardContext = `\n\nCurrent posts on the board about ${userName}:\n${boardLines}\nStay consistent with any of your own posts above (same alias, same opinions). You may reference the ongoing discussion, but do not copy existing posts.`;
      }
    } catch (e) {}
  }

  // Two-attempt generation with hardened JSON extraction. On total failure we THROW instead of
  // silently storing a canned placeholder post, so callers can surface or skip the real error.
  const strictJsonNote = "\n\nIMPORTANT: Reply with ONLY the raw JSON object itself — no markdown code fences, no commentary before or after it.";

  try {
    let parsed: any = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const rawRes = await callLLM(
          attempt === 0
            ? "You are a helpful assistant that always outputs strictly valid JSON matching the requested schema."
            : "You are a helpful assistant that always outputs strictly valid JSON matching the requested schema. Your previous reply was not parsable, so output ONLY the raw JSON object.",
          [{ role: "user", content: prompt + boardContext + (attempt > 0 ? strictJsonNote : "") }],
          undefined,
          false,
          "gossip"
        );

        const jsonCandidate = extractJsonObject(rawRes);
        if (!jsonCandidate) {
          throw new Error(`No parsable JSON object in LLM reply (raw preview: ${rawRes.slice(0, 200) || "<empty response>"})`);
        }

        const candidate = JSON.parse(jsonCandidate);
        if (!candidate || typeof candidate.content !== "string" || !candidate.content.trim()) {
          throw new Error("LLM returned JSON without usable review content.");
        }

        parsed = candidate;
      } catch (attemptErr) {
        lastError = attemptErr;
        parsed = null;
      }
    }

    if (!parsed) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Unknown gossip generation error"));
    }

    return {
      content: parsed.content,
      sentiment: String(parsed.sentiment || "neutral"),
      rating: typeof parsed.rating === "number" ? Math.max(1, Math.min(5, Math.round(parsed.rating))) : 3,
      badges: Array.isArray(parsed.badges) ? parsed.badges.map((b: any) => String(b)) : ["Active User"],
      is_anonymous: parsed.is_anonymous !== false,
      anonymous_alias: String(parsed.anonymous_alias || `${characterName.slice(0, 1)}... (Anonymous)`),
    };
  } catch (err) {
    console.error(`Failed to generate gossip review for ${characterName}:`, err);
    throw err instanceof Error ? err : new Error(String(err ?? "Unknown gossip generation error"));
  }
}


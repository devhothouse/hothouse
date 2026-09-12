// =========================================================
// AI IMAGE GENERATION PROVIDER DISPATCH (server-only: database + network)
// ---------------------------------------------------------
// Central image-generation entry point, mirroring the TTS provider
// registry (src/lib/tts.ts). Used by:
//   - /api/portraits/generate  (Use 1: AI-generated portraits)
//   - /api/portraits/assign    (when portrait_assign_generate_enabled = true)
//   - /api/chat                (Use 2: [GENERATE_IMAGE: ...] tag trigger)
//   - /api/image-gen/test      (Test button in the Manager tab)
//
// Backward compatibility: a blank, missing, or unrecognized
// `image_gen_provider` setting means the feature is FULLY disabled —
// every caller treats that state as "off" and pre-existing behavior
// is byte-identical.
// =========================================================
import { prisma } from "./db";
import fs from "fs";
import path from "path";

export type ImageGenProvider = "none" | "pollinations" | "openai" | "custom";

export function normalizeImageGenProvider(raw: string | null | undefined): ImageGenProvider {
  const v = (raw || "").trim().toLowerCase();
  if (v === "pollinations" || v === "openai" || v === "custom") return v;
  return "none";
}

export interface ImageGenerationResult {
  image: Buffer;
  contentType: string;
}

async function getSetting(key: string): Promise<string> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key },
  });
  return setting?.value ?? "";
}

// Sniffs the real image type from magic bytes so saved files always get a
// correct extension regardless of what the provider's content-type header says.
function detectImageMime(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  return "image/png";
}

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

// ======================================================================
// Pollinations (free, keyless) — GET image endpoint.
// ======================================================================
async function generateWithPollinations(prompt: string): Promise<ImageGenerationResult> {
  const model = (await getSetting("image_gen_model")).trim() || "flux";
  const width = parseInt(await getSetting("image_gen_width"), 10) || 768;
  const height = parseInt(await getSetting("image_gen_height"), 10) || 1024;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&model=${encodeURIComponent(model)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Pollinations Error ${response.status}: ${err}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("Pollinations returned an empty image.");
  return { image: buffer, contentType: response.headers.get("content-type") || detectImageMime(buffer) };
}

// ======================================================================
// OpenAI / OpenAI-compatible (covers official OpenAI plus self-hosted
// servers exposing /images/generations). Key optional when a custom
// Base URL is configured — same convention as the TTS/LLM providers.
// Accepts both b64_json and url responses (model-dependent).
// ======================================================================
function isOpenAiOfficialBase(baseUrl: string): boolean {
  return !baseUrl || /^https:\/\/api\.openai\.com/i.test(baseUrl);
}

async function generateWithOpenAiCompatible(prompt: string): Promise<ImageGenerationResult> {
  const rawBase = (await getSetting("image_gen_openai_base_url")).trim();
  const apiKey = (await getSetting("image_gen_openai_api_key")).trim();
  if (!apiKey && isOpenAiOfficialBase(rawBase)) {
    throw new Error("OpenAI Image API Key is not configured. Add it in the Manager tab → Image Generation (or set a custom Base URL for a local OpenAI-compatible server).");
  }
  const model = (await getSetting("image_gen_model")).trim() || "gpt-image-1";
  const size = (await getSetting("image_gen_openai_size")).trim() || "1024x1536";
  const base = rawBase || "https://api.openai.com/v1";
  const endpoint = `${base.replace(/\/+$/, "")}/images/generations`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  // No response_format parameter: gpt-image-1 rejects it (always returns
  // b64_json) while dall-e models default to url — both shapes handled below.
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, prompt, n: 1, size }),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI-compatible Image Error ${response.status}: ${err}`);
  }
  const data = await response.json();
  const item = data?.data?.[0];
  if (item?.b64_json) {
    const buffer = Buffer.from(item.b64_json, "base64");
    return { image: buffer, contentType: detectImageMime(buffer) };
  }
  if (item?.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`Failed to download the generated image from its URL (${imgRes.status}).`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    return { image: buffer, contentType: imgRes.headers.get("content-type") || detectImageMime(buffer) };
  }
  throw new Error("OpenAI-compatible image response contained neither b64_json nor url.");
}

// ======================================================================
// Custom HTTP Bridge — the user-defined provider, directly analogous to
// the custom TTS bridge: URL/method/body template with {prompt}/{model}
// placeholders and three response modes. Same safe-substitution
// philosophy: the body template is parsed as JSON FIRST, then
// placeholders are substituted inside string values, so special
// characters in the prompt can never break the JSON structure.
// ======================================================================
function substituteInObject(obj: any, values: Record<string, string>): any {
  if (typeof obj === "string") {
    let out = obj;
    for (const [k, v] of Object.entries(values)) out = out.split(`{${k}}`).join(v);
    return out;
  }
  if (Array.isArray(obj)) return obj.map((item) => substituteInObject(item, values));
  if (obj && typeof obj === "object") {
    const copy: any = {};
    for (const [k, v] of Object.entries(obj)) copy[k] = substituteInObject(v, values);
    return copy;
  }
  return obj;
}

function readJsonField(data: any, dottedPath: string): any {
  return dottedPath.split(".").reduce((acc: any, part: string) => (acc == null ? acc : acc[part]), data);
}

async function generateWithCustom(prompt: string, images?: string[]): Promise<ImageGenerationResult> {
  const urlTemplate = (await getSetting("image_gen_custom_url")).trim();
  if (!urlTemplate) throw new Error("Custom image bridge URL is not configured. Add it in the Manager tab → Image Generation.");
  const method = ((await getSetting("image_gen_custom_method")).trim() || "POST").toUpperCase();
  const model = (await getSetting("image_gen_model")).trim();
  // Image References (advanced): resolved local image paths are exposed to the
  // bridge as JSON arrays — {image_paths} (app-relative), {image_urls} (absolute
  // URLs built on image_gen_refs_app_origin, ideal for local ComfyUI/SD workflow
  // nodes) and {image_data_uris} (base64 data URIs). Empty array when no refs.
  const refList = (images || []).filter((p) => typeof p === "string" && p.startsWith("/"));
  const origin = ((await getSetting("image_gen_refs_app_origin")).trim() || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const values: Record<string, string> = {
    prompt,
    model,
    image_paths: JSON.stringify(refList),
    image_urls: JSON.stringify(refList.map((p) => `${origin}${p}`)),
    image_data_uris: JSON.stringify(
      refList
        .map((p) => {
          try {
            const buffer = fs.readFileSync(path.join(process.cwd(), "public", p.replace(/^\/+/, "")));
            return `data:${detectImageMime(buffer)};base64,${buffer.toString("base64")}`;
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    ),
  };
  const url = method === "GET" ? substituteInObject(urlTemplate, values) : urlTemplate;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const headersSetting = (await getSetting("image_gen_custom_headers")).trim();
  if (headersSetting) {
    try {
      const parsed = JSON.parse(headersSetting);
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) headers[k] = substituteInObject(v, values);
      }
    } catch {
      console.warn("image_gen_custom_headers is not valid JSON — ignoring headers.");
    }
  }

  let response: Response;
  if (method === "GET") {
    response = await fetch(url, { method: "GET", headers });
  } else {
    const bodyTemplate = (await getSetting("image_gen_custom_body_template")).trim() || JSON.stringify({ prompt: "{prompt}", model: "{model}" });
    let body: string;
    try {
      body = JSON.stringify(substituteInObject(JSON.parse(bodyTemplate), values));
    } catch (e: any) {
      throw new Error(`image_gen_custom_body_template is not valid JSON: ${e.message}`);
    }
    response = await fetch(url, { method: "POST", headers, body });
  }
  if (!response.ok) {
    const err = await response.text().catch(() => response.statusText);
    throw new Error(`Custom Image Bridge Error ${response.status}: ${err}`);
  }

  const responseMode = (await getSetting("image_gen_custom_response_mode")).trim() || "bytes";
  const fieldPath = (await getSetting("image_gen_custom_response_field")).trim();
  if (responseMode === "bytes") {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) throw new Error("Custom bridge returned an empty response body.");
    return { image: buffer, contentType: response.headers.get("content-type") || detectImageMime(buffer) };
  }
  const data = await response.json();
  const value = fieldPath ? readJsonField(data, fieldPath) : undefined;
  if (value == null) throw new Error(`Custom bridge response JSON did not contain the field "${fieldPath || "(empty)"}".`);
  if (responseMode === "base64_field") {
    const buffer = Buffer.from(String(value), "base64");
    return { image: buffer, contentType: detectImageMime(buffer) };
  }
  const imgRes = await fetch(String(value));
  if (!imgRes.ok) throw new Error(`Failed to download the generated image from its URL (${imgRes.status}).`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { image: buffer, contentType: imgRes.headers.get("content-type") || detectImageMime(buffer) };
}

// ======================================================================
// Dispatch + feature helpers
// ======================================================================
export async function isImageGenConfigured(): Promise<boolean> {
  return normalizeImageGenProvider(await getSetting("image_gen_provider")) !== "none";
}

export async function generateImage(prompt: string, images?: string[]): Promise<ImageGenerationResult> {
  const provider = normalizeImageGenProvider(await getSetting("image_gen_provider"));
  if (provider === "none") throw new Error("AI Image Generation is disabled. Pick a provider in the Manager tab → Image Generation.");
  if (provider === "pollinations") return generateWithPollinations(prompt);
  if (provider === "openai") return generateWithOpenAiCompatible(prompt);
  return generateWithCustom(prompt, images);
}

// Canonical default prompt templates (fallbacks used when the editable
// settings are missing or emptied — the seeded defaults match these).
export const DEFAULT_PROMPT_IMAGE_GEN_PORTRAIT = `A realistic, natural dating-app profile photo of {character_name} ({gender}).

About them (from their private personality — reflect this in vibe, styling and expression, do not quote it):
{persona_summary}

Personality traits to visually convey: {top_traits}.

Style requirements: photorealistic, natural lighting, head-and-shoulders or waist-up portrait, shallow depth of field, authentic and appealing rather than overly retouched. The photo must look like a real photo taken for a dating profile. No text, no watermarks, no borders.`;

export const DEFAULT_PROMPT_CHAT_IMAGE_GEN = `[IMAGE GENERATION ABILITY]
You can generate and send a picture at any time by including the tag [GENERATE_IMAGE: detailed image description] anywhere in your reply. Write the description in English and be visually specific: subject, pose, outfit, setting, lighting, mood (for example your own selfie, a photo of your pet, a scene from your day). Describe your own appearance naturally within the description when relevant (hair, style, look) so the picture fits you. Rules: at most one generated image per reply; use it only when it fits the conversation naturally (for example when someone asks to see a photo, or when sharing a moment makes sense); the tag itself is removed from the message the user actually sees, so make sure your reply still reads naturally without it. If your system prompt also describes image references you may attach, follow those instructions.`;

export const DEFAULT_PROMPT_CHAT_IMAGE_GEN_REFS = `[IMAGE REFERENCES]
Additionally, when it genuinely helps (for example to keep your appearance consistent), you may attach reference images to a generation by listing them after a "|" at the end of the tag: [GENERATE_IMAGE: description | self, user, chat]. Available keywords: "self" = your own profile picture; "user" = the user's profile picture (only if the app lets you see it); "chat" = pictures that have appeared in this conversation. Combine as many as you like ("self, user, chat") — the image backend receives them alongside your description. If the configured backend does not support references, they are silently ignored, so always write the description so the image works on its own.`;

export const DEFAULT_PROMPT_IMAGE_PROMPT_WRITER = `You are preparing a visual description for an image generation engine. Below is the private persona of a dating-app character named {character_name} ({gender}). The persona contains roleplay instructions and personality writing; extract ONLY what is relevant to what this person physically looks like, and write a concise visual description an image generator can use: apparent age, face and body features, hair (color, length, style), typical clothing and style, and overall vibe. 2-4 sentences, plain descriptive English, no name, no personality traits, no roleplay instructions, no markdown.
{avatar_image}
Private persona of {character_name}:
{persona}

Respond with the visual description text only.`;

// Resolves the {persona_summary} value for image generation: the character's
// AI-written visual description when present (Image Prompt Writer), otherwise
// the top slice of the private persona (length configurable, 0 = send none).
async function getVisualDigest(character: any): Promise<string> {
  if (character.imageGenPrompt && character.imageGenPrompt.trim()) return character.imageGenPrompt.trim();
  const lengthSetting = await prisma.systemSetting.findUnique({ where: { key: "image_gen_persona_excerpt_length" } });
  const excerptLength = parseInt(lengthSetting?.value ?? "800", 10);
  if (!Number.isFinite(excerptLength) || excerptLength <= 0) return "";
  return (character.privatePersona || "").slice(0, excerptLength);
}

// ======================================================================
// Use 1: generate a portrait for one character and assign it.
// Mirrors /api/portraits/assign's three-step write-back:
//   1. insert a Portrait row (processed + in_use)
//   2. release the character's previous library portrait, update Character.avatar
//   3. mirror the avatar into the physical persona JSON file
// ======================================================================
export async function generateAndAssignPortrait(character: any): Promise<{ filepath: string; prompt: string }> {
  // 1. Build the prompt from the editable template
  const templateSetting = await prisma.systemSetting.findUnique({ where: { key: "prompt_image_gen_portrait" } });
  const template = templateSetting?.value || DEFAULT_PROMPT_IMAGE_GEN_PORTRAIT;
  let topTraits = "";
  try {
    const tags = typeof character.tags === "string" ? JSON.parse(character.tags) : (character.tags || {});
    topTraits = Object.entries(tags)
      .filter(([, v]) => typeof v === "number")
      .sort((a: any, b: any) => (b[1] as number) - (a[1] as number))
      .slice(0, 5)
      .map(([k, v]) => `${k} (${v})`)
      .join(", ");
  } catch {
    topTraits = "";
  }
  const prompt = template
    .replace(/{character_name}/g, character.name || "")
    .replace(/{gender}/g, character.gender || "")
    .replace(/{persona_summary}/g, await getVisualDigest(character))
    .replace(/{top_traits}/g, topTraits || "varied interests");

  // 2. Generate & save locally (local-first: never hotlink third-party URLs)
  const result = await generateImage(prompt);
  const ext = extForMime(result.contentType);
  const dir = path.join(process.cwd(), "public", "portrait-library", "generated");
  fs.mkdirSync(dir, { recursive: true });
  const filename = `gen-${character.id}-${Date.now()}.${ext}`;
  const filepath = `/portrait-library/generated/${filename}`;
  fs.writeFileSync(path.join(dir, filename), result.image);

  // 3. Register the Portrait row (already processed and in use)
  await (prisma as any).portrait.create({
    data: {
      filepath,
      tags: JSON.stringify({ gender: (character.gender || "").toLowerCase(), source: "ai_generated" }),
      customTags: "[]",
      description: `AI-generated portrait for ${character.name}. Prompt: ${prompt.slice(0, 250)}`,
      in_use: true,
      processed: true,
    },
  });

  // 4. Release the character's previous library portrait (same as the picker)
  if (character.avatar) {
    await (prisma as any).portrait.updateMany({
      where: { filepath: character.avatar },
      data: { in_use: false },
    });
  }

  // 5. Assign on the character (DB) and mirror into the persona JSON file
  await prisma.character.update({
    where: { id: character.id },
    data: { avatar: filepath },
  });
  const filePath = path.join(process.cwd(), "AIC personas", `${character.id}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      fileData.avatar = filepath;
      fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), "utf-8");
    } catch (fileErr: any) {
      console.error(`Error saving generated avatar to character JSON file ${filePath}:`, fileErr);
    }
  }

  return { filepath, prompt };
}

// ======================================================================
// Use 2: process [GENERATE_IMAGE: ...] tags in an assistant chat reply.
// The tag is stripped from the visible reply, the described image is
// generated, saved locally under public/uploads/generated/, and appended
// as markdown. Because the markdown references a local file, the existing
// multimodal pipeline automatically shows it inline to vision-capable
// models on later turns. Failures degrade gracefully (reply sent without
// the image) and never break the chat flow.
// ======================================================================
export interface ChatImageTagContext {
  characterId?: string;
  characterName?: string;
  visualDescription?: string; // AI-written appearance description (or persona-excerpt fallback)
  selfAvatar?: string; // The character's profile image path
  userAvatar?: string; // The active user's profile image path
  chatImagePaths?: string[]; // Local image paths already present in the recent chat history
}

export async function processChatImageTags(replyText: string, context: ChatImageTagContext = {}): Promise<string> {
  const match = replyText.match(/\[GENERATE_IMAGE:\s*([^\]]+)\]/i);
  if (!match) return replyText;
  const rawBody = match[1].trim();
  // Optional image references after a "|": [GENERATE_IMAGE: description | self, user, chat]
  const [descriptionPart, refsPart] = rawBody.split("|");
  const description = descriptionPart.trim();
  // Strip every tag occurrence from the visible reply
  let cleaned = replyText.replace(/\[GENERATE_IMAGE:\s*[^\]]+\]/gi, "").trim();

  // Resolve image references (advanced feature, image_gen_refs_enabled): keywords
  // map to local image paths; unresolved ones are dropped; results are deduped and
  // capped by image_gen_refs_max_count. Providers without reference support
  // simply never receive them.
  let refImages: string[] = [];
  const refsEnabledSetting = await prisma.systemSetting.findUnique({ where: { key: "image_gen_refs_enabled" } });
  if (refsPart && refsPart.trim() && refsEnabledSetting?.value === "true") {
    const allowUserProfile = (await prisma.systemSetting.findUnique({ where: { key: "image_gen_refs_allow_user_profile" } }))?.value === "true";
    const maxCountSetting = await prisma.systemSetting.findUnique({ where: { key: "image_gen_refs_max_count" } });
    const maxCount = parseInt(maxCountSetting?.value ?? "4", 10) || 4;
    const keywords = refsPart.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
    const resolved: string[] = [];
    for (const keyword of keywords) {
      if (keyword === "self" && context.selfAvatar && context.selfAvatar.startsWith("/")) resolved.push(context.selfAvatar);
      else if (keyword === "user" && allowUserProfile && context.userAvatar && context.userAvatar.startsWith("/")) resolved.push(context.userAvatar);
      else if (keyword === "chat") resolved.push(...(context.chatImagePaths || []));
    }
    refImages = Array.from(new Set(resolved)).slice(0, Math.max(1, maxCount));
  }

  try {
    // Give the generator the character's visual identity so text-only providers
    // can still produce images that resemble the character.
    const appearance = (context.visualDescription || "").trim();
    const fullPrompt = appearance
      ? `Character appearance (for consistency): ${appearance}\n\nImage to generate: ${description}`
      : description;
    const result = await generateImage(fullPrompt, refImages);
    const ext = extForMime(result.contentType);
    const dir = path.join(process.cwd(), "public", "uploads", "generated");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `gen-chat-${Date.now()}-${Math.floor(Math.random() * 100000)}.${ext}`;
    const filepath = `/uploads/generated/${filename}`;
    fs.writeFileSync(path.join(dir, filename), result.image);
    cleaned = `${cleaned}\n\n![generated image](${filepath})`.trim();
  } catch (err: any) {
    console.error("Chat image generation failed (reply sent without the image):", err);
  }
  return cleaned;
}






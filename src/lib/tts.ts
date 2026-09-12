// =========================================================
// TTS PROVIDER DISPATCH (server-only: database + network)
// ---------------------------------------------------------
// Central synthesis entry point used by /api/voice. Every
// provider returns raw audio bytes plus a content type, so the
// client playback path is provider-agnostic.
//
// Backward compatibility: ElevenLabs is the default provider.
// A blank, missing, or unrecognized `tts_provider` setting
// resolves to ElevenLabs and reproduces the exact pre-existing
// request behavior (same keys, model, and voice settings).
// =========================================================
import { prisma } from "./db";
import {
  BUILTIN_TTS_CATALOGS,
  TTS_PROVIDER_CATALOG_KEYS,
  VoiceOption,
  normalizeTtsProvider,
  parseVoiceCatalog,
} from "./voices";

export { normalizeTtsProvider };

const DEFAULT_OPENAI_TTS_BASE = "https://api.openai.com/v1";

export interface TtsSynthesisResult {
  audio: Buffer;
  contentType: string;
}

async function getSetting(key: string): Promise<string> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key },
  });
  return setting?.value ?? "";
}

// Reads the active provider's editable voice catalog (falling back to the
// built-in default library when the setting is missing, invalid, or empty —
// exactly the fallback behavior the ElevenLabs catalog has always had).
export async function getActiveVoiceCatalog(): Promise<VoiceOption[]> {
  const provider = normalizeTtsProvider(await getSetting("tts_provider"));
  const catalogSetting = await prisma.systemSetting.findUnique({
    where: { key: TTS_PROVIDER_CATALOG_KEYS[provider] },
  });
  if (catalogSetting?.value) {
    const parsed = parseVoiceCatalog(catalogSetting.value);
    if (parsed.length > 0) return parsed;
  }
  return BUILTIN_TTS_CATALOGS[provider];
}

// Joins a base URL with a path, tolerating trailing slashes.
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

// ======================================================================
// ElevenLabs (default) — identical request behavior to the original
// hardwired /api/voice implementation.
// ======================================================================
async function synthesizeElevenLabs(text: string, voiceId: string): Promise<TtsSynthesisResult> {
  const apiKey = await getSetting("elevenlabs_api_key");
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Manager tab → TTS Settings.");
  }
  const modelId = (await getSetting("elevenlabs_model_id")) || "eleven_multilingual_v2";
  const stabilitySetting = await getSetting("elevenlabs_stability");
  const similaritySetting = await getSetting("elevenlabs_similarity_boost");
  const styleSetting = await getSetting("elevenlabs_style");
  const useSpeakerBoostSetting = await getSetting("elevenlabs_use_speaker_boost");

  const stability = stabilitySetting ? parseFloat(stabilitySetting) : 0.5;
  const similarity_boost = similaritySetting ? parseFloat(similaritySetting) : 0.75;
  const style = styleSetting ? parseFloat(styleSetting) : 0.0;
  const use_speaker_boost = useSpeakerBoostSetting ? useSpeakerBoostSetting === "true" : true;

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability,
        similarity_boost,
        style,
        use_speaker_boost,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs Error: ${err}`);
  }

  return { audio: Buffer.from(await response.arrayBuffer()), contentType: "audio/mpeg" };
}

// ======================================================================
// OpenAI / OpenAI-compatible (covers self-hosted OpenAI-shaped TTS
// servers such as Kokoro-FastAPI, chatterbox-tts-api, Speaches,
// openedai-speech, AllTalk v2 — any /v1/audio/speech endpoint).
// API key is optional when a custom (non-OpenAI) base URL is configured,
// so keyless local servers work out of the box.
// ======================================================================
function isOpenAiOfficialBase(baseUrl: string): boolean {
  return !baseUrl || /^https:\/\/api\.openai\.com/i.test(baseUrl);
}

async function synthesizeOpenAiCompatible(text: string, voiceId: string): Promise<TtsSynthesisResult> {
  const rawBase = (await getSetting("tts_openai_base_url")).trim();
  const apiKey = (await getSetting("tts_openai_api_key")).trim();
  if (!apiKey && isOpenAiOfficialBase(rawBase)) {
    throw new Error("OpenAI TTS API Key is not configured. Please add it in the Manager tab → TTS Settings (or set a custom Base URL for a local OpenAI-compatible server).");
  }
  const base = rawBase.replace(/\/+$/, "") || DEFAULT_OPENAI_TTS_BASE;
  const model = (await getSetting("tts_openai_model")).trim() || "gpt-4o-mini-tts";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(joinUrl(base, "audio/speech"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: text,
      voice: voiceId,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI-compatible TTS Error: ${err}`);
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "audio/mpeg",
  };
}

// ======================================================================
// Google Cloud Text-to-Speech (API-key REST). The language code is
// derived from the voice name prefix (e.g. "en-US-Neural2-F" → "en-US").
// ======================================================================
async function synthesizeGoogle(text: string, voiceId: string): Promise<TtsSynthesisResult> {
  const apiKey = (await getSetting("tts_google_api_key")).trim();
  if (!apiKey) {
    throw new Error("Google Cloud TTS API Key is not configured. Please add it in the Manager tab → TTS Settings.");
  }
  const segments = voiceId.split("-");
  const languageCode = segments.length >= 3 ? segments.slice(0, 2).join("-") : "en-US";

  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode, name: voiceId },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Cloud TTS Error: ${err}`);
  }

  const json = await response.json();
  const audioContent = json?.audioContent;
  if (!audioContent || typeof audioContent !== "string") {
    throw new Error("Google Cloud TTS returned no audio content.");
  }
  return { audio: Buffer.from(audioContent, "base64"), contentType: "audio/mpeg" };
}

// ======================================================================
// Cartesia (Sonic family). POST /tts/bytes → raw audio bytes.
// ======================================================================
async function synthesizeCartesia(text: string, voiceId: string): Promise<TtsSynthesisResult> {
  const apiKey = (await getSetting("tts_cartesia_api_key")).trim();
  if (!apiKey) {
    throw new Error("Cartesia API Key is not configured. Please add it in the Manager tab → TTS Settings.");
  }
  const model = (await getSetting("tts_cartesia_model")).trim() || "sonic-3";

  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": "2026-08-14",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: model,
      transcript: text,
      voice: { mode: "id", id: voiceId },
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Cartesia TTS Error: ${err}`);
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "audio/mpeg",
  };
}

// ======================================================================
// Fish Audio (S2 family). POST /v1/tts → chunked raw audio bytes.
// The model rides in a request header; the voice is `reference_id`.
// ======================================================================
async function synthesizeFish(text: string, voiceId: string): Promise<TtsSynthesisResult> {
  const apiKey = (await getSetting("tts_fish_api_key")).trim();
  if (!apiKey) {
    throw new Error("Fish Audio API Key is not configured. Please add it in the Manager tab → TTS Settings.");
  }
  const model = (await getSetting("tts_fish_model")).trim() || "s2-pro";

  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      model,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      reference_id: voiceId,
      format: "mp3",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Fish Audio TTS Error: ${err}`);
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "audio/mpeg",
  };
}

// ======================================================================
// Custom Bridge — a fully user-defined HTTP call, so ANY self-hosted
// TTS model (Supertonic, VoxCPM, Qwen-TTS, …) or hosted API can be
// hooked up without touching app code.
//
// Settings:
//   tts_custom_url          Endpoint URL. For GET, {text} inside the URL is
//                           replaced with the URL-encoded text. For POST the
//                           URL is used as-is.
//   tts_custom_method       "POST" (default) or "GET".
//   tts_custom_headers      JSON object of extra request headers.
//   tts_custom_body         JSON body template. {text}, {voice} and {model}
//                           placeholders inside any string value are
//                           substituted safely (values are replaced after
//                           parsing, so special characters can't break JSON).
//   tts_custom_model        Value substituted into {model} placeholders.
//   tts_custom_response_mode  "raw_audio" (default) | "json_base64" | "json_url"
//   tts_custom_json_field   Dotted path to the audio data inside the JSON
//                           response (e.g. "audio_base64" or "data.url").
// ======================================================================
function fillTemplate(value: any, text: string, voiceId: string, model: string): any {
  if (typeof value === "string") {
    return value
      .replace(/\{text\}/g, text)
      .replace(/\{voice\}/g, voiceId)
      .replace(/\{model\}/g, model);
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplate(v, text, voiceId, model));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, text, voiceId, model)]));
  }
  return value;
}

// Reads a dotted path ("data.audio") out of a parsed JSON response.
function readJsonPath(obj: any, path: string): any {
  return path.split(".").reduce((acc: any, segment: string) => (acc == null ? undefined : acc[segment]), obj);
}

async function synthesizeCustom(text: string, voiceId: string): Promise<TtsSynthesisResult> {
  const urlTemplate = (await getSetting("tts_custom_url")).trim();
  if (!urlTemplate) {
    throw new Error("Custom TTS Bridge URL is not configured. Please set it in the Manager tab → TTS Settings.");
  }
  const method = ((await getSetting("tts_custom_method")).trim().toUpperCase() || "POST") === "GET" ? "GET" : "POST";
  const model = (await getSetting("tts_custom_model")).trim();
  const responseMode = (await getSetting("tts_custom_response_mode")).trim() || "raw_audio";
  const jsonField = (await getSetting("tts_custom_json_field")).trim() || "audio";

  let headers: Record<string, string> = { "Content-Type": "application/json" };
  const headersRaw = (await getSetting("tts_custom_headers")).trim();
  if (headersRaw) {
    try {
      const parsedHeaders = fillTemplate(JSON.parse(headersRaw), text, voiceId, model);
      if (parsedHeaders && typeof parsedHeaders === "object") {
        headers = { ...headers, ...Object.fromEntries(Object.entries(parsedHeaders).map(([k, v]) => [k, String(v)])) };
      }
    } catch (e) {
      throw new Error("Custom TTS Bridge headers are not valid JSON. Please fix them in the Manager tab → TTS Settings.");
    }
  }

  let requestUrl = urlTemplate;
  let body: string | undefined;
  if (method === "GET") {
    requestUrl = fillTemplate(urlTemplate, encodeURIComponent(text), voiceId, model);
    delete headers["Content-Type"];
  } else {
    const bodyTemplate = (await getSetting("tts_custom_body")).trim() || '{"input": "{text}", "voice": "{voice}", "model": "{model}"}';
    let parsedBody: any;
    try {
      parsedBody = JSON.parse(bodyTemplate);
    } catch (e) {
      throw new Error("Custom TTS Bridge body template is not valid JSON. Please fix it in the Manager tab → TTS Settings.");
    }
    body = JSON.stringify(fillTemplate(parsedBody, text, voiceId, model));
  }

  const response = await fetch(requestUrl, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Custom TTS Bridge Error: ${err}`);
  }

  if (responseMode === "json_base64" || responseMode === "json_url") {
    const json = await response.json();
    const value = readJsonPath(json, jsonField);
    if (!value || typeof value !== "string") {
      throw new Error(`Custom TTS Bridge: JSON response has no string at "${jsonField}". Check the JSON Field setting.`);
    }
    if (responseMode === "json_base64") {
      return { audio: Buffer.from(value, "base64"), contentType: "audio/mpeg" };
    }
    const audioResponse = await fetch(value);
    if (!audioResponse.ok) {
      throw new Error(`Custom TTS Bridge: failed to download audio URL (${audioResponse.status}).`);
    }
    return {
      audio: Buffer.from(await audioResponse.arrayBuffer()),
      contentType: audioResponse.headers.get("content-type") || "audio/mpeg",
    };
  }

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "audio/mpeg",
  };
}

// Main dispatch: synthesize `text` with the given character voiceId using
// the active TTS provider (ElevenLabs by default).
export async function synthesizeSpeech(text: string, voiceId: string): Promise<TtsSynthesisResult> {
  const provider = normalizeTtsProvider(await getSetting("tts_provider"));
  switch (provider) {
    case "openai":
      return synthesizeOpenAiCompatible(text, voiceId);
    case "google":
      return synthesizeGoogle(text, voiceId);
    case "cartesia":
      return synthesizeCartesia(text, voiceId);
    case "fish":
      return synthesizeFish(text, voiceId);
    case "custom":
      return synthesizeCustom(text, voiceId);
    case "elevenlabs":
    default:
      return synthesizeElevenLabs(text, voiceId);
  }
}


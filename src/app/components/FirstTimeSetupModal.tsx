"use client";

// =========================================================
// FIRST-TIME SETUP MODAL (Roadmap B3)
// ---------------------------------------------------------
// 5-page guided startup wizard, opened from the top-bar
// "Set up Hothouse" button (never auto-shown on launch):
//   1. 18+ acknowledgement gate
//   2. Welcome
//   3. Model Config B (provider/model/key + Test Connection),
//      starter image upload (auto scan + process), optional TTS
//   4. Starting preferences (starter suites, tag picks,
//      trans/futa block variant, Gossip + AIC Network toggles)
//   5. How to get started + Finish (persists everything)
// Everything saved here is editable later in the Manager tab.
// =========================================================

import React, { useState, useEffect, useRef } from "react";
import { X, Sparkles, Upload, ChevronLeft, ChevronRight, Volume2, Image as ImageIcon, Cpu, ShieldAlert, Check } from "lucide-react";
import { safeFetch } from "../page";
import { showToast } from "@/lib/notify";
import { LOCAL_LLM_BASE_URL_PRESETS } from "@/lib/llmTasks";
import { TTS_PROVIDER_IDS, TTS_PROVIDER_LABELS } from "@/lib/voices";

// Per-gender visibility toggles shown on setup page 4 ("may not be everyone's
// cup of tea"). Names MUST match the Master Tags Library (`tags_master`)
// exactly — the visibility filter matches tags case-sensitively (see
// src/lib/masterTags.ts), so a casing mismatch writes an inert entry that no
// generation path ever reads.
const SETUP_TAGS = [
  "magical_being", "werewolf", "vampire", "is_overt_robot", "is_trans", "is_futanari", "is_group_profile",
  "is_manipulative", "is_overt_alien", "is_overt_animal", "demon", "angel",
  "likes_to_have_multiple_partners", "okay_with_partner_having_multiple_partners",
  "historical_setting", "futuristic_setting", "fantasy_setting", "creep",
];

const GENDER_LABELS: Record<string, string> = {
  male: "♂ Male",
  female: "♀ Female",
  nonbinary: "⚥ Non-binary",
};

function FirstTimeSetupModal({ onClose, onFinished }: { onClose: () => void; onFinished: () => void }) {
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({});

  // Page 3: Model Config (Slot B)
  const [provider, setProvider] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [temperature, setTemperature] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Page 3: starter images (upload → scan → process)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [remainingCount, setRemainingCount] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Page 3: TTS (all providers from the TTS registry)
  const [ttsChoice, setTtsChoice] = useState<"enable" | "disable">("disable");
  const [ttsProvider, setTtsProvider] = useState("elevenlabs");
  const [tts, setTts] = useState<Record<string, string>>({});

  // Page 4: preferences
  const [includeMale, setIncludeMale] = useState(true);
  const [includeFemale, setIncludeFemale] = useState(true);
  const [tagVis, setTagVis] = useState<Record<string, Record<string, boolean>>>({});
  const [transYes, setTransYes] = useState(false);
  const [futaYes, setFutaYes] = useState(false);
  const [gossipEnabled, setGossipEnabled] = useState(true);
  const [networkEnabled, setNetworkEnabled] = useState(true);

  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await safeFetch("/api/settings");
      if (data.success && data.settings) {
        const s: Record<string, string> = data.settings || {};
        setSettings(s);
        setProvider(s.model_slot_b_provider || "");
        setModelName(s.model_slot_b_model || "");
        setApiKey(s.model_slot_b_api_key || "");
        setBaseUrl(s.model_slot_b_base_url || "");
        setTemperature(s.model_slot_b_temperature || "");
        setMaxTokens(s.model_slot_b_max_tokens || "");
        setTtsChoice(
          (s.elevenlabs_api_key || s.tts_openai_api_key || s.tts_openai_base_url || s.tts_google_api_key || s.tts_cartesia_api_key || s.tts_fish_api_key || s.tts_custom_url) ? "enable" : "disable"
        );
        setTtsProvider(s.tts_provider || "elevenlabs");
        setTts({
          elevenlabs_api_key: s.elevenlabs_api_key || "",
          elevenlabs_model_id: s.elevenlabs_model_id || "",
          tts_openai_api_key: s.tts_openai_api_key || "",
          tts_openai_model: s.tts_openai_model || "",
          tts_openai_base_url: s.tts_openai_base_url || "",
          tts_google_api_key: s.tts_google_api_key || "",
          tts_cartesia_api_key: s.tts_cartesia_api_key || "",
          tts_cartesia_model: s.tts_cartesia_model || "",
          tts_fish_api_key: s.tts_fish_api_key || "",
          tts_fish_model: s.tts_fish_model || "",
          tts_custom_url: s.tts_custom_url || "",
          tts_custom_method: s.tts_custom_method || "POST",
          tts_custom_model: s.tts_custom_model || "",
          tts_custom_headers: s.tts_custom_headers || "",
          tts_custom_body: s.tts_custom_body || "",
          tts_custom_response_mode: s.tts_custom_response_mode || "raw_audio",
          tts_custom_json_field: s.tts_custom_json_field || "",
        });
        setGossipEnabled(s.gossip_enabled !== "false");
        setNetworkEnabled(s.aic_network_enabled !== "false");
        setIncludeMale(s.starter_suite_include_male !== "false");
        setIncludeFemale(s.starter_suite_include_female !== "false");
        let savedMap: any = {};
        try { savedMap = JSON.parse(s.tags_gender_visibility || "{}") || {}; } catch { savedMap = {}; }
        const init: Record<string, Record<string, boolean>> = {};
        for (const tag of SETUP_TAGS) {
          const entry = savedMap[tag] || {};
          init[tag] = { male: entry.male !== false, female: entry.female !== false, nonbinary: entry.nonbinary !== false };
        }
        setTagVis(init);
        refreshRemainingCount();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRemainingCount = async () => {
    const res = await safeFetch("/api/portraits");
    if (res.success && Array.isArray(res.portraits)) {
      setRemainingCount(res.portraits.filter((p: any) => !p.processed).length);
    }
  };

  const saveSettings = async (payload: Record<string, string>) => {
    const res = await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.success;
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult({ ok: false, msg: "Testing..." });
    const res = await safeFetch("/api/settings/test-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model: modelName, apiKey, temperature, maxTokens, baseUrl }),
    });
    setTesting(false);
    setTestResult(res.success ? { ok: true, msg: res.message || "Connection OK." } : { ok: false, msg: res.error || "Test failed." });
  };

  const uploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0 || isUploading) return;
    setIsUploading(true);
    setUploadNote(null);
    let saved = 0;
    let rejected = 0;
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/portraits/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) saved++; else rejected++;
      } catch {
        rejected++;
      }
    }
    setIsUploading(false);
    setUploadedCount((c) => c + saved);
    if (saved > 0) {
      setUploadNote(`Uploaded ${saved} image(s)${rejected ? `, ${rejected} rejected` : ""}. Now click "Scan & Process" below.`);
      await refreshRemainingCount();
    } else {
      setUploadNote(`Upload failed${rejected ? ` — ${rejected} file(s) rejected (images must be .jpg/.jpeg/.png/.webp)` : ""}.`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const scanLibrary = async () => {
    setIsScanning(true);
    const res = await safeFetch("/api/portraits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
    setIsScanning(false);
    if (!res.success) {
      showToast("Scan failed: " + res.error);
      return false;
    }
    await refreshRemainingCount();
    return true;
  };

  const processUploadedImages = async () => {
    setIsProcessing(true);
    setProcessedCount(0);
    let processed = 0;
    try {
      for (let i = 0; i < 500; i++) {
        const res = await safeFetch("/api/portraits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tag", limit: 1 }),
        });
        if (!res.success) {
          showToast(`Processing stopped: ${res.error}`);
          break;
        }
        if (res.processedCount === 0) break; // nothing left to process
        processed++;
        setProcessedCount(processed);
        await refreshRemainingCount();
      }
      showToast(`Processed ${processed} image(s).`);
    } finally {
      setIsProcessing(false);
    }
  };

  const scanAndProcess = async () => {
    if (await scanLibrary()) await processUploadedImages();
  };

  const savePage3 = async (): Promise<boolean> => {
    const slotIdsRaw = settings.model_slot_ids || "";
    const slotIds = slotIdsRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (!slotIds.includes("B")) slotIds.push("B");
    const payload: Record<string, string> = {
      model_slot_b_provider: provider,
      model_slot_b_model: modelName,
      model_slot_b_api_key: apiKey,
      model_slot_b_temperature: temperature,
      model_slot_ids: slotIds.join(","),
    };
    if (provider === "openai" || provider === "local") payload.model_slot_b_base_url = baseUrl;
    if (maxTokens.trim() !== "") payload.model_slot_b_max_tokens = maxTokens;
    if (ttsChoice === "enable") {
      payload.tts_provider = ttsProvider;
      for (const [k, v] of Object.entries(tts)) payload[k] = v;
    }
    const ok = await saveSettings(payload);
    if (!ok) showToast("Could not save settings — check your connection and try again.");
    return ok;
  };

  const savePage4 = async (): Promise<boolean> => {
    let existing: any = {};
    try { existing = JSON.parse(settings.tags_gender_visibility || "{}") || {}; } catch { existing = {}; }
    for (const tag of SETUP_TAGS) {
      existing[tag] = { ...(existing[tag] || {}), ...tagVis[tag] };
    }
    const variant = transYes && futaYes ? "both" : transYes ? "transonly" : futaYes ? "futaonly" : "neither";
    const ok = await saveSettings({
      tags_gender_visibility: JSON.stringify(existing),
      trans_futa_block_variant: variant,
      gossip_enabled: String(gossipEnabled),
      aic_network_enabled: String(networkEnabled),
    });
    if (!ok) showToast("Could not save preferences — check your connection and try again.");
    return ok;
  };

  const finishSetup = async () => {
    setFinishing(true);
    const res = await safeFetch("/api/setup/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: { first_time_setup_hide_button: "true" },
        starterSuite: { male: includeMale, female: includeFemale },
      }),
    });
    if (res.success) {
      const ss = res.starterSuite;
      if (ss && ss.totalStarters > 0) {
        showToast(`Setup finished. Starter characters: ${ss.enabledCount} active, ${ss.disabledCount} deactivated.`);
      } else {
        showToast("Setup finished — you're ready to go!");
      }
      onFinished();
    } else {
      setFinishing(false);
      showToast("Setup could not be saved: " + res.error);
    }
  };

  const goNext = async () => {
    if (page === 3) {
      setSaving(true);
      const ok = await savePage3();
      setSaving(false);
      if (!ok) return;
    }
    if (page === 4) {
      setSaving(true);
      const ok = await savePage4();
      setSaving(false);
      if (!ok) return;
    }
    setPage((p) => Math.min(5, p + 1));
  };

  const transFutaVariant = transYes && futaYes ? "both" : transYes ? "transonly" : futaYes ? "futaonly" : "neither";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative border border-gray-200 dark:border-gray-700 shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 z-10"
          title="Close setup (nothing is lost — you can reopen it from the top bar)"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Page indicator */}
        <div className="flex items-center gap-1.5 mb-4 pr-8">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={page === n ? "cur" : n} className={`h-1.5 rounded-full transition-all ${page === n ? "w-8 bg-pink-500" : "w-4 bg-gray-200 dark:bg-gray-600"}`} />
          ))}
          <span className="text-[10px] text-gray-400 ml-2 font-bold">Page {page} of 5</span>
        </div>

        {page === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-6 h-6 text-red-500" />
              <h2 className="text-lg font-bold text-red-600 dark:text-red-400">WARNING: ADULT CONTENT</h2>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-200">
              This app contains adult material, including sexually explicit content, nudity, and/or other sensitive subject matter intended strictly for mature audiences (18 years of age or older, or the legal age of majority in your local jurisdiction).
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-300">By using this app, you explicitly acknowledge, warrant, and agree that:</p>
            <ul className="text-sm text-gray-700 dark:text-gray-200 list-disc pl-6 space-y-1">
              <li>You are at least 18 years old (or meet the legal age requirement in your region).</li>
              <li>You are not offended or disturbed by sexually explicit or adult-oriented material.</li>
              <li>Accessing adult content is legal in your local city, state, or country.</li>
              <li>You are accessing this app voluntarily for your own personal use.</li>
            </ul>
            <p className="text-sm font-bold text-gray-800 dark:text-gray-100">
              If you do not meet these criteria, or if viewing adult material is illegal or offensive where you live, please leave immediately.
            </p>
          </div>
        )}

        {page === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-pink-500">Welcome to Hothouse :)</h2>
            <p className="text-sm text-gray-700 dark:text-gray-200">This is an open-source AI-based dating app simulator.</p>
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">If you're a casual user:</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Please go through these quick setup steps and generally follow recommendations if you want this to work with as little hassle as possible.
              </p>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">If you're an advanced user:</p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                If you're familiar with other local-first AI-based roleplay apps or you know what you're doing, you'll still want to go through this setup before you start changing things. Hothouse has a lot of LLM call-based systems that run behind the scenes, and some may work better with different models, but to get started I recommend getting going with a strong, vision-capable model — the next page walks you through picking one.
              </p>
            </div>
          </div>
        )}

        {page === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2"><Cpu className="w-5 h-5 text-pink-500" /> Model Setup (Model Config Slot B)</h2>
              <p className="text-xs text-gray-500 mt-1">
                To get the basic features of the app running, you will need a link to a strong, vision-capable model you're comfortable calling a lot. As of September 2026, I recommend GLM 5.3 Flash (<a href="https://openrouter.ai/z-ai/glm-5.3-flash" target="_blank" rel="noreferrer" className="text-pink-500 underline">openrouter.ai/z-ai/glm-5.3-flash</a>). Specify the provider, model, and API key here — saved to <strong>Model Slot B</strong>. You can always edit this later in the Manager tab; there are extensive options for using a variety of models concurrently for various uses. Most models need to be vision-capable, and generally need to be pretty good. Crappy local models won't be a good fit, but high-quality ones may work well — these don't need to be frontier models. Your mileage may vary.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                If you have never set up an LLM-provider API link before, just search how to do it. It's not difficult, but yes, you will need to pay for the actual LLM you're using (unless you pick a free one).
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-gray-50/60 dark:bg-gray-900/40">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Provider</label>
                  <select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm">
                    <option value="">— Select provider —</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="claude">Anthropic Claude</option>
                    <option value="openrouter">OpenRouter (recommended for GLM 5.3 Flash)</option>
                    <option value="openai">OpenAI / OpenAI-Compatible</option>
                    <option value="local">Local / Self-Hosted (Ollama, LM Studio, llama.cpp, vLLM…)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Model Name</label>
                  <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder={provider === "local" ? "e.g. qwen3-8b (your local model id)" : "e.g. z-ai/glm-5.3-flash"} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">{provider === "local" ? "API Key (usually not required)" : "API Key"}</label>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={provider === "local" ? "Leave blank for most local servers" : "Paste API key..."} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                </div>
                {(provider === "openai" || provider === "local") && (
                  <div>
                    <label className="block text-xs font-bold mb-1">{provider === "local" ? "Local Server Base URL (required)" : "Base URL (optional — local servers)"}</label>
                    <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider === "local" ? "http://localhost:11434/v1" : "http://localhost:1234/v1"} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                    {provider === "local" && (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) setBaseUrl(e.target.value); }}
                        className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm mt-2"
                      >
                        <option value="">— Pick a preset to fill Base URL —</option>
                        {LOCAL_LLM_BASE_URL_PRESETS.map((p) => (
                          <option key={p.url} value={p.url}>{p.label} — {p.url}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={testConnection} disabled={testing} className="text-xs font-bold px-3 py-1.5 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm disabled:opacity-50 transition-all">
                  {testing ? "Testing..." : "Test Connection"}
                </button>
                {testResult && (
                  <p className={`text-xs px-3 py-2 rounded-lg flex-1 ${testResult.ok ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
                    {testResult.ok ? "✅ " : "❌ "}{testResult.msg}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {page === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2"><ImageIcon className="w-5 h-5 text-pink-500" /> Profile Images for the Characters</h2>
              <p className="text-xs text-gray-500 mt-1">
                You will also very likely want to upload profile images for the AI-driven characters you'll meet on the app to choose from. I've provided a couple starter images, but you'll have to provide your own images going forward. I recommend finding a couple dozen images and uploading them here. You can always add more later via the <strong>Profile Image Upload</strong> tab within the Manager tab. Images are stored in <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">public/portrait-library</code>.
              </p>
              <p className="text-xs text-gray-500 mt-1">You can skip this for now, but if you generate any new characters, you'll want to have uploaded more images.</p>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-gray-50/60 dark:bg-gray-900/40">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!isUploading && e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${dragOver ? "border-pink-400 bg-pink-50/50 dark:bg-pink-950/10" : "border-gray-300 dark:border-gray-600 hover:border-pink-400"}`}
              >
                <Upload className="w-7 h-7 mx-auto text-gray-400 mb-2" />
                <p className="text-sm font-bold text-gray-700 dark:text-gray-200">{isUploading ? "Uploading..." : "Drop images here, or click to browse"}</p>
              </div>
              <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); }} />
              {uploadedCount > 0 && <p className="text-xs text-green-700 dark:text-green-400 font-bold">{uploadedCount} image(s) uploaded this session.</p>}
              {uploadNote && <p className="text-xs text-gray-600 dark:text-gray-300">{uploadNote}</p>}
              <button
                type="button"
                onClick={scanAndProcess}
                disabled={isScanning || isProcessing || isUploading}
                className="text-xs font-bold px-4 py-2 rounded-full bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-all disabled:opacity-50"
              >
                {isScanning ? "Scanning..." : isProcessing ? `Processing images... (${processedCount} done)` : `Scan & Process Uploaded Images${remainingCount !== null && remainingCount > 0 ? ` (${remainingCount} unprocessed)` : ""}`}
              </button>
              <p className="text-[10px] text-gray-400">
                Once you upload images, you'll also need to scan the library and process them (the vision LLM tags each image). This button takes care of both for anything you upload in this box — you'll usually do that later in the Profile Image Upload settings in the Manager tab.
              </p>
            </div>
          </div>
        )}

        {page === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2"><Volume2 className="w-5 h-5 text-pink-500" /> Text-to-Speech (optional)</h2>
              <p className="text-xs text-gray-500 mt-1">
                You may also want a TTS provider. If you are willing to spend a bit of money, I strongly recommend ElevenLabs v3, as this app will recognize you are using it and provide custom instructions to characters to use the Eleven v3 voice-tag system. Untested with non-ElevenLabs providers. You may also leave it disabled for no TTS — dating apps don't have read messages, after all :)
              </p>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-gray-50/60 dark:bg-gray-900/40 mt-2">
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={ttsChoice === "enable"} onChange={() => setTtsChoice("enable")} className="text-pink-600" />
                    <Volume2 className="w-4 h-4 text-pink-500" /> Enable TTS
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" checked={ttsChoice === "disable"} onChange={() => setTtsChoice("disable")} className="text-pink-600" />
                    No TTS for now
                  </label>
                </div>
                {ttsChoice === "enable" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold mb-1">TTS Provider</label>
                      <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm">
                        {TTS_PROVIDER_IDS.map((id) => (
                          <option key={id} value={id}>{TTS_PROVIDER_LABELS[id]}</option>
                        ))}
                      </select>
                      {ttsProvider === "elevenlabs" && (
                        <p className="text-[10px] text-gray-400 mt-1">ElevenLabs v3 is strongly recommended: the app recognizes it and gives characters the Eleven v3 voice-tag instructions for expressive speech.</p>
                      )}
                    </div>
                    {(ttsProvider === "elevenlabs") && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold mb-1">ElevenLabs API Key</label>
                          <input type="password" value={tts.elevenlabs_api_key || ""} onChange={(e) => setTts((p) => ({ ...p, elevenlabs_api_key: e.target.value }))} placeholder="sk_..." className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">TTS Model ID</label>
                          <input type="text" value={tts.elevenlabs_model_id || ""} onChange={(e) => setTts((p) => ({ ...p, elevenlabs_model_id: e.target.value }))} placeholder="e.g. eleven_v3" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                      </div>
                    )}
                    {(ttsProvider === "openai") && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold mb-1">API Key (optional for local servers)</label>
                          <input type="password" value={tts.tts_openai_api_key || ""} onChange={(e) => setTts((p) => ({ ...p, tts_openai_api_key: e.target.value }))} placeholder="sk-..." className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">TTS Model</label>
                          <input type="text" value={tts.tts_openai_model || ""} onChange={(e) => setTts((p) => ({ ...p, tts_openai_model: e.target.value }))} placeholder="e.g. gpt-4o-mini-tts" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-bold mb-1">Base URL (optional — local OpenAI-compatible TTS servers)</label>
                          <input type="text" value={tts.tts_openai_base_url || ""} onChange={(e) => setTts((p) => ({ ...p, tts_openai_base_url: e.target.value }))} placeholder="e.g. http://localhost:8880/v1 (Kokoro-FastAPI)" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                      </div>
                    )}
                    {(ttsProvider === "google") && (
                      <div>
                        <label className="block text-xs font-bold mb-1">Google Cloud TTS API Key</label>
                        <input type="password" value={tts.tts_google_api_key || ""} onChange={(e) => setTts((p) => ({ ...p, tts_google_api_key: e.target.value }))} placeholder="AIza..." className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        <p className="text-[10px] text-gray-400 mt-1">Voice IDs are Google voice names (e.g. en-US-Neural2-F); the language code is derived automatically.</p>
                      </div>
                    )}
                    {(ttsProvider === "cartesia") && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold mb-1">Cartesia API Key</label>
                          <input type="password" value={tts.tts_cartesia_api_key || ""} onChange={(e) => setTts((p) => ({ ...p, tts_cartesia_api_key: e.target.value }))} placeholder="sk_car_..." className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">Cartesia Model</label>
                          <input type="text" value={tts.tts_cartesia_model || ""} onChange={(e) => setTts((p) => ({ ...p, tts_cartesia_model: e.target.value }))} placeholder="e.g. sonic-3" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                      </div>
                    )}
                    {(ttsProvider === "fish") && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold mb-1">Fish Audio API Key</label>
                          <input type="password" value={tts.tts_fish_api_key || ""} onChange={(e) => setTts((p) => ({ ...p, tts_fish_api_key: e.target.value }))} placeholder="api.fish.audio key" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">Fish Audio Model</label>
                          <input type="text" value={tts.tts_fish_model || ""} onChange={(e) => setTts((p) => ({ ...p, tts_fish_model: e.target.value }))} placeholder="e.g. s2.1-pro, s2-pro, s1" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                      </div>
                    )}
                    {(ttsProvider === "custom") && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold mb-1">Custom Bridge Endpoint URL</label>
                          <input type="text" value={tts.tts_custom_url || ""} onChange={(e) => setTts((p) => ({ ...p, tts_custom_url: e.target.value }))} placeholder="http://localhost:5000/tts" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">Method</label>
                          <select value={tts.tts_custom_method || "POST"} onChange={(e) => setTts((p) => ({ ...p, tts_custom_method: e.target.value }))} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm">
                            <option value="POST">POST (JSON body template)</option>
                            <option value="GET">GET (text in URL)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">{"{model} Value (optional)"}</label>
                          <input type="text" value={tts.tts_custom_model || ""} onChange={(e) => setTts((p) => ({ ...p, tts_custom_model: e.target.value }))} placeholder="e.g. a model id your server expects" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">JSON Field Path (JSON modes)</label>
                          <input type="text" value={tts.tts_custom_json_field || ""} onChange={(e) => setTts((p) => ({ ...p, tts_custom_json_field: e.target.value }))} placeholder="audio" className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-bold mb-1">JSON Body Template (POST only)</label>
                          <textarea rows={2} value={tts.tts_custom_body || ""} onChange={(e) => setTts((p) => ({ ...p, tts_custom_body: e.target.value }))} placeholder='{"input": "{text}", "voice": "{voice}", "model": "{model}"}' className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-xs font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold mb-1">Response Mode</label>
                          <select value={tts.tts_custom_response_mode || "raw_audio"} onChange={(e) => setTts((p) => ({ ...p, tts_custom_response_mode: e.target.value }))} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm">
                            <option value="raw_audio">Raw audio bytes (most servers)</option>
                            <option value="json_base64">JSON with base64 audio field</option>
                            <option value="json_url">JSON with audio download URL field</option>
                          </select>
                        </div>
                        <p className="text-[10px] text-gray-400 sm:col-span-2">The Custom Bridge works with ANY HTTP TTS endpoint (self-hosted Supertonic, VoxCPM, Qwen-TTS…). The {'{text}'} / {'{voice}'} / {'{model}'} placeholders are substituted automatically. Extra headers and advanced options live in Manager → TTS Settings.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <p className="text-xs px-3 py-2 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              ⚠️ A warning: default settings will generally work well, but can be very token-heavy. If you're using an expensive model, you'll probably want to play around with the settings.
            </p>
          </div>
        )}

        {page === 4 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">Starting App Preferences</h2>
              <p className="text-xs text-gray-500 mt-1">All of this is editable elsewhere later.</p>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2 bg-gray-50/60 dark:bg-gray-900/40">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Here, you can choose the starter suite of characters:</p>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                <input type="checkbox" checked={includeMale} onChange={(e) => setIncludeMale(e.target.checked)} className="rounded text-pink-600" />
                Include starter male characters
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                <input type="checkbox" checked={includeFemale} onChange={(e) => setIncludeFemale(e.target.checked)} className="rounded text-pink-600" />
                Include starter female characters
              </label>
              <p className="text-[10px] text-gray-400">Unticked sets will be deactivated (hidden from the feed) when the starter characters ship — you can change this anytime later.</p>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2 bg-gray-50/60 dark:bg-gray-900/40">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Some tag picks that may not be everyone's cup of tea:</p>
              <p className="text-[10px] text-gray-400">Choose which character genders each of these tags can appear on during generation — same controls as the tag pill editor in Global Settings.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1.5 pr-2">Tag</th>
                      {(["male", "female", "nonbinary"] as const).map((g) => (
                        <th key={g} className="py-1.5 px-2 text-center">{GENDER_LABELS[g]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SETUP_TAGS.map((tag) => (
                      <tr key={tag} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1.5 pr-2 font-bold text-gray-700 dark:text-gray-200">{tag}</td>
                        {(["male", "female", "nonbinary"] as const).map((g) => (
                          <td key={g} className="py-1.5 px-2 text-center">
                            <input
                              type="checkbox"
                              className="rounded text-pink-600"
                              checked={tagVis[tag]?.[g] !== false}
                              onChange={(e) => setTagVis((prev) => ({ ...prev, [tag]: { ...prev[tag], [g]: e.target.checked } }))}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PAGE-4B-PLACEHOLDER */}

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2 bg-gray-50/60 dark:bg-gray-900/40">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Trans &amp; futanari characters</p>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                <input type="checkbox" checked={transYes} onChange={(e) => setTransYes(e.target.checked)} className="rounded text-pink-600" />
                Yes, I want trans characters to show up
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                <input type="checkbox" checked={futaYes} onChange={(e) => setFutaYes(e.target.checked)} className="rounded text-pink-600" />
                Yes, I want futa characters to show up
              </label>
              <p className="text-[10px] text-gray-400">Applies to the AIC Generation Block Template via the <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">{"{trans_futa_block}"}</code> placeholder — currently resolved to: <strong>{transFutaVariant}</strong>. Editable later in Global Settings.</p>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-gray-50/60 dark:bg-gray-900/40">
              <p className="text-sm font-bold text-gray-800 dark:text-gray-100">Starting systems</p>
              <label className="flex flex-col gap-0.5 cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={gossipEnabled} onChange={(e) => setGossipEnabled(e.target.checked)} className="rounded text-pink-600" />
                  Enable Gossip / Community Board
                </span>
                <span className="text-[10px] text-gray-400 pl-6">Characters write peer reviews of their matches on a shared "community board". Other characters can then take that gossip into account when evaluating profiles or chatting with each other — a living reputation system that colors matches, evaluations, and banter app-wide.</span>
              </label>
              <label className="flex flex-col gap-0.5 cursor-pointer">
                <span className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={networkEnabled} onChange={(e) => setNetworkEnabled(e.target.checked)} className="rounded text-pink-600" />
                  Enable AIC Social Network
                </span>
                <span className="text-[10px] text-gray-400 pl-6">Characters interact with each other: they discover matches among themselves, hold their own conversations, and build relationship summaries — a background social simulation that keeps the world feeling alive (and gives the gossip board something to talk about).</span>
              </label>
            </div>

            <p className="text-xs px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <strong>Difficulty:</strong> if you want to adjust how difficult it is to get a match, you'll want to play around with the User Profile Evaluation prompt, adjustable in the Task Settings portion of the Manager tab. The default configuration is meant to be a balanced difficulty. They do actually evaluate your profile, including the image, so you might need to put some effort into it! They may decide you're not worth the effort!
            </p>
          </div>
        )}

        {page === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-pink-500">How to Get Started</h2>
            <ol className="text-sm text-gray-700 dark:text-gray-200 list-decimal pl-6 space-y-2">
              <li>Make a profile in the <strong>Profile</strong> tab.</li>
              <li>Click <strong>Run Background Processes</strong> in the top bar.</li>
              <li>Go! Use a photo in your profile :)</li>
            </ol>
            <p className="text-xs text-gray-500">
              That's it — the background processes will evaluate your profile against the active characters, and matches will start appearing in your feed. Everything you configured here can be fine-tuned in the <strong>Manager</strong> tab whenever you like.
            </p>
          </div>
        )}

        {/* Footer navigation */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || saving || finishing}
            className="text-xs font-bold px-4 py-2 rounded-full text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors disabled:opacity-30 flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          {page === 1 ? (
            <button
              type="button"
              onClick={() => { showToast("Understood — the app is closed. Please close this window if adult content is not for you."); onClose(); }}
              className="text-xs font-bold px-4 py-2 rounded-full text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title="Leave immediately (closes setup)"
            >
              Leave
            </button>
          ) : null}
          {page > 1 && page < 5 && (
            <button
              type="button"
              onClick={goNext}
              disabled={saving || finishing}
              className="text-xs font-bold px-5 py-2 rounded-full bg-pink-500 hover:bg-pink-600 text-white shadow-sm transition-all disabled:opacity-50 flex items-center gap-1"
            >
              {saving ? "Saving..." : page === 3 ? "Save & Continue" : page === 4 ? "Save & Continue" : "Continue"} <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {page === 1 && (
            <button
              type="button"
              onClick={() => setPage(2)}
              className="text-xs font-bold px-5 py-2 rounded-full bg-pink-500 hover:bg-pink-600 text-white shadow-sm transition-all flex items-center gap-1"
            >
              I am 18 or older — Continue <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {page === 5 && (
            <button
              type="button"
              onClick={finishSetup}
              disabled={finishing}
              className="text-xs font-bold px-5 py-2 rounded-full bg-pink-500 hover:bg-pink-600 text-white shadow-sm transition-all disabled:opacity-50 flex items-center gap-1"
            >
              {finishing ? "Finishing..." : "Finish Setup"} <Check className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { FirstTimeSetupModal };
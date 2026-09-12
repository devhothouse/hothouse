"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Play, Zap, Volume2, MessageSquare, FileText, Tag, Sparkles,
  Bot, Settings, Cpu, Sliders, Database, Download, Plus, Trash2,
  Wand2, Radio, Image as ImageIcon, Users, ShieldCheck, X, Clock, Save, Upload,
  Heart, Coffee, Globe, GitBranch, ExternalLink
} from "lucide-react";
import { safeFetch } from "../page";
import { ManualAicGenModal, InteractionLedger } from "../page";
import {
  LLM_TASKS, MODEL_SLOT_LETTERS, MODEL_SLOT_IDS_KEY, TASK_ASSIGNMENT_KEY,
  slotKey, parseSlotIds, LlmTaskDef, LOCAL_LLM_BASE_URL_PRESETS,
} from "@/lib/llmTasks";
import {
  parseMasterTags, parseTagVisibility, filterMasterTagsByGender,
  isTagVisibleForKey, TAG_GENDER_KEYS, TagGenderKey, TagVisibilityMap,
} from "@/lib/masterTags";
import { VOICES, VoiceOption, parseVoiceCatalog, serializeVoiceCatalog, TTS_PROVIDER_IDS, TTS_PROVIDER_LABELS, TTS_PROVIDER_CATALOG_KEYS, BUILTIN_TTS_CATALOGS, isTtsProviderConfigured, normalizeTtsProvider } from "@/lib/voices";
import { buildSettingsExport, normalizeImportedSettings } from "@/lib/settingsSnapshots";
import { showToast, confirmInApp } from "@/lib/notify";

// =========================================================
// MANAGER TAB
// ---------------------------------------------------------
// The reorganized settings hub (formerly the "Editor" tab):
//   Triggers  – every manual trigger button, grouped by feature
//   AI Models – Model Config slots (A-Z) with test-connection
//   Assign    – which Model Config(s) each LLM task uses (+weights/failover)
//   Tasks     – per-task prompts & parameters (one section per LLM task)
//   Global    – app-wide behavior toggles & master libraries
//   TTS       – ElevenLabs voice synthesis settings
//   My Data   – ledger, stats, exports & danger zone
//   About     – support (Buy Me a Coffee), feedback & project links
// All legacy settings remain editable here or in their legacy locations
// (AIC Gen tab, AIC Network tab settings sub-view) and keep working.
// =========================================================

type SubView = "triggers" | "models" | "assign" | "tasks" | "global" | "tts" | "imagegen" | "portraits" | "data" | "about";

const SUB_VIEWS: { id: SubView; label: string; icon: any }[] = [
  { id: "models", label: "AI Model Manager", icon: Cpu },
  { id: "assign", label: "AI Model Task Assignment", icon: Sliders },
  { id: "tasks", label: "Task Settings & Prompts", icon: Settings },
  { id: "global", label: "Global Settings", icon: ShieldCheck },
  { id: "tts", label: "TTS Settings", icon: Volume2 },
  { id: "imagegen", label: "Image Generation", icon: ImageIcon },
  { id: "portraits", label: "Profile Image Upload", icon: ImageIcon },
  { id: "data", label: "My Data", icon: Database },
  { id: "triggers", label: "Manual Triggers", icon: Play },
  { id: "about", label: "About Hothouse", icon: Heart },
];

// ---------------- Shared small UI helpers ----------------

function SectionCard({ title, icon: Icon, color, description, children }: any) {
  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
      <h3 className={`font-bold flex items-center gap-2 ${color || ""}`}>
        {Icon && <Icon className="w-5 h-5" />} {title}
      </h3>
      {description && <p className="text-sm text-gray-600 dark:text-gray-400 -mt-1">{description}</p>}
      {children}
    </div>
  );
}

function Field({ label, description, children }: any) {
  return (
    <div>
      <label className="block text-sm font-bold mb-1">{label}</label>
      {description && <p className="text-xs text-gray-500 mb-1">{description}</p>}
      {children}
    </div>
  );
}

function TextField({ label, description, value, onChange, placeholder, type = "text", className }: any) {
  return (
    <Field label={label} description={description}>
      <input
        type={type}
        value={value ?? ""}
        onChange={onChange}
        placeholder={placeholder}
        className={className || "w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"}
      />
    </Field>
  );
}

function SelectField({ label, description, value, onChange, options }: any) {
  return (
    <Field label={label} description={description}>
      <select
        value={value ?? ""}
        onChange={onChange}
        className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"
      >
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

function PromptField({ label, description, placeholders, value, onChange, rows = 6 }: any) {
  return (
    <Field
      label={label}
      description={
        <>
          {description}
          {placeholders && placeholders.length > 0 && (
            <>
              <br />Placeholders:{" "}
              {placeholders.map((p: string, i: number) => (
                <code key={p} className="bg-gray-200 dark:bg-gray-600 px-1 rounded mr-1">
                  {`{${p}}`}{i < placeholders.length - 1 ? "," : ""}
                </code>
              ))}
            </>
          )}
        </>
      }
    >
      <textarea
        rows={rows}
        value={value ?? ""}
        onChange={onChange}
        className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-xs font-mono"
      />
    </Field>
  );
}

function TriggerButton({ onClick, disabled, label, busyLabel, color = "neutral", className }: any) {
  const colors: Record<string, string> = {
    neutral: "bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500",
    pink: "bg-pink-600 hover:bg-pink-700",
    purple: "bg-purple-600 hover:bg-purple-700",
    blue: "bg-blue-600 hover:bg-blue-700",
    gray: "bg-gray-600 hover:bg-gray-700",
    indigo: "bg-indigo-600 hover:bg-indigo-700",
    teal: "bg-teal-600 hover:bg-teal-700",
    orange: "bg-orange-600 hover:bg-orange-700",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${colors[color]} text-white px-4 py-2 rounded-lg font-medium shadow-sm transition disabled:opacity-50 text-sm ${className || "flex-1"}`}
    >
      {disabled ? (busyLabel || "Working...") : label}
    </button>
  );
}

export function ManagerTab({
  isProcessingPhotos, setIsProcessingPhotos, photoProgress, setPhotoProgress,
  unprocessedPhotosCount, fetchUnprocessedCount,
  addTask, removeTask, updateTaskProgress,
  isEvaluating, isPickingVoice, isTriggeringAsync, isGeneratingBio, isGeneratingTags, isGenerating,
  settings, setSettings, isSaving, loadSettings, saveSettings,
  handleEvaluate, handleVoicePicker, handleTriggerAsync, handleBulkGenerateBio,
  handleBulkGenerateTags, handleResolveNames, handleGenerate, handleGenerateManual,
  isGeneratingPortraits, handleGeneratePortraits,
  isWritingPrompts, handleImagePromptWriter
}: any) {
  const [activeSubView, setActiveSubView] = useState<SubView>("models");

  // Portrait processing (moved from the old Editor tab, identical behavior)
  const [numPhotosToProcess, setNumPhotosToProcess] = useState<number>(10);

  // AIC generation trigger inputs
  const [genGender, setGenGender] = useState("Female");
  const [genLookingFor, setGenLookingFor] = useState("Male");
  const [showManualGen, setShowManualGen] = useState(false);

  // Task Assignment draft (parsed from the llm_task_assignment JSON setting)
  const [assignment, setAssignment] = useState<Record<string, any>>({});

  // Task Settings accordion state
  const [openTask, setOpenTask] = useState<string | null>(null);

  // Model Config connection-test state
  const [testingSlot, setTestingSlot] = useState<string | null>(null);
  const [slotTestResult, setSlotTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  useEffect(() => {
    loadSettings();
    fetchUnprocessedCount();
    try {
      const parsed = settings?.[TASK_ASSIGNMENT_KEY] ? JSON.parse(settings[TASK_ASSIGNMENT_KEY]) : {};
      setAssignment(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setAssignment({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (key: string, value: string) => {
    // Functional update so multiple rapid key edits (e.g. the Master Tags editor
    // persisting two keys at once) never overwrite each other with stale state.
    setSettings((prev: any) => ({ ...prev, [key]: value }));
  };

  const slotIds = parseSlotIds(settings?.[MODEL_SLOT_IDS_KEY] || "A,B,C");

  const addSlot = () => {
    const next = MODEL_SLOT_LETTERS.find((L) => !slotIds.includes(L));
    if (!next) {
      showToast("All 26 Model Config slots (A-Z) are already in use.");
      return;
    }
    setSettings({
      ...settings,
      [MODEL_SLOT_IDS_KEY]: [...slotIds, next].join(","),
      [slotKey(next, "label")]: `Model Config ${next}`,
      [slotKey(next, "provider")]: "",
      [slotKey(next, "model")]: "",
      [slotKey(next, "api_key")]: "",
      [slotKey(next, "temperature")]: "",
      [slotKey(next, "max_tokens")]: "",
    });
  };

  const removeSlot = async (letter: string) => {
    if (!await confirmInApp(`Remove Model Config ${letter} from the list? (Tasks assigned to it will automatically use their dedicated LLM link settings instead. Its stored fields stay in the database until overwritten.)`)) return;
    setSettings({
      ...settings,
      [MODEL_SLOT_IDS_KEY]: slotIds.filter((L) => L !== letter).join(","),
    });
  };

  const testSlot = async (letter: string) => {
    setTestingSlot(letter);
    setSlotTestResult((prev) => ({ ...prev, [letter]: { ok: false, msg: "Testing..." } }));
    const res = await safeFetch("/api/settings/test-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: settings[slotKey(letter, "provider")],
        model: settings[slotKey(letter, "model")],
        apiKey: settings[slotKey(letter, "api_key")],
        temperature: settings[slotKey(letter, "temperature")],
        maxTokens: settings[slotKey(letter, "max_tokens")],
        baseUrl: settings[slotKey(letter, "base_url")],
      }),
    });
    setTestingSlot(null);
    setSlotTestResult((prev) => ({
      ...prev,
      [letter]: res.success
        ? { ok: true, msg: res.message || "Connection OK." }
        : { ok: false, msg: res.error || "Test failed." },
    }));
  };

  const saveAssignment = async () => {
    await saveSettings({ ...settings, [TASK_ASSIGNMENT_KEY]: JSON.stringify(assignment) });
  };

  const setTaskAssignment = (taskId: string, updater: (entry: any) => any) => {
    setAssignment((prev) => ({ ...prev, [taskId]: updater(prev[taskId] || { slots: [], weights: {} }) }));
  };

  // Portrait batch processing (sequential Vision AI calls; safe to leave tab)
  const handleProcessPhotos = async () => {
    if (!await confirmInApp(`Are you sure you want to process and tag up to ${numPhotosToProcess} unprocessed photos? This will run sequential Vision AI calls.`)) {
      return;
    }
    setIsProcessingPhotos(true);
    setPhotoProgress({ current: 0, total: numPhotosToProcess, status: "Starting photo processing..." });
    addTask("process_portraits", "Processing Portrait Library", "Starting photo analysis...", true);
    for (let i = 1; i <= numPhotosToProcess; i++) {
      setPhotoProgress({ current: i - 1, total: numPhotosToProcess, status: `Analyzing photo ${i} of ${numPhotosToProcess}...` });
      updateTaskProgress("process_portraits", i - 1, numPhotosToProcess, `Analyzing photo ${i} of ${numPhotosToProcess}...`);
      try {
        const res = await safeFetch("/api/portraits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tag", limit: 1 })
        });
        if (res.success) {
          if (res.processedCount === 0) {
            setPhotoProgress((prev: any) => prev ? { ...prev, status: "All available photos processed!" } : null);
            break;
          }
          setPhotoProgress({ current: i, total: numPhotosToProcess, status: `Successfully analyzed photo ${i} of ${numPhotosToProcess}.` });
          updateTaskProgress("process_portraits", i, numPhotosToProcess, `Successfully analyzed photo ${i} of ${numPhotosToProcess}.`);
        } else {
          setPhotoProgress((prev: any) => prev ? { ...prev, status: `Error on photo ${i}: ${res.error || "Unknown error"}` } : null);
          showToast(`Processing stopped on photo ${i}: ${res.error}`);
          break;
        }
      } catch (err: any) {
        showToast(`Error in photo tagging loop: ${err.message}`);
        break;
      }
    }
    setIsProcessingPhotos(false);
    removeTask("process_portraits");
    fetchUnprocessedCount();
    setTimeout(() => setPhotoProgress(null), 3000);
  };

  // Master tags available for the Manual AIC Generation modal, restricted to the
  // currently selected generation gender's tag list (per-gender visibility map).
  const manualGenTags = (() => {
    const tags = parseMasterTags(settings?.tags_master);
    return filterMasterTagsByGender(tags, parseTagVisibility(settings?.tags_gender_visibility), genGender);
  })();

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6 bg-white dark:bg-gray-900">
      <div className="border-b border-gray-100 dark:border-gray-800 pb-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Sliders className="text-pink-500 w-6 h-6" /> Manager
        </h2>
        <p className="text-sm text-gray-500">
          Central configuration hub: manual triggers, AI model routing, per-task prompts &amp; parameters, global behavior, TTS, and your data.
          Each section that edits settings has its own <strong>Save Changes</strong> button at the bottom.
        </p>
      </div>

      {/* Sub-view navigation (modeled after the AIC Network tab) */}
      <div className="flex flex-wrap border-b border-gray-200 dark:border-gray-700 gap-4">
        {SUB_VIEWS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSubView(id)}
            className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeSubView === id
                ? "border-pink-600 text-pink-600 dark:text-pink-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {activeSubView === "triggers" && (
        <ManualTriggersView
          settings={settings}
          isEvaluating={isEvaluating} isPickingVoice={isPickingVoice} isTriggeringAsync={isTriggeringAsync}
          isGeneratingBio={isGeneratingBio} isGeneratingTags={isGeneratingTags} isGenerating={isGenerating}
          isProcessingPhotos={isProcessingPhotos} photoProgress={photoProgress}
          unprocessedPhotosCount={unprocessedPhotosCount} numPhotosToProcess={numPhotosToProcess}
          setNumPhotosToProcess={setNumPhotosToProcess} handleProcessPhotos={handleProcessPhotos} loadSettings={loadSettings}
          handleEvaluate={handleEvaluate} handleVoicePicker={handleVoicePicker} handleTriggerAsync={handleTriggerAsync}
          handleBulkGenerateBio={handleBulkGenerateBio} handleBulkGenerateTags={handleBulkGenerateTags} handleResolveNames={handleResolveNames}
          isGeneratingPortraits={isGeneratingPortraits} handleGeneratePortraits={handleGeneratePortraits}
          isWritingPrompts={isWritingPrompts} handleImagePromptWriter={handleImagePromptWriter}
          genGender={genGender} setGenGender={setGenGender} genLookingFor={genLookingFor} setGenLookingFor={setGenLookingFor}
          setShowManualGen={setShowManualGen} handleGenerate={handleGenerate} manualGenTags={manualGenTags}
        />
      )}

      {activeSubView === "models" && (
        <ModelManagerView
          settings={settings} handleChange={handleChange} isSaving={isSaving} saveSettings={saveSettings}
          slotIds={slotIds} addSlot={addSlot} removeSlot={removeSlot}
          testingSlot={testingSlot} slotTestResult={slotTestResult} testSlot={testSlot}
        />
      )}

      {activeSubView === "assign" && (
        <TaskAssignmentView
          assignment={assignment} setTaskAssignment={setTaskAssignment}
          slotIds={slotIds} settings={settings} isSaving={isSaving} saveAssignment={saveAssignment}
        />
      )}

      {activeSubView === "tasks" && (
        <TaskSettingsView
          settings={settings} handleChange={handleChange} isSaving={isSaving} saveSettings={saveSettings}
          openTask={openTask} setOpenTask={setOpenTask}
          handleEvaluate={handleEvaluate} handleVoicePicker={handleVoicePicker} handleTriggerAsync={handleTriggerAsync}
          handleBulkGenerateBio={handleBulkGenerateBio} handleBulkGenerateTags={handleBulkGenerateTags}
          handleResolveNames={handleResolveNames}
          handleImagePromptWriter={handleImagePromptWriter} isWritingPrompts={isWritingPrompts}
          isEvaluating={isEvaluating} isPickingVoice={isPickingVoice} isTriggeringAsync={isTriggeringAsync}
          isGeneratingBio={isGeneratingBio} isGeneratingTags={isGeneratingTags}
          isProcessingPhotos={isProcessingPhotos} photoProgress={photoProgress}
          unprocessedPhotosCount={unprocessedPhotosCount} numPhotosToProcess={numPhotosToProcess}
          setNumPhotosToProcess={setNumPhotosToProcess} handleProcessPhotos={handleProcessPhotos} loadSettings={loadSettings}
        />
      )}

      {activeSubView === "global" && (
        <GlobalSettingsView settings={settings} handleChange={handleChange} isSaving={isSaving} saveSettings={saveSettings} loadSettings={loadSettings} />
      )}

      {activeSubView === "tts" && (
        <TtsSettingsView settings={settings} handleChange={handleChange} isSaving={isSaving} saveSettings={saveSettings} />
      )}

      {activeSubView === "imagegen" && (
        <ImageGenView settings={settings} handleChange={handleChange} isSaving={isSaving} saveSettings={saveSettings} />
      )}

      {activeSubView === "portraits" && (
        <ProfileImageUploadView
          isProcessingPhotos={isProcessingPhotos} photoProgress={photoProgress}
          unprocessedPhotosCount={unprocessedPhotosCount} numPhotosToProcess={numPhotosToProcess}
          setNumPhotosToProcess={setNumPhotosToProcess} handleProcessPhotos={handleProcessPhotos}
          loadSettings={loadSettings}
        />
      )}

      {activeSubView === "data" && (
        <MyDataView settings={settings} loadSettings={loadSettings} />
      )}

      {activeSubView === "about" && (
        <AboutHothouseView />
      )}

      {showManualGen && (
        <ManualAicGenModal
          tags={manualGenTags}
          onClose={() => setShowManualGen(false)}
          isGenerating={isGenerating}
          onGenerate={async (scores: any, devTags: any) => {
            await handleGenerateManual(genGender, genLookingFor, scores, devTags, () => {
              setShowManualGen(false);
            });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------
// SUBVIEW 1: MANUAL TRIGGERS (all manual buttons, grouped)
// ---------------------------------------------------------

function ManualTriggersView(props: any) {
  const {
    isEvaluating, isPickingVoice, isTriggeringAsync, isGeneratingBio, isGeneratingTags, isGenerating,
    isProcessingPhotos, photoProgress, unprocessedPhotosCount, numPhotosToProcess,
    setNumPhotosToProcess, handleProcessPhotos, loadSettings,
    handleEvaluate, handleVoicePicker, handleTriggerAsync, handleBulkGenerateBio,
    handleBulkGenerateTags, handleResolveNames,
    isGeneratingPortraits, handleGeneratePortraits,
    isWritingPrompts, handleImagePromptWriter,
  } = props;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Every manual trigger in the app, grouped by feature. All of these run in the background — it is safe to switch tabs or chat while they run.
        The same buttons also appear inside each task's own settings section under “Task Settings &amp; Prompts”.
      </p>

      <SectionCard title="Decision Engine (User Profile Evaluation)" icon={Zap} description="Runs the LLM engine to have AICs evaluate the currently active human profile. Only characters that have not evaluated this profile yet are included.">
        <div className="flex gap-2">
          <TriggerButton onClick={() => handleEvaluate(true)} disabled={isEvaluating} label="Evaluate User Profile (AICs Who Haven't Evaluated Yet)" busyLabel="Evaluating..." />
        </div>
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Evaluates compatibility against profiles in the background.</p>
      </SectionCard>

      <SectionCard title="Asynchronous Messaging" icon={MessageSquare} description="Force one random matched AIC to take the initiative and message you asynchronously. Matched characters with existing unread messages are 3x less likely to be chosen.">
        <TriggerButton onClick={handleTriggerAsync} disabled={isTriggeringAsync} label="Trigger Random Asynchronous Message" busyLabel="Generating Initiative Message..." className="w-full" />
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Triggers active DM outreach in the background.</p>
      </SectionCard>

      <SectionCard title="Bio Management" icon={FileText} description="Let the AI Bio Writer fill out missing public profile questionnaires for characters.">
        <TriggerButton onClick={() => handleBulkGenerateBio()} disabled={isGeneratingBio} label="AICs with Empty Bio Fill Bio Questionnaire" busyLabel="Generating..." className="w-full" />
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Generates bio content in the background.</p>
      </SectionCard>

      <SectionCard title="AIC Voice Picker" icon={Volume2} description="Run the voice selection helper to let characters without a voice select their own ElevenLabs voice based on descriptions.">
        <TriggerButton onClick={() => handleVoicePicker(true)} disabled={isPickingVoice} label="Run Voice Picker on Characters with No Voice" busyLabel="Processing..." className="w-full" />
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Assigns voices in the background.</p>
      </SectionCard>

      <SectionCard title="AI Portrait Generation" icon={ImageIcon} description="Let characters without a profile photo generate one with AI (Manager → Image Generation picks the provider). When the portrait-generation toggle is enabled there, this is also what the Image Picker runs.">
        <TriggerButton onClick={handleGeneratePortraits} disabled={isGeneratingPortraits} label="Generate Portraits for Characters Without an Image (AI)" busyLabel="Generating..." className="w-full" />
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Generates and assigns portraits in the background.</p>
      </SectionCard>

      <SectionCard title="Image Prompt Writer" icon={ImageIcon} description="Writes each character's visual appearance description used by AI image generation (portraits + chat images) so generated images actually look like the character. Characters without one are processed.">
        <TriggerButton onClick={handleImagePromptWriter} disabled={isWritingPrompts} label="Write Image Prompts (Characters Without One)" busyLabel="Writing..." className="w-full" />
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Writes descriptions in the background.</p>
      </SectionCard>

      <SectionCard title="Rare Background Tasks" icon={Tag} description="You likely will not need to run these manually.">
        <div className="flex flex-col gap-2">
          <TriggerButton onClick={() => handleBulkGenerateTags()} disabled={isGeneratingTags} label="Trigger Self-Tagging" busyLabel="Tagging..." className="w-full" />
          <TriggerButton onClick={() => handleResolveNames()} disabled={false} label="Run AI Name Resolver (Rename Duplicates & Placeholders)" className="w-full" />
        </div>
        <p className="text-[10px] text-gray-400">
          ✔️ Safe to change tabs / chat. Self-Tagging evaluates characters without tags against all master traits; the Name
          Resolver renames characters with duplicate, empty, or placeholder names.
        </p>
      </SectionCard>

      <SectionCard title="Portrait Library Tools" icon={Sparkles} description="Manage your high-quality portrait collection. Place files in public/portrait-library first.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <TriggerButton
            onClick={async () => {
              const res = await safeFetch("/api/portraits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
              if (res.success) {
                showToast(res.message);
                await loadSettings();
              } else {
                showToast("Scan failed: " + res.error);
              }
            }}
            disabled={false}
            label="Scan Portrait Folder"
            className="w-full"
          />
          <div className="flex flex-col border border-gray-200 dark:border-gray-700 p-2 rounded-xl bg-gray-500/5">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={500}
                value={numPhotosToProcess}
                onChange={(e) => setNumPhotosToProcess(Math.max(1, parseInt(e.target.value) || 1))}
                disabled={isProcessingPhotos}
                className="w-14 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs text-center font-bold"
                title="Number of photos to process"
              />
              <TriggerButton
                onClick={handleProcessPhotos}
                disabled={isProcessingPhotos}
                label={`Process Unprocessed Photos (${unprocessedPhotosCount} remaining)`}
                busyLabel="Processing..."
                className="flex-1"
              />
            </div>
            {photoProgress && (
              <div className="space-y-1 mt-1">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden">
                  <div className="bg-gray-600 dark:bg-gray-400 h-1 rounded-full transition-all duration-300" style={{ width: `${(photoProgress.current / photoProgress.total) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-600 dark:text-gray-300 font-semibold truncate">
                  {photoProgress.status} ({photoProgress.current}/{photoProgress.total})
                </p>
              </div>
            )}
          </div>
          <div>
            <TriggerButton
              onClick={async () => {
                if (await confirmInApp("Trigger intelligent portrait photo selection for all active characters who don't have a photo yet?")) {
                  const res = await safeFetch("/api/portraits/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allEmpty: true }) });
                  if (res.success) {
                    showToast(`Successfully assigned custom portraits for ${res.selectedCount} characters.`);
                  } else {
                    showToast("Photo selection failed: " + res.error);
                  }
                }
              }}
              disabled={false}
              label="Auto-Assign Portrait Images"
              className="w-full"
            />
          </div>
        </div>
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Scan adds new library files; processing tags them; auto-assign reruns character portrait matching.</p>
      </SectionCard>

      <SectionCard title="Generate AIC" icon={Wand2} description="Generate a brand-new AI character: personalized to the active profile's learned preferences, fully randomized, or built from manual tag scores.">
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Character Gender" value={props.genGender} onChange={(e: any) => props.setGenGender(e.target.value)} options={[{ value: "Female", label: "Female" }, { value: "Male", label: "Male" }, { value: "Non-binary", label: "Non-binary" }]} />
          <SelectField label="Looking For" value={props.genLookingFor} onChange={(e: any) => props.setGenLookingFor(e.target.value)} options={[{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }, { value: "Everyone", label: "Everyone" }]} />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <TriggerButton
            onClick={async () => {
              if (await confirmInApp(`Generate a new personalized ${props.genGender} AIC seeking ${props.genLookingFor}?`)) {
                props.handleGenerate(props.genGender, props.genLookingFor, false, () => props.loadSettings());
              }
            }}
            disabled={isGenerating}
            label="Generate Personalized AIC"
            busyLabel="Generating..."
            className="w-full"
          />
          <TriggerButton
            onClick={async () => {
              if (await confirmInApp(`Generate a new fully randomized ${props.genGender} AIC seeking ${props.genLookingFor}?`)) {
                props.handleGenerate(props.genGender, props.genLookingFor, true, () => props.loadSettings());
              }
            }}
            disabled={isGenerating}
            label="Generate Randomized AIC"
            busyLabel="Generating..."
            className="w-full"
          />
          <TriggerButton onClick={() => props.setShowManualGen(true)} disabled={isGenerating} label="Generate AIC from Manual Tag Scores" busyLabel="Generating..." className="w-full" />
        </div>
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. The character is written to “AIC personas/” and synced to the database.</p>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------
// SUBVIEW: PROFILE IMAGE UPLOAD (upload → scan → process, one place)
// ---------------------------------------------------------

function ProfileImageUploadView(props: any) {
  const {
    isProcessingPhotos, photoProgress, unprocessedPhotosCount,
    numPhotosToProcess, setNumPhotosToProcess, handleProcessPhotos, loadSettings,
  } = props;
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadResult(null);
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
    if (saved > 0) {
      setUploadResult(`Uploaded ${saved} image(s)${rejected > 0 ? `, ${rejected} rejected (must be .jpg/.jpeg/.png/.webp)` : ""}. Now run BOTH steps below: Scan, then Process.`);
      showToast(`Uploaded ${saved} image(s). Remember to Scan + Process (both steps below).`);
      loadSettings();
    } else {
      setUploadResult(`Upload failed${rejected > 0 ? ` — ${rejected} file(s) rejected (images must be .jpg/.jpeg/.png/.webp)` : ""}.`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleScan = async () => {
    setIsScanning(true);
    const res = await safeFetch("/api/portraits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
    setIsScanning(false);
    if (res.success) {
      showToast(res.message);
      await loadSettings();
    } else {
      showToast("Scan failed: " + res.error);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        This is where you add profile images for AI-driven characters (AICs) to choose from.
        <strong> After uploading, you must always run BOTH steps below — Scan, then Process — or the new images will not be usable.</strong>
      </p>

      <SectionCard title="Step 1 — Upload Images" icon={Upload} description="Drag images here or click to browse. They are saved into public/portrait-library/ on disk. JPG, JPEG, PNG and WebP are supported; upload as many as you like (a couple dozen is a good start).">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!isUploading && e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files); }}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver ? "border-pink-400 bg-pink-50/50 dark:bg-pink-950/10" : "border-gray-300 dark:border-gray-600 hover:border-pink-400"}`}
        >
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
            {isUploading ? "Uploading..." : "Drop images here, or click to browse"}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">Images are stored in public/portrait-library and served from /portrait-library/…</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files); }}
        />
        {uploadResult && (
          <p className="text-xs px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{uploadResult}</p>
        )}
      </SectionCard>

      <SectionCard title="Step 2 — Scan the Portrait Library" icon={Sparkles} description="After uploading, click this to register every image file found in public/portrait-library/ into the database. Scanning is what makes the app aware the files exist — without it, newly uploaded images are invisible to the app. It also cleans up records for files that no longer exist on disk.">
        <TriggerButton onClick={handleScan} disabled={isScanning} label="Scan Portrait Folder" busyLabel="Scanning..." className="w-full" />
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Never modifies the image files themselves.</p>
      </SectionCard>

      <SectionCard title="Step 2 — Run the Image Tagger (Process Unprocessed Images)" icon={Wand2} description="Runs the vision LLM over every unprocessed portrait: it assigns the predefined tags (gender, hair, body type, clothing, setting, lewdness…), custom tags, and a short written description. This is what makes images selectable by characters — the Image Picker only offers processed portraits, and gender filtering relies on the assigned tags. Each image costs one LLM call.">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={500}
              value={numPhotosToProcess}
              onChange={(e) => setNumPhotosToProcess(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={isProcessingPhotos}
              className="w-14 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs text-center font-bold"
              title="Number of photos to process per batch click"
            />
            <TriggerButton
              onClick={handleProcessPhotos}
              disabled={isProcessingPhotos}
              label={`Process Unprocessed Photos (${unprocessedPhotosCount} remaining)`}
              busyLabel="Processing..."
              className="flex-1"
            />
          </div>
          {photoProgress && (
            <div className="space-y-1">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden">
                <div className="bg-gray-600 dark:bg-gray-400 h-1 rounded-full transition-all duration-300" style={{ width: `${(photoProgress.current / photoProgress.total) * 100}%` }} />
              </div>
              <p className="text-[10px] text-gray-600 dark:text-gray-300 font-semibold truncate">
                {photoProgress.status} ({photoProgress.current}/{photoProgress.total})
              </p>
            </div>
          )}
        </div>
        <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Tagging runs in the background; keep the batch number small if you're on a budget.</p>
      </SectionCard>

      <SectionCard title="Reminder" icon={Clock}>
        <p className="text-xs text-gray-600 dark:text-gray-300">
          ⚠️ <strong>You need to run BOTH — Scan, then Process — every time you upload new images.</strong>
          {" "}Upload alone does nothing: the images must be scanned into the database and then processed (tagged) by the vision LLM before any character can pick them.
        </p>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------
// SUBVIEW 2: AI MODEL MANAGER (Model Config slots A-Z)
// ---------------------------------------------------------

function ModelManagerView(props: any) {
  const { settings, handleChange, isSaving, saveSettings, slotIds, addSlot, removeSlot, testingSlot, slotTestResult, testSlot } = props;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        A <strong>Model Config</strong> is a reusable connection preset (provider, model, API key, temperature, max output tokens).
        Create as many as you need (up to 26, A–Z), then assign them to tasks under <strong>AI Model Task Assignment</strong>.
        When a task is assigned one or more configs, every call of that type randomly picks one (weighted) and automatically
        switches to the next alternate if the call errors. Blank fields fall back to the global LLM settings.
      </p>

      {slotIds.map((letter: string, idx: number) => (
        <ModelConfigCard
          key={letter}
          letter={letter}
          idx={idx}
          settings={settings}
          handleChange={handleChange}
          removeSlot={removeSlot}
          testingSlot={testingSlot}
          testResult={slotTestResult[letter]}
          testSlot={testSlot}
        />
      ))}

      <button
        onClick={addSlot}
        disabled={slotIds.length >= 26}
        className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-pink-400 text-gray-600 dark:text-gray-300 hover:text-pink-500 font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Plus className="w-4 h-4" /> {slotIds.length < 26 ? `Add Model Config (next slot: ${MODEL_SLOT_LETTERS.find((L) => !slotIds.includes(L))})` : "All 26 slots (A-Z) in use"}
      </button>

      <button
        onClick={() => saveSettings()}
        disabled={isSaving}
        className="bg-black dark:bg-white text-white dark:text-black w-full p-2 rounded font-bold"
      >
        {isSaving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

function ModelConfigCard({ letter, idx, settings, handleChange, removeSlot, testingSlot, testResult, testSlot }: any) {
  const provider = settings[slotKey(letter, "provider")] || "";
  return (
    <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Cpu className="w-4 h-4 text-pink-500" /> Model Config {letter}
          {settings[slotKey(letter, "label")] && <span className="text-xs font-normal text-gray-500">— {settings[slotKey(letter, "label")]}</span>}
        </h3>
        <div className="flex items-center gap-2">
          <TriggerButton onClick={() => testSlot(letter)} disabled={testingSlot === letter} label="Test Connection" busyLabel="Testing..." color="indigo" className="text-xs px-3 py-1" />
          {idx >= 3 && (
            <button onClick={() => removeSlot(letter)} className="text-red-400 hover:text-red-600 p-1" title="Remove this Model Config">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="Display Label (optional)" value={settings[slotKey(letter, "label")]} onChange={(e: any) => handleChange(slotKey(letter, "label"), e.target.value)} placeholder={`e.g. ${letter === "A" ? "Main Quality Model" : "My Fast Model"}`} />
        <SelectField
          label="Provider"
          value={provider}
          onChange={(e: any) => handleChange(slotKey(letter, "provider"), e.target.value)}
          options={[
            { value: "", label: "— Select provider —" },
            { value: "gemini", label: "Google Gemini" },
            { value: "claude", label: "Anthropic Claude" },
            { value: "openrouter", label: "OpenRouter" },
            { value: "openai", label: "OpenAI / OpenAI-Compatible" },
            { value: "local", label: "Local / Self-Hosted (Ollama, LM Studio, llama.cpp, vLLM…)" },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Model Name"
          value={settings[slotKey(letter, "model")]}
          onChange={(e: any) => handleChange(slotKey(letter, "model"), e.target.value)}
          placeholder={provider === "gemini" ? "e.g. gemini-3.7-flash" : provider === "claude" ? "e.g. claude-3-5-sonnet-latest" : provider === "openrouter" ? "e.g. meta-llama/llama-3.1-8b-instruct:free" : provider === "local" ? "e.g. qwen3-8b (your local server's model id)" : provider === "openai" ? "e.g. gpt-4o-mini" : "Provider's model ID"}
        />
        <TextField
          label="API Key"
          type="password"
          value={settings[slotKey(letter, "api_key")]}
          onChange={(e: any) => handleChange(slotKey(letter, "api_key"), e.target.value)}
          placeholder={provider === "claude" ? "sk-ant-..." : provider === "openrouter" ? "sk-or-v1-..." : provider === "openai" ? "sk-... (optional for local servers)" : provider === "local" ? "Usually not required" : "Paste API key..."}
          description={provider === "openai" ? "Leave blank to inherit the global OpenAI key. Not required when a local server Base URL is set below." : provider === "local" ? "Not required for most local servers (Ollama, LM Studio, llama.cpp, vLLM, KoboldCpp, LocalAI)." : undefined}
        />
        {(provider === "openai" || provider === "local") && (
          <>
            <TextField
              label={provider === "local" ? "Base URL (your local server)" : "Base URL (optional — for local / compatible servers)"}
              value={settings[slotKey(letter, "base_url")]}
              onChange={(e: any) => handleChange(slotKey(letter, "base_url"), e.target.value)}
              placeholder={provider === "local" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"}
              description={provider === "local" ? "Required: the OpenAI-compatible endpoint of your local server. Use the preset picker below or type any URL." : "Blank = official OpenAI. Local OpenAI-compatible servers: Ollama http://localhost:11434/v1 · LM Studio http://localhost:1234/v1 · llama.cpp http://localhost:8080/v1 · vLLM http://localhost:8000/v1."}
            />
            {provider === "local" && (
              <SelectField
                label="Common local server presets (fills Base URL)"
                value=""
                onChange={(e: any) => { if (e.target.value) handleChange(slotKey(letter, "base_url"), e.target.value); }}
                options={[
                  { value: "", label: "— Pick a preset to fill Base URL —" },
                  ...LOCAL_LLM_BASE_URL_PRESETS.map((p) => ({ value: p.url, label: `${p.label} — ${p.url}` })),
                ]}
              />
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="Temperature (Creativity)"
          type="number"
          value={settings[slotKey(letter, "temperature")]}
          onChange={(e: any) => handleChange(slotKey(letter, "temperature"), e.target.value)}
          placeholder="1"
          description="0 = focused/deterministic, higher = more creative. Leave blank for the default of 1."
        />
        <TextField
          label="Max Output Tokens (optional)"
          type="number"
          value={settings[slotKey(letter, "max_tokens")]}
          onChange={(e: any) => handleChange(slotKey(letter, "max_tokens"), e.target.value)}
          placeholder="4000"
          description="Upper bound on response length. Anthropic default: 4000. Leave blank to use each provider's default (Gemini/OpenRouter send no limit unless set here)."
        />
      </div>

      {testResult && (
        <p className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"}`}>
          {testResult.ok ? "✅ " : "❌ "}{testResult.msg}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// SUBVIEW 3: AI MODEL TASK ASSIGNMENT
// ---------------------------------------------------------

function TaskAssignmentView({ assignment, setTaskAssignment, slotIds, settings, isSaving, saveAssignment }: any) {
  const groups = Array.from(new Set(LLM_TASKS.map((t: LlmTaskDef) => t.group)));

  const slotOptions = (taskId: string, position: number) => [
    { value: "", label: "— None —" },
    ...slotIds
      .filter((L: string) => L !== assignment[taskId]?.slots?.[0] || position === 0)
      .map((L: string) => ({ value: L, label: `${L}${settings[slotKey(L, "label")] ? ` — ${settings[slotKey(L, "label")]}` : ""}` })),
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        For each <strong>type of LLM call</strong> the app makes, assign up to <strong>3 Model Configs</strong> with optional{" "}
        <strong>choice weights</strong>. Every time the app makes a call of that type, it randomly picks one assigned config
        (higher weight = picked more often). If that call errors, it automatically retries with the next assigned config, then
        the third. A task with <strong>no Model Config assigned</strong> runs on the Global LLM Default settings (Manager →
        Global Settings) and is flagged in the warning banner below until you assign one.
      </p>

      {(() => {
        const unassigned = LLM_TASKS.filter((t: LlmTaskDef) => !(assignment[t.id]?.slots || []).some(Boolean));
        if (unassigned.length === 0) return null;
        return (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 rounded-xl">
            <p className="text-xs text-amber-800 dark:text-amber-200 font-bold">
              ⚠ {unassigned.length} task{unassigned.length === 1 ? "" : "s"} without a Model Config: {unassigned.map((t: LlmTaskDef) => t.label).join(", ")} — currently running on the Global LLM Default settings.
            </p>
          </div>
        );
      })()}

      {groups.map((group: string) => (
        <div key={group} className="space-y-2">
          <h3 className="font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wider text-xs">{group}</h3>
          {LLM_TASKS.filter((t: LlmTaskDef) => t.group === group).map((task: LlmTaskDef) => {
            const entry = assignment[task.id] || { slots: [], weights: {} };
            const slots: string[] = entry.slots || [];
            const weights: Record<string, number> = entry.weights || {};
            return (
              <div key={task.id} className="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <h4 className="font-bold text-sm text-gray-800 dark:text-white">{task.label}</h4>
                    <p className="text-xs text-gray-500">{task.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[0, 1, 2].map((pos) => {
                    const letter = slots[pos] || "";
                    return (
                      <div key={pos} className="space-y-1">
                        <label className="block text-xs font-bold text-gray-500">
                          {pos === 0 ? "Primary Config" : `Alternate Config ${pos + 1}`}
                        </label>
                        <select
                          value={letter}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTaskAssignment(task.id, (en: any) => {
                              const nextSlots = [...(en.slots || [])];
                              while (nextSlots.length < 3) nextSlots.push("");
                              nextSlots[pos] = val;
                              const cleaned = nextSlots.filter((L: string, i: number) => L || i === 0);
                              const dedup: string[] = [];
                              for (const L of cleaned) {
                                if (L && dedup.includes(L)) continue;
                                dedup.push(L);
                              }
                              return { ...en, slots: dedup };
                            });
                          }}
                          className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm"
                        >
                          {slotOptions(task.id, pos).map((o: any) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {letter && (
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={weightsOf(entry)[letter] ?? 1}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setTaskAssignment(task.id, (en: any) => ({
                                ...en,
                                weights: { ...(en.weights || {}), [letter]: isNaN(val) ? 1 : val },
                              }));
                            }}
                            className="w-full bg-gray-100 dark:bg-gray-700 p-1.5 rounded text-xs"
                            title="Choice weight (relative likelihood of being picked)"
                            placeholder="Weight: 1"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-[10px] text-gray-400">
                  {slots.filter(Boolean).length === 0
                    ? "Not assigned → runs on the Global LLM Default settings (flagged in the warning banner above). Assign a Model Config to control this task's routing."
                    : `Choice order: ${[slots[0], slots[1], slots[2]].filter(Boolean).join(" → ")}. Weights control the random pick; if a call errors, the app automatically switches to the next alternate in order.`}
                </p>
              </div>
            );
          })}
        </div>
      ))}

      <button
        onClick={saveAssignment}
        disabled={isSaving}
        className="bg-black dark:bg-white text-white dark:text-black w-full p-2 rounded font-bold"
      >
        {isSaving ? "Saving..." : "Save Task Assignments"}
      </button>
    </div>
  );
}

function weightsOf(entry: any): Record<string, number> {
  return entry?.weights || {};
}

// ---------------------------------------------------------
// SUBVIEW 4: TASK SETTINGS & PROMPTS (one section per task)
// ---------------------------------------------------------

const TASK_SECTIONS: { id: string; label: string; icon: any; note?: string }[] = [
  { id: "chat", label: "AIC-User Chat Messaging", icon: MessageSquare },
  { id: "async", label: "Asynchronous Messaging", icon: Radio },
  { id: "evaluation", label: "User Profile Evaluation (Decision Engine)", icon: Zap },
  { id: "match_delay", label: "Match Delay (AIC Response Lag)", icon: Clock, note: "Not an LLM task — pure app behavior for how mutual likes become matches." },
  { id: "persona_generation", label: "AIC Generation", icon: Wand2 },
  { id: "name_generation", label: "AIC Name Generation (Name Resolver)", icon: Tag },
  { id: "self_tagging", label: "AIC Self-Tagging", icon: Sliders },
  { id: "portrait_tagging", label: "Utility: Portrait Auto-Tagging", icon: ImageIcon },
  { id: "portrait_assign", label: "AIC Image Picker", icon: ImageIcon },
  { id: "voice_picker", label: "AIC Voice Picker", icon: Volume2 },
  { id: "bio", label: "AIC Bio Writer", icon: FileText },
  { id: "image_prompt_writer", label: "AIC Image Prompt Writer", icon: ImageIcon },
  { id: "gossip", label: "Gossip Review Generation", icon: Users },
  { id: "aic_match", label: "AIC↔AIC Match Evaluation", icon: Bot, note: "Also configurable in the AIC Network tab — both locations edit the same settings." },
  { id: "aic_chat", label: "AIC↔AIC Chat Messaging", icon: Bot, note: "Also configurable in the AIC Network tab — both locations edit the same settings." },
  { id: "aic_summary", label: "AIC↔AIC Summary", icon: Bot, note: "Also configurable in the AIC Network tab — both locations edit the same settings." },
];

function TaskSettingsView(props: any) {
  const { openTask, setOpenTask } = props;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Every LLM task the app performs, each with its own prompts, parameters and trigger/debug buttons. Which model each task
        uses is a routing question — configure that under <strong>AI Model Task Assignment</strong>; what each task says and does
        is configured here.
      </p>

      {TASK_SECTIONS.map((s) => (
        <div key={s.id} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
          <button
            onClick={() => setOpenTask(openTask === s.id ? null : s.id)}
            className="w-full px-4 py-3 flex justify-between items-center bg-gray-50 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-800 transition select-none"
          >
            <span className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-2">
              <s.icon className="w-4 h-4 text-pink-500" /> {s.label}
            </span>
            <span className="text-xs text-gray-400">{openTask === s.id ? "▲ Close" : "▼ Open"}</span>
          </button>
          {openTask === s.id && (
            <div className="p-4 space-y-4 border-t border-gray-100 dark:border-gray-800">
              {s.note && <p className="text-[11px] text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 rounded-lg">ℹ️ {s.note}</p>}
              {s.id === "chat" && <ChatTaskSection {...props} />}
              {s.id === "async" && <AsyncTaskSection {...props} />}
              {s.id === "evaluation" && <EvaluationTaskSection {...props} />}
              {s.id === "match_delay" && <MatchDelaySection {...props} />}
              {s.id === "persona_generation" && <GenerationTaskSection {...props} />}
              {s.id === "name_generation" && <NameGenerationTaskSection {...props} />}
              {s.id === "self_tagging" && <SelfTaggingTaskSection {...props} />}
              {s.id === "portrait_tagging" && <PortraitTaggingTaskSection {...props} />}
              {s.id === "portrait_assign" && <ImagePickerTaskSection {...props} />}
              {s.id === "voice_picker" && <VoicePickerTaskSection {...props} />}
              {s.id === "bio" && <BioTaskSection {...props} />}
              {s.id === "image_prompt_writer" && <ImagePromptWriterTaskSection {...props} />}
              {s.id === "gossip" && <GossipTaskSection {...props} />}
              {s.id === "aic_match" && <AicAicMatchSection {...props} />}
              {s.id === "aic_chat" && <AicAicChatSection {...props} />}
              {s.id === "aic_summary" && <AicAicSummarySection {...props} />}
            </div>
          )}
        </div>
      ))}

      <button
        onClick={() => props.saveSettings()}
        disabled={props.isSaving}
        className="bg-black dark:bg-white text-white dark:text-black w-full p-2 rounded font-bold"
      >
        {props.isSaving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

// Live, always-up-to-date visualization of how the AIC-User chat system prompt
// and message payload are assembled (including optional injections).
function ChatPromptDiagram({ settings }: any) {
  const crossChatOn = (settings.cross_chat_include_user_in_aic || "true") !== "false";
  const crossChatLoc = settings.cross_chat_injection_location || "system_prompt_bottom";
  const gossipOn = (settings.gossip_inject_in_chat || "true") !== "false";
  const gossipLoc = settings.gossip_injection_location || "system_prompt_bottom";
  const imagesOn = (settings.inline_images || "true") !== "false";
  const stampsOn = (settings.pass_timestamps || "true") !== "false";

  const topBlocks: string[] = [];
  const bottomBlocks: string[] = [];
  if (crossChatOn) (crossChatLoc === "system_prompt_top" ? topBlocks : bottomBlocks).push("Cross-chat memory (what this AIC knows from its other conversations)");
  if (gossipOn) (gossipLoc === "system_prompt_top" ? topBlocks : bottomBlocks).push("Gossip board block (peer reviews about you)");

  const Row = ({ n, children, on = true }: any) => (
    <li className={`flex gap-2 ${on ? "" : "opacity-40 line-through"}`}>
      <span className="font-mono text-[10px] text-pink-500 pt-0.5 min-w-[1.4em]">{n}</span>
      <span>{children}</span>
    </li>
  );

  const v3On =
    (!settings.tts_provider || settings.tts_provider === "elevenlabs") &&
    String(settings.elevenlabs_model_id || "").trim().toLowerCase().startsWith("eleven_v3");

  let n = 0;
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50 dark:bg-gray-900/40 space-y-3">
      <p className="text-xs font-bold text-gray-600 dark:text-gray-300">🧩 Live prompt structure — assembled fresh on every AIC-User chat message:</p>
      <ol className="text-xs text-gray-600 dark:text-gray-300 space-y-1.5">
        {topBlocks.map((b, i) => (
          <Row key={`t${i}`} n={`T${topBlocks.length - i}`}>
            {b} <span className="text-[10px] text-gray-400">(injected at the TOP of the system prompt)</span>
          </Row>
        ))}
        <Row n={++n}><strong>Chat Prompt Prefix</strong> (editable in this section)</Row>
        <Row n={++n}><strong>Character identity:</strong> name, private persona, public bio (from the character file)</Row>
        <Row n={++n}><strong>Match record:</strong> match status, your swipe, their swipe decision, and their internal evaluation rationale</Row>
        <Row n={++n}><strong>Your user context:</strong> name, bio, gender, looking-for</Row>
        <Row n={++n}><strong>Critical rules</strong> (stay in character; timestamp etiquette) + <strong>Unmatch rule</strong> (editable below)</Row>
        {bottomBlocks.map((b, i) => (
          <Row key={`b${i}`} n={++n}>{b} <span className="text-[10px] text-gray-400">(injected at the BOTTOM of the system prompt)</span></Row>
        ))}
        <Row n={++n} on={v3On}>{`ElevenLabs v3 voice-tag prompting — {eleven_v3_prompting} references anywhere in the assembled prompt resolve to the TTS setting's text`} <span className="text-[10px] text-gray-400">{v3On ? "(TTS provider is ElevenLabs AND model is ElevenLabs v3 — resolves)" : "(TTS provider is not ElevenLabs, or model is not ElevenLabs v3 — resolves to nothing)"}</span></Row>
      </ol>
      <div className="text-xs text-gray-600 dark:text-gray-300 space-y-1">
        <p className="font-bold">Then the message payload sent to the model:</p>
        <ol className="space-y-1">
          <Row n="a" on={stampsOn}>Full chat history with <code className="text-[10px]">[Sent at ...]</code> timestamps — {stampsOn ? "enabled (Pass Timestamps to LLM)" : "disabled (Pass Timestamps to LLM)"}</Row>
          <Row n="b" on={imagesOn}>Both profile pictures as reference images — {imagesOn ? "enabled (Inline Images)" : "disabled (Inline Images)"}</Row>
        </ol>
      </div>
    </div>
  );
}

// ---- AIC-User Chat section ----
function ChatTaskSection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Applies to every in-character reply you receive in Chat (including Regenerate and Edit actions). The full prompt
        structure is shown live below — injections appear or disappear as you toggle their settings in this section and in the
        AIC Network tab.
      </p>

      <ChatPromptDiagram settings={settings} />

      <PromptField
        label="Chat Prompt Prefix"
        description="Placed at the very beginning of every chat's system instructions, BEFORE the character's details (see structure diagram above). This prefix is used ONLY by AIC-User Chat — other tasks have their own prompts. Reference {eleven_v3_prompting} to inject the ElevenLabs v3 voice-tag prompting — it resolves to empty unless the TTS model is ElevenLabs v3."
        placeholders={["eleven_v3_prompting"]}
        value={settings.system_prompt_prefix}
        onChange={(e: any) => handleChange("system_prompt_prefix", e.target.value)}
        rows={4}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField
          label="Unmatch Hint Threshold (total messages)"
          type="number"
          value={settings.unmatch_msg_threshold_hint}
          onChange={(e: any) => handleChange("unmatch_msg_threshold_hint", e.target.value)}
          description="If the chat is longer than this, the AIC must have hinted at parting ways in earlier messages before it may unmatch."
        />
        <TextField
          label="Unmatch Reluctant Threshold (total messages)"
          type="number"
          value={settings.unmatch_msg_threshold_reluctant}
          onChange={(e: any) => handleChange("unmatch_msg_threshold_reluctant", e.target.value)}
          description="Beyond this length the AIC becomes extremely reluctant to unmatch, reserving it for severe conflicts."
        />
      </div>

      <PromptField
        label="AIC Unmatching Prompt Template Block"
        description="Appended to the critical rules; instructs the AIC when and how to permanently unmatch via the [UNMATCH] tag."
        placeholders={["hint_threshold", "reluctant_threshold", "total_messages"]}
        value={settings.prompt_unmatch_rule}
        onChange={(e: any) => handleChange("prompt_unmatch_rule", e.target.value)}
        rows={5}
      />

      <p className="text-[10px] text-gray-400">
        No manual trigger — this task fires whenever you send a message. Use “Asynchronous Messaging → Trigger Random
        Asynchronous Message” to generate an incoming reply without typing one.
      </p>
    </div>
  );
}

// ---- Asynchronous Messaging section ----
function AsyncTaskSection({ settings, handleChange, handleTriggerAsync, isTriggeringAsync }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Lets matched characters spontaneously start conversations and send unread messages on their own (tab switches, swipes,
        and a background timer). Uses the same routing as AIC-User Chat unless you assign a Model Config to
        “Asynchronous Messaging”.
      </p>

      <TriggerButton onClick={handleTriggerAsync} disabled={isTriggeringAsync} label="Trigger Random Asynchronous Message (debug)" busyLabel="Generating Initiative Message..." className="w-full" />
      <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Triggers active DM outreach in the background.</p>

      <SelectField
        label="Enable Asynchronous Messaging"
        value={settings.async_messaging_enabled || "true"}
        onChange={(e: any) => handleChange("async_messaging_enabled", e.target.value)}
        options={[
          { value: "true", label: "Enabled (matched characters message the user spontaneously)" },
          { value: "false", label: "Disabled" },
        ]}
      />

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Hard Cutoff (Max Total Unreads)" type="number" value={settings.async_hard_cutoff} onChange={(e: any) => handleChange("async_hard_cutoff", e.target.value)} placeholder="e.g. 20" description="Absolute cap on unread messages the USER may accumulate across ALL matches combined (a per-user total, not per character)." />
        <TextField label="Soft Limit (Unreads before decay)" type="number" value={settings.async_soft_limit} onChange={(e: any) => handleChange("async_soft_limit", e.target.value)} placeholder="e.g. 5" description="Beyond this, the chance of further messages decays." />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <TextField label="Chance (Tab Switch)" type="number" value={settings.async_chance_tab_switch} onChange={(e: any) => handleChange("async_chance_tab_switch", e.target.value)} />
        <TextField label="Chance (Swipe)" type="number" value={settings.async_chance_swipe} onChange={(e: any) => handleChange("async_chance_swipe", e.target.value)} />
        <TextField label="Chance (1-Min Interval)" type="number" value={settings.async_chance_interval} onChange={(e: any) => handleChange("async_chance_interval", e.target.value)} />
      </div>

      <TextField
        label="Global Delay Multiplier Coefficient"
        type="number"
        value={settings.async_global_delay_coeff}
        onChange={(e: any) => handleChange("async_global_delay_coeff", e.target.value)}
        placeholder="e.g. 1.0 (Higher = more delay chance)"
        description="Calculated as: Character Delay Chance × Global Multiplier. On a user's first message to an AIC, the delay chance is boosted 5x (up to an 80% ceiling) to replicate real-life response lag."
      />

      <PromptField
        label="Asynchronous Messaging Prompt Context"
        description="System prompt instructions telling the AIC what initiative to take when messaging on its own."
        value={settings.prompt_async_message}
        onChange={(e: any) => handleChange("prompt_async_message", e.target.value)}
        rows={4}
      />
      <p className="text-[10px] text-gray-400">
        Model routing: assign configs to the “Asynchronous Messaging” task; when none is assigned, it runs on the Global LLM Default settings.
      </p>
    </div>
  );
}

// ---- Evaluation section ----
function EvaluationTaskSection({ settings, handleChange, handleEvaluate, isEvaluating }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">The Decision Engine: characters privately evaluate your active profile and decide to pass, like, or slide-in.</p>

      <TriggerButton onClick={() => handleEvaluate(true)} disabled={isEvaluating} label="Evaluate User Profile (AICs Who Haven't Evaluated Yet)" busyLabel="Evaluating..." className="w-full" />

      <PromptField
        label="AI Swipe Evaluation Prompt Template"
        description="The character's private evaluation instructions for human profiles."
        placeholders={["private_persona", "user_name", "user_gender", "user_looking_for", "user_bio", "user_avatar_description", "image_prompt_block"]}
        value={settings.prompt_evaluate_swipe}
        onChange={(e: any) => handleChange("prompt_evaluate_swipe", e.target.value)}
        rows={8}
      />

    </div>
  );
}

// ---- Match Delay section (AIC Evaluation Delay feature) ----
// Not an LLM task: pure timing/behavior configuration for mutual-match materialization.
function MatchDelaySection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        When you like a character who has already liked you, the mutual match normally lands instantly. With this feature,
        each such match has a configurable chance to instead be delayed — the character “gets back to you” after a realistic
        lag. Slide-ins (characters who messaged first) always match instantly. Delayed matches appear with a
        “You have a new match” push notification when their timer elapses while the app is running; if the app is closed the
        timer is not running either, and the match appears (with the notification) the next time the app is open.
      </p>

      <SelectField
        label="Enable Match Delay"
        value={settings.match_delay_enabled || "true"}
        onChange={(e: any) => handleChange("match_delay_enabled", e.target.value)}
        options={[
          { value: "true", label: "Enabled (mutual likes can match after a delay)" },
          { value: "false", label: "Disabled (all mutual likes match instantly)" },
        ]}
      />

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Delay Chance"
          type="number"
          value={settings.match_delay_chance}
          onChange={(e: any) => handleChange("match_delay_chance", e.target.value)}
          placeholder="e.g. 0.6 (= 60%)"
          description="Probability (0–1) that a mutual like is delayed instead of matching instantly. Default 0.6."
        />
        <TextField
          label="Delay Durations (minutes)"
          value={settings.match_delay_durations}
          onChange={(e: any) => handleChange("match_delay_durations", e.target.value)}
          placeholder="e.g. 1,5,10,30,60"
          description="Comma-separated list; one value is picked at random per delayed match. Default 1,5,10,30,60. Blank resets to the default; a list with no valid values (e.g. just 0) disables delays entirely."
        />
      </div>
    </div>
  );
}

// ---- AIC Generation section ----
function GenerationTaskSection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Creating brand-new character personas — both preference-driven generation and manual tag-score generation.
        (The full AIC Generation workspace with live preference tables remains in the <strong>AIC Gen</strong> tab; those
        prompts are the same settings edited here.)
      </p>

      <PromptField
        label="AIC Generation Base Prompt"
        description="The master instructions for generating a new character's JSON spec (persona, tags, delays, etc.)."
        placeholders={["gender", "looking_for", "tags_specification", "taken_names", "block_template"]}
        value={settings.aic_gen_base_prompt}
        onChange={(e: any) => handleChange("aic_gen_base_prompt", e.target.value)}
        rows={8}
      />

      <PromptField
        label="AIC Generation Block Template"
        description="Optional extra block appended into the base prompt via the {block_template} placeholder."
        placeholders={["gender", "looking_for", "tags_specification"]}
        value={settings.aic_gen_block_template}
        onChange={(e: any) => handleChange("aic_gen_block_template", e.target.value)}
        rows={5}
      />

      <p className="text-[10px] text-gray-400">
        Manual triggers: <strong>Manual Triggers → Generate AIC</strong>, or the full workflow in the AICs tab (AIC Generation section, at the bottom).
      </p>
    </div>
  );
}

// ---- Name Generation section ----
function NameGenerationTaskSection({ settings, handleChange, handleResolveNames }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Generates unique, contextually appropriate character names for the AI Name Resolver (duplicates/empty/placeholder names) and the duplicate-name retry loop during generation.</p>

      <TriggerButton onClick={() => handleResolveNames()} disabled={false} label="Run AI Name Resolver (debug)" color="purple" className="w-full" />
      <p className="text-[10px] text-gray-400">✔️ Safe to change tabs / chat. Renames duplicate and unnamed characters in the background.</p>

      <PromptField
        label="AI Name Generation Prompt Template"
        description="Custom naming instructions. The resolver lists all taken names so the LLM avoids them."
        placeholders={["private_persona", "tags_specification", "taken_names"]}
        value={settings.prompt_name_generation}
        onChange={(e: any) => handleChange("prompt_name_generation", e.target.value)}
        rows={5}
      />
      <p className="text-[10px] text-gray-400">
        When no Model Config is assigned, this task runs on the Global LLM Default settings.
      </p>
    </div>
  );
}

// ---- Self-Tagging section ----
function SelfTaggingTaskSection({ settings, handleChange, handleBulkGenerateTags, isGeneratingTags }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Characters rate themselves 1-10 across all 100 master traits, aligned with their persona and photo. The master tag list itself lives in <strong>Global Settings</strong>.</p>

      <TriggerButton onClick={() => handleBulkGenerateTags()} disabled={isGeneratingTags} label="Trigger Self-Tagging (debug — all characters without tags)" busyLabel="Tagging..." color="blue" className="w-full" />

      <PromptField
        label="AI Self-Tagging Evaluation Prompt Template"
        description="Vision-assisted: the character's photo is attached for alignment with their visual look."
        placeholders={["character_name", "public_bio", "private_persona", "avatar_image", "master_tags"]}
        value={settings.prompt_self_tagging}
        onChange={(e: any) => handleChange("prompt_self_tagging", e.target.value)}
        rows={6}
      />
      <p className="text-[10px] text-gray-400">
        When no Model Config is assigned, this task runs on the Global LLM Default settings.
      </p>
    </div>
  );
}

// ---- Portrait Auto-Tagging section ----
function PortraitTaggingTaskSection(props: any) {
  const { settings, handleChange, isProcessingPhotos, photoProgress, unprocessedPhotosCount, numPhotosToProcess, setNumPhotosToProcess, handleProcessPhotos, loadSettings } = props;
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Vision analysis of unprocessed library portraits: assigns predefined tags, 10 custom tags, and a 3-sentence description.
        Results power the AIC Image Picker and preference matching.
      </p>

      <div className="flex flex-col border border-teal-200/40 dark:border-teal-900/40 p-3 rounded-xl bg-teal-500/5 gap-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={500}
            value={numPhotosToProcess}
            onChange={(e) => setNumPhotosToProcess(Math.max(1, parseInt(e.target.value) || 1))}
            disabled={isProcessingPhotos}
            className="w-16 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-2 py-1 rounded border border-teal-300 dark:border-teal-800 text-xs text-center font-bold"
            title="Number of photos to process"
          />
          <TriggerButton
            onClick={handleProcessPhotos}
            disabled={isProcessingPhotos}
            label={`Process Unprocessed Photos (${unprocessedPhotosCount} remaining)`}
            busyLabel="Processing..."
            color="teal"
            className="flex-1"
          />
        </div>
        {photoProgress && (
          <div className="space-y-1">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1 overflow-hidden">
              <div className="bg-teal-500 h-1 rounded-full transition-all duration-300" style={{ width: `${(photoProgress.current / photoProgress.total) * 100}%` }} />
            </div>
            <p className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold truncate">
              {photoProgress.status} ({photoProgress.current}/{photoProgress.total})
            </p>
          </div>
        )}
        <TriggerButton
          onClick={async () => {
            const res = await safeFetch("/api/portraits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
            if (res.success) {
              showToast(res.message);
              await loadSettings();
            } else {
              showToast("Scan failed: " + res.error);
            }
          }}
          disabled={false}
          label="Scan Portrait Folder (import new files)"
          color="indigo"
          className="w-full"
        />
      </div>

      <TextField
        label="Predefined Portrait Tags (comma-separated)"
        value={(() => {
          try {
            return settings.portrait_predefined_tags ? JSON.parse(settings.portrait_predefined_tags).join(", ") : "";
          } catch {
            return "";
          }
        })()}
        onChange={(e: any) => {
          const tags = e.target.value.split(",").map((t: string) => t.trim()).filter((t: string) => t.length > 0);
          handleChange("portrait_predefined_tags", JSON.stringify(tags));
        }}
        description="The fixed tag vocabulary the vision model assigns (e.g. gender, hair color)."
      />

      <PromptField
        label="Portrait Auto-Tagging Prompt Template"
        description="Vision LLM instructions for analyzing each portrait photo."
        placeholders={["predefined_tags"]}
        value={settings.prompt_portrait_tagging}
        onChange={(e: any) => handleChange("prompt_portrait_tagging", e.target.value)}
        rows={6}
      />
      <p className="text-[10px] text-gray-400">
        When no Model Config is assigned, this task runs on the Global LLM Default settings.
      </p>
    </div>
  );
}

// ---- AIC Image Picker section ----
function ImagePickerTaskSection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Characters choose their own profile picture from up to N sampled, processed, unassigned portraits filtered by gender (sample size configurable below, default 40).</p>

      <TextField label="Portrait Sample Size" type="number" value={settings.portrait_assign_sample_count} onChange={(e: any) => handleChange("portrait_assign_sample_count", e.target.value)} placeholder="e.g. 40" description="How many sampled, gender-filtered portraits each character chooses from when picking their photo (default 40)." />

      <TriggerButton
        onClick={async () => {
          if (await confirmInApp("Trigger intelligent portrait photo selection for all active characters who don't have a photo yet?")) {
            const res = await safeFetch("/api/portraits/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allEmpty: true }) });
            if (res.success) {
              showToast(`Successfully assigned custom portraits for ${res.selectedCount} characters.`);
            } else {
              showToast("Photo selection failed: " + res.error);
            }
          }
        }}
        disabled={false}
        label="Auto-Assign Portrait Images (debug — all characters without a photo)"
        color="orange"
        className="w-full"
      />

      <PromptField
        label="Character Portrait Selection Prompt Template"
        description="The character adopts their own voice and picks the portrait that best aligns with their private persona."
        placeholders={["character_name", "private_persona", "portraits_list"]}
        value={settings.prompt_portrait_selection}
        onChange={(e: any) => handleChange("prompt_portrait_selection", e.target.value)}
        rows={6}
      />
      <p className="text-[10px] text-gray-400">
        Per-character repicking is also available in the <strong>AICs</strong> tab editor. When no Model Config is assigned,
        this task runs on the Global LLM Default settings.
      </p>
    </div>
  );
}

// ---- Voice Picker section ----
function VoicePickerTaskSection({ settings, handleChange, handleVoicePicker, isPickingVoice }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Characters choose their own ElevenLabs voice from the catalog below, balancing usage across voices. The prompt and the
        voice catalog are both fully editable. Voice usage counts only include active (non-disabled, non-deleted) characters.
      </p>

      <TriggerButton onClick={() => handleVoicePicker(true)} disabled={isPickingVoice} label="Run Voice Picker on Characters with No Voice" busyLabel="Processing..." className="w-full" />

      <PromptField
        label="AI Voice Picker Prompt Template"
        description="Sent to the character with the full voice catalog (including each voice's current usage count)."
        placeholders={["character_name", "gender", "public_bio", "private_persona", "voice_catalog"]}
        value={settings.prompt_voice_picker}
        onChange={(e: any) => handleChange("prompt_voice_picker", e.target.value)}
        rows={8}
      />

      <p className="text-[11px] text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 rounded-lg">
        🗣️ The voice catalog (voice IDs + descriptions) is edited with a proper editor in the <strong>TTS Settings</strong>{" "}
        tab (“ElevenLabs Voice Library”). An empty or invalid catalog falls back to the built-in default library at pick time.
      </p>
      <p className="text-[10px] text-gray-400">
        When no Model Config is assigned, this task runs on the Global LLM Default settings.
      </p>
    </div>
  );
}

// ---- Bio Writer section ----
function BioTaskSection({ settings, handleChange, handleBulkGenerateBio, isGeneratingBio }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Writes structured public bios (Intro, About Me, My Prompts) for characters, visually aligned with their portrait. The
        master questionnaire library lives in <strong>Global Settings</strong>.
      </p>

      <TriggerButton onClick={() => handleBulkGenerateBio()} disabled={isGeneratingBio} label="AICs with Empty Bio Fill Bio Questionnaire (debug)" busyLabel="Generating..." color="pink" className="w-full" />

      <SelectField
        label="Bio Name Guidance"
        value={settings.bio_name_guidance_enabled || "true"}
        onChange={(e: any) => handleChange("bio_name_guidance_enabled", e.target.value)}
        options={[
          { value: "true", label: "Enabled (solo bios omit own name; group bios can use it)" },
          { value: "false", label: "Disabled (no name instructions appended)" },
        ]}
        description="Appends a small runtime instruction: solo profiles never state their own name in the bio text, while group profiles (names containing “&” or “and”) may reference their names."
      />

      <PromptField
        label="AI Bio Questionnaire Generation Prompt Template"
        description="Vision-assisted: the character's photo is attached so the bio aligns with their visual look."
        placeholders={["character_name", "gender", "looking_for", "private_persona", "avatar_image", "master_questions"]}
        value={settings.prompt_bio_writing}
        onChange={(e: any) => handleChange("prompt_bio_writing", e.target.value)}
        rows={8}
      />

    </div>
  );
}

// ---- Image Prompt Writer section ----
function ImagePromptWriterTaskSection({ settings, handleChange, handleImagePromptWriter, isWritingPrompts }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Writes each character's visual appearance description (vision-assisted by their portrait when they have one). The description replaces the raw persona excerpt as the appearance input for AI-generated portraits and is injected into chat image generation so generated images match the character. Characters without a description are processed by the bulk trigger.</p>

      <TriggerButton onClick={handleImagePromptWriter} disabled={isWritingPrompts} label="Write Image Prompts (Characters Without One)" busyLabel="Writing..." color="blue" className="w-full" />

      <PromptField
        label="Image Prompt Writer Prompt Template"
        description="Vision-assisted: the character's portrait is attached when they have one. The result is stored on the character and used by AI image generation."
        placeholders={["character_name", "gender", "avatar_image", "persona"]}
        value={settings.prompt_image_prompt_writer}
        onChange={(e: any) => handleChange("prompt_image_prompt_writer", e.target.value)}
        rows={7}
      />
      <p className="text-[10px] text-gray-400">
        This task is managed from the Image Generation tab (Manual Triggers → Write Image Prompts runs the same writer).
      </p>
    </div>
  );
}

// ---- Gossip section ----
function GossipTaskSection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        The community review board: characters write anonymous peer reviews of their matches, which are optionally
        injected into evaluations and chats (toggles below). The board UI with its own manual-post button lives in the{" "}
        <strong>Gossip</strong> tab.
      </p>

      <PromptField
        label="Gossip Review Generation Prompt Template (Community Board)"
        description="The character writes a candid review post of their match; outputs JSON (content, sentiment, rating, badges, anonymity)."
        placeholders={["character_name", "private_persona", "public_bio", "user_name", "trigger_reason", "chat_transcript", "available_badges"]}
        value={settings.prompt_gossip_review}
        onChange={(e: any) => handleChange("prompt_gossip_review", e.target.value)}
        rows={8}
      />

      <PromptField
        label="Gossip Injection Block for Evaluations"
        description="Injected into swipe evaluations so characters weigh peer reviews about the user."
        placeholders={["user_name", "gossip_reviews_list"]}
        value={settings.prompt_gossip_eval_injection}
        onChange={(e: any) => handleChange("prompt_gossip_eval_injection", e.target.value)}
        rows={4}
      />

      <PromptField
        label="Gossip Context Injection for Chat"
        description="Injected into AIC-User chat so characters can playfully use what they've heard."
        placeholders={["user_name", "gossip_reviews_list"]}
        value={settings.prompt_gossip_chat_injection}
        onChange={(e: any) => handleChange("prompt_gossip_chat_injection", e.target.value)}
        rows={4}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="Review Message Milestones (JSON array)" value={settings.gossip_message_milestones} onChange={(e: any) => handleChange("gossip_message_milestones", e.target.value)} placeholder="[40, 100]" description="Chat message counts that trigger an automatic review post." />
        <TextField label="Milestone Trigger Chance (0-1)" type="number" value={settings.gossip_milestone_trigger_chance} onChange={(e: any) => handleChange("gossip_milestone_trigger_chance", e.target.value)} />
        <SelectField label="Review on User Unmatch" value={settings.gossip_trigger_unmatch_user || "true"} onChange={(e: any) => handleChange("gossip_trigger_unmatch_user", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        <SelectField label="Review on AIC Unmatch" value={settings.gossip_trigger_unmatch_aic || "true"} onChange={(e: any) => handleChange("gossip_trigger_unmatch_aic", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        <TextField label="Unmatch Trigger Chance (0-1)" type="number" value={settings.gossip_unmatch_trigger_chance} onChange={(e: any) => handleChange("gossip_unmatch_trigger_chance", e.target.value)} />
        <SelectField label="Review on Ignored Slide-In" value={settings.gossip_trigger_slide_in_ignored || "true"} onChange={(e: any) => handleChange("gossip_trigger_slide_in_ignored", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        <TextField label="Ignored Slide-In Chance (0-1)" type="number" value={settings.gossip_slide_in_ignored_trigger_chance} onChange={(e: any) => handleChange("gossip_slide_in_ignored_trigger_chance", e.target.value)} />
        <TextField label="Ignored Slide-In Delay (hours)" type="number" value={settings.gossip_slide_in_ignore_delay_hours} onChange={(e: any) => handleChange("gossip_slide_in_ignore_delay_hours", e.target.value)} />
        <SelectField label="Review on Accepted Slide-In" value={settings.gossip_trigger_slide_in_accepted || "true"} onChange={(e: any) => handleChange("gossip_trigger_slide_in_accepted", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField label="Inject Gossip into Evaluations" value={settings.gossip_inject_in_evaluations || "true"} onChange={(e: any) => handleChange("gossip_inject_in_evaluations", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        <TextField label="Evaluation Injection Chance (0-1)" type="number" value={settings.gossip_eval_inject_chance} onChange={(e: any) => handleChange("gossip_eval_inject_chance", e.target.value)} />
        <TextField label="Max Reviews per Evaluation" type="number" value={settings.gossip_eval_max_reviews} onChange={(e: any) => handleChange("gossip_eval_max_reviews", e.target.value)} />
        <SelectField label="Inject Gossip into Chat" value={settings.gossip_inject_in_chat || "true"} onChange={(e: any) => handleChange("gossip_inject_in_chat", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        <TextField label="Chat Injection Chance (0-1)" type="number" value={settings.gossip_chat_inject_chance} onChange={(e: any) => handleChange("gossip_chat_inject_chance", e.target.value)} />
        <TextField label="Max Reviews per Chat Injection" type="number" value={settings.gossip_chat_max_reviews} onChange={(e: any) => handleChange("gossip_chat_max_reviews", e.target.value)} />
      </div>

      <GossipBadgesCatalog settings={settings} handleChange={handleChange} />

      <SelectField
        label="Injection Location (System Prompt)"
        value={settings.gossip_injection_location || "system_prompt_bottom"}
        onChange={(e: any) => handleChange("gossip_injection_location", e.target.value)}
        options={[
          { value: "system_prompt_top", label: "Top of system prompt" },
          { value: "system_prompt_bottom", label: "Bottom of system prompt" },
        ]}
        description="Where the gossip block lands inside chat system prompts — reflected live in the AIC-User Chat prompt diagram."
      />

    </div>
  );
}

function GossipBadgesCatalog({ settings, handleChange }: any) {
  return (
    <Field
      label="Gossip Badges Catalog (JSON array of { name, category, emoji })"
      description="The badge vocabulary reviewers pick from. The Gossip tab's Badge Manager edits this same catalog."
    >
      <textarea
        rows={6}
        value={(() => {
          try {
            return settings.gossip_badges_catalog ? JSON.stringify(JSON.parse(settings.gossip_badges_catalog), null, 1) : "";
          } catch {
            return settings.gossip_badges_catalog || "";
          }
        })()}
        onChange={(e: any) => handleChange("gossip_badges_catalog", e.target.value)}
        className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-[10px] font-mono"
      />
      <p className="text-[10px] text-gray-400 mt-1">⚠️ Must be valid JSON or the board falls back to its internal defaults.</p>
    </Field>
  );
}

// ---- AIC↔AIC Match Evaluation section ----
function AicAicMatchSection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        AIC Network: characters evaluate other characters' profiles for mutual likes and slide-ins.
      </p>

      <PromptField
        label="AIC↔AIC Match Evaluation Prompt Template"
        description="Character A evaluates character B's profile based on their private persona and orientation."
        placeholders={["character_a_name", "character_b_name", "character_a_private_persona", "character_a_public_bio", "character_a_gender", "character_a_looking_for", "character_b_gender", "character_b_looking_for", "character_b_public_bio", "image_prompt_block"]}
        value={settings.prompt_aic_aic_eval}
        onChange={(e: any) => handleChange("prompt_aic_aic_eval", e.target.value)}
        rows={8}
      />

      <p className="text-[10px] text-gray-400">
        Manual triggers live in the <strong>Network</strong> tab (manual match/evaluation bar and simulation rounds).
      </p>
    </div>
  );
}

// ---- AIC↔AIC Chat section ----
function AicAicChatSection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Character-to-character conversations inside the AIC Network simulation, including unmatching rules and cross-chat memory for AICs.</p>

      <PromptField
        label="AIC↔AIC Chat System Prompt Template"
        description="Each character's in-character instructions for talking with another AIC."
        placeholders={["character_name", "partner_name", "private_persona", "character_public_bio", "other_chats_memory_block", "partner_public_bio", "unmatch_rule"]}
        value={settings.prompt_aic_aic_chat}
        onChange={(e: any) => handleChange("prompt_aic_aic_chat", e.target.value)}
        rows={7}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField label="Include Profile Images (vision)" value={settings.aic_aic_include_images || "true"} onChange={(e: any) => handleChange("aic_aic_include_images", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        <SelectField label="Allow AIC↔AIC Unmatching" value={settings.aic_aic_allow_unmatch || "true"} onChange={(e: any) => handleChange("aic_aic_allow_unmatch", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        <TextField label="Unmatch Hint Threshold (messages)" type="number" value={settings.aic_aic_unmatch_msg_threshold_hint} onChange={(e: any) => handleChange("aic_aic_unmatch_msg_threshold_hint", e.target.value)} />
        <TextField label="Unmatch Reluctant Threshold (messages)" type="number" value={settings.aic_aic_unmatch_msg_threshold_reluctant} onChange={(e: any) => handleChange("aic_aic_unmatch_msg_threshold_reluctant", e.target.value)} />
        <TextField label="Max Messages per AIC↔AIC Chat" type="number" value={settings.aic_aic_max_messages_per_chat} onChange={(e: any) => handleChange("aic_aic_max_messages_per_chat", e.target.value)} />
        <TextField label="Max AIC↔AIC Matches per Character" type="number" value={settings.aic_aic_max_matches_per_char} onChange={(e: any) => handleChange("aic_aic_max_matches_per_char", e.target.value)} />
        <TextField label="Max Total AIC↔AIC Calls (guardrail)" type="number" value={settings.aic_aic_max_total_calls} onChange={(e: any) => handleChange("aic_aic_max_total_calls", e.target.value)} />
        <SelectField label="Emergency Stop (freeze all AIC↔AIC calls)" value={settings.aic_aic_emergency_stop || "false"} onChange={(e: any) => handleChange("aic_aic_emergency_stop", e.target.value)} options={[{ value: "false", label: "Off (normal operation)" }, { value: "true", label: "ON — block all AIC↔AIC calls" }]} />
      </div>

      <PromptField
        label="AIC↔AIC Unmatching Prompt Template Block"
        description="Appended to AIC↔AIC chat instructions; governs [UNMATCH] behavior between characters."
        placeholders={["partner_name", "hint_threshold", "reluctant_threshold", "total_messages"]}
        value={settings.prompt_aic_aic_unmatch_rule}
        onChange={(e: any) => handleChange("prompt_aic_aic_unmatch_rule", e.target.value)}
        rows={5}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TextField label="Sim Round: Eval Attempts" type="number" value={settings.sim_round_eval_attempts} onChange={(e: any) => handleChange("sim_round_eval_attempts", e.target.value)} />
        <TextField label="Sim Round: Messages per Chat" type="number" value={settings.sim_round_messages_per_chat} onChange={(e: any) => handleChange("sim_round_messages_per_chat", e.target.value)} />
        <TextField label="Sim Round: Max Total Messages" type="number" value={settings.sim_round_max_total_messages} onChange={(e: any) => handleChange("sim_round_max_total_messages", e.target.value)} />
      </div>

      <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-2">
        <p className="text-xs font-bold text-gray-600 dark:text-gray-300">Cross-Chat Memory (what AICs know from their other relationships)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField label="Injection Mode" value={settings.cross_chat_injection_mode || "summary_only"} onChange={(e: any) => handleChange("cross_chat_injection_mode", e.target.value)} options={[{ value: "summary_only", label: "Summary only" }, { value: "full_transcript", label: "Full transcripts" }, { value: "both", label: "Summary + transcripts" }]} />
          <SelectField label="Injection Location" value={settings.cross_chat_injection_location || "system_prompt_bottom"} onChange={(e: any) => handleChange("cross_chat_injection_location", e.target.value)} options={[{ value: "system_prompt_top", label: "Top of system prompt" }, { value: "system_prompt_bottom", label: "Bottom of system prompt" }]} />
          <TextField label="Max Other Chats Referenced" type="number" value={settings.cross_chat_max_other_chats} onChange={(e: any) => handleChange("cross_chat_max_other_chats", e.target.value)} />
          <TextField label="Max Transcript Messages per Chat" type="number" value={settings.cross_chat_max_transcript_messages} onChange={(e: any) => handleChange("cross_chat_max_transcript_messages", e.target.value)} />
          <SelectField label="Inject into AIC→User chats" value={settings.cross_chat_include_user_in_aic || "true"} onChange={(e: any) => handleChange("cross_chat_include_user_in_aic", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
          <SelectField label="Inject into AIC→AIC chats" value={settings.cross_chat_include_aic_in_aic || "true"} onChange={(e: any) => handleChange("cross_chat_include_aic_in_aic", e.target.value)} options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} />
        </div>
      </div>

    </div>
  );
}

// ---- AIC↔AIC Summary section ----
function AicAicSummarySection({ settings, handleChange }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Concise relationship summaries of AIC↔AIC conversations, used by cross-chat memory so characters remember their other relationships.</p>

      <PromptField
        label="AIC↔AIC Summary Prompt Template"
        placeholders={["character_a_name", "character_b_name", "chat_transcript"]}
        value={settings.prompt_aic_aic_summary}
        onChange={(e: any) => handleChange("prompt_aic_aic_summary", e.target.value)}
        rows={6}
      />

    </div>
  );
}

// ---- About Hothouse subview (support / feedback) ----
// Replaces the originally planned intrusive BMC popup modal (Roadmap B4,
// revised by owner decision): a calm, always-reachable subtab instead of a
// timed modal. All links open in a new tab.
function AboutHothouseView() {
  const linkBubble =
    "flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:border-pink-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors shadow-sm";
  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-3xl border border-pink-100 dark:border-pink-900/40 bg-gradient-to-r from-pink-50 to-rose-50 dark:from-pink-950/20 dark:to-rose-950/20 p-6 space-y-4">
        <h3 className="text-lg font-extrabold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Heart className="text-pink-500 w-5 h-5" /> Support Hothouse
        </h3>

        <a
          href="https://buymeacoffee.com/hothouse"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-3 w-full bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-extrabold p-4 rounded-2xl shadow-md transition-transform hover:scale-[1.01]"
        >
          <Coffee className="w-5 h-5" />
          <span>buymeacoffee.com/hothouse</span>
          <ExternalLink className="w-4 h-4 opacity-70" />
        </a>

        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
          <p>Hothouse is open-source and will always be free.</p>
          <p className="font-bold">Please tip the barman :)</p>
          <p>
            If you went to get a drink and the bartender set you up with a hot stranger, you&apos;d probably give him a
            tip even if the hot stranger turned out to be a domineering vampire AI or whatever (maybe you&apos;d be even
            more inclined to tip, you beautiful freak).
          </p>
          <p>This is a solo passion project from a first time dev and I could use your support.</p>
          <p>Supporting gets you nothing. This project is open-source and will never be behind a paywall.</p>
          <p>
            But to me it means a lot–it means I created something that was worth somebody else&apos;s time and money. It
            means recouping the significant time and costs of making this app. And–just maybe–it sends a signal that it
            might be worth spending more time working on Hothouse, if that&apos;s something people are interested in.
          </p>
          <p className="font-semibold flex items-center gap-1">
            All the best, Hothouse Dev <Heart className="inline w-4 h-4 text-pink-500" />
          </p>
          <p>Regardless, I hope you enjoy the app and please provide feedback!</p>
        </div>
      </div>

      <div className="rounded-3xl border border-gray-100 dark:border-gray-700/60 bg-white dark:bg-gray-800 p-6 space-y-3">
        <h3 className="text-lg font-extrabold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <Globe className="text-pink-500 w-5 h-5" /> Links & Feedback
        </h3>
        <div className="grid grid-cols-1 gap-2">
          <a href="https://hothousedev.carrd.co/" target="_blank" rel="noopener noreferrer" className={linkBubble}>
            <Globe className="w-4 h-4 text-pink-500 shrink-0" />
            <span className="flex flex-col min-w-0">
              <span className="break-words">hothousedev.carrd.co</span>
              <span className="text-[10px] font-normal text-gray-400">Feedback &amp; info site</span>
            </span>
          </a>
          <a href="https://buymeacoffee.com/hothouse" target="_blank" rel="noopener noreferrer" className={linkBubble}>
            <Coffee className="w-4 h-4 text-pink-500 shrink-0" />
            <span className="flex flex-col min-w-0">
              <span className="break-words">buymeacoffee.com/hothouse</span>
              <span className="text-[10px] font-normal text-gray-400">Support the project</span>
            </span>
          </a>
          <a href="https://github.com/devhothouse/hothouse" target="_blank" rel="noopener noreferrer" className={linkBubble}>
            <GitBranch className="w-4 h-4 text-pink-500 shrink-0" />
            <span className="flex flex-col min-w-0">
              <span className="break-words">github.com/devhothouse/hothouse</span>
              <span className="text-[10px] font-normal text-gray-400">Source code</span>
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}

// ---- Global Settings subview ----
function GlobalSettingsView({ settings, handleChange, isSaving, saveSettings, loadSettings }: any) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">App-wide behavior and master libraries. Model Config assignments always take precedence; tasks without one run on the Global LLM Defaults below.</p>

      <Field label="Global LLM Defaults" description="The app-wide default LLM and the ONLY task fallback: every task without an assigned Model Config runs here (the AI Model Task Assignment view shows a warning banner listing those tasks). Blank fields inside Model Config slots (API key, model, temperature) also fall back to these settings.">
        <div className="space-y-3">
          <SelectField
            label="Default Provider"
            value={settings.llm_provider || ""}
            onChange={(e: any) => handleChange("llm_provider", e.target.value)}
            description="Used only when a task has no Model Config assigned in Manager → AI Model Task Assignment."
            options={[
              { value: "", label: "- Select provider -" },
              { value: "gemini", label: "Google Gemini" },
              { value: "claude", label: "Anthropic Claude" },
              { value: "openrouter", label: "OpenRouter" },
              { value: "openai", label: "OpenAI / OpenAI-Compatible" },
              { value: "local", label: "Local / Self-Hosted (Ollama, LM Studio, llama.cpp, vLLM…)" },
            ]}
          />
          {(settings.llm_provider || "") === "gemini" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Gemini API Key" type="password" value={settings.gemini_api_key} onChange={(e: any) => handleChange("gemini_api_key", e.target.value)} placeholder="AIzaSy..." />
              <TextField label="Gemini Model Name" value={settings.gemini_model} onChange={(e: any) => handleChange("gemini_model", e.target.value)} placeholder="e.g. gemini-3.7-flash" />
            </div>
          )}
          {(settings.llm_provider || "") === "claude" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Anthropic API Key" type="password" value={settings.anthropic_api_key} onChange={(e: any) => handleChange("anthropic_api_key", e.target.value)} placeholder="sk-ant-..." />
              <TextField label="Anthropic Model Name" value={settings.anthropic_model} onChange={(e: any) => handleChange("anthropic_model", e.target.value)} placeholder="e.g. claude-3-5-sonnet-latest" />
            </div>
          )}
          {(settings.llm_provider || "") === "openrouter" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="OpenRouter API Key" type="password" value={settings.openrouter_api_key} onChange={(e: any) => handleChange("openrouter_api_key", e.target.value)} placeholder="sk-or-v1-..." />
              <TextField label="OpenRouter Model Name" value={settings.openrouter_model} onChange={(e: any) => handleChange("openrouter_model", e.target.value)} placeholder="e.g. meta-llama/llama-3.1-8b-instruct:free" />
            </div>
          )}
          {(settings.llm_provider || "") === "openai" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="OpenAI API Key" type="password" value={settings.openai_api_key} onChange={(e: any) => handleChange("openai_api_key", e.target.value)} placeholder="sk-... (optional for local servers)" />
              <TextField label="OpenAI Model Name" value={settings.openai_model} onChange={(e: any) => handleChange("openai_model", e.target.value)} placeholder="e.g. gpt-4o-mini" />
              <TextField label="OpenAI Base URL (optional)" value={settings.openai_base_url} onChange={(e: any) => handleChange("openai_base_url", e.target.value)} placeholder="https://api.openai.com/v1" description="Blank = official OpenAI. Local OpenAI-compatible servers: Ollama http://localhost:11434/v1 · LM Studio http://localhost:1234/v1 · llama.cpp http://localhost:8080/v1 · vLLM http://localhost:8000/v1. API key not required for local servers." />
            </div>
          )}
          {(settings.llm_provider || "") === "local" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="API Key (usually not required)" type="password" value={settings.openai_api_key} onChange={(e: any) => handleChange("openai_api_key", e.target.value)} placeholder="Leave blank for most local servers" description="Local OpenAI-compatible servers (Ollama, LM Studio, llama.cpp, vLLM, KoboldCpp, LocalAI) typically need no key; fill this only if yours requires auth." />
              <TextField label="Model Name (your local model id)" value={settings.openai_model} onChange={(e: any) => handleChange("openai_model", e.target.value)} placeholder="e.g. qwen3-8b" />
              <div className="sm:col-span-2">
                <TextField label="Local Server Base URL (required)" value={settings.openai_base_url} onChange={(e: any) => handleChange("openai_base_url", e.target.value)} placeholder="http://localhost:11434/v1" description="The OpenAI-compatible endpoint of your local server — use the preset picker or type any URL." />
                <SelectField
                  label="Common local server presets (fills Base URL)"
                  value=""
                  onChange={(e: any) => { if (e.target.value) handleChange("openai_base_url", e.target.value); }}
                  options={[
                    { value: "", label: "— Pick a preset to fill Base URL —" },
                    ...LOCAL_LLM_BASE_URL_PRESETS.map((p) => ({ value: p.url, label: `${p.label} — ${p.url}` })),
                  ]}
                />
              </div>
            </div>
          )}
          <TextField label="Global Temperature" type="number" value={settings.temperature} onChange={(e: any) => handleChange("temperature", e.target.value)} description="Used whenever a task leaves its temperature blank. Default 1." />
        </div>
      </Field>

      <SelectField
        label="Disable LLM Safety Settings"
        value={settings.llm_disable_safety || "true"}
        onChange={(e: any) => handleChange("llm_disable_safety", e.target.value)}
        options={[
          { value: "true", label: "Enabled (disable safety filters)" },
          { value: "false", label: "Disabled (use default safety filters)" },
        ]}
        description="Highly recommended for adult-themed dating app roleplay to prevent LLM silent blocking errors. Applies to all providers (Gemini receives BLOCK_NONE thresholds; other providers simply omit nothing)."
      />

      <SelectField
        label="AIC Social Network"
        value={settings.aic_network_enabled || "true"}
        onChange={(e: any) => handleChange("aic_network_enabled", e.target.value)}
        options={[
          { value: "true", label: "Enabled (AICs match and chat with each other)" },
          { value: "false", label: "OFF — no match discovery, simulation rounds, or AIC↔AIC messages" },
        ]}
        description="Master switch for the entire AIC Social Network feature. When off, no AIC↔AIC LLM calls run anywhere; existing chats stay viewable. Quick toggle also available at the top of the Network tab."
      />

      <SelectField
        label="Gossip / Community Board"
        value={settings.gossip_enabled || "true"}
        onChange={(e: any) => handleChange("gossip_enabled", e.target.value)}
        options={[
          { value: "true", label: "Enabled (characters write peer reviews of their matches)" },
          { value: "false", label: "OFF — no new gossip reviews are generated" },
        ]}
        description="Master switch for the Gossip feature. When off, no new reviews are generated by any trigger (milestones, ghosting checks, unmatch post-mortems, or manual); the existing board stays viewable. Quick toggle also available at the top of the Gossip tab."
      />

      <SelectField
        label="Prompt Caching"
        value={settings.prompt_caching_enabled || "true"}
        onChange={(e: any) => handleChange("prompt_caching_enabled", e.target.value)}
        options={[
          { value: "true", label: "Enabled (cache long prompts where supported)" },
          { value: "false", label: "Disabled" },
        ]}
        description="Anthropic Claude (direct & via OpenRouter): caches the system prompt + recent chat prefix, making long chats faster and cheaper. Gemini caches long prompts implicitly; other providers ignore this."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField
          label="Inline Images (Multimodal)"
          value={settings.inline_images || "true"}
          onChange={(e: any) => handleChange("inline_images", e.target.value)}
          options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]}
          description="When enabled, image/media attachments and profile pictures are sent to the model as real images (vision). When disabled, they are replaced by placeholder text."
        />
        <SelectField
          label="Pass Timestamps to LLM"
          value={settings.pass_timestamps || "true"}
          onChange={(e: any) => handleChange("pass_timestamps", e.target.value)}
          options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]}
          description="Prefixes each chat history message with a [Sent at ...] timestamp so characters know time gaps between messages."
        />
      </div>

      <Field label="Master Questionnaire Library (one question per line)" description="The structured prompt questions used by the Bio Writer and human profile creation.">
        <textarea
          rows={5}
          value={(() => {
            try {
              return settings.questionnaire_master ? JSON.parse(settings.questionnaire_master).join("\n") : "";
            } catch {
              return "";
            }
          })()}
          onChange={(e: any) => {
            const lines = e.target.value.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
            handleChange("questionnaire_master", JSON.stringify(lines));
          }}
          className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm"
        />
      </Field>

      <Field label="Master Tags Library" description="The trait vocabulary used for AIC generation, self-tagging, and preference learning. Each tag can be toggled onto the Male, Female, and/or Non-binary generation lists (all lit = every list, the default). Tag edits save instantly, like the Gossip Badge Manager.">
        <MasterTagsEditor settings={settings} handleChange={handleChange} loadSettings={loadSettings} />
      </Field>

      <SelectField
        label="Trans / Futa Generation Question ({trans_futa_block})"
        value={settings.trans_futa_block_variant || "neither"}
        onChange={(e: any) => handleChange("trans_futa_block_variant", e.target.value)}
        options={[
          { value: "neither", label: "Neither — no trans/futa question in generated personas" },
          { value: "transonly", label: "Trans only — ask if the character is trans" },
          { value: "futaonly", label: "Futa only — ask if the character is a futanari" },
          { value: "both", label: "Both — ask the trans and the futanari questions" },
        ]}
        description="Same choice as the startup wizard: which trans/futanari question the AIC Generation Block Template's {trans_futa_block} placeholder resolves to when new characters are generated. Remember to click Save Changes below."
      />

      <button
        onClick={() => saveSettings()}
        disabled={isSaving}
        className="bg-black dark:bg-white text-white dark:text-black w-full p-2 rounded font-bold"
      >
        {isSaving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

// ---- Master Tags Library editor (pill-based, per-gender visibility) ----
// Styled after the Gossip Badge Manager: pills with add/remove, a search box,
// and list-filter chips. Every action persists immediately to the same two
// settings keys all consumers read (`tags_master` + `tags_gender_visibility`).
// Tags without a visibility entry are visible on every list (legacy default).
const GENDER_CHIP_META: { key: TagGenderKey; symbol: string; label: string; on: string }[] = [
  { key: "male", symbol: "♂", label: "Male list", on: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/40" },
  { key: "female", symbol: "♀", label: "Female list", on: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-900/40" },
  { key: "nonbinary", symbol: "⚥", label: "Non-binary list", on: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/40" },
];
const GENDER_CHIP_OFF = "bg-gray-100 text-gray-300 dark:bg-gray-800 dark:text-gray-600 border-transparent hover:text-gray-500";

// Expands a possibly-partial visibility entry into a complete one
// (missing flags default to visible, matching the backward-compatible default).
function normalizeEntry(entry: { male?: boolean; female?: boolean; nonbinary?: boolean } | undefined) {
  return {
    male: entry?.male !== false,
    female: entry?.female !== false,
    nonbinary: entry?.nonbinary !== false,
  };
}

function MasterTagsEditor({ settings, handleChange, loadSettings }: any) {
  const [tags, setTags] = useState<string[]>(() => parseMasterTags(settings?.tags_master));
  const [visibility, setVisibility] = useState<TagVisibilityMap>(() => parseTagVisibility(settings?.tags_gender_visibility));
  const [newTag, setNewTag] = useState("");
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<"all" | TagGenderKey>("all");
  const [isSaving, setIsSaving] = useState(false);

  // Keep in sync when settings are reloaded elsewhere (idempotent for our own writes)
  useEffect(() => {
    setTags(parseMasterTags(settings?.tags_master));
    setVisibility(parseTagVisibility(settings?.tags_gender_visibility));
  }, [settings?.tags_master, settings?.tags_gender_visibility]);

  // Persist immediately (same full-catalog POST pattern as the Gossip Badge Manager)
  const persist = async (nextTags: string[], nextVisibility: TagVisibilityMap) => {
    setIsSaving(true);
    const res = await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tags_master: JSON.stringify(nextTags),
        tags_gender_visibility: JSON.stringify(nextVisibility),
      }),
    });
    setIsSaving(false);
    if (!res.success) {
      showToast(`Failed to save tag changes: ${res.error || "Unknown error"}`);
      loadSettings();
      return;
    }
    setTags(nextTags);
    setVisibility(nextVisibility);
    handleChange("tags_master", JSON.stringify(nextTags));
    handleChange("tags_gender_visibility", JSON.stringify(nextVisibility));
  };

  const handleAddTag = () => {
    const t = newTag.trim().toLowerCase().replace(/\s+/g, "_");
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t)) {
      showToast(`Tag "${t}" already exists in the Master Tags Library.`);
      return;
    }
    const nextVisibility: TagVisibilityMap = { ...visibility, [t]: { male: true, female: true, nonbinary: true } };
    setNewTag("");
    persist([...tags, t], nextVisibility);
  };

  const handleRemoveTag = async (t: string) => {
    if (!await confirmInApp(`Remove tag "${t}" from the Master Tags Library?\n\nExisting characters keep their stored scores, but the tag will no longer be assigned to new characters.`)) return;
    const nextVisibility: TagVisibilityMap = { ...visibility };
    delete nextVisibility[t];
    persist(tags.filter((x) => x !== t), nextVisibility);
  };

  const handleToggleGender = (t: string, g: TagGenderKey) => {
    const next = { ...normalizeEntry(visibility[t]) };
    next[g] = !next[g];
    persist(tags, { ...visibility, [t]: next });
  };

  const listCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    TAG_GENDER_KEYS.forEach((k) => {
      counts[k] = tags.filter((t) => isTagVisibleForKey(t, visibility, k)).length;
    });
    return counts;
  }, [tags, visibility]);

  const visibleTags = tags
    .filter((t) => (listFilter === "all" ? true : isTagVisibleForKey(t, visibility, listFilter)))
    .filter((t) => t.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-2">
      {/* Add new tag */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
          placeholder="new_trait_name (snake_case)"
          className="flex-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs"
        />
        <button
          type="button"
          onClick={handleAddTag}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1 disabled:opacity-50"
          disabled={isSaving}
        >
          <Plus className="w-3.5 h-3.5" /> Add Tag
        </button>
      </div>

      {/* Search + list filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search tags..."
          className="flex-1 min-w-[160px] p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs"
        />
        {(["all", ...TAG_GENDER_KEYS] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setListFilter(k)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
              listFilter === k
                ? "bg-pink-600 text-white border-pink-600"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-pink-300"
            }`}
          >
            {k === "all"
              ? `All (${tags.length})`
              : `${GENDER_CHIP_META.find((m) => m.key === k)?.symbol} ${k === "male" ? "Male" : k === "female" ? "Female" : "Non-binary"} (${listCounts[k]})`}
          </button>
        ))}
      </div>

      {/* Pills */}
      <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700/60">
        {visibleTags.length === 0 ? (
          <p className="text-xs text-gray-400 italic p-2">No tags match this view.</p>
        ) : (
          visibleTags.map((t) => {
            const entry = normalizeEntry(visibility[t]);
            const allOff = !entry.male && !entry.female && !entry.nonbinary;
            return (
              <span
                key={t}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-white dark:bg-gray-800 border shadow-2xs ${
                  allOff ? "border-amber-400 dark:border-amber-700" : "border-gray-200 dark:border-gray-700"
                }`}
                title={allOff ? "Hidden from every list — this tag will not be assigned to new characters." : undefined}
              >
                <span className={`max-w-[150px] truncate ${allOff ? "text-gray-400 line-through" : "text-gray-800 dark:text-gray-200"}`}>{t}</span>
                {GENDER_CHIP_META.map((m) => {
                  const isOn = entry[m.key];
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => handleToggleGender(t, m.key)}
                      disabled={isSaving}
                      title={`${isOn ? "Hide from" : "Show on"} the ${m.label}`}
                      className={`w-5 h-5 rounded-full text-[10px] leading-none border flex items-center justify-center transition ${isOn ? m.on : GENDER_CHIP_OFF}`}
                    >
                      {m.symbol}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  disabled={isSaving}
                  className="text-gray-400 hover:text-rose-500 ml-0.5"
                  title="Remove tag from library"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })
        )}
      </div>
      <p className="text-[11px] text-gray-400">
        ♂/♀/⚥ toggle which gender's generation list each tag appears on. All three lit = every list (default). Amber outline = hidden from every list (kept in the library but never assigned to new characters; existing characters are unaffected).
      </p>
    </div>
  );
}

// ---- TTS Settings subview (multi-provider) ----
function TtsSettingsView({ settings, handleChange, isSaving, saveSettings }: any) {
  const activeProvider = normalizeTtsProvider(settings.tts_provider);
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Voice synthesis: how character messages sound when played back in chat. ElevenLabs is the default; switch freely —
        each provider keeps its own settings and its own editable voice library for the AI Voice Picker. Voice IDs are plain
        strings on each character (run the Voice Picker afterwards to assign voices from the new provider's catalog).
      </p>

      <SelectField
        label="TTS Provider"
        value={activeProvider}
        onChange={(e: any) => handleChange("tts_provider", e.target.value)}
        options={TTS_PROVIDER_IDS.map((id) => ({ value: id, label: TTS_PROVIDER_LABELS[id] }))}
      />

      {activeProvider === "elevenlabs" && (
        <>
      <TextField label="ElevenLabs API Key" type="password" value={settings.elevenlabs_api_key} onChange={(e: any) => handleChange("elevenlabs_api_key", e.target.value)} placeholder="sk_..." />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="TTS Model ID" value={settings.elevenlabs_model_id} onChange={(e: any) => handleChange("elevenlabs_model_id", e.target.value)} placeholder="e.g. eleven_multilingual_v2 or eleven_multilingual_v3" />
        <TextField label="Default Voice ID (for generation)" value={settings.elevenlabs_default_voice_id} onChange={(e: any) => handleChange("elevenlabs_default_voice_id", e.target.value)} placeholder="Voice ID for newly generated characters" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Stability (0.0 - 1.0)" type="number" value={settings.elevenlabs_stability} onChange={(e: any) => handleChange("elevenlabs_stability", e.target.value)} description="Lower = more expressive/variable, higher = more consistent." />
        <TextField label="Similarity Boost (0.0 - 1.0)" type="number" value={settings.elevenlabs_similarity_boost} onChange={(e: any) => handleChange("elevenlabs_similarity_boost", e.target.value)} description="How closely the output sticks to the original voice." />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Style Exaggeration (0.0 - 1.0)" type="number" value={settings.elevenlabs_style} onChange={(e: any) => handleChange("elevenlabs_style", e.target.value)} />
        <SelectField label="Use Speaker Boost" value={settings.elevenlabs_use_speaker_boost || "true"} onChange={(e: any) => handleChange("elevenlabs_use_speaker_boost", e.target.value)} options={[{ value: "true", label: "True" }, { value: "false", label: "False" }]} />
      </div>

      <SelectField
        label="Voice Streaming"
        value={settings.elevenlabs_voice_streaming || "false"}
        onChange={(e: any) => handleChange("elevenlabs_voice_streaming", e.target.value)}
        options={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]}
        description="Streams audio as it is generated for faster playback."
      />

      <PromptField
        label="ElevenLabs v3 Voice-Tag Prompting"
        description="The bracketed voice-tag instructions characters use to sound expressive. Prompt fields can reference it via the {eleven_v3_prompting} placeholder — it resolves to this text ONLY when ElevenLabs is the active TTS Provider AND the TTS Model ID above is set to ElevenLabs v3 (a model id starting with “eleven_v3”); with any other provider or model it resolves to empty, so nothing changes."
        placeholders={["eleven_v3_prompting"]}
        value={settings.eleven_v3_prompting}
        onChange={(e: any) => handleChange("eleven_v3_prompting", e.target.value)}
        rows={8}
      />
        </>
      )}

      {activeProvider === "openai" && (
        <>
          <TextField label="OpenAI API Key" type="password" value={settings.tts_openai_api_key} onChange={(e: any) => handleChange("tts_openai_api_key", e.target.value)} placeholder="sk-... (optional for local servers)" description="Required for official OpenAI. Leave blank when pointing at a local OpenAI-compatible server below." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="TTS Model" value={settings.tts_openai_model} onChange={(e: any) => handleChange("tts_openai_model", e.target.value)} placeholder="e.g. gpt-4o-mini-tts or tts-1-hd" description="Local servers often accept any value here (they only need the endpoint shape)." />
            <TextField label="Base URL (optional — for local servers)" value={settings.tts_openai_base_url} onChange={(e: any) => handleChange("tts_openai_base_url", e.target.value)} placeholder="https://api.openai.com/v1" description="Blank = official OpenAI. Local OpenAI-compatible TTS servers: Kokoro-FastAPI http://localhost:8880/v1 · chatterbox-tts-api (Chatterbox/Chatterbox-nano) http://localhost:4123/v1 · Speaches http://localhost:8000/v1 · openedai-speech http://localhost:8000/v1." />
          </div>
        </>
      )}

      {activeProvider === "google" && (
        <TextField label="Google Cloud TTS API Key" type="password" value={settings.tts_google_api_key} onChange={(e: any) => handleChange("tts_google_api_key", e.target.value)} placeholder="AIza..." description="Cloud Text-to-Speech API key. Voice IDs are Google voice names (e.g. en-US-Neural2-F); the language code is derived from the name automatically." />
      )}

      {activeProvider === "cartesia" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Cartesia API Key" type="password" value={settings.tts_cartesia_api_key} onChange={(e: any) => handleChange("tts_cartesia_api_key", e.target.value)} placeholder="sk_car_..." />
          <TextField label="Cartesia Model" value={settings.tts_cartesia_model} onChange={(e: any) => handleChange("tts_cartesia_model", e.target.value)} placeholder="e.g. sonic-3" description="Voice IDs come from play.cartesia.ai → Voices (preset or cloned)." />
        </div>
      )}

      {activeProvider === "fish" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Fish Audio API Key" type="password" value={settings.tts_fish_api_key} onChange={(e: any) => handleChange("tts_fish_api_key", e.target.value)} placeholder="api.fish.audio key" />
          <TextField label="Fish Audio Model" value={settings.tts_fish_model} onChange={(e: any) => handleChange("tts_fish_model", e.target.value)} placeholder="e.g. s2.1-pro, s2-pro, s1" description="Voice IDs are Fish Audio reference IDs from fish.audio → My Voices." />
        </div>
      )}

      {activeProvider === "custom" && (
        <>
          <p className="text-xs text-gray-500">
            Custom Bridge: point the app at ANY HTTP TTS endpoint (self-hosted Supertonic, VoxCPM, Qwen-TTS, or any hosted
            API) without code changes. Placeholders <strong>{"{text}"}</strong>, <strong>{"{voice}"}</strong> and{" "}
            <strong>{"{model}"}</strong> are substituted inside the URL (GET) and every body/header string (POST) after JSON
            parsing, so special characters can't break your template.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="Endpoint URL" value={settings.tts_custom_url} onChange={(e: any) => handleChange("tts_custom_url", e.target.value)} placeholder="http://localhost:5000/tts" />
            <SelectField label="Method" value={settings.tts_custom_method || "POST"} onChange={(e: any) => handleChange("tts_custom_method", e.target.value)} options={[{ value: "POST", label: "POST (JSON body template)" }, { value: "GET", label: "GET (text in URL)" }]} />
          </div>
          <TextField label="{model} Placeholder Value (optional)" value={settings.tts_custom_model} onChange={(e: any) => handleChange("tts_custom_model", e.target.value)} placeholder="e.g. a model id your server expects" />
          <Field label="Extra Headers (JSON, optional)" description='Example: {"Authorization": "Bearer my-token"}. Placeholders are substituted here too.'>
            <textarea rows={2} value={settings.tts_custom_headers} onChange={(e: any) => handleChange("tts_custom_headers", e.target.value)} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-xs font-mono" />
          </Field>
          <Field label="JSON Body Template (POST only)" description='Example: {"input": "{text}", "voice": "{voice}", "model": "{model}"} (the default). Placeholders can appear anywhere inside string values.'>
            <textarea rows={4} value={settings.tts_custom_body} onChange={(e: any) => handleChange("tts_custom_body", e.target.value)} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-xs font-mono" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SelectField
              label="Response Mode"
              value={settings.tts_custom_response_mode || "raw_audio"}
              onChange={(e: any) => handleChange("tts_custom_response_mode", e.target.value)}
              options={[
                { value: "raw_audio", label: "Raw audio bytes (most servers)" },
                { value: "json_base64", label: "JSON with base64 audio field" },
                { value: "json_url", label: "JSON with audio download URL field" },
              ]}
            />
            <TextField label="JSON Field Path (JSON modes only)" value={settings.tts_custom_json_field} onChange={(e: any) => handleChange("tts_custom_json_field", e.target.value)} placeholder="audio" description='Dotted path to the audio data, e.g. "audio", "audio_base64" or "data.url".' />
          </div>
        </>
      )}

      <Field
        label="Voice Library (active provider)"
        description="The voice IDs and descriptions characters pick from in the AI Voice Picker. Add or remove voices freely — edits save instantly. Only active when the selected provider is configured."
      >
        <VoiceLibraryEditor settings={settings} handleChange={handleChange} ttsProvider={activeProvider} />
      </Field>

      <button
        onClick={() => saveSettings()}
        disabled={isSaving}
        className="bg-black dark:bg-white text-white dark:text-black w-full p-2 rounded font-bold"
      >
        {isSaving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------
// SUBVIEW: IMAGE GENERATION (AI-generated portraits & chat images)
// ---------------------------------------------------------
// Modeled on TTS Settings: one provider registry, per-provider fields,
// and the two feature toggles. Everything defaults off — provider "None"
// means the whole feature is inert and pre-existing behavior is untouched.
// Client-side note: the provider normalizer from src/lib/imageGen.ts is NOT
// imported here (that module is server-only); the same normalization is
// inlined below.
function ImageGenView({ settings, handleChange, isSaving, saveSettings }: any) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const rawProvider = (settings.image_gen_provider || "").trim().toLowerCase();
  const activeProvider = ["pollinations", "openai", "custom"].includes(rawProvider) ? rawProvider : "none";

  const testConnection = async () => {
    setTesting(true);
    setTestResult("Generating a small test image...");
    const res = await safeFetch("/api/image-gen/test", { method: "POST" });
    setTesting(false);
    if (res.success) {
      setTestResult(`Success! The provider returned a ${res.contentType} image (${Math.round((res.byteLength || 0) / 1024)} KB).`);
    } else {
      setTestResult(`Failed: ${res.error}`);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        AI image generation powers two optional features: characters can generate their own dating-profile portraits
        (instead of picking from the portrait library), and characters can send pictures mid-chat via the
        {" "}[GENERATE_IMAGE: description] tag. Everything is off by default — nothing changes until you pick a provider.
        Generated images are always saved locally; nothing is hotlinked from third parties.
      </p>

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 rounded-xl">
        <p className="text-xs text-amber-800 dark:text-amber-200">
          ⚠️ <strong>Heads-up:</strong> unless you know what you&apos;re doing and create a custom ComfyUI workflow or the
          like (see Image References below), images generated by AICs in chat won&apos;t necessarily match their profile
          image. Running the Image Prompt Writer (Manual Triggers) and using reference keywords improves consistency,
          but is not a guarantee. <strong>Recommended to keep off: feature in development.</strong>
        </p>
      </div>

      <SectionCard title="Provider" icon={ImageIcon} description="Pick an image generation backend. Pollinations is free and keyless; OpenAI-compatible covers official OpenAI and self-hosted servers with an /images/generations endpoint; the Custom HTTP Bridge supports anything else.">
        <SelectField
          label="Image Generation Provider"
          value={activeProvider}
          onChange={(e: any) => handleChange("image_gen_provider", e.target.value)}
          options={[
            { value: "none", label: "None (Image Generation disabled — default)" },
            { value: "pollinations", label: "Pollinations (free, keyless)" },
            { value: "openai", label: "OpenAI / OpenAI-Compatible" },
            { value: "custom", label: "Custom HTTP Bridge" },
          ]}
        />
        <TextField label="Model" value={settings.image_gen_model} onChange={(e: any) => handleChange("image_gen_model", e.target.value)} placeholder="e.g. flux, gpt-image-1, or your server's model id" description="Used by Pollinations, OpenAI-compatible, and substituted into the Custom bridge's {model} placeholder." />

        {activeProvider === "pollinations" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Image Width (px)" type="number" value={settings.image_gen_width} onChange={(e: any) => handleChange("image_gen_width", e.target.value)} />
              <TextField label="Image Height (px)" type="number" value={settings.image_gen_height} onChange={(e: any) => handleChange("image_gen_height", e.target.value)} description="Portrait ratio recommended (e.g. 768 x 1024)." />
            </div>
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40 p-3 rounded-xl space-y-1">
              <p className="text-xs text-red-600 dark:text-red-300 font-bold">Why Pollinations might be a bad choice:</p>
              <p className="text-xs text-red-600/90 dark:text-red-300/90">
                1. Context exposure — the generation prompt is sent to a third party&apos;s servers. For portraits this
                can include an excerpt of the character&apos;s private persona (see the excerpt length setting in Portrait
                Generation below; set it to 0 to send none).
                2. Content moderation — explicit/adult images may be refused by their filter.
                3. It is free and keyless, so rate limits and terms can change at any time. For privacy and adult
                content, prefer a local OpenAI-compatible or Custom setup.
              </p>
            </div>
          </>
        )}

        {activeProvider === "openai" && (
          <>
            <TextField label="OpenAI API Key" type="password" value={settings.image_gen_openai_api_key} onChange={(e: any) => handleChange("image_gen_openai_api_key", e.target.value)} placeholder="sk-..." description="Optional when a custom Base URL points at a keyless local server." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextField label="Base URL" value={settings.image_gen_openai_base_url} onChange={(e: any) => handleChange("image_gen_openai_base_url", e.target.value)} placeholder="blank = official OpenAI endpoint" description="Point at any OpenAI-compatible /images/generations server (SD WebUI, ComfyUI, SwarmUI, ...)." />
              <TextField label="Image Size" value={settings.image_gen_openai_size} onChange={(e: any) => handleChange("image_gen_openai_size", e.target.value)} placeholder="e.g. 1024x1536" description="Must be a size the chosen model supports." />
            </div>
          </>
        )}

        {activeProvider === "custom" && (
          <>
            <TextField label="Endpoint URL" value={settings.image_gen_custom_url} onChange={(e: any) => handleChange("image_gen_custom_url", e.target.value)} placeholder="https://my-server/generate — {prompt}/{model} substituted (GET) or sent in the body (POST)" />
            <SelectField label="Method" value={settings.image_gen_custom_method || "POST"} onChange={(e: any) => handleChange("image_gen_custom_method", e.target.value)} options={[{ value: "POST", label: "POST (JSON body template)" }, { value: "GET", label: "GET (placeholders in URL)" }]} />
            <Field label="Extra Headers (JSON, optional)" description='Example: {"Authorization": "Bearer my-token"}. Placeholders are substituted here too.'>
              <textarea rows={2} value={settings.image_gen_custom_headers} onChange={(e: any) => handleChange("image_gen_custom_headers", e.target.value)} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-xs font-mono" />
            </Field>
            <Field label="JSON Body Template (POST only)" description='Example: {"prompt": "{prompt}", "model": "{model}"}. Placeholders can appear anywhere inside string values.'>
              <textarea rows={4} value={settings.image_gen_custom_body_template} onChange={(e: any) => handleChange("image_gen_custom_body_template", e.target.value)} className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded text-xs font-mono" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SelectField label="Response Mode" value={settings.image_gen_custom_response_mode || "bytes"} onChange={(e: any) => handleChange("image_gen_custom_response_mode", e.target.value)} options={[{ value: "bytes", label: "Raw image bytes (most servers)" }, { value: "base64_field", label: "JSON with base64 image field" }, { value: "url_field", label: "JSON with image download URL field" }]} />
              <TextField label="JSON Field Path (JSON modes only)" value={settings.image_gen_custom_response_field} onChange={(e: any) => handleChange("image_gen_custom_response_field", e.target.value)} placeholder='e.g. "data" or "data.0.url"' description="Dotted path to the image data inside the JSON response." />
            </div>
          </>
        )}

        <TriggerButton onClick={testConnection} disabled={testing} label="Test Image Generation" busyLabel="Testing..." />
        {testResult && (
          <p className={`text-xs ${testResult.startsWith("Success") ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{testResult}</p>
        )}

        {/* __APPEND_IMGVIEW__ */}
      </SectionCard>

      <SectionCard title="Portrait Generation (replaces the library Image Picker)" icon={ImageIcon} description="When enabled, the Image Picker — manual trigger, per-character Repick, generation pipelines, and the background processes runner — generates an AI portrait from the template below instead of picking a library photo. Falls back to library picking automatically when no provider is configured.">
        <SelectField
          label="Generate portraits instead of picking from the library"
          value={settings.portrait_assign_generate_enabled || "false"}
          onChange={(e: any) => handleChange("portrait_assign_generate_enabled", e.target.value)}
          options={[{ value: "false", label: "Disabled (default — pick from library)" }, { value: "true", label: "Enabled (generate AI portraits)" }]}
        />
        <PromptField
          label="Portrait Generation Prompt Template"
          description="Describes the profile photo to generate for each character."
          placeholders={["character_name", "gender", "persona_summary", "top_traits"]}
          value={settings.prompt_image_gen_portrait}
          onChange={(e: any) => handleChange("prompt_image_gen_portrait", e.target.value)}
          rows={8}
        />
        <TextField
          label="Persona Excerpt Length (characters)"
          type="number"
          value={settings.image_gen_persona_excerpt_length}
          onChange={(e: any) => handleChange("image_gen_persona_excerpt_length", e.target.value)}
          description="Fallback only: how many characters from the top of the private persona fill {persona_summary} when a character has no AI-written visual description. 0 = send no persona content (maximum privacy). Run the Image Prompt Writer (Manual Triggers) for a much better result."
        />
      </SectionCard>

      <SectionCard title="Chat Image Generation" icon={ImageIcon} description="Characters can send pictures mid-conversation by including the tag [GENERATE_IMAGE: description] in a reply. The tag is stripped from the visible message and the generated image is attached to it. Vision-capable models see these images inline on later turns (handled by the existing multimodal pipeline). Applies to AIC-to-User chats only.">
        <SelectField
          label="Enable chat image generation"
          value={settings.chat_image_generation_enabled || "false"}
          onChange={(e: any) => handleChange("chat_image_generation_enabled", e.target.value)}
          options={[{ value: "false", label: "Disabled (default)" }, { value: "true", label: "Enabled (characters can send images)" }]}
        />
        <PromptField
          label="Chat Image Instruction Template"
          description="Appended to the chat system prompt while enabled. Explains the tag and when to use it."
          value={settings.prompt_chat_image_gen}
          onChange={(e: any) => handleChange("prompt_chat_image_gen", e.target.value)}
          rows={8}
        />
      </SectionCard>

      <SectionCard title="Image References (Advanced / Power Users)" icon={ImageIcon} description="Lets characters attach images to generation requests via [GENERATE_IMAGE: description | self, user, chat]. References are only delivered through the Custom HTTP Bridge (via its {image_paths}, {image_urls} and {image_data_uris} placeholders); Pollinations and OpenAI-compatible ignore them. Intended for custom local workflows (e.g. ComfyUI) that use reference images for identity and style consistency.">
        <SelectField
          label="Enable image references"
          value={settings.image_gen_refs_enabled || "false"}
          onChange={(e: any) => handleChange("image_gen_refs_enabled", e.target.value)}
          options={[{ value: "false", label: "Disabled (default)" }, { value: "true", label: "Enabled (characters may attach references)" }]}
        />
        <SelectField
          label="Allow the 'user' keyword (user's profile image)"
          value={settings.image_gen_refs_allow_user_profile || "false"}
          onChange={(e: any) => handleChange("image_gen_refs_allow_user_profile", e.target.value)}
          options={[{ value: "false", label: "No (default — your profile image is never sent)" }, { value: "true", label: "Yes (characters may reference your profile image)" }]}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Max Reference Images" type="number" value={settings.image_gen_refs_max_count} onChange={(e: any) => handleChange("image_gen_refs_max_count", e.target.value)} description="Caps how many resolved references a single request can carry." />
          <TextField label="App Origin (for {image_urls})" value={settings.image_gen_refs_app_origin} onChange={(e: any) => handleChange("image_gen_refs_app_origin", e.target.value)} placeholder="http://127.0.0.1:3000" description="Used to expand {image_urls} into absolute URLs that a local workflow can fetch." />
        </div>
        <PromptField
          label="Image References Instruction Template"
          description="Appended to the chat system prompt (after the main image instruction) only while references are enabled. Teaches the keyword syntax."
          value={settings.prompt_chat_image_gen_refs}
          onChange={(e: any) => handleChange("prompt_chat_image_gen_refs", e.target.value)}
          rows={7}
        />
      </SectionCard>

      <button
        onClick={() => saveSettings()}
        disabled={isSaving}
        className="bg-black dark:bg-white text-white dark:text-black w-full p-2 rounded font-bold"
      >
        {isSaving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

// ---- Voice Library editor (voice picker catalog for the ACTIVE provider) ----
// Styled after the Master Tags editor: add/remove entries, edit descriptions
// inline (persisted on blur). Every action persists immediately to the active
// provider's `voices_catalog_*` setting (the same key the voice picker reads).
// Disabled until the selected provider is configured (API key, or a Base URL
// for local/custom servers). An empty/invalid catalog falls back to that
// provider's built-in default library at pick time — existing behavior.
function VoiceLibraryEditor({ settings, handleChange, ttsProvider }: any) {
  const provider = normalizeTtsProvider(ttsProvider);
  const catalogKey = TTS_PROVIDER_CATALOG_KEYS[provider];
  const configured = isTtsProviderConfigured(settings, provider);
  const [voices, setVoices] = useState<VoiceOption[]>(() => parseVoiceCatalog(settings?.[catalogKey]));
  const [newId, setNewId] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Keep in sync when settings are reloaded elsewhere (idempotent for our own writes)
  useEffect(() => {
    setVoices(parseVoiceCatalog(settings?.[catalogKey]));
  }, [settings?.[catalogKey]]);

  // Persist immediately (same full-catalog POST pattern as the Master Tags editor)
  const persist = async (next: VoiceOption[]) => {
    setIsSaving(true);
    handleChange(catalogKey, serializeVoiceCatalog(next));
    await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [catalogKey]: serializeVoiceCatalog(next) }),
    });
    setIsSaving(false);
  };

  const handleAdd = () => {
    if (!configured) return;
    const id = newId.trim();
    if (!id) {
      setError("A voice ID is required.");
      return;
    }
    if (voices.some((v) => v.id === id)) {
      setError(`Voice ID "${id}" is already in the library.`);
      return;
    }
    setError("");
    persist([...voices, { id, description: newDescription.trim() }]);
    setNewId("");
    setNewDescription("");
  };

  const handleRemove = async (id: string) => {
    if (!configured) return;
    if (!await confirmInApp(`Remove voice ${id} from the picker catalog? Characters already using it keep their assigned voice; only the voice picker stops offering it.`)) return;
    persist(voices.filter((v) => v.id !== id));
  };

  const handleDescriptionChange = (id: string, description: string) => {
    setVoices((prev) => prev.map((v) => (v.id === id ? { ...v, description } : v)));
  };

  const handleDescriptionCommit = () => {
    if (!configured) return;
    const current = parseVoiceCatalog(settings?.[catalogKey]);
    const changed = voices.some((v) => current.find((c) => c.id === v.id)?.description !== v.description);
    if (changed) persist(voices);
  };

  return (
    <div className={`space-y-2 ${configured ? "" : "opacity-50 pointer-events-none select-none"}`}>
      {!configured && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg -mx-1">
          🔒 Configure the selected TTS provider above (its API key — or a Base URL for local/custom servers) to edit its
          voice library. The catalog is inert without it.
        </p>
      )}

      {/* Add new voice */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          placeholder="Voice ID (e.g. Fm7GKKwr83u3Y5p20wwq)"
          className="w-56 p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs font-mono"
        />
        <input
          type="text"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          onKeyDown={(e: any) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
          placeholder="Description (how it sounds — characters read this when choosing)"
          className="flex-1 p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1 disabled:opacity-50 shrink-0"
          disabled={isSaving || !configured}
        >
          <Plus className="w-3.5 h-3.5" /> Add Voice
        </button>
      </div>
      {error && <p className="text-[11px] text-red-500 font-semibold">{error}</p>}

      {/* Voice entries */}
      <div className="space-y-2 max-h-80 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700/60">
        {voices.length === 0 ? (
          <p className="text-xs text-gray-400 italic p-2">
            The catalog is currently empty — the voice picker falls back to this provider's built-in default library until
            you add entries here.
          </p>
        ) : (
          voices.map((v) => (
            <div key={v.id} className="flex gap-2 items-start bg-white dark:bg-gray-800 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="w-56 shrink-0">
                <p className="text-xs font-mono font-bold text-gray-900 dark:text-white break-all">{v.id}</p>
                <button
                  type="button"
                  onClick={() => handleRemove(v.id)}
                  className="mt-1 text-[10px] text-red-500 hover:text-red-700 font-semibold flex items-center gap-0.5 disabled:opacity-50"
                  disabled={isSaving || !configured}
                >
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              </div>
              <textarea
                rows={2}
                value={v.description}
                onChange={(e) => handleDescriptionChange(v.id, e.target.value)}
                onBlur={handleDescriptionCommit}
                placeholder="Description of how this voice sounds..."
                className="flex-1 p-1.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-200 text-xs"
              />
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400">
          {voices.length} voice{voices.length === 1 ? "" : "s"} in the picker catalog. Removing a voice never changes
          characters already using it — it only stops the voice picker from offering it to new picks.
        </p>
      </div>
    </div>
  );
}

// ---- User Preferences table (recommendation engine analytics) ----
// Same data and editing workflow as the AIC Gen tab's "View My Hidden
// Preferences" spoiler, embedded here in My Data.
function PreferenceTableSection() {
  const [prefs, setPrefs] = useState<any[]>([]);
  const [draft, setDraft] = useState<any[]>([]);
  const [profileName, setProfileName] = useState("");
  const [interactionCount, setInteractionCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "ascending" | "descending" } | null>({ key: "combinedImportance", direction: "descending" });

  const loadPreferences = async () => {
    setIsLoading(true);
    const data = await safeFetch("/api/profiles/preferences");
    setIsLoading(false);
    if (data.success) {
      setPrefs(data.preferences || []);
      setDraft(JSON.parse(JSON.stringify(data.preferences || [])));
      setProfileName(data.profileName || "");
      setInteractionCount(data.interactionCount || 0);
    }
  };

  useEffect(() => {
    loadPreferences();
  }, []);

  const requestSort = (key: string) => {
    let direction: "ascending" | "descending" = "ascending";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "ascending") direction = "descending";
    setSortConfig({ key, direction });
  };

  const sorted = useMemo(() => {
    const items = [...draft];
    if (!sortConfig) return items;
    items.sort((a: any, b: any) => {
      if (sortConfig.key === "tag") {
        return sortConfig.direction === "ascending" ? a.tag.localeCompare(b.tag) : b.tag.localeCompare(a.tag);
      }
      const aN = isNaN(parseFloat(a[sortConfig.key])) ? 0 : parseFloat(a[sortConfig.key]);
      const bN = isNaN(parseFloat(b[sortConfig.key])) ? 0 : parseFloat(b[sortConfig.key]);
      return sortConfig.direction === "ascending" ? aN - bN : bN - aN;
    });
    return items;
  }, [draft, sortConfig]);

  const onDraftChange = (tag: string, field: string, value: string) => {
    setDraft((prev) => prev.map((p) => (p.tag === tag ? { ...p, [field]: value } : p)));
  };

  const onCommit = async (tag: string, field: string, valueStr: string) => {
    const val = parseFloat(valueStr);
    if (isNaN(val)) return;
    const apiField = field === "combinedTarget" ? "target" : field === "combinedImportance" ? "importance" : "confidence";
    await safeFetch("/api/profiles/preferences/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, [apiField]: val })
    });
    loadPreferences();
  };

  const onReset = async (tag: string) => {
    await safeFetch("/api/profiles/preferences/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag })
    });
    loadPreferences();
  };

  const arrow = (key: string) => (sortConfig?.key === key ? (sortConfig.direction === "ascending" ? " ▲" : " ▼") : "");

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-gray-500">
          These scores represent how much the recommendation algorithm thinks the active profile prefers each trait, based on
          matches, swipes, and chats. Edits here override the algorithm for AIC generation.
        </p>
        <button
          onClick={loadPreferences}
          className="text-xs text-pink-500 hover:underline flex items-center gap-1 font-semibold shrink-0"
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        Active profile: <strong>{profileName || "Loading..."}</strong> ({interactionCount} interactions analyzed)
      </p>

      {draft.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No preferences calculated yet. Go swipe on some characters in the Feed first!</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-50 dark:bg-gray-700/60 text-gray-500 sticky top-0">
              <tr className="select-none">
                <th onClick={() => requestSort("tag")} className="p-2.5 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition" title="Sort by Tag Name">
                  Tag / Trait{arrow("tag")}
                </th>
                <th onClick={() => requestSort("combinedTarget")} className="p-2.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition font-bold text-pink-500" title="Sort by Target Sweet Spot">
                  Sweet Spot (Target Value){arrow("combinedTarget")}
                </th>
                <th onClick={() => requestSort("combinedImportance")} className="p-2.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition font-bold text-blue-500" title="Sort by Importance">
                  Importance (Rigidity){arrow("combinedImportance")}
                </th>
                <th onClick={() => requestSort("combinedConfidence")} className="p-2.5 text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition font-bold text-purple-500" title="Sort by Confidence">
                  Confidence{arrow("combinedConfidence")}
                </th>
                <th className="p-2.5 text-right font-bold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((pref: any) => (
                <ManagerPreferenceRow key={pref.tag} pref={pref} onDraftChange={onDraftChange} onCommit={onCommit} onReset={onReset} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Renders one preference row (sort/edits identical to the AIC Gen tab table).
function ManagerPreferenceRow({ pref, onDraftChange, onCommit, onReset }: any) {
  return (
    <tr
      className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
        pref.isOverridden ? "bg-pink-50/20 dark:bg-pink-950/10" : ""
      } ${!pref.isActiveTag ? "opacity-60 dark:opacity-50 bg-gray-50/40 dark:bg-gray-900/10" : ""}`}
    >
      <td className="p-2.5 text-gray-800 dark:text-gray-200">
        <div className="font-semibold flex flex-col">
          <span>
            {pref.tag}
            {pref.isOverridden && <span className="text-[9px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full font-bold ml-1 uppercase">Overridden</span>}
            {!pref.isActiveTag && <span className="text-[9px] bg-gray-400 dark:bg-gray-600 text-white px-1.5 py-0.5 rounded-full font-bold ml-1 uppercase">Inactive</span>}
          </span>
          <span className="text-[10px] text-gray-400 font-normal">
            Used by {pref.activeAicCount || 0} active, {pref.inactiveAicCount || 0} inactive AICs
          </span>
        </div>
      </td>
      <td className="p-2.5 text-right whitespace-nowrap">
        <input
          type="number" step="0.1" min="1" max="10"
          value={pref.combinedTarget}
          onChange={(e) => onDraftChange(pref.tag, "combinedTarget", e.target.value)}
          onBlur={(e) => onCommit(pref.tag, "combinedTarget", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onCommit(pref.tag, "combinedTarget", (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
          className="w-16 bg-gray-100 dark:bg-gray-700 p-1 text-center rounded text-xs font-bold text-pink-600 dark:text-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
        />
      </td>
      <td className="p-2.5 text-right whitespace-nowrap">
        <input
          type="number" step="0.05" min="0" max="1"
          value={pref.combinedImportance}
          onChange={(e) => onDraftChange(pref.tag, "combinedImportance", e.target.value)}
          onBlur={(e) => onCommit(pref.tag, "combinedImportance", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onCommit(pref.tag, "combinedImportance", (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
          className="w-16 bg-gray-100 dark:bg-gray-700 p-1 text-center rounded text-xs font-bold text-blue-600 dark:text-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </td>
      <td className="p-2.5 text-right whitespace-nowrap">
        <input
          type="number" step="0.05" min="0" max="1"
          value={pref.combinedConfidence}
          onChange={(e) => onDraftChange(pref.tag, "combinedConfidence", e.target.value)}
          onBlur={(e) => onCommit(pref.tag, "combinedConfidence", e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { onCommit(pref.tag, "combinedConfidence", (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
          className="w-16 bg-gray-100 dark:bg-gray-700 p-1 text-center rounded text-xs font-bold text-purple-600 dark:text-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
        />
      </td>
      <td className="p-2.5 text-right">
        {pref.isOverridden && (
          <button onClick={() => onReset(pref.tag)} className="text-[10px] text-gray-400 hover:text-red-500 font-semibold" title="Reset this override to the calculated value">
            Reset
          </button>
        )}
      </td>
    </tr>
  );
}

// ---- My Data subview ----
function MyDataView({ settings, loadSettings }: any) {
  const [stats, setStats] = useState<{ characters: number; portraits: number; processed: number }>({ characters: 0, portraits: 0, processed: 0 });
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [snapshotName, setSnapshotName] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const chars = await safeFetch("/api/characters");
        const portraits = await safeFetch("/api/portraits");
        const portraitList: any[] = Array.isArray(portraits?.portraits) ? portraits.portraits : [];
        setStats({
          characters: Array.isArray(chars?.characters) ? chars.characters.length : 0,
          portraits: portraitList.length,
          processed: portraitList.filter((p: any) => p.processed).length,
        });
      } catch {}
    })();
  }, []);

  // Settings snapshots (My Data backup card)
  const loadSnapshots = async () => {
    const res = await safeFetch("/api/settings/snapshots");
    if (res.success && Array.isArray(res.snapshots)) setSnapshots(res.snapshots);
  };

  useEffect(() => {
    loadSnapshots();
  }, []);

  const formatWhen = (iso: any) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d.getTime())
      ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "unknown date";
  };

  const exportSettings = () => {
    // Versioned envelope (see src/lib/settingsSnapshots.ts); the settings
    // prop is the full GET /api/settings dump (snapshots & runtime markers excluded).
    const payload = buildSettingsExport(settings);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hothouse-settings-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: any) => {
    const file = e.target?.files?.[0];
    if (e.target) e.target.value = ""; // allow re-selecting the same file after a failure
    if (!file) return;
    let parsed: any;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showToast("Import failed: the selected file is not valid JSON.");
      return;
    }
    const normalized = normalizeImportedSettings(parsed);
    if (!normalized.ok) {
      showToast("Import failed: " + normalized.error);
      return;
    }
    const count = Object.keys(normalized.settings).length;
    const message = count === 0
      ? "This file contains 0 settings. Importing it would delete every current setting (snapshots and preference-reset history are kept). Continue?"
      : `Import ${count} settings from "${file.name}"?\n\nThis replaces your current settings: every setting in the file overwrites the current value, and current settings not present in the file are deleted. Snapshots and preference-reset history are not affected.`;
    if (!await confirmInApp(message)) return;
    setIsImporting(true);
    const res = await safeFetch("/api/settings/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: normalized.settings }),
    });
    setIsImporting(false);
    if (res.success) {
      showToast(`Imported ${res.imported} settings (${res.deleted} old setting${res.deleted === 1 ? "" : "s"} removed).`);
      window.location.reload(); // clean reload so every tab picks up the new settings
    } else {
      showToast("Import failed: " + res.error);
    }
  };

  const saveSnapshot = async () => {
    const name = snapshotName.trim();
    if (!name) {
      showToast("Please enter a name for the snapshot first.");
      return;
    }
    if (snapshots.some((s: any) => s.name === name) && !await confirmInApp(`A snapshot named "${name}" already exists. Overwrite it with the current settings?`)) return;
    const res = await safeFetch("/api/settings/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.success) {
      setSnapshotName("");
      loadSnapshots();
    } else {
      showToast("Failed to save snapshot: " + res.error);
    }
  };

  const loadSnapshot = async (snap: any) => {
    const message = `Load snapshot "${snap.name}" (${formatWhen(snap.savedAt)}, ${snap.keyCount} settings)?\n\nThis replaces your current settings with the snapshot's contents, and current settings not present in the snapshot are deleted. Snapshots and preference-reset history are not affected.`;
    if (!await confirmInApp(message)) return;
    const res = await safeFetch("/api/settings/snapshots/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: snap.key }),
    });
    if (res.success) {
      showToast(`Snapshot "${snap.name}" loaded (${res.imported} settings restored, ${res.deleted} removed).`);
      window.location.reload();
    } else {
      showToast("Failed to load snapshot: " + res.error);
    }
  };

  const deleteSnapshot = async (snap: any) => {
    if (!await confirmInApp(`Delete snapshot "${snap.name}"? Your current settings are not affected. This cannot be undone.`)) return;
    const res = await safeFetch("/api/settings/snapshots", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: snap.key }),
    });
    if (res.success) {
      loadSnapshots();
    } else {
      showToast("Failed to delete snapshot: " + res.error);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Your data at a glance, plus exports and destructive resets. Gossip reviews live in the Gossip tab, and hidden character personas are viewable in the AICs tab.</p>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-2xl font-bold text-pink-500">{stats.characters}</p>
          <p className="text-xs text-gray-500">AIC Characters</p>
        </div>
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-2xl font-bold text-indigo-500">{stats.portraits}</p>
          <p className="text-xs text-gray-500">Portraits in Library</p>
        </div>
        <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 text-center">
          <p className="text-2xl font-bold text-teal-500">{stats.processed}</p>
          <p className="text-xs text-gray-500">Portraits Processed</p>
        </div>
      </div>

      <SectionCard title="User Preferences (Recommendation Engine)" icon={Sliders} description="The hidden preference matrix the AIC generator uses for the active profile — view, sort, edit, or reset individual trait scores. The same table is also available (spoiler-protected) in the AICs tab.">
        <PreferenceTableSection />
      </SectionCard>

      <SectionCard title="Interaction Ledger" icon={Database} description="Your complete match/swipe history with every AIC.">
        <InteractionLedger />
      </SectionCard>

      <SectionCard title="Export & Import" icon={Download} description="Back up your configuration as a portable JSON file (every setting: models, prompts, TTS, image generation, tags, gossip …) and restore it on any machine.">
        <div className="flex gap-2">
          <TriggerButton onClick={exportSettings} disabled={false} label="Export All Settings (JSON)" color="gray" />
          <TriggerButton onClick={() => importInputRef.current?.click()} disabled={isImporting} busyLabel="Importing..." label="Import Settings (JSON)" color="gray" />
        </div>
        <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
        <p className="text-xs text-gray-500">Importing replaces all current settings with the file's contents — a confirmation shows the exact key count first. Older exports without a version stamp are accepted. Snapshots and preference-reset history are never part of the file.</p>
      </SectionCard>

      <SectionCard title="Settings Snapshots" icon={Save} description="Named save points for your settings, stored inside the app.">
        <div className="flex gap-2">
          <input
            value={snapshotName}
            onChange={(e: any) => setSnapshotName(e.target.value)}
            onKeyDown={(e: any) => { if (e.key === "Enter") saveSnapshot(); }}
            placeholder="Snapshot name, e.g. Before TTS overhaul"
            className="flex-1 bg-gray-100 dark:bg-gray-700 p-2 rounded"
          />
          <TriggerButton onClick={saveSnapshot} disabled={false} label="Save settings as…" color="gray" />
        </div>
        {snapshots.length === 0 ? (
          <p className="text-xs text-gray-500">No snapshots yet — use the field above to save your current settings under a name.</p>
        ) : (
          <div className="space-y-2">
            {snapshots.map((snap: any) => (
              <div key={snap.key} className="flex items-center justify-between gap-2 bg-gray-200/60 dark:bg-gray-700/60 p-2 rounded">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{snap.name}</p>
                  <p className="text-xs text-gray-500">{formatWhen(snap.savedAt)} · {snap.keyCount} settings</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <TriggerButton onClick={() => loadSnapshot(snap)} disabled={false} label="Load" color="blue" className="w-auto" />
                  <button onClick={() => deleteSnapshot(snap)} type="button" className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded font-bold transition text-sm">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="bg-red-50/50 dark:bg-red-950/10 p-5 rounded-2xl border border-red-100/60 dark:border-red-900/20 space-y-3">
        <h4 className="font-bold text-sm text-red-500">Danger Zone</h4>
        <p className="text-xs text-gray-500">Wipe matchmaking choices and chat logs for your active profile, or reset the recommendation learning matrix. These actions cannot be undone.</p>
        <button
          onClick={async () => {
            if (await confirmInApp("Are you sure you want to wipe all interactions between your active profile and ALL AICs? This will permanently delete all chat history and matches. This action cannot be undone.")) {
              const res = await safeFetch("/api/interactions", { method: "DELETE" });
              if (res.success) {
                showToast("All interactions reset successfully! You can evaluate again.");
                window.dispatchEvent(new Event("interactions-updated"));
                loadSettings();
              } else {
                showToast("Reset failed: " + res.error);
              }
            }
          }}
          type="button"
          className="bg-red-600 hover:bg-red-700 text-white w-full p-2 rounded font-bold transition text-sm"
        >
          Wipe My AI Interactions
        </button>
        <button
          onClick={async () => {
            if (!await confirmInApp("Are you sure you want to reset your algorithm learning history? This will start the algorithm fresh from today but won't delete your active matches/DMs. This action cannot be undone.")) return;
            const data = await safeFetch("/api/profiles/preferences", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reset" })
            });
            if (data.success) {
              showToast("Preferences reset successfully!");
            } else {
              showToast("Failed to reset preferences: " + data.error);
            }
          }}
          type="button"
          className="bg-red-600 hover:bg-red-700 text-white w-full p-2 rounded font-bold transition text-sm"
        >
          Reset Learning Matrix (Recommendation Preferences)
        </button>
      </div>
    </div>
  );
}




















"use client";

import React, { useState, useEffect } from "react";
import { 
  Bot, 
  Play, 
  RefreshCw, 
  Trash2, 
  Edit3, 
  Plus, 
  Check, 
  X, 
  Sliders, 
  Activity, 
  MessageSquare, 
  ShieldAlert, 
  Sparkles, 
  FileText,
  Search,
  PauseCircle,
  PlayCircle
} from "lucide-react";
import { safeFetch, hasRenderableAvatar } from "../page";
import { showToast, confirmInApp } from "@/lib/notify";
import { providerModelKey, providerModelPlaceholder, PROVIDER_MODEL_DEFAULTS } from "@/lib/llmTasks";

export function AicNetworkTab() {
  const [activeSubView, setActiveSubView] = useState<"matches" | "metrics" | "settings">("matches");
  const [interactions, setInteractions] = useState<any[]>([]);
  const [characters, setCharacters] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "matched" | "unmatched" | "disabled" | "deleted">("all");

  const [selectedChat, setSelectedChat] = useState<any | null>(null);
  const [manualA, setManualA] = useState("");
  const [manualB, setManualB] = useState("");
  const [isManualMatching, setIsManualMatching] = useState(false);

  const [editSettings, setEditSettings] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [interData, metricsData, settingsData] = await Promise.all([
        safeFetch("/api/aic-network/interactions"),
        safeFetch("/api/aic-network/metrics"),
        safeFetch("/api/settings"),
      ]);

      if (interData.success) {
        setInteractions(interData.interactions || []);
        setCharacters(interData.characters || []);
      }
      if (metricsData.success) {
        setMetrics(metricsData.metrics || []);
      }
      if (settingsData.success) {
        setSettings(settingsData.settings || {});
        setEditSettings(settingsData.settings || {});
      }
    } catch (e) {
      console.error("Error loading AIC Network data:", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // AIC Social Network master switch (mirrored in Manager → Global Settings)
  const networkEnabled = settings.aic_network_enabled !== "false";

  const filteredInteractions = interactions.filter((inter) => {
    const nameA = inter.characterA?.name?.toLowerCase() || "deleted character";
    const nameB = inter.characterB?.name?.toLowerCase() || "deleted character";
    const q = searchQuery.toLowerCase();
    const matchesSearch = nameA.includes(q) || nameB.includes(q);

    if (!matchesSearch) return false;
    if (statusFilter === "matched") return inter.matched && !inter.disabled && !inter.unmatched && !inter.characterA?.deleted && !inter.characterB?.deleted;
    if (statusFilter === "unmatched") return inter.unmatched || !inter.matched;
    if (statusFilter === "disabled") return inter.disabled;
    if (statusFilter === "deleted") return inter.characterA?.deleted || inter.characterB?.deleted;
    return true;
  });

  const handleBulkDeleteInteractions = async () => {
    if (!await confirmInApp("⚠️ Are you sure you want to permanently delete ALL AIC-to-AIC interactions and message histories? This cannot be undone.")) return;
    if (!await confirmInApp("Please confirm a second time: Delete all AIC-to-AIC chats?")) return;
    const res = await safeFetch("/api/aic-network/interactions?all=true", {
      method: "DELETE",
    });
    if (res.success) {
      setSelectedChat(null);
      await fetchData();
      setStatusText("All AIC-to-AIC interactions have been deleted.");
    } else {
      showToast(res.error || "Failed to delete all interactions.");
    }
  };

  const handleToggleUnmatch = async (inter: any) => {
    const isUnmatched = inter.unmatched;
    const action = isUnmatched ? "rematch" : "unmatch";
    const res = await safeFetch("/api/aic-network/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: inter.id,
        action,
        unmatchedBy: "admin",
      }),
    });
    if (res.success) {
      await fetchData();
      if (selectedChat && selectedChat.id === inter.id) {
        setSelectedChat((prev: any) => ({
          ...prev,
          unmatched: !isUnmatched,
          unmatchedBy: isUnmatched ? null : "admin",
        }));
      }
    } else {
      showToast(res.error || "Failed to update unmatch status.");
    }
  };

  const handleManualMatch = async () => {
    if (!manualA || !manualB || manualA === manualB) {
      showToast("Please select two distinct characters.");
      return;
    }
    setIsManualMatching(true);
    const res = await safeFetch("/api/aic-network/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterAId: manualA,
        characterBId: manualB,
        action: "manual_match",
      }),
    });
    setIsManualMatching(false);
    if (res.success) {
      setManualA("");
      setManualB("");
      fetchData();
    } else {
      showToast(res.error || "Failed to create match.");
    }
  };

  const handleEvaluatePair = async (charAId: string, charBId: string) => {
    setStatusText("Evaluating compatibility...");
    setSimulating(true);
    const res = await safeFetch("/api/aic-network/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterAId: charAId, characterBId: charBId }),
    });
    setSimulating(false);
    setStatusText("");
    if (res.success) {
      fetchData();
      showToast(`Evaluation complete! Decision: A->B (${res.eval1to2?.decision}), B->A (${res.eval2to1?.decision}). Matched: ${res.interaction?.matched ? "YES" : "NO"}`);
    } else {
      showToast(res.error || "Evaluation failed.");
    }
  };

  const handleRunSingleTurn = async (interactionId: string, turns = 1) => {
    setSimulating(true);
    setStatusText(`Simulating ${turns} turn(s)...`);
    const res = await safeFetch("/api/aic-network/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactionId, turnsCount: turns }),
    });
    setSimulating(false);
    setStatusText("");
    if (res.success) {
      await fetchData();
      if (selectedChat && selectedChat.id === interactionId) {
        const updated = await safeFetch("/api/aic-network/interactions");
        if (updated.success) {
          const fresh = updated.interactions.find((i: any) => i.id === interactionId);
          if (fresh) setSelectedChat(fresh);
        }
      }
    } else {
      showToast(res.error || "Failed to execute turn.");
    }
  };

  const handleRunSimulationRound = async () => {
    setSimulating(true);
    setStatusText("Running simulation round: discovering matches & generating conversation turns...");
    const res = await safeFetch("/api/aic-network/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runSimulationRound: true }),
    });
    setSimulating(false);
    setStatusText("");
    if (res.success) {
      fetchData();
      showToast(
        `Simulation Round Results:\n` +
        `• Compatibility Evaluations Attempted: ${res.evaluationsAttempted || 0} (${res.newMatchesFormed || 0} new match${res.newMatchesFormed === 1 ? "" : "es"} established)\n` +
        `• Total Messages Generated: ${res.totalMessagesGenerated || 0} across active conversations\n` +
        `${res.reachedRoundCap ? "⚠️ Round stopped early upon hitting the configured Max Messages Per Round budget limit." : ""}`
      );
    } else {
      showToast(res.error || "Simulation round failed.");
    }
  };

  const handleToggleEmergencyStop = async () => {
    const current = settings.aic_aic_emergency_stop === "true";
    const newVal = current ? "false" : "true";
    const res = await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aic_aic_emergency_stop: newVal }),
    });
    if (res.success) {
      setSettings((prev) => ({ ...prev, aic_aic_emergency_stop: newVal }));
      setEditSettings((prev) => ({ ...prev, aic_aic_emergency_stop: newVal }));
    }
  };

  const handleToggleNetworkEnabled = async () => {
    const newVal = networkEnabled ? "false" : "true";
    const res = await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aic_network_enabled: newVal }),
    });
    if (res.success) {
      setSettings((prev) => ({ ...prev, aic_network_enabled: newVal }));
      setEditSettings((prev) => ({ ...prev, aic_network_enabled: newVal }));
      showToast(newVal === "true"
        ? "AIC Social Network enabled."
        : "AIC Social Network turned off — no match discovery, simulation rounds, or AIC↔AIC messages will run until you turn it back on.");
    } else {
      showToast(res.error || "Failed to update the AIC Social Network toggle.");
    }
  };

  const handleToggleDisable = async (inter: any) => {
    const res = await safeFetch("/api/aic-network/interactions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: inter.id,
        disabled: !inter.disabled,
      }),
    });
    if (res.success) {
      fetchData();
    }
  };

  const handleResetInteraction = async (inter: any) => {
    if (!await confirmInApp(`Reset conversation history between ${inter.characterA.name} and ${inter.characterB.name}?`)) return;
    const res = await safeFetch("/api/aic-network/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterAId: inter.characterAId,
        characterBId: inter.characterBId,
        action: "reset",
      }),
    });
    if (res.success) {
      fetchData();
    }
  };

  const handleDeleteInteraction = async (id: string) => {
    if (!await confirmInApp("Permanently delete this AIC-to-AIC interaction?")) return;
    const res = await safeFetch(`/api/aic-network/interactions?id=${id}`, {
      method: "DELETE",
    });
    if (res.success) {
      fetchData();
    }
  };

  const handleGenerateSummary = async (interactionId: string) => {
    setStatusText("Generating relationship summary...");
    setSimulating(true);
    const res = await safeFetch("/api/aic-network/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactionId }),
    });
    setSimulating(false);
    setStatusText("");
    if (res.success) {
      fetchData();
      if (selectedChat && selectedChat.id === interactionId) {
        setSelectedChat((prev: any) => ({ ...prev, summary: res.summary }));
      }
    } else {
      showToast(res.error || "Failed to generate summary.");
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    const res = await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editSettings),
    });
    setSavingSettings(false);
    if (res.success) {
      setSettings(editSettings);
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
    } else {
      showToast(res.error || "Failed to save settings.");
    }
  };

  const handleResetMetrics = async (charId?: string) => {
    if (!await confirmInApp(charId ? "Reset metrics for this character?" : "Reset all character call metrics?")) return;
    const res = await safeFetch("/api/aic-network/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: charId, resetAll: !charId }),
    });
    if (res.success) {
      fetchData();
    }
  };

  const isEmergencyStopped = settings.aic_aic_emergency_stop === "true";
  const activeMatchesCount = interactions.filter((i) => i.matched && !i.disabled).length;
  const totalAicMessagesCount = interactions.reduce((acc, i) => acc + (i.messages?.length || 0), 0);
  const totalCallsCount = metrics.reduce((acc, m) => acc + (m.totalCalls || 0), 0);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 space-y-6 bg-gray-50/50 dark:bg-gray-900/50">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header Title & Status Controls */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center font-bold">
                <Bot size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                  AIC Social Network
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  Simulated AIC-to-AIC autonomous matching, chatting, and cross-chat memory ledger
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleToggleNetworkEnabled}
              className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm border ${
                networkEnabled
                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900/40"
                  : "bg-red-500 hover:bg-red-600 text-white border-red-600"
              }`}
              title="Master switch for the entire AIC Social Network feature: match discovery, simulation rounds, and AIC↔AIC conversation turns. Existing chats stay viewable. A working copy of this toggle lives in Manager → Global Settings."
            >
              <Activity size={16} />
              {networkEnabled ? "AIC Network: ON" : "AIC Network: OFF"}
            </button>

            <button
              onClick={handleToggleEmergencyStop}
              className={`px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm ${
                isEmergencyStopped
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200"
              }`}
            >
              <ShieldAlert size={16} />
              {isEmergencyStopped ? "EMERGENCY STOP ACTIVE" : "Emergency Stop"}
            </button>

            <button
              disabled={simulating || isEmergencyStopped || characters.length < 2 || !networkEnabled}
              onClick={handleRunSimulationRound}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shadow-sm"
            >
              <Play size={15} />
              Run Simulation Round
            </button>

            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 rounded-xl text-gray-600 dark:text-gray-300 transition"
              title="Refresh Data"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Informational Banner on Simulation Rounds */}
        <div className="bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-indigo-900 dark:text-indigo-200">
          <div className="flex items-start gap-2.5">
            <Sparkles size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-extrabold block mb-0.5">How Simulation Rounds Work:</span>
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-[11px]">
                Triggering a <strong>Simulation Round</strong> advances the AIC dating ecosystem in two phases:
                <br />
                <strong>1. Match Discovery:</strong> Evaluates unacquainted AICs to form new mutual matches (up to {settings.sim_round_eval_attempts || "2"} attempts).
                <br />
                <strong>2. Conversation Turns:</strong> Generates {settings.sim_round_messages_per_chat || "1"} new back-and-forth turn per active chat, strictly capped by the <strong>Max {settings.sim_round_max_total_messages || "12"} Messages Per Round</strong> budget limit.
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveSubView("settings")}
            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 self-end sm:self-center"
          >
            Configure Limits →
          </button>
        </div>

        {/* Global Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700/60 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Active Matches</span>
            <span className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1 block">
              {activeMatchesCount}
            </span>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700/60 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">AIC-AIC Messages</span>
            <span className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1 block">
              {totalAicMessagesCount}
            </span>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700/60 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Total LLM Calls</span>
            <span className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1 block">
              {totalCallsCount}
            </span>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-2xl border border-gray-100 dark:border-gray-700/60 shadow-xs">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Total Active AICs</span>
            <span className="text-2xl font-extrabold text-gray-900 dark:text-white mt-1 block">
              {characters.length}
            </span>
          </div>
        </div>

        {/* Simulating Notice Banner */}
        {simulating && (
          <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 p-4 rounded-2xl flex items-center gap-3 text-indigo-700 dark:text-indigo-300 font-semibold text-sm animate-pulse">
            <RefreshCw size={18} className="animate-spin shrink-0" />
            <span>{statusText || "Processing simulation turns..."}</span>
          </div>
        )}

        {/* Sub-Navigation Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 gap-6">
          <button
            onClick={() => setActiveSubView("matches")}
            className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeSubView === "matches"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <MessageSquare size={16} />
            Matches & Conversations ({interactions.length})
          </button>

          <button
            onClick={() => setActiveSubView("metrics")}
            className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeSubView === "metrics"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Activity size={16} />
            Call Metrics
          </button>

          <button
            onClick={() => setActiveSubView("settings")}
            className={`pb-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${
              activeSubView === "settings"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Sliders size={16} />
            Prompts & Memory Config
          </button>
        </div>

        {/* ==================================================================== */}
        {/* SUBVIEW 1: MATCHES & CONVERSATIONS */}
        {/* ==================================================================== */}
        {activeSubView === "matches" && (
          <div className="space-y-6">
            {/* Quick Action: Manual Match / Evaluation Bar */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700/60 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3 w-full md:w-auto">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider shrink-0">Manual Pairing:</span>
                <select
                  value={manualA}
                  onChange={(e) => setManualA(e.target.value)}
                  className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-1.5 text-xs font-semibold flex-1 md:flex-initial"
                >
                  <option value="">Select Character A...</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>

                <span className="text-gray-400 font-bold">⇄</span>

                <select
                  value={manualB}
                  onChange={(e) => setManualB(e.target.value)}
                  className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-1.5 text-xs font-semibold flex-1 md:flex-initial"
                >
                  <option value="">Select Character B...</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                <button
                  disabled={!manualA || !manualB || manualA === manualB || isManualMatching}
                  onClick={() => handleEvaluatePair(manualA, manualB)}
                  className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50 px-3 py-1.5 rounded-xl font-bold text-xs transition"
                >
                  Run Compatibility Evaluation
                </button>

                <button
                  disabled={!manualA || !manualB || manualA === manualB || isManualMatching}
                  onClick={handleManualMatch}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1"
                >
                  <Plus size={14} />
                  Force Match
                </button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 flex-wrap">
              <div className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by character name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 pl-9 pr-3 py-2 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap self-end sm:self-auto">
                {(["all", "matched", "unmatched", "disabled", "deleted"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition ${
                      statusFilter === filter
                        ? "bg-indigo-600 text-white"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {filter}
                  </button>
                ))}

                <button
                  onClick={handleBulkDeleteInteractions}
                  className="bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-800/50 px-3 py-1.5 rounded-xl font-bold text-xs transition ml-1 flex items-center gap-1"
                  title="Bulk delete all AIC-to-AIC interactions"
                >
                  <Trash2 size={13} />
                  Delete All Interactions
                </button>
              </div>
            </div>

            {/* Interactions List */}
            {filteredInteractions.length === 0 ? (
              <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700">
                <Bot size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm font-bold text-gray-500">No AIC-to-AIC interactions found.</p>
                <p className="text-xs text-gray-400 mt-1">Use the Manual Pairing bar above or run compatibility evaluations to create matches.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredInteractions.map((inter) => {
                  const charA = inter.characterA || { name: "[Deleted Character]", avatar: "", deleted: true };
                  const charB = inter.characterB || { name: "[Deleted Character]", avatar: "", deleted: true };
                  const isDeletedChar = charA.deleted || charB.deleted;
                  const msgsCount = inter.messages?.length || 0;
                  const lastMsg = msgsCount > 0 ? inter.messages[msgsCount - 1] : null;

                  return (
                    <div
                      key={inter.id}
                      className={`p-5 rounded-3xl border transition shadow-xs ${
                        isDeletedChar
                          ? "bg-gray-100/50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700 opacity-75"
                          : inter.unmatched
                          ? "bg-rose-50/40 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/30"
                          : inter.disabled
                          ? "bg-gray-100/70 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 opacity-80"
                          : inter.matched
                          ? "bg-white dark:bg-gray-800 border-indigo-100/80 dark:border-indigo-900/40"
                          : "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-800"
                      }`}
                    >
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        
                        {/* Pair Avatars & Names */}
                        <div className="flex items-center gap-4">
                          <div className="flex -space-x-3 shrink-0">
                            {charA?.avatar ? (
                              <img
                                src={charA.avatar}
                                alt={charA.name}
                                className="w-14 h-14 rounded-full object-cover border-2 border-white dark:border-gray-800 shadow-sm"
                              />
                            ) : (
                              <div className="w-14 h-14 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center border-2 border-white dark:border-gray-800 text-xs font-bold text-gray-500">
                                ?
                              </div>
                            )}
                            {charB?.avatar ? (
                              <img
                                src={charB.avatar}
                                alt={charB.name}
                                className="w-14 h-14 rounded-full object-cover border-2 border-white dark:border-gray-800 shadow-sm"
                              />
                            ) : (
                              <div className="w-14 h-14 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center border-2 border-white dark:border-gray-800 text-xs font-bold text-gray-500">
                                ?
                              </div>
                            )}
                          </div>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                                {charA.name} & {charB.name}
                              </h3>
                              {inter.unmatched && (
                                <span className="bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  💔 Unmatched
                                </span>
                              )}
                              {inter.matched && !inter.disabled && !inter.unmatched && !isDeletedChar && (
                                <span className="bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Matched
                                </span>
                              )}
                              {!inter.matched && !inter.unmatched && (
                                <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Pending / Pass
                                </span>
                              )}
                              {inter.disabled && !inter.unmatched && (
                                <span className="bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                  Frozen / Inactive
                                </span>
                              )}
                              {isDeletedChar && (
                                <span className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                                  Deleted Character
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">
                              💬 {msgsCount} message{msgsCount === 1 ? "" : "s"} · Updated: {new Date(inter.updatedAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 w-full md:w-auto justify-end flex-wrap">
                          <button
                            onClick={() => setSelectedChat(inter)}
                            className="bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 px-3.5 py-1.5 rounded-xl font-bold text-xs transition"
                          >
                            Inspect & Chat ({msgsCount})
                          </button>

                          {inter.matched && !inter.disabled && !inter.unmatched && !isDeletedChar && (
                            <>
                              <button
                                disabled={simulating || isEmergencyStopped}
                                onClick={() => handleRunSingleTurn(inter.id, 1)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 px-3 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-1"
                              >
                                <Play size={13} />
                                Run 1 Turn
                              </button>

                              <button
                                disabled={simulating || isEmergencyStopped}
                                onClick={() => handleRunSingleTurn(inter.id, 3)}
                                className="bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 disabled:opacity-50 px-2.5 py-1.5 rounded-xl font-bold text-xs transition"
                              >
                                +3 Turns
                              </button>
                            </>
                          )}

                          {inter.matched && !isDeletedChar && (
                            <button
                              onClick={() => handleToggleUnmatch(inter)}
                              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                                inter.unmatched
                                  ? "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 hover:bg-rose-200"
                                  : "text-gray-400 hover:text-rose-600 dark:hover:text-rose-400"
                              }`}
                              title={inter.unmatched ? "Rematch this pair" : "Unmatch this pair"}
                            >
                              {inter.unmatched ? "💔 Rematch" : "💔 Unmatch"}
                            </button>
                          )}

                          {!isDeletedChar && (
                            <button
                              onClick={() => handleToggleDisable(inter)}
                              className={`p-1.5 rounded-xl text-xs font-bold transition ${
                                inter.disabled
                                  ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50"
                                  : "text-gray-400 hover:text-amber-600"
                              }`}
                              title={inter.disabled ? "Unfreeze interaction" : "Freeze interaction"}
                            >
                              {inter.disabled ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                            </button>
                          )}

                          <button
                            onClick={() => handleResetInteraction(inter)}
                            className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-xl transition"
                            title="Reset messages and status"
                          >
                            <RefreshCw size={15} />
                          </button>

                          <button
                            onClick={() => handleDeleteInteraction(inter.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 rounded-xl transition"
                            title="Delete interaction row"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {/* Summary or Latest Message snippet */}
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                        <div className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                          {inter.summary ? (
                            <span><strong className="text-indigo-600 dark:text-indigo-400">Dynamic Summary:</strong> {inter.summary}</span>
                          ) : lastMsg ? (
                            <span><strong>Latest:</strong> "{lastMsg.content}"</span>
                          ) : (
                            <span className="text-gray-400 italic">No messages yet.</span>
                          )}
                        </div>

                        {inter.matched && (
                          <button
                            disabled={simulating || msgsCount === 0}
                            onClick={() => handleGenerateSummary(inter.id)}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                          >
                            {inter.summary ? "Refresh Summary" : "Generate Summary"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* SUBVIEW 2: CALL METRICS (pure ledger — limits live in Settings) */}
        {/* ==================================================================== */}
        {activeSubView === "metrics" && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-3xl border border-gray-100 dark:border-gray-700/60 shadow-xs space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-4">
              <div>
                <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">
                  Character LLM Call Ledger
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Detailed accounting of LLM queries generated by each AI Character across user chats, AIC matches, and summaries.
                </p>
              </div>

              <button
                onClick={() => handleResetMetrics()}
                className="bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400 px-3.5 py-1.5 rounded-xl font-bold text-xs transition"
              >
                Reset All Metrics
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-gray-400 font-bold uppercase tracking-wider">
                    <th className="pb-3 px-2">Character</th>
                    <th className="pb-3 px-2">User Chat Calls</th>
                    <th className="pb-3 px-2">AIC-AIC Chat Calls</th>
                    <th className="pb-3 px-2">Eval Calls</th>
                    <th className="pb-3 px-2">Summary Calls</th>
                    <th className="pb-3 px-2">Total Queries</th>
                    <th className="pb-3 px-2">Last Activity</th>
                    <th className="pb-3 px-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {characters.map((char) => {
                    const m = metrics.find((metric) => metric.characterId === char.id) || {
                      userChatCalls: 0,
                      aicChatCalls: 0,
                      evalCalls: 0,
                      summaryCalls: 0,
                      totalCalls: 0,
                      lastCallAt: null,
                    };

                    return (
                      <tr key={char.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition">
                        <td className="py-3 px-2 flex items-center gap-2.5">
                          {hasRenderableAvatar(char.avatar) ? (
                            <img
                              src={char.avatar}
                              alt={char.name}
                              className="w-8 h-8 rounded-full object-cover shadow-xs"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-500 shadow-xs select-none">
                              {(char.name || "?")[0]}
                            </div>
                          )}
                          <span className="font-extrabold text-gray-900 dark:text-white">{char.name}</span>
                        </td>
                        <td className="py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">{m.userChatCalls}</td>
                        <td className="py-3 px-2 font-semibold text-indigo-600 dark:text-indigo-400">{m.aicChatCalls}</td>
                        <td className="py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">{m.evalCalls}</td>
                        <td className="py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">{m.summaryCalls}</td>
                        <td className="py-3 px-2 font-extrabold text-gray-900 dark:text-white">{m.totalCalls}</td>
                        <td className="py-3 px-2 text-gray-500">
                          {m.lastCallAt ? new Date(m.lastCallAt).toLocaleString() : "Never"}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <button
                            disabled={m.totalCalls === 0}
                            onClick={() => handleResetMetrics(char.id)}
                            className="text-[11px] text-gray-400 hover:text-red-500 disabled:opacity-30 font-bold"
                          >
                            Reset
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ==================================================================== */}
        {/* SUBVIEW 3: DEDICATED LLMS, PROMPTS & MEMORY CONFIG */}
        {/* ==================================================================== */}
        {activeSubView === "settings" && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-lg text-gray-900 dark:text-white">
                  AIC Network Configuration & Prompts
                </h3>
                <p className="text-xs text-gray-500 font-medium">
                  Configure guardrails, cross-chat memory injection, and prompt templates. LLM routing for every AIC↔AIC task is managed in Manager → AI Model Task Assignment.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {settingsSuccess && (
                  <span className="text-xs font-bold text-green-600 flex items-center gap-1">
                    <Check size={15} /> Saved!
                  </span>
                )}
                <button
                  disabled={savingSettings}
                  onClick={handleSaveSettings}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl font-bold text-xs transition shadow-sm"
                >
                  {savingSettings ? "Saving..." : "Save Settings"}
                </button>
              </div>
            </div>

            {/* Accordion 1: Guardrails & Hard Limits */}
            <details open className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700/60 p-6 shadow-xs">
              <summary className="font-extrabold text-base cursor-pointer list-none flex justify-between items-center text-gray-900 dark:text-white select-none">
                <span className="flex items-center gap-2">
                  <ShieldAlert size={18} className="text-red-500" />
                  Guardrails & Hard Limits
                </span>
                <span className="text-xs text-gray-400">▼</span>
              </summary>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Max Active Matches Per Character
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Hard ceiling for how many concurrent active matches an AIC can hold before new likes are blocked.
                  </p>
                  <input
                    type="number"
                    value={editSettings.aic_aic_max_matches_per_char || "3"}
                    onChange={(e) => setEditSettings({ ...editSettings, aic_aic_max_matches_per_char: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Max Messages Per AIC Conversation
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Halts automatic back-and-forth generation when a chat reaches this many total messages to prevent infinite token loops.
                  </p>
                  <input
                    type="number"
                    value={editSettings.aic_aic_max_messages_per_chat || "16"}
                    onChange={(e) => setEditSettings({ ...editSettings, aic_aic_max_messages_per_chat: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Include Profile Images in Prompts
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Provide both characters' avatars in AIC-to-AIC evaluation and chat prompts using multimodal vision syntax.
                  </p>
                  <select
                    value={editSettings.aic_aic_include_images || "true"}
                    onChange={(e) => setEditSettings({ ...editSettings, aic_aic_include_images: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="true">Enabled (Include Avatars)</option>
                    <option value="false">Disabled (Text Only)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Allow Autonomous AIC Unmatching
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Allows AICs to terminate incompatible relationships by outputting the [UNMATCH] tag during dialogue simulation.
                  </p>
                  <select
                    value={editSettings.aic_aic_allow_unmatch || "true"}
                    onChange={(e) => setEditSettings({ ...editSettings, aic_aic_allow_unmatch: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="true">Enabled (AICs Can Unmatch)</option>
                    <option value="false">Disabled (Never Unmatch)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Unmatch Hint Threshold
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Message count after which an AIC must have previously hinted at departing before initiating an unmatch.
                  </p>
                  <input
                    type="number"
                    value={editSettings.aic_aic_unmatch_msg_threshold_hint || "8"}
                    onChange={(e) => setEditSettings({ ...editSettings, aic_aic_unmatch_msg_threshold_hint: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Unmatch Reluctant Threshold
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Message count after which an AIC becomes extremely reluctant to unmatch except in severe conflicts.
                  </p>
                  <input
                    type="number"
                    value={editSettings.aic_aic_unmatch_msg_threshold_reluctant || "30"}
                    onChange={(e) => setEditSettings({ ...editSettings, aic_aic_unmatch_msg_threshold_reluctant: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Global AIC-AIC Emergency Stop
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Instantly freeze all autonomous evaluations and simulation turns across the entire system.
                  </p>
                  <select
                    value={editSettings.aic_aic_emergency_stop || "false"}
                    onChange={(e) => setEditSettings({ ...editSettings, aic_aic_emergency_stop: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="false">Inactive (Simulation Allowed)</option>
                    <option value="true">Active (Simulation Paused)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Match Discovery Attempts Per Round
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    How many unacquainted character pairings the engine should evaluate for compatibility during each simulation round.
                  </p>
                  <input
                    type="number"
                    value={editSettings.sim_round_eval_attempts || "2"}
                    onChange={(e) => setEditSettings({ ...editSettings, sim_round_eval_attempts: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Messages Generated Per Active Conversation
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Number of back-and-forth dialogue turns each active conversation generates during a simulation round.
                  </p>
                  <input
                    type="number"
                    value={editSettings.sim_round_messages_per_chat || "1"}
                    onChange={(e) => setEditSettings({ ...editSettings, sim_round_messages_per_chat: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Max Messages Per Round (Budget Ceiling)
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Hard ceiling on total messages generated in a single simulation round across all chats combined.
                  </p>
                  <input
                    type="number"
                    value={editSettings.sim_round_max_total_messages || "12"}
                    onChange={(e) => setEditSettings({ ...editSettings, sim_round_max_total_messages: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>
              </div>
            </details>

            {/* Accordion 2: Cross-Chat Memory & Transcript Injection */}
            <details open className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700/60 p-6 shadow-xs">
              <summary className="font-extrabold text-base cursor-pointer list-none flex justify-between items-center text-gray-900 dark:text-white select-none">
                <span className="flex items-center gap-2">
                  <Sparkles size={18} className="text-purple-500" />
                  Cross-Chat Memory & Transcript Injection
                </span>
                <span className="text-xs text-gray-400">▼</span>
              </summary>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Injection Mode
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Choose whether other conversations are injected as high-level relationship summaries, dialogue transcripts, or both.
                  </p>
                  <select
                    value={editSettings.cross_chat_injection_mode || "summary_only"}
                    onChange={(e) => setEditSettings({ ...editSettings, cross_chat_injection_mode: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="disabled">Disabled (No other-chat context)</option>
                    <option value="summary_only">Summary Only (Recommended)</option>
                    <option value="transcript_only">Transcript Only (Full dialogue)</option>
                    <option value="both">Both (Summary + Dialogue)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Memory Injection Location
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Where in the LLM prompt other connection memories are positioned.
                  </p>
                  <select
                    value={editSettings.cross_chat_injection_location || "system_prompt_bottom"}
                    onChange={(e) => setEditSettings({ ...editSettings, cross_chat_injection_location: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="system_prompt_bottom">System Prompt Bottom (End of Persona)</option>
                    <option value="system_prompt_top">System Prompt Top (Before Persona)</option>
                    <option value="before_recent_messages">Before History (Context Message)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Max Other Chats to Inject
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Maximum number of other connection memories included in each prompt to control token context.
                  </p>
                  <input
                    type="number"
                    value={editSettings.cross_chat_max_other_chats || "3"}
                    onChange={(e) => setEditSettings({ ...editSettings, cross_chat_max_other_chats: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Max Transcript Messages Per Other Chat
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Number of recent dialogue turns included when transcript mode is active.
                  </p>
                  <input
                    type="number"
                    value={editSettings.cross_chat_max_transcript_messages || "6"}
                    onChange={(e) => setEditSettings({ ...editSettings, cross_chat_max_transcript_messages: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Inject AIC Chats into User Chats
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Allows AICs to recall their dating connections with fellow AICs while chatting with human users.
                  </p>
                  <select
                    value={editSettings.cross_chat_include_aic_in_user || "true"}
                    onChange={(e) => setEditSettings({ ...editSettings, cross_chat_include_aic_in_user: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="true">Enabled (Yes)</option>
                    <option value="false">Disabled (No)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Inject User Chats into AIC-AIC Chats
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Allows AICs to recall conversations with human users while chatting with other AICs.
                  </p>
                  <select
                    value={editSettings.cross_chat_include_user_in_aic || "true"}
                    onChange={(e) => setEditSettings({ ...editSettings, cross_chat_include_user_in_aic: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="true">Enabled (Yes)</option>
                    <option value="false">Disabled (No)</option>
                  </select>
                </div>
              </div>
            </details>

            {/* Accordion 4: Configurable Prompt Templates */}
            <details className="bg-white dark:bg-gray-800 rounded-3xl border border-gray-100 dark:border-gray-700/60 p-6 shadow-xs">
              <summary className="font-extrabold text-base cursor-pointer list-none flex justify-between items-center text-gray-900 dark:text-white select-none">
                <span className="flex items-center gap-2">
                  <FileText size={18} className="text-emerald-500" />
                  Configurable Prompt Templates
                </span>
                <span className="text-xs text-gray-400">▼</span>
              </summary>

              <div className="space-y-6 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    AIC-to-AIC Compatibility Evaluation Prompt
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Available tokens: {"{character_a_name}"}, {"{character_a_gender}"}, {"{character_a_looking_for}"}, {"{character_a_private_persona}"}, {"{character_a_public_bio}"}, {"{character_a_avatar}"}, {"{character_b_name}"}, {"{character_b_gender}"}, {"{character_b_looking_for}"}, {"{character_b_public_bio}"}, {"{character_b_avatar}"}, {"{image_prompt_block}"}.
                  </p>
                  <textarea
                    rows={7}
                    value={editSettings.prompt_aic_aic_eval || ""}
                    onChange={(e) => setEditSettings({ ...editSettings, prompt_aic_aic_eval: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 font-mono text-xs leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    AIC-to-AIC Conversation System Prompt
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Available tokens: {"{character_name}"}, {"{speaker_name}"}, {"{partner_name}"}, {"{private_persona}"}, {"{character_public_bio}"}, {"{partner_public_bio}"}, {"{other_chats_memory_block}"}, {"{unmatch_rule}"}.
                  </p>
                  <textarea
                    rows={7}
                    value={editSettings.prompt_aic_aic_chat || ""}
                    onChange={(e) => setEditSettings({ ...editSettings, prompt_aic_aic_chat: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 font-mono text-xs leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    AIC-to-AIC Unmatch Rule Instruction Prompt
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Available tokens: {"{partner_name}"}, {"{hint_threshold}"}, {"{reluctant_threshold}"}, {"{total_messages}"}.
                  </p>
                  <textarea
                    rows={5}
                    value={editSettings.prompt_aic_aic_unmatch_rule || ""}
                    onChange={(e) => setEditSettings({ ...editSettings, prompt_aic_aic_unmatch_rule: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 font-mono text-xs leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Relationship Dynamic Summary Prompt
                  </label>
                  <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
                    Available tokens: {"{character_a_name}"}, {"{character_b_name}"}, {"{chat_transcript}"}.
                  </p>
                  <textarea
                    rows={5}
                    value={editSettings.prompt_aic_aic_summary || ""}
                    onChange={(e) => setEditSettings({ ...editSettings, prompt_aic_aic_summary: e.target.value })}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-3 font-mono text-xs leading-relaxed"
                  />
                </div>
              </div>
            </details>

            {/* Accordion 5: Danger Zone */}
            <details className="bg-red-50/50 dark:bg-red-950/20 rounded-3xl border border-red-200 dark:border-red-900/50 p-6 shadow-xs">
              <summary className="font-extrabold text-base cursor-pointer list-none flex justify-between items-center text-red-900 dark:text-red-300 select-none">
                <span className="flex items-center gap-2">
                  <ShieldAlert size={18} className="text-red-500" />
                  Danger Zone & Bulk Operations
                </span>
                <span className="text-xs text-red-400">▼</span>
              </summary>

              <div className="space-y-4 mt-6 pt-4 border-t border-red-200 dark:border-red-900/50">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-xs text-red-900 dark:text-red-300">
                      Delete All AIC-to-AIC Interactions & Messages
                    </h4>
                    <p className="text-[11px] text-red-700/80 dark:text-red-400/80 mt-0.5">
                      Permanently wipes all peer interaction records, evaluations, match statuses, and dialogue histories across all characters.
                    </p>
                  </div>
                  <button
                    onClick={handleBulkDeleteInteractions}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition shrink-0 flex items-center gap-1.5 shadow-sm"
                  >
                    <Trash2 size={14} />
                    Delete All Interactions
                  </button>
                </div>
              </div>
            </details>
          </div>
        )}

      </div>

      {/* AIC Chat Inspector Modal */}
      {selectedChat && (
        <AicChatModal
          interaction={selectedChat}
          onClose={() => setSelectedChat(null)}
          onUpdate={fetchData}
        />
      )}
    </div>
  );
}

// Modal component for viewing and debugging an individual AIC-AIC chat
function AicChatModal({ interaction, onClose, onUpdate }: { interaction: any, onClose: () => void, onUpdate: () => void }) {
  const [messages, setMessages] = useState<any[]>(interaction.messages || []);
  const [runningTurns, setRunningTurns] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newMsgSender, setNewMsgSender] = useState(interaction.characterAId);
  const [newMsgContent, setNewMsgContent] = useState("");
  const [currentInter, setCurrentInter] = useState<any>(interaction);

  const charA = currentInter.characterA || { name: "[Deleted Character]", avatar: "", id: currentInter.characterAId, deleted: true };
  const charB = currentInter.characterB || { name: "[Deleted Character]", avatar: "", id: currentInter.characterBId, deleted: true };
  const isDeletedChar = charA.deleted || charB.deleted;
  const isUnmatched = currentInter.unmatched;

  const fetchMessages = async () => {
    const res = await safeFetch(`/api/aic-network/messages?interactionId=${currentInter.id}`);
    if (res.success) {
      setMessages(res.messages || []);
    }
  };

  const handleToggleModalUnmatch = async () => {
    const action = isUnmatched ? "rematch" : "unmatch";
    const res = await safeFetch("/api/aic-network/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: currentInter.id,
        action,
        unmatchedBy: "admin",
      }),
    });
    if (res.success) {
      setCurrentInter((prev: any) => ({
        ...prev,
        unmatched: !isUnmatched,
        unmatchedBy: isUnmatched ? null : "admin",
      }));
      onUpdate();
    } else {
      showToast(res.error || "Failed to toggle unmatch.");
    }
  };

  const handleRunTurn = async (turns = 1) => {
    setRunningTurns(true);
    const res = await safeFetch("/api/aic-network/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactionId: currentInter.id, turnsCount: turns }),
    });
    setRunningTurns(false);
    if (res.success) {
      fetchMessages();
      onUpdate();
    } else {
      showToast(res.error || "Failed to execute turn.");
    }
  };

  const handleSaveEdit = async (msgId: string) => {
    const res = await safeFetch("/api/aic-network/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", messageId: msgId, content: editText }),
    });
    if (res.success) {
      setEditingMsgId(null);
      fetchMessages();
      onUpdate();
    }
  };

  const handleDeleteMsg = async (msgId: string) => {
    if (!await confirmInApp("Delete this message?")) return;
    const res = await safeFetch("/api/aic-network/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", messageId: msgId }),
    });
    if (res.success) {
      fetchMessages();
      onUpdate();
    }
  };

  const handleAddCustomMsg = async () => {
    if (!newMsgContent.trim()) return;
    const res = await safeFetch("/api/aic-network/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add",
        aicInteractionId: currentInter.id,
        senderId: newMsgSender,
        content: newMsgContent.trim(),
      }),
    });
    if (res.success) {
      setNewMsgContent("");
      fetchMessages();
      onUpdate();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 md:p-8">
      <div className="bg-white dark:bg-gray-900 rounded-3xl overflow-hidden max-w-3xl w-full flex flex-col h-[85vh] shadow-2xl border border-gray-200 dark:border-gray-800">
        
        {/* Header */}
        <div className="p-4 md:p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/70 dark:bg-gray-800/50">
          <div className="flex items-center gap-4">
            <div className="flex -space-x-3">
              {charA?.avatar ? (
                <img src={charA.avatar} alt={charA.name} className="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-gray-800 shadow-sm" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center border-2 border-white dark:border-gray-800 text-xs font-bold text-gray-500">?</div>
              )}
              {charB?.avatar ? (
                <img src={charB.avatar} alt={charB.name} className="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-gray-800 shadow-sm" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center border-2 border-white dark:border-gray-800 text-xs font-bold text-gray-500">?</div>
              )}
            </div>

            <div>
              <h3 className="font-extrabold text-base text-gray-900 dark:text-white flex items-center gap-2 flex-wrap">
                {charA?.name} & {charB?.name}
                {isUnmatched && (
                  <span className="bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    💔 Unmatched
                  </span>
                )}
                {isDeletedChar && (
                  <span className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    Deleted Char
                  </span>
                )}
              </h3>
              <p className="text-xs text-gray-500 font-medium">
                {messages.length} messages exchanged
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isDeletedChar && (
              <button
                onClick={handleToggleModalUnmatch}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                  isUnmatched
                    ? "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 hover:bg-rose-200"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:text-rose-600"
                }`}
              >
                {isUnmatched ? "💔 Rematch" : "💔 Unmatch"}
              </button>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-200 hover:bg-gray-300 transition"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Deleted / Inactive Banner */}
        {isDeletedChar && (
          <div className="bg-amber-50 dark:bg-amber-950/40 px-6 py-2.5 border-b border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300 font-medium">
            ⚠️ One or both characters in this conversation have been deleted. Past chat history is preserved in read-only mode.
          </div>
        )}

        {/* Unmatched Banner */}
        {isUnmatched && !isDeletedChar && (
          <div className="bg-rose-50 dark:bg-rose-950/40 px-6 py-2.5 border-b border-rose-200 dark:border-rose-900/50 text-xs text-rose-800 dark:text-rose-300 font-medium flex items-center justify-between">
            <span>💔 This conversation is currently unmatched. New simulation turns are paused until rematched.</span>
          </div>
        )}

        {/* Dynamic Summary Banner */}
        {currentInter.summary && (
          <div className="bg-indigo-50/80 dark:bg-indigo-950/30 px-6 py-2.5 border-b border-indigo-100 dark:border-indigo-900/40 text-xs text-indigo-800 dark:text-indigo-300 font-medium flex items-center gap-2">
            <Sparkles size={14} className="shrink-0 text-indigo-500" />
            <span className="line-clamp-2"><strong>Dynamic:</strong> {currentInter.summary}</span>
          </div>
        )}

        {/* Chat Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 bg-gray-50/30 dark:bg-gray-950/20">
          {messages.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm font-semibold">
              No dialogue yet. Click "Run 1 Turn" below to have them start talking!
            </div>
          ) : (
            messages.map((m) => {
              const isCharA = m.senderId === charA?.id;
              const sender = isCharA ? charA : charB;
              const isEditing = editingMsgId === m.id;

              return (
                <div
                  key={m.id}
                  className={`flex gap-3 group items-start ${isCharA ? "flex-row" : "flex-row-reverse"}`}
                >
                  {hasRenderableAvatar(sender?.avatar) ? (
                    <img
                      src={sender?.avatar}
                      alt={sender?.name}
                      className="w-8 h-8 rounded-full object-cover shrink-0 mt-1 shadow-xs"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0 mt-1 select-none">
                      {(sender?.name || "?")[0]}
                    </div>
                  )}

                  <div className={`max-w-[78%] space-y-1 ${isCharA ? "items-start" : "items-end"}`}>
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                        {sender?.name}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-2 p-2 bg-white dark:bg-gray-800 rounded-2xl border border-indigo-300">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full text-xs bg-transparent border-0 focus:ring-0 p-1 resize-none font-medium"
                          rows={3}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingMsgId(null)}
                            className="px-2 py-1 rounded text-xs text-gray-500 font-bold"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(m.id)}
                            className="px-3 py-1 rounded bg-indigo-600 text-white text-xs font-bold"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`p-3.5 rounded-2xl text-xs font-medium leading-relaxed relative ${
                          isCharA
                            ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-100 dark:border-gray-700/60 shadow-xs"
                            : "bg-indigo-600 text-white shadow-xs"
                        }`}
                      >
                        <p>{m.content}</p>

                        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-3 right-2 flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-1.5 py-0.5 shadow-sm">
                          <button
                            onClick={() => {
                              setEditingMsgId(m.id);
                              setEditText(m.content);
                            }}
                            className="p-1 text-gray-400 hover:text-indigo-600"
                            title="Edit"
                          >
                            <Edit3 size={11} />
                          </button>
                          <button
                            onClick={() => handleDeleteMsg(m.id)}
                            className="p-1 text-gray-400 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions & Custom Message Inserter */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 space-y-3">
          {/* Custom Message Injector */}
          <div className="flex gap-2 items-center">
            <select
              disabled={isDeletedChar || isUnmatched}
              value={newMsgSender}
              onChange={(e) => setNewMsgSender(e.target.value)}
              className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-2.5 py-2 text-xs font-bold shrink-0 disabled:opacity-50"
            >
              <option value={charA?.id}>{charA?.name}</option>
              <option value={charB?.id}>{charB?.name}</option>
            </select>

            <input
              type="text"
              disabled={isDeletedChar || isUnmatched}
              placeholder={
                isDeletedChar
                  ? "Chat is read-only (character deleted)"
                  : isUnmatched
                  ? "Chat is unmatched (turns paused)"
                  : "Inject custom message as this character..."
              }
              value={newMsgContent}
              onChange={(e) => setNewMsgContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCustomMsg();
              }}
              className="flex-1 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 text-xs disabled:opacity-50"
            />

            <button
              onClick={handleAddCustomMsg}
              disabled={!newMsgContent.trim() || isDeletedChar || isUnmatched}
              className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Inject
            </button>
          </div>

          {/* Autonomous Turns Runner Bar */}
          <div className="flex justify-between items-center flex-wrap gap-2 pt-1">
            <span className="text-[11px] font-bold text-gray-400">
              {isDeletedChar
                ? "Simulation disabled (Deleted Character)"
                : isUnmatched
                ? "Simulation disabled (Unmatched)"
                : `Next speaker: ${messages.length === 0 || messages[messages.length - 1].senderId === charB?.id ? charA?.name : charB?.name}`}
            </span>

            <div className="flex items-center gap-2">
              <button
                disabled={runningTurns || isDeletedChar || isUnmatched}
                onClick={() => handleRunTurn(1)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shadow-sm"
              >
                <Play size={14} />
                {runningTurns ? "Thinking..." : "Run 1 Turn"}
              </button>

              <button
                disabled={runningTurns || isDeletedChar || isUnmatched}
                onClick={() => handleRunTurn(3)}
                className="bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl font-bold text-xs transition"
              >
                Run 3 Turns
              </button>

              <button
                disabled={runningTurns || isDeletedChar || isUnmatched}
                onClick={() => handleRunTurn(6)}
                className="bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 rounded-xl font-bold text-xs transition"
              >
                Run 6 Turns
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

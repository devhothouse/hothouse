"use client";

import React, { useState, useEffect } from "react";
import {
  MessageSquare,
  Sparkles,
  RefreshCw,
  Trash2,
  Edit3,
  Plus,
  Check,
  X,
  Sliders,
  ThumbsUp,
  Flame,
  Coffee,
  Heart,
  AlertTriangle,
  Eye,
  EyeOff,
  Search,
  Filter,
  Star,
  Award,
  Send,
  HelpCircle,
  Tag,
  Shield,
  Activity
} from "lucide-react";
import { safeFetch } from "../page";
import { showToast, confirmInApp } from "@/lib/notify";
import {
  GenerateModal,
  CustomModal,
  BadgeManagerModal,
  SettingsModal,
  EditReviewModal,
} from "./GossipModals";


interface UserReviewItem {
  id: string;
  profileId: string;
  characterId: string;
  interactionId?: string | null;
  content: string;
  sentiment: string;
  rating: number;
  badges: string;
  isAnonymous: boolean;
  anonymousAlias?: string | null;
  triggerReason: string;
  upvotes: number;
  createdAt: string;
  updatedAt: string;
  character?: {
    id: string;
    name: string;
    avatar: string;
    publicBio: string;
    gender: string;
  };
}

interface BadgeItem {
  name: string;
  category: "green_flag" | "red_flag" | "spice" | "tea" | string;
  emoji: string;
}

export function GossipTab({ activeProfile, onOpenBio }: { activeProfile: any; onOpenBio?: (char: any) => void }) {
  const [reviews, setReviews] = useState<UserReviewItem[]>([]);
  const [stats, setStats] = useState<{
    totalReviews: number;
    avgRating: number;
    sentimentCounts: Record<string, number>;
    topBadges: { name: string; count: number }[];
  }>({
    totalReviews: 0,
    avgRating: 0,
    sentimentCounts: {},
    topBadges: [],
  });

  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [badgeFilter, setBadgeFilter] = useState("all");
  const [authorFilter, setAuthorFilter] = useState("all");
  const [showAdminReveal, setShowAdminReveal] = useState(false);

  // Modals
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showBadgeManagerModal, setShowBadgeManagerModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingReview, setEditingReview] = useState<UserReviewItem | null>(null);

  // Generation Modal States
  const [availableCharacters, setAvailableCharacters] = useState<any[]>([]);
  const [genCharacterId, setGenCharacterId] = useState("");
  const [genTriggerReason, setGenTriggerReason] = useState("milestone_40_msgs");
  const [isGenerating, setIsGenerating] = useState(false);

  // Gossip feature master switch (mirrored in Manager → Global Settings).
  const [gossipEnabled, setGossipEnabled] = useState(true);
  useEffect(() => {
    const loadToggle = async () => {
      const data = await safeFetch("/api/settings");
      if (data.success && data.settings) setGossipEnabled(data.settings.gossip_enabled !== "false");
    };
    loadToggle();
  }, []);

  const handleToggleGossipEnabled = async () => {
    const newVal = gossipEnabled ? "false" : "true";
    const res = await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gossip_enabled: newVal }),
    });
    if (res.success) {
      setGossipEnabled(newVal === "true");
      showToast(newVal === "true"
        ? "Gossip feature enabled."
        : "Gossip turned off — no new reviews will be generated (milestones, ghosting checks, unmatch post-mortems, or manual triggers) until you turn it back on.");
    } else {
      showToast(res.error || "Failed to update the Gossip toggle.");
    }
  };

  // Custom Review Modal States
  const [customCharId, setCustomCharId] = useState("");
  const [customContent, setCustomContent] = useState("");
  const [customSentiment, setCustomSentiment] = useState("green_flag");
  const [customRating, setCustomRating] = useState(4);
  const [customBadges, setCustomBadges] = useState<string[]>([]);
  const [customIsAnon, setCustomIsAnon] = useState(true);
  const [customAlias, setCustomAlias] = useState("");
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);

  // Badges & Milestones States
  const [badgesCatalog, setBadgesCatalog] = useState<BadgeItem[]>([]);
  const [newBadgeName, setNewBadgeName] = useState("");
  const [newBadgeCategory, setNewBadgeCategory] = useState<"green_flag" | "red_flag" | "spice" | "tea">("green_flag");
  const [newBadgeEmoji, setNewBadgeEmoji] = useState("🟢");
  const [milestonesStr, setMilestonesStr] = useState("[40, 100]");

  // Gossip Settings States
  const [gossipSettings, setGossipSettings] = useState<Record<string, string>>({});
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const fetchReviews = async () => {
    if (!activeProfile) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("profileId", activeProfile.id);
      if (sentimentFilter !== "all") params.append("sentiment", sentimentFilter);
      if (badgeFilter !== "all") params.append("badge", badgeFilter);
      if (authorFilter !== "all") params.append("authorId", authorFilter);
      if (searchQuery.trim()) params.append("q", searchQuery.trim());

      const res = await safeFetch(`/api/gossip?${params.toString()}`);
      if (res.success) {
        setReviews(res.reviews || []);
        setStats(res.stats || { totalReviews: 0, avgRating: 0, sentimentCounts: {}, topBadges: [] });
      }
    } catch (err) {
      console.error("Failed to load gossip reviews:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAuxiliaryData = async () => {
    try {
      const [charsRes, badgesRes, settingsRes] = await Promise.all([
        safeFetch("/api/characters"),
        safeFetch("/api/gossip/badges"),
        safeFetch("/api/settings"),
      ]);

      if (charsRes.success) {
        setAvailableCharacters(charsRes.characters || []);
        if (charsRes.characters?.length > 0 && !genCharacterId) {
          setGenCharacterId(charsRes.characters[0].id);
          setCustomCharId(charsRes.characters[0].id);
        }
      }

      if (badgesRes.success && Array.isArray(badgesRes.badges)) {
        setBadgesCatalog(badgesRes.badges);
      }

      if (settingsRes.success && settingsRes.settings) {
        setGossipSettings(settingsRes.settings);
        if (settingsRes.settings.gossip_message_milestones) {
          setMilestonesStr(settingsRes.settings.gossip_message_milestones);
        }
      }
    } catch (err) {
      console.error("Failed to fetch auxiliary gossip data:", err);
    }
  };

  useEffect(() => {
    if (activeProfile) {
      fetchReviews();
      fetchAuxiliaryData();
    }
  }, [activeProfile, sentimentFilter, badgeFilter, authorFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReviews();
  };

  const handleUpvote = async (reviewId: string) => {
    setReviews((prev) =>
      prev.map((r) => (r.id === reviewId ? { ...r, upvotes: r.upvotes + 1 } : r))
    );
    try {
      await safeFetch("/api/gossip/upvote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reviewId }),
      });
    } catch (err) {
      console.error("Failed to upvote:", err);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!await confirmInApp("Are you sure you want to delete this gossip post?")) return;
    try {
      const res = await safeFetch(`/api/gossip?id=${reviewId}`, { method: "DELETE" });
      if (res.success) {
        fetchReviews();
      } else {
        showToast("Failed to delete: " + res.error);
      }
    } catch (err: any) {
      showToast("Error: " + err.message);
    }
  };

  const handleClearAll = async () => {
    if (!await confirmInApp(`Are you sure you want to purge all gossip reviews for ${activeProfile.name}? This cannot be undone.`)) return;
    try {
      const res = await safeFetch(`/api/gossip?all=true&profileId=${activeProfile.id}`, { method: "DELETE" });
      if (res.success) {
        fetchReviews();
      } else {
        showToast("Failed to clear reviews: " + res.error);
      }
    } catch (err: any) {
      showToast("Error: " + err.message);
    }
  };

  const handleCheckMilestones = async () => {
    try {
      setLoading(true);
      const res = await safeFetch("/api/gossip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_all" }),
      });
      if (res.success) {
        showToast(res.message || "Checked all active chats and updated milestones.");
        fetchReviews();
      } else {
        showToast("Failed: " + res.error);
      }
    } catch (err: any) {
      showToast("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateReview = async () => {
    if (!genCharacterId) return;
    setIsGenerating(true);
    try {
      const res = await safeFetch("/api/gossip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          characterId: genCharacterId,
          triggerReason: genTriggerReason,
        }),
      });
      if (res.success) {
        setShowGenerateModal(false);
        fetchReviews();
      } else {
        showToast("Generation failed: " + res.error);
      }
    } catch (err: any) {
      showToast("Error: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateCustom = async () => {
    if (!customContent.trim() || !customCharId) {
      showToast("Please write review content and pick an author.");
      return;
    }
    setIsCreatingCustom(true);
    try {
      const res = await safeFetch("/api/gossip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          profileId: activeProfile.id,
          characterId: customCharId,
          content: customContent.trim(),
          sentiment: customSentiment,
          rating: customRating,
          badges: customBadges,
          isAnonymous: customIsAnon,
          anonymousAlias: customAlias.trim() || undefined,
          triggerReason: "manual_post",
        }),
      });
      if (res.success) {
        setShowCustomModal(false);
        setCustomContent("");
        setCustomBadges([]);
        fetchReviews();
      } else {
        showToast("Failed to post: " + res.error);
      }
    } catch (err: any) {
      showToast("Error: " + err.message);
    } finally {
      setIsCreatingCustom(false);
    }
  };

  const handleSaveBadgesAndMilestones = async () => {
    try {
      await Promise.all([
        safeFetch("/api/gossip/badges", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ badges: badgesCatalog }),
        }),
        safeFetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gossip_message_milestones: milestonesStr }),
        }),
      ]);
      showToast("Badges and milestones saved!");
      setShowBadgeManagerModal(false);
      fetchReviews();
    } catch (err: any) {
      showToast("Error saving: " + err.message);
    }
  };

  // Badge add/remove now persist to the database immediately so custom gossip tags
  // survive tab closes and app restarts (previously they were local-only until the
  // Badge Manager's explicit Save button was clicked, so unsaved tags were lost).
  const persistBadges = async (nextCatalog: BadgeItem[]) => {
    const res = await safeFetch("/api/gossip/badges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ badges: nextCatalog }),
    });
    if (!res.success) {
      showToast("Failed to save badge changes: " + (res.error || "unknown error"));
    }
  };

  const handleAddBadge = () => {
    if (!newBadgeName.trim()) return;
    const exists = badgesCatalog.some((b) => b.name.toLowerCase() === newBadgeName.trim().toLowerCase());
    if (exists) {
      showToast("Badge already exists.");
      return;
    }
    const nextCatalog: BadgeItem[] = [
      ...badgesCatalog,
      { name: newBadgeName.trim(), category: newBadgeCategory, emoji: newBadgeEmoji },
    ];
    setBadgesCatalog(nextCatalog);
    setNewBadgeName("");
    persistBadges(nextCatalog);
  };

  const handleRemoveBadge = (nameToRemove: string) => {
    const nextCatalog = badgesCatalog.filter((b) => b.name !== nameToRemove);
    setBadgesCatalog(nextCatalog);
    persistBadges(nextCatalog);
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const res = await safeFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gossipSettings),
      });
      if (res.success) {
        showToast("Gossip settings saved successfully!");
        setShowSettingsModal(false);
      } else {
        showToast("Failed to save settings: " + res.error);
      }
    } catch (err: any) {
      showToast("Error saving settings: " + err.message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSaveEditedReview = async () => {
    if (!editingReview) return;
    try {
      let parsedBadges: string[] = [];
      try {
        parsedBadges = typeof editingReview.badges === "string" ? JSON.parse(editingReview.badges) : editingReview.badges;
      } catch {
        parsedBadges = [editingReview.badges];
      }

      const res = await safeFetch("/api/gossip", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingReview.id,
          content: editingReview.content,
          sentiment: editingReview.sentiment,
          rating: editingReview.rating,
          badges: parsedBadges,
          isAnonymous: editingReview.isAnonymous,
          anonymousAlias: editingReview.anonymousAlias,
        }),
      });
      if (res.success) {
        setEditingReview(null);
        fetchReviews();
      } else {
        showToast("Failed to update: " + res.error);
      }
    } catch (err: any) {
      showToast("Error: " + err.message);
    }
  };

  const getSentimentBadge = (sentiment: string) => {
    switch (sentiment) {
      case "green_flag":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">🟢 Green Flag</span>;
      case "red_flag":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800">🔴 Red Flag</span>;
      case "tea_spill":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">☕ Spicy Tea</span>;
      case "kink_friendly":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-800">🌶️ Kink / Dynamics</span>;
      case "wholesome":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300 border border-sky-300 dark:border-sky-800">💖 Wholesome</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700">⚪ Neutral Note</span>;
    }
  };

  return (
    <div className="h-full flex flex-col overflow-y-auto bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 md:p-6 pb-24 space-y-6">
      {/* 1. Header & Active Profile Reputation Scorecard */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 dark:border-gray-700/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">☕</span>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent">
                Dating Gossip & Community Board
              </h1>
              <span className="bg-pink-100 text-pink-700 dark:bg-pink-950/70 dark:text-pink-300 text-xs px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                COMMUNITY
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Simulated private forum where AI characters post honest tea, reviews, and flags about dating <span className="font-semibold text-gray-800 dark:text-gray-200">@{activeProfile?.name}</span>.
            </p>
          </div>

          {/* Action Toolbar Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleToggleGossipEnabled}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition flex items-center gap-1.5 shadow-sm ${
                gossipEnabled
                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900/40"
                  : "bg-red-500 hover:bg-red-600 text-white border-red-600"
              }`}
              title="Master switch for the Gossip feature: stops ALL new review generation (milestones, ghosting checks, unmatch post-mortems, and manual triggers). The existing board stays viewable. A working copy of this toggle lives in Manager → Global Settings."
            >
              {gossipEnabled ? "☕ Gossip: ON" : "☕ Gossip: OFF"}
            </button>
            <button
              onClick={handleCheckMilestones}
              disabled={!gossipEnabled}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Scans all active chats to check if 40/100 msg milestones or 24h ignored slide-ins should trigger a review"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Check Milestones
            </button>
            <button
              onClick={() => setShowGenerateModal(true)}
              disabled={!gossipEnabled}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-pink-600 hover:bg-pink-700 text-white shadow-sm transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Trigger AI Review
            </button>
            <button
              onClick={() => setShowCustomModal(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-sm transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Post Custom Note
            </button>
            <button
              onClick={() => setShowBadgeManagerModal(true)}
              className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition"
              title="Manage Badges & Milestone Numbers"
            >
              <Tag className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition"
              title="Gossip Settings & Injection Prompts"
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scorecard KPI Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          {/* Average Rating */}
          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200/70 dark:border-gray-700/50 flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xl">
              ⭐
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-gray-900 dark:text-white">{stats.avgRating || "N/A"}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">/ 5.0</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Based on <span className="font-semibold text-gray-700 dark:text-gray-300">{stats.totalReviews}</span> AIC reviews
              </p>
            </div>
          </div>

          {/* Sentiment Flag Distribution */}
          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200/70 dark:border-gray-700/50 flex flex-col justify-center">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
              Community Sentiment
            </span>
            <div className="w-full bg-gray-200 dark:bg-gray-700 h-2.5 rounded-full overflow-hidden flex">
              {stats.totalReviews > 0 ? (
                <>
                  <div
                    className="bg-emerald-500 h-full"
                    style={{
                      width: `${((stats.sentimentCounts.green_flag || 0) / stats.totalReviews) * 100}%`,
                    }}
                    title={`Green Flags: ${stats.sentimentCounts.green_flag || 0}`}
                  />
                  <div
                    className="bg-purple-500 h-full"
                    style={{
                      width: `${((stats.sentimentCounts.kink_friendly || 0) / stats.totalReviews) * 100}%`,
                    }}
                    title={`Kink/Spice: ${stats.sentimentCounts.kink_friendly || 0}`}
                  />
                  <div
                    className="bg-amber-500 h-full"
                    style={{
                      width: `${((stats.sentimentCounts.tea_spill || 0) / stats.totalReviews) * 100}%`,
                    }}
                    title={`Tea: ${stats.sentimentCounts.tea_spill || 0}`}
                  />
                  <div
                    className="bg-rose-500 h-full"
                    style={{
                      width: `${((stats.sentimentCounts.red_flag || 0) / stats.totalReviews) * 100}%`,
                    }}
                    title={`Red Flags: ${stats.sentimentCounts.red_flag || 0}`}
                  />
                </>
              ) : (
                <div className="w-full bg-gray-300 dark:bg-gray-600 h-full" />
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] font-medium text-gray-600 dark:text-gray-300 mt-1.5">
              <span className="text-emerald-600 dark:text-emerald-400">🟢 {stats.sentimentCounts.green_flag || 0} Green</span>
              <span className="text-purple-600 dark:text-purple-400">🌶️ {stats.sentimentCounts.kink_friendly || 0} Spice</span>
              <span className="text-amber-600 dark:text-amber-400">☕ {stats.sentimentCounts.tea_spill || 0} Tea</span>
              <span className="text-rose-600 dark:text-rose-400">🔴 {stats.sentimentCounts.red_flag || 0} Red</span>
            </div>
          </div>

          {/* Top Badges */}
          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200/70 dark:border-gray-700/50 flex flex-col justify-center">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-amber-500" /> Top Badges
            </span>
            <div className="flex flex-wrap gap-1.5 overflow-hidden max-h-12">
              {stats.topBadges.length > 0 ? (
                stats.topBadges.slice(0, 4).map((b, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 shadow-2xs"
                  >
                    {b.name} <span className="text-[10px] text-pink-500 font-bold">x{b.count}</span>
                  </span>
                ))
              ) : (
                <span className="text-xs text-gray-400 dark:text-gray-500 italic">No badges awarded yet.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Search & Filtering Deck */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-3.5 border border-gray-200 dark:border-gray-700 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[200px] flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search gossip, badges, tea..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-hidden focus:ring-2 focus:ring-pink-500"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 transition"
          >
            Filter
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sentimentFilter}
            onChange={(e) => setSentimentFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-hidden"
          >
            <option value="all">All Sentiments</option>
            <option value="green_flag">🟢 Green Flags</option>
            <option value="red_flag">🔴 Red Flags</option>
            <option value="tea_spill">☕ Spicy Tea</option>
            <option value="kink_friendly">🌶️ Kink / Spice</option>
            <option value="wholesome">💖 Wholesome</option>
            <option value="neutral">⚪ Neutral</option>
          </select>

          <select
            value={authorFilter}
            onChange={(e) => setAuthorFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-hidden"
          >
            <option value="all">All Authors</option>
            {availableCharacters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <button
            onClick={() => setShowAdminReveal(!showAdminReveal)}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition flex items-center gap-1.5 ${
              showAdminReveal
                ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                : "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600"
            }`}
            title="Reveal actual AIC author identities behind anonymous posts"
          >
            {showAdminReveal ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showAdminReveal ? "Admin Reveal: ON" : "Admin Reveal"}
          </button>

          {reviews.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 transition"
              title="Delete all reviews for this profile"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 3. Review Post Feed */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center p-12 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700">
            <RefreshCw className="w-6 h-6 animate-spin text-pink-500 mr-3" />
            <span className="text-sm font-medium text-gray-500">Loading gossip ledger...</span>
          </div>
        ) : reviews.length === 0 ? (
          <div className="text-center p-12 bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-2xs">
            <Coffee className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-gray-800 dark:text-gray-200">No Gossip Posted Yet</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
              As you chat with AICs and hit milestones (40 or 100 msgs) or unmatch, they will anonymously post candid dating reviews and flags here.
            </p>
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => setShowGenerateModal(true)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-pink-600 hover:bg-pink-700 text-white transition"
              >
                Generate First Review
              </button>
            </div>
          </div>
        ) : (
          reviews.map((review) => {
            let badgesArr: string[] = [];
            try {
              badgesArr = JSON.parse(review.badges);
            } catch {
              badgesArr = [review.badges];
            }

            const isRevealed = showAdminReveal || !review.isAnonymous;
            const authorName = isRevealed && review.character ? review.character.name : review.anonymousAlias || "Anonymous Dater";

            return (
              <div
                key={review.id}
                className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-200 dark:border-gray-700/80 shadow-2xs hover:shadow-md transition-shadow relative group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {isRevealed && review.character?.avatar ? (
                      <img
                        src={review.character.avatar}
                        alt={authorName}
                        onClick={() => review.character && onOpenBio?.(review.character)}
                        className="w-10 h-10 rounded-full object-cover border-2 border-pink-400 dark:border-pink-600 cursor-pointer hover:scale-105 transition-transform"
                        title="Click to view character bio"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 text-white flex items-center justify-center font-bold text-sm shadow-inner">
                        {review.isAnonymous ? "🎭" : authorName.slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => isRevealed && review.character && onOpenBio?.(review.character)}
                          className={`text-sm font-bold text-gray-900 dark:text-white ${
                            isRevealed && review.character ? "hover:underline cursor-pointer hover:text-pink-600 dark:hover:text-pink-400" : ""
                          }`}
                        >
                          {authorName}
                        </span>
                        {review.isAnonymous && (
                          <span className="text-[10px] bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-1.5 py-0.2 rounded font-medium">
                            {showAdminReveal ? `(Anon: ${review.anonymousAlias})` : "Anonymous"}
                          </span>
                        )}
                        {getSentimentBadge(review.sentiment)}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        <div className="flex text-amber-400 text-xs">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span key={i}>{i < review.rating ? "★" : "☆"}</span>
                          ))}
                        </div>
                        <span>•</span>
                        <span>{new Date(review.createdAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        <span>•</span>
                        <span className="bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.2 rounded text-[10px] text-gray-500 dark:text-gray-400">
                          {review.triggerReason.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditingReview(review)}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                      title="Edit review"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteReview(review.id)}
                      className="p-1 rounded-md text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                      title="Delete review"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {badgesArr.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {badgesArr.map((badge, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300 border border-pink-200/80 dark:border-pink-800/50"
                      >
                        🏷️ {badge}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mt-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed font-sans whitespace-pre-wrap">
                  {review.content}
                </p>

                <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700/50 mt-4 pt-3 text-xs text-gray-500 dark:text-gray-400">
                  <button
                    onClick={() => handleUpvote(review.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 hover:bg-pink-50 hover:text-pink-600 dark:bg-gray-700/60 dark:hover:bg-pink-950/50 dark:hover:text-pink-300 transition text-xs font-semibold"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Helpful tea</span>
                    <span className="ml-0.5 font-bold text-gray-700 dark:text-gray-200">{review.upvotes}</span>
                  </button>

                  <span className="text-[11px] text-gray-400 italic">
                    {review.isAnonymous ? "Posted anonymously to local board" : `Posted publicly by ${authorName}`}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. MODALS */}
      <GenerateModal
        show={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        characters={availableCharacters}
        characterId={genCharacterId}
        setCharacterId={setGenCharacterId}
        triggerReason={genTriggerReason}
        setTriggerReason={setGenTriggerReason}
        activeProfileName={activeProfile?.name || "User"}
        isGenerating={isGenerating}
        onGenerate={handleGenerateReview}
      />

      <CustomModal
        show={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        characters={availableCharacters}
        charId={customCharId}
        setCharId={setCustomCharId}
        content={customContent}
        setContent={setCustomContent}
        sentiment={customSentiment}
        setSentiment={setCustomSentiment}
        rating={customRating}
        setRating={setCustomRating}
        isAnon={customIsAnon}
        setIsAnon={setCustomIsAnon}
        alias={customAlias}
        setAlias={setCustomAlias}
        isCreating={isCreatingCustom}
        onCreate={handleCreateCustom}
      />

      <BadgeManagerModal
        show={showBadgeManagerModal}
        onClose={() => setShowBadgeManagerModal(false)}
        milestonesStr={milestonesStr}
        setMilestonesStr={setMilestonesStr}
        newBadgeName={newBadgeName}
        setNewBadgeName={setNewBadgeName}
        newBadgeCategory={newBadgeCategory}
        setNewBadgeCategory={setNewBadgeCategory}
        newBadgeEmoji={newBadgeEmoji}
        setNewBadgeEmoji={setNewBadgeEmoji}
        badgesCatalog={badgesCatalog}
        onAddBadge={handleAddBadge}
        onRemoveBadge={handleRemoveBadge}
        onSave={handleSaveBadgesAndMilestones}
      />

      <SettingsModal
        show={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        settings={gossipSettings}
        setSettings={setGossipSettings}
        isSaving={isSavingSettings}
        onSave={handleSaveSettings}
      />

      <EditReviewModal
        review={editingReview}
        onClose={() => setEditingReview(null)}
        setReview={setEditingReview}
        onSave={handleSaveEditedReview}
      />
    </div>
  );
}

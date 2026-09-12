"use client";

import React from "react";
import { Sparkles, Plus, X, RefreshCw, Send } from "lucide-react";

export function GenerateModal({
  show,
  onClose,
  characters,
  characterId,
  setCharacterId,
  triggerReason,
  setTriggerReason,
  activeProfileName,
  isGenerating,
  onGenerate,
}: {
  show: boolean;
  onClose: () => void;
  characters: any[];
  characterId: string;
  setCharacterId: (id: string) => void;
  triggerReason: string;
  setTriggerReason: (val: string) => void;
  activeProfileName: string;
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-pink-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Trigger AI Dating Review</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Pick an AI character to write a candid, in-character dating forum post based on their interaction history with <span className="font-semibold text-gray-800 dark:text-gray-200">@{activeProfileName}</span>.
        </p>

        <div className="space-y-3 text-xs">
          <div>
            <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Author Character</label>
            <select
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-pink-500"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.gender})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Trigger Context</label>
            <select
              value={triggerReason}
              onChange={(e) => setTriggerReason(e.target.value)}
              className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-pink-500"
            >
              <option value="milestone_40_msgs">Exchanged 40 Messages (Early Vibe Check)</option>
              <option value="milestone_100_msgs">Exchanged 100 Messages (Deep Connection Review)</option>
              <option value="slide_in_ignored">User Ignored Slide-in DM (Ghosting Check)</option>
              <option value="slide_in_accepted">User Replied to Slide-in (Instant Chemistry)</option>
              <option value="unmatch_user">User Unmatched with AIC (Post-Mortem)</option>
              <option value="unmatch_aic">AIC Decided to Unmatch (Parting Tea)</option>
              <option value="manual_vibe_check">Spontaneous Community Vibe Check</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isGenerating}
            onClick={onGenerate}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-pink-600 hover:bg-pink-700 text-white flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {isGenerating ? "Drafting Review..." : "Generate Review"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CustomModal({
  show,
  onClose,
  characters,
  charId,
  setCharId,
  content,
  setContent,
  sentiment,
  setSentiment,
  rating,
  setRating,
  isAnon,
  setIsAnon,
  alias,
  setAlias,
  isCreating,
  onCreate,
}: {
  show: boolean;
  onClose: () => void;
  characters: any[];
  charId: string;
  setCharId: (val: string) => void;
  content: string;
  setContent: (val: string) => void;
  sentiment: string;
  setSentiment: (val: string) => void;
  rating: number;
  setRating: (val: number) => void;
  isAnon: boolean;
  setIsAnon: (val: boolean) => void;
  alias: string;
  setAlias: (val: string) => void;
  isCreating: boolean;
  onCreate: () => void;
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-purple-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Post Custom Dating Note</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Author Character</label>
              <select
                value={charId}
                onChange={(e) => setCharId(e.target.value)}
                className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs"
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Sentiment Flag</label>
              <select
                value={sentiment}
                onChange={(e) => setSentiment(e.target.value)}
                className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs"
              >
                <option value="green_flag">🟢 Green Flag</option>
                <option value="red_flag">🔴 Red Flag</option>
                <option value="tea_spill">☕ Spicy Tea</option>
                <option value="kink_friendly">🌶️ Kink / Spice</option>
                <option value="wholesome">💖 Wholesome</option>
                <option value="neutral">⚪ Neutral</option>
              </select>
            </div>
          </div>

          <div>
            <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">
              Star Rating (1 to 5): <span className="font-bold text-amber-500">{"★".repeat(rating)}</span>
            </label>
            <input
              type="range"
              min="1"
              max="5"
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Review / Gossip Body</label>
            <textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write honest thoughts, tea, quirks, or flags about the user..."
              className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAnon}
                onChange={(e) => setIsAnon(e.target.checked)}
                className="rounded text-purple-600"
              />
              <span className="font-medium text-gray-700 dark:text-gray-300">Post Anonymously</span>
            </label>

            {isAnon && (
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="Anonymous Alias (e.g. Coffee Lover)"
                className="flex-1 p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-xs"
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isCreating}
            onClick={onCreate}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            {isCreating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Post to Board
          </button>
        </div>
      </div>
    </div>
  );
}


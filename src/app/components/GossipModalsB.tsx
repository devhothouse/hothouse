"use client";

import React from "react";
import { Tag, Sliders, Edit3, X, Plus } from "lucide-react";

export function BadgeManagerModal({
  show,
  onClose,
  milestonesStr,
  setMilestonesStr,
  newBadgeName,
  setNewBadgeName,
  newBadgeCategory,
  setNewBadgeCategory,
  newBadgeEmoji,
  setNewBadgeEmoji,
  badgesCatalog,
  onAddBadge,
  onRemoveBadge,
  onSave,
}: {
  show: boolean;
  onClose: () => void;
  milestonesStr: string;
  setMilestonesStr: (val: string) => void;
  newBadgeName: string;
  setNewBadgeName: (val: string) => void;
  newBadgeCategory: string;
  setNewBadgeCategory: (val: any) => void;
  newBadgeEmoji: string;
  setNewBadgeEmoji: (val: string) => void;
  badgesCatalog: { name: string; category: string; emoji: string }[];
  onAddBadge: () => void;
  onRemoveBadge: (name: string) => void;
  onSave: () => void;
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-xl w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Badges & Trigger Milestones</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1 text-xs">
          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/60">
            <label className="font-bold text-gray-800 dark:text-gray-200 block mb-1">
              Message Count Trigger Milestones (JSON Array)
            </label>
            <p className="text-gray-500 dark:text-gray-400 text-[11px] mb-2">
              When a private chat reaches these message counts, the character automatically reflects and drafts a review.
            </p>
            <input
              type="text"
              value={milestonesStr}
              onChange={(e) => setMilestonesStr(e.target.value)}
              placeholder="[40, 100]"
              className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white font-mono"
            />
          </div>

          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/60 space-y-2">
            <label className="font-bold text-gray-800 dark:text-gray-200 block">Add New Custom Badge / Tag</label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={newBadgeName}
                onChange={(e) => setNewBadgeName(e.target.value)}
                placeholder="Badge Name"
                className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white col-span-1"
              />
              <select
                value={newBadgeCategory}
                onChange={(e: any) => {
                  setNewBadgeCategory(e.target.value);
                  if (e.target.value === "green_flag") setNewBadgeEmoji("🟢");
                  if (e.target.value === "red_flag") setNewBadgeEmoji("🔴");
                  if (e.target.value === "spice") setNewBadgeEmoji("🌶️");
                  if (e.target.value === "tea") setNewBadgeEmoji("☕");
                }}
                className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white col-span-1"
              >
                <option value="green_flag">Green Flag</option>
                <option value="red_flag">Red Flag</option>
                <option value="spice">Spice / Dynamics</option>
                <option value="tea">Tea / Quirks</option>
              </select>
              <div className="flex gap-2 col-span-1">
                <input
                  type="text"
                  value={newBadgeEmoji}
                  onChange={(e) => setNewBadgeEmoji(e.target.value)}
                  className="w-12 p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-center"
                  title="Emoji"
                />
                <button
                  type="button"
                  onClick={onAddBadge}
                  className="flex-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="font-bold text-gray-800 dark:text-gray-200 block mb-1.5">
              Badges Catalog ({badgesCatalog.length})
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-700/60">
              {badgesCatalog.map((b) => (
                <span
                  key={b.name}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 shadow-2xs group"
                >
                  <span>{b.emoji}</span>
                  <span>{b.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveBadge(b.name)}
                    className="text-gray-400 hover:text-rose-500 ml-0.5"
                    title="Remove badge"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
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
            onClick={onSave}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-sm"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}


export function SettingsModal({
  show,
  onClose,
  settings,
  setSettings,
  isSaving,
  onSave,
}: {
  show: boolean;
  onClose: () => void;
  settings: Record<string, string>;
  setSettings: (val: Record<string, string>) => void;
  isSaving: boolean;
  onSave: () => void;
}) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-pink-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Gossip & Review Board Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1 text-xs">
          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/60 space-y-2.5">
            <h4 className="font-bold text-gray-800 dark:text-gray-200">Automatic Review Triggers & Probabilities</h4>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.gossip_trigger_unmatch_user !== "false"}
                  onChange={(e) =>
                    setSettings({ ...settings, gossip_trigger_unmatch_user: String(e.target.checked) })
                  }
                  className="rounded text-pink-600"
                />
                <span>Trigger on User Unmatch</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.gossip_trigger_unmatch_aic !== "false"}
                  onChange={(e) =>
                    setSettings({ ...settings, gossip_trigger_unmatch_aic: String(e.target.checked) })
                  }
                  className="rounded text-pink-600"
                />
                <span>Trigger on AIC Unmatch</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.gossip_trigger_slide_in_ignored !== "false"}
                  onChange={(e) =>
                    setSettings({ ...settings, gossip_trigger_slide_in_ignored: String(e.target.checked) })
                  }
                  className="rounded text-pink-600"
                />
                <span>Trigger on Ignored Slide-in</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-600 dark:text-gray-400">Ignore Delay:</span>
                <input
                  type="number"
                  value={settings.gossip_slide_in_ignore_delay_hours || "24"}
                  onChange={(e) =>
                    setSettings({ ...settings, gossip_slide_in_ignore_delay_hours: e.target.value })
                  }
                  className="w-16 p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-center"
                />
                <span>hours</span>
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700/60 pt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-gray-500 block mb-0.5">Milestone Chance:</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={settings.gossip_milestone_trigger_chance ?? "1.0"}
                  onChange={(e) => setSettings({ ...settings, gossip_milestone_trigger_chance: e.target.value })}
                  className="w-full p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-center"
                />
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">Unmatch Chance:</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={settings.gossip_unmatch_trigger_chance ?? "1.0"}
                  onChange={(e) => setSettings({ ...settings, gossip_unmatch_trigger_chance: e.target.value })}
                  className="w-full p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-center"
                />
              </div>
              <div>
                <span className="text-gray-500 block mb-0.5">Slide-In Delay Chance:</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={settings.gossip_slide_in_ignored_trigger_chance ?? "1.0"}
                  onChange={(e) => setSettings({ ...settings, gossip_slide_in_ignored_trigger_chance: e.target.value })}
                  className="w-full p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-center"
                />
              </div>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/60 space-y-2.5">
            <h4 className="font-bold text-gray-800 dark:text-gray-200">Evaluation & Chat Prompt Injections</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={settings.gossip_inject_in_evaluations !== "false"}
                    onChange={(e) =>
                      setSettings({ ...settings, gossip_inject_in_evaluations: String(e.target.checked) })
                    }
                    className="rounded text-pink-600"
                  />
                  <span>Inject in Swipe Evaluations</span>
                </label>
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>Injection Chance (0.0-1.0):</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={settings.gossip_eval_inject_chance ?? "1.0"}
                    onChange={(e) =>
                      setSettings({ ...settings, gossip_eval_inject_chance: e.target.value })
                    }
                    className="w-14 p-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-center"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>Max Reviews in Eval:</span>
                  <input
                    type="number"
                    value={settings.gossip_eval_max_reviews || "3"}
                    onChange={(e) =>
                      setSettings({ ...settings, gossip_eval_max_reviews: e.target.value })
                    }
                    className="w-14 p-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-center"
                  />
                </div>
              </div>

              <div className="space-y-1.5 p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <label className="flex items-center gap-2 font-semibold">
                  <input
                    type="checkbox"
                    checked={settings.gossip_inject_in_chat !== "false"}
                    onChange={(e) =>
                      setSettings({ ...settings, gossip_inject_in_chat: String(e.target.checked) })
                    }
                    className="rounded text-pink-600"
                  />
                  <span>Inject in Live Chat</span>
                </label>
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>Injection Chance (0.0-1.0):</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={settings.gossip_chat_inject_chance ?? "0.4"}
                    onChange={(e) =>
                      setSettings({ ...settings, gossip_chat_inject_chance: e.target.value })
                    }
                    className="w-14 p-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-center"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-gray-500">
                  <span>Max Reviews in Chat:</span>
                  <input
                    type="number"
                    value={settings.gossip_chat_max_reviews || "2"}
                    onChange={(e) =>
                      setSettings({ ...settings, gossip_chat_max_reviews: e.target.value })
                    }
                    className="w-14 p-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-center"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-900/60 p-3.5 rounded-xl border border-gray-200 dark:border-gray-700/60 space-y-2">
            <h4 className="font-bold text-gray-800 dark:text-gray-200">Gossip Review Prompt Template</h4>
            <textarea
              rows={4}
              value={settings.prompt_gossip_review || ""}
              onChange={(e) => setSettings({ ...settings, prompt_gossip_review: e.target.value })}
              placeholder="Master review prompt ({character_name}, {user_name}, {chat_transcript}, {available_badges}, {trigger_reason})"
              className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 font-mono text-[11px]"
            />
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
            disabled={isSaving}
            onClick={onSave}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-pink-600 hover:bg-pink-700 text-white shadow-sm disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EditReviewModal({
  review,
  onClose,
  setReview,
  onSave,
}: {
  review: any | null;
  onClose: () => void;
  setReview: (r: any) => void;
  onSave: () => void;
}) {
  if (!review) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full p-6 border border-gray-200 dark:border-gray-700 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
          <div className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-indigo-500" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Edit Dating Review</h3>
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
              <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Sentiment Flag</label>
              <select
                value={review.sentiment}
                onChange={(e) => setReview({ ...review, sentiment: e.target.value })}
                className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900"
              >
                <option value="green_flag">🟢 Green Flag</option>
                <option value="red_flag">🔴 Red Flag</option>
                <option value="tea_spill">☕ Spicy Tea</option>
                <option value="kink_friendly">🌶️ Kink / Spice</option>
                <option value="wholesome">💖 Wholesome</option>
                <option value="neutral">⚪ Neutral</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Star Rating (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={review.rating}
                onChange={(e) => setReview({ ...review, rating: Number(e.target.value) })}
                className="w-full p-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-center"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-gray-700 dark:text-gray-300 block mb-1">Review Body</label>
            <textarea
              rows={4}
              value={review.content}
              onChange={(e) => setReview({ ...review, content: e.target.value })}
              className="w-full p-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-xs"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={review.isAnonymous}
                onChange={(e) => setReview({ ...review, isAnonymous: e.target.checked })}
                className="rounded text-indigo-600"
              />
              <span className="font-medium text-gray-700 dark:text-gray-300">Post Anonymously</span>
            </label>

            {review.isAnonymous && (
              <input
                type="text"
                value={review.anonymousAlias || ""}
                onChange={(e) => setReview({ ...review, anonymousAlias: e.target.value })}
                placeholder="Anonymous Alias"
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
            onClick={onSave}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            Update Review
          </button>
        </div>
      </div>
    </div>
  );
}



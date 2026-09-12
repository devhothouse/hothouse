"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { isTagVisibleForGender, parseTagVisibility } from "@/lib/masterTags";
import { 
  Heart, 
  X, 
  MessageCircle, 
  User, 
  Settings, 
  PlayCircle,
  MessageSquare,
  Upload,
  RefreshCw,
  Edit2,
  Trash2,
  Check,
  Volume2,
  VolumeX,
  Paperclip,
  UserPlus,
  FileText,
  Tag,
  Sparkles,
  Users,
  Bot,
  Coffee,
  ChevronUp,
  ChevronDown
} from "lucide-react";
import { AicNetworkTab } from "./components/AicNetworkTab";
import { GossipTab } from "./components/GossipTab";
import { ManagerTab } from "./components/ManagerTab";
import { FirstTimeSetupModal } from "./components/FirstTimeSetupModal";
import { showToast, confirmInApp, NotifyHost } from "@/lib/notify";

// Helper for image drag and drop uploads
async function uploadImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (data.success) return data.url;
  throw new Error(data.error || "Upload failed");
}

// Only treat avatars as renderable when they are real image URLs/paths (local "/...", "http(s)://...",
// or data: URLs). Empty strings and description-style values (e.g. "A nice person") would otherwise
// be requested as page URLs by the browser, spamming 404 / failed-resource errors everywhere.
export function hasRenderableAvatar(url: any): boolean {
  return typeof url === "string" && (url.startsWith("/") || url.startsWith("http") || url.startsWith("data:"));
}

function ImageUploader({ currentUrl, onUpload }: { currentUrl: string, onUpload: (url: string) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      setIsUploading(true);
      try {
        const url = await uploadImage(file);
        onUpload(url);
      } catch (err) {
        showToast("Upload failed");
      }
      setIsUploading(false);
    }
  };

  return (
    <div 
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl overflow-hidden relative flex items-center justify-center bg-gray-50 dark:bg-gray-800 transition-colors h-32 w-32 ${isDragging ? "border-pink-500 bg-pink-50 dark:bg-pink-900/20" : "border-gray-300 dark:border-gray-700"}`}
    >
      {isUploading && <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white z-10 font-bold">Uploading...</div>}
      {currentUrl && currentUrl !== "A nice person" && !currentUrl.includes("Default") ? (
        <img src={currentUrl} className="w-full h-full object-cover" alt="avatar" />
      ) : (
        <div className="text-center p-2">
          <Upload className="w-6 h-6 mx-auto text-gray-400 mb-1" />
          <span className="text-[10px] text-gray-500">Drag & Drop Image</span>
        </div>
      )}
      <input 
        type="file" 
        accept="image/*" 
        className="absolute inset-0 opacity-0 cursor-pointer"
        onChange={async (e) => {
          if (e.target.files && e.target.files[0]) {
            setIsUploading(true);
            try {
              const url = await uploadImage(e.target.files[0]);
              onUpload(url);
            } catch (err) {
              showToast("Upload failed");
            }
            setIsUploading(false);
          }
        }}
      />
    </div>
  );
}

// Robust fetch utility to prevent JSON parsing crashes globally
export const safeFetch = async (url: string, options?: RequestInit) => {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    if (!res.ok) {
      console.error(`API Error ${res.status} from ${url}:`, text);
      // Try to parse error JSON if possible
      try {
        const errJson = JSON.parse(text);
        return { success: false, error: errJson.error || `HTTP ${res.status}` };
      } catch (e) {
        return { success: false, error: text || `HTTP ${res.status}` };
      }
    }
    if (!text) return { success: false, error: "Empty response from server" };
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error(`Invalid JSON from ${url}:`, text);
      return { success: false, error: "Invalid JSON format returned from server" };
    }
  } catch (e: any) {
    console.error(`Fetch network error for ${url}:`, e);
    return { success: false, error: "Network error: " + e.message };
  }
};

// Extractor helper to find the first line / intro sentence of a bio
function getIntroSentence(bio: string): string {
  if (!bio) return "";
  const splitters = ["\n", "About Me:", "My Prompts:", "About me:"];
  let firstPart = bio;
  for (const s of splitters) {
    const idx = firstPart.indexOf(s);
    if (idx !== -1 && idx > 0) {
      firstPart = firstPart.substring(0, idx);
    }
  }
  let clean = firstPart.replace(/\*\*Intro\*\*:/gi, "")
                     .replace(/\*\*Intro:\*\*/gi, "")
                     .replace(/\*\*Intro\*\*/gi, "")
                     .replace(/intro:/gi, "")
                     .replace(/introduction:/gi, "")
                     .replace(/[*#`_]/g, "")
                     .trim();
  return clean;
}

// --------------------------------------------------------
// STRUCTURED BIO PARSER AND COMPILER HELPERS
// --------------------------------------------------------
export interface StructuredBio {
  intro: string;
  aboutMe: Record<string, string>;
  favorites: Record<string, string>;
  prompts: { question: string; answer: string }[];
}

// Parses a markdown dating-app bio string into a structured data object.
// Uses a highly robust parsing algorithm that handles custom-spaced, colon-free, and bullet-free formats.
// Ensures that all asterisks, markdown bold artifacts, and stray indicators are completely stripped from both keys and values.
export function parseBioMarkdown(bio: string): StructuredBio {
  const result: StructuredBio = {
    intro: "",
    aboutMe: {},
    favorites: {},
    prompts: []
  };
  if (!bio) return result;
  
  const lines = bio.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  let currentSection: "intro" | "aboutme" | "favorites" | "prompts" = "intro";
  let lastPromptQuestion = "";
  
  lines.forEach(line => {
    // Strip markdown indicators to cleanly check section headings
    const cleanLine = line.replace(/[*#`_\-:]/g, "").trim();
    const lowerLine = cleanLine.toLowerCase();
    
    if (lowerLine === "intro" || lowerLine === "introduction") {
      currentSection = "intro";
      return;
    }
    if (lowerLine === "about me") {
      currentSection = "aboutme";
      return;
    }
    if (lowerLine === "favorites") {
      currentSection = "favorites";
      return;
    }
    if (lowerLine === "my prompts" || lowerLine === "prompts") {
      currentSection = "prompts";
      return;
    }
    
    if (currentSection === "intro") {
      const cleaned = line.replace(/\*\*Intro\*\*:/gi, "")
                          .replace(/\*\*Intro:\*\*/gi, "")
                          .replace(/\*\*Intro\*\*/gi, "")
                          .replace(/intro:/gi, "")
                          .replace(/introduction:/gi, "")
                          .replace(/[*#`_]/g, "")
                          .trim();
      if (cleaned.length > 0 && cleaned.toLowerCase() !== "intro") {
        result.intro = cleaned;
      }
    } else if (currentSection === "aboutme" || currentSection === "favorites") {
      // Robust field extraction: strip leading bullet points and spacing
      const cleanItem = line.replace(/^[*•\u2022-]\s+/, "").trim();
      if (!cleanItem) return;

      let label = "";
      let val = "";

      // Case 1: Key is bolded, e.g. * **Age:** 35 or * **Family** Yes
      if (cleanItem.startsWith("**")) {
        const closingIndex = cleanItem.indexOf("**", 2);
        if (closingIndex !== -1) {
          label = cleanItem.substring(2, closingIndex).trim();
          val = cleanItem.substring(closingIndex + 2).trim();
        }
      }

      // Case 2: No bold markers, but has a colon, e.g. Age: 35
      if (!label && cleanItem.includes(":")) {
        const colonIdx = cleanItem.indexOf(":");
        label = cleanItem.substring(0, colonIdx).trim();
        val = cleanItem.substring(colonIdx + 1).trim();
      }

      // Case 3: No bold markers and no colons, fallback to first space, e.g. * Age 35
      if (!label) {
        const spaceIdx = cleanItem.indexOf(" ");
        if (spaceIdx !== -1) {
          label = cleanItem.substring(0, spaceIdx).trim();
          val = cleanItem.substring(spaceIdx + 1).trim();
        }
      }

      if (label) {
        // Clean up leading/trailing colons from label
        if (label.endsWith(":")) label = label.slice(0, -1).trim();
        if (label.startsWith(":")) label = label.slice(1).trim();

        // Strip all bold asterisks and stray characters from label and value
        label = label.replace(/\*\*/g, "").replace(/\*/g, "").trim();
        val = val.replace(/\*\*/g, "").replace(/\*/g, "").trim();

        // Clean up leading colons from value
        if (val.startsWith(":")) val = val.slice(1).trim();

        if (label && val) {
          if (currentSection === "aboutme") {
            result.aboutMe[label] = val;
          } else {
            result.favorites[label] = val;
          }
        }
      }
    } else if (currentSection === "prompts") {
      // Handles question titles in prompts
      if ((line.startsWith("**") && line.endsWith("**")) || line.startsWith("**")) {
        lastPromptQuestion = line.replace(/\*\*/g, "").trim();
      } else if (lastPromptQuestion) {
        result.prompts.push({ question: lastPromptQuestion, answer: line.trim() });
        lastPromptQuestion = "";
      }
    }
  });
  
  return result;
}

// Compiles a structured bio object back into standard profile markdown
export function compileBioMarkdown(struct: StructuredBio): string {
  let markdown = "";
  
  if (struct.intro.trim()) {
    markdown += `**Intro**\n${struct.intro.trim()}\n\n`;
  }
  
  const aboutMeKeys = Object.keys(struct.aboutMe).filter(k => struct.aboutMe[k].trim());
  if (aboutMeKeys.length > 0) {
    markdown += `**About Me**\n`;
    aboutMeKeys.forEach(k => {
      markdown += `* **${k}**: ${struct.aboutMe[k].trim()}\n`;
    });
    markdown += `\n`;
  }
  
  const favKeys = Object.keys(struct.favorites).filter(k => struct.favorites[k].trim());
  if (favKeys.length > 0) {
    markdown += `**Favorites**\n`;
    favKeys.forEach(k => {
      markdown += `* **${k}**: ${struct.favorites[k].trim()}\n`;
    });
    markdown += `\n`;
  }
  
  const validPrompts = struct.prompts.filter(p => p.question.trim() && p.answer.trim());
  if (validPrompts.length > 0) {
    markdown += `**My Prompts**\n\n`;
    validPrompts.forEach(p => {
      markdown += `**${p.question.trim()}**\n${p.answer.trim()}\n\n`;
    });
  }
  
  return markdown.trim();
}


// Fullscreen elegant structured bio modal component
function ElegantBioModal({ character, onClose }: { character: any, onClose: () => void }) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  const renderAboutMeSection = (items: { label: string; val: string }[], keySuffix: string) => {
    if (items.length === 0) return null;
    return (
      <div key={`about-me-section-${keySuffix}`} className="my-4 space-y-2">
        <h4 className="font-extrabold text-xs text-pink-500 uppercase tracking-wider mb-2">About Me</h4>
        <div className="space-y-2">
          {items.map((item, i) => {
            let icon = "📍";
            const lowerLabel = item.label.toLowerCase();
            if (lowerLabel.includes("age")) {
              if (lowerLabel.includes("lowest") || lowerLabel.includes("min")) icon = "📉";
              else if (lowerLabel.includes("highest") || lowerLabel.includes("max")) icon = "📈";
              else icon = "🎂";
            }
            else if (lowerLabel.includes("profession") || lowerLabel.includes("work") || lowerLabel.includes("curator") || lowerLabel.includes("job")) icon = "💼";
            else if (lowerLabel.includes("gender")) icon = "⚧";
            else if (lowerLabel.includes("look") || lowerLabel.includes("seek")) icon = "🎯";
            else if (lowerLabel.includes("hobbies") || lowerLabel.includes("hobby") || lowerLabel.includes("vibe")) icon = "✨";
            else if (lowerLabel.includes("height")) icon = "📏";
            else if (lowerLabel.includes("star sign") || lowerLabel.includes("zodiac") || lowerLabel.includes("sign")) icon = "🌌";
            else if (lowerLabel.includes("kink")) icon = "😈";
            else if (lowerLabel.includes("language")) icon = "🗣️";
            else if (lowerLabel.includes("dating intention") || lowerLabel.includes("intention")) icon = "💘";
            else if (lowerLabel.includes("family") || lowerLabel.includes("kids")) icon = "👶";
            else if (lowerLabel.includes("penis")) icon = "🍆";
            else if (lowerLabel.includes("ai") || lowerLabel.includes("robot")) icon = "🤖";
            else if (lowerLabel.includes("cannabis") || lowerLabel.includes("weed")) icon = "🌿";
            else if (lowerLabel.includes("tobacco") || lowerLabel.includes("smoking")) icon = "🚬";
            else if (lowerLabel.includes("drinking") || lowerLabel.includes("alcohol")) icon = "🍷";
            else if (lowerLabel.includes("pets") || lowerLabel.includes("cat") || lowerLabel.includes("dog")) icon = "🐾";
            else if (lowerLabel.includes("living") || lowerLabel.includes("situation")) icon = "🏡";
            else if (lowerLabel.includes("roommate")) icon = "👥";
            else if (lowerLabel.includes("messaging") || lowerLabel.includes("texting")) icon = "💬";
            else if (lowerLabel.includes("double text")) icon = "🔄";
            else if (lowerLabel.includes("relationship")) icon = "👩‍❤️‍👨";
            else if (lowerLabel.includes("married")) icon = "💍";
            else if (lowerLabel.includes("hometown") || lowerLabel.includes("home")) icon = "📍";

            return (
              <div 
                key={i} 
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4 bg-violet-50/60 dark:bg-violet-950/20 px-4 py-3 rounded-2xl border border-violet-100/50 dark:border-violet-900/30 shadow-sm"
              >
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 font-medium text-sm shrink-0">
                  <span>{icon}</span>
                  <span>{item.label}</span>
                </div>
                <div className="text-sm font-bold text-gray-800 dark:text-gray-100 text-left sm:text-right break-words min-w-0 flex-1">
                  {item.val}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderFavoritesSection = (items: { label: string; val: string }[], keySuffix: string) => {
    if (items.length === 0) return null;
    return (
      <div key={`favorites-section-${keySuffix}`} className="my-4 space-y-2">
        <h4 className="font-extrabold text-xs text-pink-500 uppercase tracking-wider mb-2">Favorites</h4>
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => {
            let icon = "⭐";
            const lowerLabel = item.label.toLowerCase();
            if (lowerLabel.includes("song") || lowerLabel.includes("music")) icon = "🎵";
            else if (lowerLabel.includes("game")) icon = "🎮";
            else if (lowerLabel.includes("book")) icon = "📖";
            else if (lowerLabel.includes("movie") || lowerLabel.includes("film")) icon = "🎬";
            else if (lowerLabel.includes("tv show") || lowerLabel.includes("show") || lowerLabel.includes("television")) icon = "📺";
            else if (lowerLabel.includes("food") || lowerLabel.includes("eat")) icon = "🍕";
            else if (lowerLabel.includes("animal") || lowerLabel.includes("pet")) icon = "🐾";
            else if (lowerLabel.includes("color")) icon = "🎨";
            else if (lowerLabel.includes("season")) icon = "📅";
            else if (lowerLabel.includes("travel destination") || lowerLabel.includes("travel") || lowerLabel.includes("destination") || lowerLabel.includes("place")) icon = "✈️";
            else if (lowerLabel.includes("store") || lowerLabel.includes("shop")) icon = "🛍️";
            else if (lowerLabel.includes("sport") && !lowerLabel.includes("team")) icon = "⚽";
            else if (lowerLabel.includes("sports team") || lowerLabel.includes("team")) icon = "🏟️";

            return (
              <div 
                key={i} 
                className="flex items-center gap-2 bg-pink-50/50 dark:bg-pink-950/20 px-3 py-2 rounded-xl border border-pink-100/50 dark:border-pink-900/30 shadow-sm"
                title={item.label}
              >
                <span className="text-base shrink-0">{icon}</span>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 break-words">
                  {item.val}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderBioStructured = (bio: string) => {
    if (!bio) return null;
    const parsed = parseBioMarkdown(bio);
    const elements: React.ReactNode[] = [];

    // Render Intro
    if (parsed.intro) {
      elements.push(
        <div key="intro-section" className="p-4 rounded-2xl bg-pink-50/30 dark:bg-pink-950/10 border border-pink-100/30 dark:border-pink-900/20 shadow-sm mb-6">
          <p className="text-[15px] md:text-base font-semibold text-gray-800 dark:text-gray-100 leading-relaxed">
            {parsed.intro}
          </p>
        </div>
      );
    }

    // Render About Me Items
    const aboutMeItems = Object.entries(parsed.aboutMe).map(([label, val]) => ({ label, val }));
    if (aboutMeItems.length > 0) {
      elements.push(renderAboutMeSection(aboutMeItems, "modal-about"));
    }

    // Render Favorites Items
    const favoritesItems = Object.entries(parsed.favorites).map(([label, val]) => ({ label, val }));
    if (favoritesItems.length > 0) {
      elements.push(renderFavoritesSection(favoritesItems, "modal-fav"));
    }

    // Render Prompts
    parsed.prompts.forEach((p, idx) => {
      elements.push(
        <div key={`prompt-${idx}`} className="bg-pink-50/50 dark:bg-pink-950/20 p-4 rounded-2xl border border-pink-100/50 dark:border-pink-900/30 my-3 shadow-sm">
          <span className="text-xs text-pink-500 font-bold block mb-1">{p.question}</span>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 italic">{p.answer}</p>
        </div>
      );
    });

    return elements;
  };

  // Safe normalized aspect ratio to prevent extreme photos from breaking layouts
  const cleanAspectRatio = aspectRatio ? Math.min(Math.max(aspectRatio, 0.45), 1.2) : 0.7;

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 md:p-12 overflow-y-auto"
    >
      {/* Inject dynamic CSS for perfect responsive sizing based on image aspect ratio on desktop */}
      {aspectRatio && (
        <style dangerouslySetInnerHTML={{__html: `
          @media (min-width: 768px) {
            .dynamic-modal-container {
              max-width: calc(70vh * ${cleanAspectRatio} + 450px) !important;
            }
            .dynamic-image-container {
              width: calc(70vh * ${cleanAspectRatio}) !important;
            }
          }
        `}} />
      )}

      <motion.div 
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        className="bg-white dark:bg-gray-900 rounded-3xl overflow-hidden max-w-4xl w-full flex flex-col md:flex-row shadow-2xl relative border border-gray-100 dark:border-gray-800 h-[85vh] md:h-[70vh] dynamic-modal-container"
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-10 h-10 bg-black/40 hover:bg-black/60 rounded-full flex items-center justify-center text-white font-bold text-lg shadow transition-colors"
        >
          ✕
        </button>

        {/* Large Portrait Section - Responsive to picture's natural aspect ratio/dimensions */}
        <div 
          className="w-full h-[40vh] md:h-full bg-black relative shrink-0 overflow-hidden dynamic-image-container"
        >
          {hasRenderableAvatar(character.characterAvatar || character.avatar) ? (
            <img 
              src={character.characterAvatar || character.avatar} 
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setAspectRatio(img.naturalWidth / img.naturalHeight);
                }
              }}
              className="w-full h-full object-cover block mx-auto" 
              alt="" 
            />
          ) : (
            <div className="w-48 h-full bg-pink-100 dark:bg-pink-950/20 flex items-center justify-center text-pink-500 font-bold select-none text-xl shrink-0">Hothouse</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
          <div className="absolute bottom-6 left-6 right-6 text-white max-w-full">
            <h3 className="text-4xl font-extrabold italic tracking-tighter drop-shadow-md truncate">{character.characterName || character.name}</h3>
            {character.gender && (
              <p className="text-sm font-semibold opacity-90 drop-shadow truncate">{character.gender} looking for {character.lookingFor}</p>
            )}
          </div>
        </div>

        {/* Structured Bio details section */}
        <div className="w-full flex-1 h-full flex flex-col p-6 md:p-8 overflow-y-auto bg-white dark:bg-gray-900">
          <div className="flex-1 space-y-4">
            {renderBioStructured(character.characterPublicBio || character.publicBio || character.bio)}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Play a clean programmatic dual-tone soft chime using browser Web Audio API (Feature #3)
function playSoftNotificationSound() {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // First chime tone (high and sweet)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    gain1.gain.setValueAtTime(0, ctx.currentTime);
    gain1.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    
    // Second chime tone (harmonic perfect fifth)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(783.99, ctx.currentTime + 0.08); // G5 (delayed slightly)
    gain2.gain.setValueAtTime(0, ctx.currentTime);
    gain2.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    
    osc1.start();
    osc1.stop(ctx.currentTime + 0.6);
    osc2.start();
    osc2.stop(ctx.currentTime + 0.7);
  } catch (err) {
    console.error("Failed to play notification audio:", err);
  }
}

export default function Hothouse() {
  const [activeTab, setActiveTab] = useState("feed");
  const [profiles, setProfiles] = useState<any[]>([]);
  const [activeProfile, setActiveProfile] = useState<any>(null);
  const [feedQueue, setFeedQueue] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [activeChat, setActiveChat] = useState<any>(null);
  const [matchOverlay, setMatchOverlay] = useState<any>(null);
  const [bioPopupChar, setBioPopupChar] = useState<any>(null);
  const [showCreateProfileModal, setShowCreateProfileModal] = useState(false);
  const [asyncMessagingEnabled, setAsyncMessagingEnabled] = useState(true);
  // FIRST-TIME SETUP (Roadmap B3, button-triggered): "Hide this button after I finish setup"
  // toggle persists as first_time_setup_hide_button; the top bar itself collapses into
  // a small pull-tab (arrow pill) toggled by first_time_setup_bar_collapsed.
  const [showFirstTimeSetupModal, setShowFirstTimeSetupModal] = useState(false);
  const [firstTimeSetupDone, setFirstTimeSetupDone] = useState(false);
  const [topBarCollapsed, setTopBarCollapsed] = useState(false);
  // CENTRAL BACKGROUND TASK MANAGER STATES (Misc #3)
  const [activeTasks, setActiveTasks] = useState<any[]>([]);
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [unprocessedPhotosCount, setUnprocessedPhotosCount] = useState<number>(0);
  const [isProcessingPhotos, setIsProcessingPhotos] = useState(false);
  const [photoProgress, setPhotoProgress] = useState<{ current: number; total: number; status: string } | null>(null);
  // TOP-BAR BACKGROUND PROCESSES RUNNER & QUICK NETWORK ROUND (Feature: header quick actions)
  const [bgIntervalInput, setBgIntervalInput] = useState("15");
  const [bgAutoRunsEnabled, setBgAutoRunsEnabled] = useState(true);
  const [isRunningBackground, setIsRunningBackground] = useState(false);
  const [isRunningNetwork, setIsRunningNetwork] = useState(false);
  const isRunningBackgroundRef = useRef(false); // Guards against overlapping auto-runs (interval/switch/manual)
  const prevProfileIdRef = useRef<string | null>(null); // Distinguishes profile switches from first load
  const committedBgIntervalRef = useRef("15"); // Last persisted interval value (avoids redundant POSTs on blur)
  // Helper functions for global background tasks list (Misc #3) - Hoisted to parent level
  const addTask = (id: string, name: string, status: string, isSafe = true) => {
    setActiveTasks((prev: any[]) => {
      if (prev.some(t => t.id === id)) {
        return prev.map(t => t.id === id ? { ...t, name, status, isSafe } : t);
      }
      return [...prev, { id, name, status, progress: 0, total: 100, isSafe }];
    });
  };

  const updateTaskProgress = (id: string, current: number, total: number, status: string) => {
    setActiveTasks((prev: any[]) => 
      prev.map(t => t.id === id ? { ...t, progress: current, total, status } : t)
    );
  };

  const removeTask = (id: string) => {
    setActiveTasks((prev: any[]) => prev.filter(t => t.id !== id));
  };
  // GLOBAL STATE FOR SYSTEM SETTINGS - Hoisted for global accessibility across tabs
  const [settings, setSettings] = useState<any>({
    llm_provider: "gemini",
    gemini_model: "gemini-3.7-flash",
    temperature: "0.7",
    llm_disable_safety: "true",
    prompt_name_generation: ""
  });
  const [isSaving, setIsSaving] = useState(false);

  // GLOBAL LOADING STATES FOR HOISTED BACKGROUND TASKS - Ensuring 100% stability on tab switching
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isPickingVoice, setIsPickingVoice] = useState(false);
  const [isGeneratingPortraits, setIsGeneratingPortraits] = useState(false);
  const [isWritingPrompts, setIsWritingPrompts] = useState(false);
  const [isTriggeringAsync, setIsTriggeringAsync] = useState(false);
  const [isGeneratingBio, setIsGeneratingBio] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const loadSettings = async () => {
    const data = await safeFetch("/api/settings");
    if (data.success && data.settings && Object.keys(data.settings).length > 0) {
      setSettings((prev: any) => ({ ...prev, ...data.settings }));
      setFirstTimeSetupDone(data.settings.first_time_setup_hide_button === "true");
      setTopBarCollapsed(data.settings.first_time_setup_bar_collapsed === "true");
    }
  };

  // Saves settings to local database. Avoids circular JSON serialization errors if triggered directly by a React click event (MouseEvent).
  const saveSettings = async (customSettings?: any) => {
    setIsSaving(true);
    // Check if customSettings is a DOM MouseEvent or React SyntheticEvent to avoid serializing React fiber/DOM nodes
    const isEvent = customSettings && (typeof customSettings.preventDefault === "function" || customSettings.target || customSettings.nativeEvent);
    const settingsPayload = (customSettings && !isEvent) ? customSettings : settings;

    const data = await safeFetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsPayload)
    });
    setIsSaving(false);
    if (data.success) {
      showToast("Settings safely stored in local database!");
      loadSettings();
    } else {
      showToast("Failed to save settings: " + data.error);
    }
  };
  // GLOBAL BACKGROUND ASYNC TASK DEFINITIONS - 100% resilient to unmounting tab components
  const handleEvaluate = async (onlyUnseen = false) => {
    setIsEvaluating(true);
    addTask("evaluate_swipes", "Decision Compatibility Engine", "Evaluating swipe profiles compatibility...", true);
    const data = await safeFetch("/api/evaluate", { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyUnseen })
    });
    setIsEvaluating(false);
    removeTask("evaluate_swipes");
    if (data.success) {
      showToast(`Compatibility engine run complete! Recalculated preferences and updated interactions.`);
    } else {
      showToast("Evaluation failed: " + data.error);
    }
  };

  const handleVoicePicker = async (onlyEmpty = false) => {
    setIsPickingVoice(true);
    addTask("voice_picker", "Intelligent Voice Matcher", "Selecting voices on ElevenLabs...", true);
    const data = await safeFetch("/api/voice-picker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onlyEmpty, allCharacters: !onlyEmpty })
    });
    setIsPickingVoice(false);
    removeTask("voice_picker");
    if (data.success) {
      showToast(`Voice selection complete! Processed ${data.processedCount} characters.`);
    } else {
      showToast("Voice selection failed: " + data.error);
    }
  };

  // AI Portrait Generation (A1): fills missing portraits with AI-generated images
  // (requires an Image Generation provider to be configured in the Manager tab).
  const handleGeneratePortraits = async () => {
    setIsGeneratingPortraits(true);
    addTask("generate_portraits_ai", "AI Portrait Generation", "Generating portraits for characters without an image...", true);
    const res: any = await safeFetch("/api/portraits/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allEmpty: true })
    });
    setIsGeneratingPortraits(false);
    removeTask("generate_portraits_ai");
    if (res.success) {
      const failures = (res.generated || []).filter((g: any) => g.error).length;
      if (failures > 0) {
        showToast(`AI portrait generation finished with ${res.generatedCount} succeeded and ${failures} failed. See the server console for details.`);
      } else {
        showToast(`AI portrait generation complete! Generated ${res.generatedCount} portrait(s).`);
      }
    } else {
      showToast("AI portrait generation failed: " + res.error);
    }
  };

  // Image Prompt Writer: writes each character's visual appearance description
  // used by AI image generation (uses the image_prompt_writer LLM task).
  const handleImagePromptWriter = async () => {
    setIsWritingPrompts(true);
    addTask("image_prompt_writer", "AIC Image Prompt Writer", "Writing visual descriptions for characters...", true);
    const res: any = await safeFetch("/api/image-gen/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allEmpty: true })
    });
    setIsWritingPrompts(false);
    removeTask("image_prompt_writer");
    if (res.success) {
      const failures = (res.results || []).filter((r: any) => r.error).length;
      if (failures > 0) {
        showToast(`Image prompt writing finished with ${res.writtenCount} succeeded and ${failures} failed. See the server console for details.`);
      } else {
        showToast(`Image prompts written for ${res.writtenCount} character(s)!`);
      }
    } else {
      showToast("Image prompt writing failed: " + res.error);
    }
  };

  const handleTriggerAsync = async () => {
    setIsTriggeringAsync(true);
    addTask("async_trigger", "Background DM Trigger", "Triggering background messages...", true);
    const res = await safeFetch("/api/chat/async-trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    setIsTriggeringAsync(false);
    removeTask("async_trigger");
    if (res.success) {
      showToast(`Asynchronous message triggered! ${res.characterName} messaged you: "${res.message}"`);
    } else {
      showToast("Failed to trigger message: " + res.error);
    }
  };

  const handleBulkGenerateBio = async (onComplete?: () => void) => {
    if (await confirmInApp("Let LLM generate structured bio questionnaires for all characters with empty bios? This will use your active LLM.")) {
      setIsGeneratingBio(true);
      addTask("generate_bios", "Bulk Bio Generator", "Generating markdown bios and QA prompts...", true);
      try {
        const res = await safeFetch("/api/generate-bio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allEmpty: true }) });
        if (res.success) {
          showToast(`Successfully generated bio questionnaires for ${res.generatedCount} characters.`);
          if (onComplete) onComplete();
        } else {
          showToast("Bio generation failed: " + res.error);
        }
      } catch (e: any) {
        showToast("Bio generation failed: " + e.message);
      } finally {
        setIsGeneratingBio(false);
        removeTask("generate_bios");
      }
    }
  };

  const handleBulkGenerateTags = async (onComplete?: () => void) => {
    if (await confirmInApp("Trigger self-tagging evaluation for all characters who do not have tags yet? This evaluates characters against 100 traits.")) {
      setIsGeneratingTags(true);
      addTask("generate_tags", "Bulk Trait Tagging", "Analyzing character traits and tag scores...", true);
      try {
        const res = await safeFetch("/api/generate-tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allEmpty: true }) });
        if (res.success) {
          showToast(`Successfully generated tags for ${res.generatedCount} characters.`);
          if (onComplete) onComplete();
        } else {
          showToast("Tag generation failed: " + res.error);
        }
      } catch (e: any) {
        showToast("Tag generation failed: " + e.message);
      } finally {
        setIsGeneratingTags(false);
        removeTask("generate_tags");
      }
    }
  };
  const handleGenerate = async (gender: string, lookingFor: string, randomizeTags = false, onComplete?: () => void) => {
    setIsGenerating(true);
    addTask("generate_aic", "AIC Generator", "Creating personalized character persona...", true);
    try {
      const data = await safeFetch("/api/generate-aic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gender, lookingFor, randomizeTags })
      });
      if (data.success) {
        showToast(`Successfully generated AIC "${data.character.name}"! You can now swipe on them in your Feed!`);
        if (onComplete) onComplete();
      } else {
        showToast("Generation failed: " + data.error);
      }
    } catch (e: any) {
      showToast("Generation failed: " + e.message);
    } finally {
      setIsGenerating(false);
      removeTask("generate_aic");
    }
  };

  const handleGenerateManual = async (gender: string, lookingFor: string, scores: any, devTags: any, onComplete?: () => void) => {
    setIsGenerating(true);
    addTask("generate_aic_manual", "Manual AIC Generator", "Generating custom AI Character from manual tags...", true);
    try {
      const data = await safeFetch("/api/generate-aic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          gender, 
          lookingFor, 
          manualTags: scores, 
          manualDevelopedTags: devTags 
        })
      });
      if (data.success) {
        showToast(`Successfully generated custom AIC "${data.character.name}" from manually selected tags! You can now swipe on them in your Feed!`);
        if (onComplete) onComplete();
      } else {
        showToast("Custom generation failed: " + data.error);
      }
    } catch (e: any) {
      showToast("Custom generation failed: " + e.message);
    } finally {
      setIsGenerating(false);
      removeTask("generate_aic_manual");
    }
  };

  const handleResolveNames = async (onComplete?: () => void) => {
    addTask("resolve_names", "AI Name Resolver", "Resolving duplicate, empty, or placeholder names...", true);
    try {
      const res = await safeFetch("/api/generate-aic/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      if (res.success) {
        if (res.renamed && res.renamed.length > 0) {
          showToast(`Name resolution complete! Renamed ${res.renamed.length} duplicate/placeholder character display names.`);
        } else {
          showToast("All active character names are already 100% unique! No renames needed.");
        }
        if (onComplete) onComplete();
      } else {
        showToast("Name resolution failed: " + res.error);
      }
    } catch (e: any) {
      showToast("Name resolution failed: " + e.message);
    } finally {
      removeTask("resolve_names");
    }
  };

  // Load global settings on startup
  useEffect(() => {
    loadSettings();
  }, []);

  // Fetch remaining unprocessed photos count
  const fetchUnprocessedCount = async () => {
    const res = await safeFetch("/api/portraits");
    if (res.success && res.portraits) {
      const count = res.portraits.filter((p: any) => !p.processed).length;
      setUnprocessedPhotosCount(count);
    }
  };

  
  // Floating push notification state (Feature #3)
  // type "match" is used by the Match Delay feature ("You have a new match");
  // undefined/"message" is the classic asynchronous-message notification.
  const [notification, setNotification] = useState<{
    type?: "message" | "match";
    characterName: string;
    characterId: string;
    characterAvatar: string;
    message: string;
  } | null>(null);

  // Auto-dismiss the notification after 3.5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => {
        setNotification(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Click-to-reply notification action: redirects straight to the chat window! (Feature #3)
  const handleNotificationClick = async () => {
    if (!notification) return;
    // Match notifications redirect to the Matches (DMs) list instead of a chat
    if (notification.type === "match") {
      setActiveTab("dms");
      setNotification(null);
      return;
    }
    const foundMatch = matches.find(m => m.characterId === notification.characterId);
    if (foundMatch) {
      setActiveChat(foundMatch);
      setActiveTab("chat");
      await safeFetch("/api/chat/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: foundMatch.id }),
      });
      fetchMatches();
    } else {
      setActiveTab("dms");
    }
    setNotification(null);
  };
  
  // States to manage pipeline execution when searching for more profiles
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");

  // Automated 4-step pipeline: Generate -> Choose Portrait -> Write Bio -> Evaluate Compatibility
  const handleSearchMore = async () => {
    if (!activeProfile) return;
    setIsGeneratingMore(true);
    addTask("batch_generate_aic", "Batch Character Generator", "Starting personalized AIC pipeline...", true);
    try {
      // Step 1: Generate 10 new personalized characters
      for (let i = 1; i <= 10; i++) {
        const msg = `Generating personalized character ${i} of 10...`;
        setGenerationStatus(msg);
        updateTaskProgress("batch_generate_aic", Math.round((i - 1) * 4), 100, msg);
        let genGender = "Female";
        if (activeProfile.lookingFor === "Male") {
          genGender = "Male";
        } else if (activeProfile.lookingFor === "Everyone") {
          const rand = Math.random();
          genGender = rand < 0.45 ? "Female" : rand < 0.90 ? "Male" : "Non-binary";
        }
        
        // Randomly set who the generated AIC is looking for between the user profile's gender and "Everyone" (50/50 chance)
        const charLookingFor = Math.random() < 0.5 ? activeProfile.gender : "Everyone";

        await safeFetch("/api/generate-aic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            gender: genGender, 
            lookingFor: charLookingFor
          })
        });
      }

      // Step 2: Intelligent portrait library picker selection via LLM
      const step2Msg = "Choosing best-matching portrait pictures from library...";
      setGenerationStatus(step2Msg);
      updateTaskProgress("batch_generate_aic", 40, 100, step2Msg);
      await safeFetch("/api/portraits/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allEmpty: true })
      });

      // Step 3: Write structured bio questionnaires
      const step3Msg = "Writing bio questionnaires for new characters...";
      setGenerationStatus(step3Msg);
      updateTaskProgress("batch_generate_aic", 60, 100, step3Msg);
      await safeFetch("/api/generate-bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allEmpty: true })
      });

      // Step 3.5: Run voice picker on new characters
      const step35Msg = "Selecting unique voices for new characters...";
      setGenerationStatus(step35Msg);
      updateTaskProgress("batch_generate_aic", 80, 100, step35Msg);
      await safeFetch("/api/voice-picker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyEmpty: true })
      });

      // Step 4: Evaluate compatibility & register matches/swipes
      const step4Msg = "Running decision evaluations on your profile...";
      setGenerationStatus(step4Msg);
      updateTaskProgress("batch_generate_aic", 90, 100, step4Msg);
      await safeFetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyUnseen: true })
      });

      setGenerationStatus("Done! Refreshing feed...");
      updateTaskProgress("batch_generate_aic", 100, 100, "Done! Refreshing feed...");
      await fetchFeed();
      await fetchMatches();
      showToast("Successfully generated and fully prepared 10 new personalized characters matching your preferences!");
    } catch (err: any) {
      showToast("Pipeline error: " + err.message);
    } finally {
      setIsGeneratingMore(false);
      setGenerationStatus("");
      removeTask("batch_generate_aic");
    }
  };

  // Initialize
  useEffect(() => {
    initApp();
  }, []);

  const fetchAsyncSetting = async () => {
    const data = await safeFetch("/api/settings");
    if (data.success && data.settings) {
      setAsyncMessagingEnabled(data.settings.async_messaging_enabled !== "false");
      // Background Processes Runner interval (minutes); code fallback of 15 keeps
      // databases without the seeded setting fully backward compatible.
      const parsedMinutes = parseInt(data.settings.background_processes_interval_minutes, 10);
      if (Number.isFinite(parsedMinutes) && parsedMinutes >= 1) {
        setBgIntervalInput(String(parsedMinutes));
        committedBgIntervalRef.current = String(parsedMinutes);
      }
      // Background Processes auto-run master switch (missing key = enabled,
      // keeping pre-feature databases fully backward compatible).
      setBgAutoRunsEnabled(data.settings.background_processes_enabled !== "false");
    }
  };

  const initApp = async () => {
    // Await init to finish completely before attempting to fetch profiles
    // to prevent SQLite locking collisions
    const initRes = await safeFetch("/api/init", { method: "POST" });
    if (initRes) {
      await fetchProfiles();
      await fetchAsyncSetting();
      await fetchUnprocessedCount();
    }
  };

  const fetchProfiles = async () => {
    const data = await safeFetch("/api/profiles");
    if (data.success && data.profiles) {
      setProfiles(data.profiles);
      const active = data.profiles.find((p: any) => p.isActive);
      setActiveProfile(active || data.profiles[0]);
    }
  };

  // Raise the push-style "new match" notification for matches that just
  // materialized in the background (Match Delay feature). Only the latest match
  // is toasted when several land at once; the rest appear in the Matches list.
  const announceNewMatches = (newMatches: any[] | undefined | null) => {
    if (!newMatches || newMatches.length === 0) return;
    const latest = newMatches[newMatches.length - 1];
    setNotification({
      type: "match",
      characterName: latest.characterName,
      characterId: latest.characterId,
      characterAvatar: latest.characterAvatar,
      message: "You have a new match",
    });
    playSoftNotificationSound();
  };

  const fetchFeed = async () => {
    const data = await safeFetch("/api/feed");
    if (data.success && data.queue) {
      setFeedQueue(data.queue);
    }
    // Match Delay: report matches materialized by this fetch
    if (data.success) {
      announceNewMatches(data.newMatches);
    }
  };

  const fetchMatches = async () => {
    const data = await safeFetch("/api/chat");
    if (data.success && data.matches) {
      setMatches(data.matches);
    }
    // Match Delay: report matches materialized by this fetch
    if (data.success) {
      announceNewMatches(data.newMatches);
    }
  };

  // TOP-BAR BACKGROUND PROCESSES RUNNER — sequentially fills AIC gaps:
  // voice picker (no voice) → image picker (no image) → bio writer (no bio) →
  // evaluation (AICs who haven't evaluated the active profile yet).
  // Triggered manually from the top bar, on profile switches, and every N minutes.
  // Reuses the same route payloads as the Manual Triggers buttons; each step is
  // skipped naturally by its route when there is nothing to process.
  const runBackgroundProcesses = async (trigger: "manual" | "profile_switch" | "interval" = "manual") => {
    if (!activeProfile || isRunningBackgroundRef.current) return;
    // Auto-run master switch: profile-switch and interval triggers are skipped
    // entirely when disabled; the manual top-bar button always works.
    if (trigger !== "manual" && !bgAutoRunsEnabled) return;
    isRunningBackgroundRef.current = true;
    setIsRunningBackground(true);
    addTask("background_processes", "Background Processes Runner", "Running background maintenance processes...", true);
    const setStep = (current: number, status: string) => updateTaskProgress("background_processes", current, 4, status);
    const failures: string[] = [];
    try {
      // Step 1: Voice picker — AICs without a voice
      setStep(1, "Selecting voices for characters without one...");
      const voiceRes: any = await safeFetch("/api/voice-picker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyEmpty: true })
      });
      if (voiceRes && voiceRes.success === false) failures.push(`Voice picker: ${voiceRes.error || "failed"}`);

      // Step 2: Image picker — AICs without an image
      setStep(2, "Assigning portraits to characters without an image...");
      const portraitRes: any = await safeFetch("/api/portraits/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allEmpty: true })
      });
      if (portraitRes && portraitRes.success === false) failures.push(`Image picker: ${portraitRes.error || "failed"}`);

      // Step 3: Bio writer — AICs without a bio
      setStep(3, "Writing bios for characters without one...");
      const bioRes: any = await safeFetch("/api/generate-bio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allEmpty: true })
      });
      if (bioRes && bioRes.success === false) failures.push(`Bio writer: ${bioRes.error || "failed"}`);

      // Step 4: Evaluation — AICs who haven't evaluated the active profile yet
      setStep(4, "Evaluating characters who haven't evaluated your profile yet...");
      const evalRes: any = await safeFetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onlyUnseen: true })
      });
      if (evalRes && evalRes.success === false) failures.push(`Evaluation: ${evalRes.error || "failed"}`);

      // Refresh feed & matches so new swipes/slide-ins/matches appear immediately
      await fetchFeed();
      await fetchMatches();

      // Only the manual click surfaces a summary; automated triggers stay silent
      // (failures are already logged to the console by safeFetch).
      if (trigger === "manual") {
        if (failures.length > 0) {
          showToast("Background processes finished with warnings:\n" + failures.join("\n"));
        } else {
          showToast("Background processes complete! Voices, portraits, bios, and evaluations are up to date.");
        }
      }
    } finally {
      removeTask("background_processes");
      isRunningBackgroundRef.current = false;
      setIsRunningBackground(false);
    }
  };

  // Persists the top-bar interval input (committed on blur / Enter)
  const commitBgInterval = () => {
    const parsed = parseInt(bgIntervalInput, 10);
    const minutes = Number.isFinite(parsed) && parsed >= 1 ? parsed : 15;
    if (String(minutes) !== bgIntervalInput) setBgIntervalInput(String(minutes));
    if (String(minutes) !== committedBgIntervalRef.current) {
      committedBgIntervalRef.current = String(minutes);
      safeFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background_processes_interval_minutes: String(minutes) })
      });
    }
  };

  // QUICK RUN AIC SOCIAL NETWORK — triggers one full simulation round
  // (Match Discovery + Conversation Turns) with the same payload as the
  // AIC Network tab's "Run Simulation Round" button.
  const handleQuickRunNetwork = async () => {
    setIsRunningNetwork(true);
    addTask("quick_network_round", "AIC Social Network Round", "Discovering matches & generating conversation turns...", true);
    const res: any = await safeFetch("/api/aic-network/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runSimulationRound: true })
    });
    setIsRunningNetwork(false);
    removeTask("quick_network_round");
    if (res.success) {
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

  // Background Asynchronous Auto-Triggering checks (Topic B #3)
  const runAsyncAutoCheck = async (eventType: "tab_switch" | "swipe" | "interval") => {
    if (!activeProfile) return;
    const res = await safeFetch("/api/chat/async-auto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType })
    });
    if (res.success && res.triggered) {
      // If an asynchronous message was triggered, reload matches to show new unread badges!
      fetchMatches();

      // Show floating notification if user is not actively on their specific chat page (Feature #3)
      const isCurrentlyChatting = activeTab === "chat" && activeChat && activeChat.characterId === res.characterId;
      if (!isCurrentlyChatting) {
        setNotification({
          characterName: res.characterName,
          characterId: res.characterId,
          characterAvatar: res.characterAvatar,
          message: stripBrackets(res.message),
        });
        playSoftNotificationSound();
      }
    }

    // Match Delay: report matches that materialized in the background during this check
    if (res.success && res.newMatches?.length > 0) {
      fetchMatches();
      announceNewMatches(res.newMatches);
    }
  };

  useEffect(() => {
    if (activeProfile && activeTab === "feed") {
      fetchFeed();
    }
    if (activeProfile && (activeTab === "dms" || activeTab === "chat")) {
      fetchMatches();
    }
    // Check for occasional async messages on tab switch
    if (activeProfile && activeTab !== "chat") {
      runAsyncAutoCheck("tab_switch");
    }
  }, [activeProfile, activeTab]);

  // 1-minute background interval for asynchronous messages
  useEffect(() => {
    if (!activeProfile) return;
    const timer = setInterval(() => {
      runAsyncAutoCheck("interval");
    }, 60000); // 1 minute
    return () => clearInterval(timer);
  }, [activeProfile]);

  // Background Processes Runner: auto-run whenever the user switches profiles
  // (first load is deliberately skipped — only actual switches trigger it)
  useEffect(() => {
    if (!activeProfile) return;
    const prevId = prevProfileIdRef.current;
    prevProfileIdRef.current = activeProfile.id;
    if (prevId !== null && prevId !== activeProfile.id) {
      runBackgroundProcesses("profile_switch");
    }
  }, [activeProfile?.id]);

  // Background Processes Runner: recurring auto-run every N minutes
  // (interval configurable in the top bar, persisted as background_processes_interval_minutes;
  // scheduling is skipped entirely while the auto-runs master switch is off)
  useEffect(() => {
    if (!activeProfile || !bgAutoRunsEnabled) return;
    const timer = setInterval(() => {
      runBackgroundProcesses("interval");
    }, Math.max(1, parseInt(bgIntervalInput, 10) || 15) * 60000);
    return () => clearInterval(timer);
  }, [activeProfile, bgIntervalInput, bgAutoRunsEnabled]);

  const handleSwipe = async (characterId: string, action: "pass" | "like") => {
    const swipedChar = feedQueue.find(c => c.id === characterId);
    setFeedQueue((prev) => prev.filter((c) => c.id !== characterId));
    
    const data = await safeFetch("/api/interact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId, userStatus: action }),
    });
    if (data.matched && swipedChar) {
      setMatchOverlay(swipedChar);
    }
    // Check for async message on swipe
    runAsyncAutoCheck("swipe");
  };

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <AnimatePresence>
        {matchOverlay && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.8 }} 
            animate={{ opacity: 1, scale: 1 }} 
            exit={{ opacity: 0, scale: 1.1 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm text-white"
          >
            <motion.h1 
              initial={{ y: -50 }} animate={{ y: 0 }}
              className="text-6xl font-black text-pink-500 mb-8 italic tracking-tighter"
              style={{ textShadow: "0 4px 20px rgba(236, 72, 153, 0.5)" }}
            >
              IT'S A MATCH!
            </motion.h1>
            
            <div className="flex gap-4 items-center">
              {hasRenderableAvatar(activeProfile?.avatar) ? (
                <img src={activeProfile?.avatar} className="w-32 h-32 rounded-full border-4 border-pink-500 object-cover" />
              ) : (
                <div className="w-32 h-32 rounded-full border-4 border-pink-500 bg-pink-100 dark:bg-pink-950/40 flex items-center justify-center text-pink-500 font-bold text-3xl select-none">👤</div>
              )}
              <Heart className="text-pink-500 w-12 h-12" fill="currentColor" />
              {hasRenderableAvatar(matchOverlay.avatar) ? (
                <img src={matchOverlay.avatar} className="w-32 h-32 rounded-full border-4 border-pink-500 object-cover" />
              ) : (
                <div className="w-32 h-32 rounded-full border-4 border-pink-500 bg-pink-100 dark:bg-pink-950/40 flex items-center justify-center text-pink-500 font-bold text-3xl select-none">{(matchOverlay.name || "?")[0]}</div>
              )}
            </div>
            
            <p className="mt-8 text-lg font-medium text-gray-300">You and {matchOverlay.name} liked each other.</p>
            
            <button 
              onClick={() => {
                setMatchOverlay(null);
                setActiveTab("dms");
              }}
              className="mt-8 bg-gradient-to-r from-pink-500 to-rose-500 px-8 py-4 rounded-full font-bold text-lg shadow-xl shadow-pink-500/30 hover:scale-105 transition-transform"
            >
              Send a Message
            </button>
            <button 
              onClick={() => setMatchOverlay(null)}
              className="mt-4 text-gray-400 hover:text-white transition-colors"
            >
              Keep Swiping
            </button>
          </motion.div>
        )}
        {bioPopupChar && (
          <ElegantBioModal 
            character={bioPopupChar} 
            onClose={() => setBioPopupChar(null)} 
          />
        )}
        {/* New Profile creation form (rolled into the Profile tab) */}
        {showCreateProfileModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative border border-gray-200 dark:border-gray-700 shadow-2xl">
              <button
                onClick={() => setShowCreateProfileModal(false)}
                className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 z-10"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <CreateProfileTab
                onProfileCreated={async () => {
                  await fetchProfiles();
                  setShowCreateProfileModal(false);
                }}
              />
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="p-4 bg-white dark:bg-gray-800 shadow-sm flex justify-between items-center select-none font-sans">
        <h1 className="text-xl font-bold text-pink-500">Hothouse</h1>
        {topBarCollapsed ? (
          <button
            type="button"
            onClick={async () => {
              const newValue = !topBarCollapsed;
              setTopBarCollapsed(newValue);
              await safeFetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ first_time_setup_bar_collapsed: String(newValue) })
              });
            }}
            className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all border shadow-sm bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300 dark:border-gray-700 flex items-center gap-1"
            title="Show the header controls (async messaging, background processes, quick runs, profile card)"
          >
            <ChevronDown size={12} /> Show controls
          </button>
        ) : (
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <button
            type="button"
            onClick={async () => {
              const newValue = !asyncMessagingEnabled;
              setAsyncMessagingEnabled(newValue);
              await safeFetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ async_messaging_enabled: String(newValue) })
              });
            }}
            className={`text-[11px] font-bold px-3 py-1.5 rounded-full transition-all border shadow-sm ${
              asyncMessagingEnabled
                ? "bg-pink-50 hover:bg-pink-100 text-pink-700 border-pink-100 dark:bg-pink-950/20 dark:text-pink-300 dark:border-pink-900/30"
                : "bg-gray-50 hover:bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
            }`}
            title="Toggle whether matched characters can message you globally in the background"
          >
            {asyncMessagingEnabled ? "⚡ Characters can message you whenever" : "💤 Characters won't message you out of nowhere"}
          </button>
          <div
            className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-700 rounded-full px-2 py-1 bg-gray-50/60 dark:bg-gray-900/40"
            title="Background processes — these three controls are one connected unit: the auto-runs toggle, the manual run button, and the minutes interval. They control nothing else."
          >
            <button
              type="button"
              onClick={async () => {
                const newValue = !bgAutoRunsEnabled;
                setBgAutoRunsEnabled(newValue);
                await safeFetch("/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ background_processes_enabled: String(newValue) })
                });
              }}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-all border shadow-sm ${
                bgAutoRunsEnabled
                  ? "bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900/40"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700"
              }`}
              title="Master switch for AUTOMATIC background process runs (on profile switches + every N minutes). Turning this off stops all auto-runs; the manual 'Run background processes' button next to it still works."
            >
              {bgAutoRunsEnabled ? "♻️ Auto-runs: On" : "♻️ Auto-runs: Off"}
            </button>
            <button
              type="button"
              onClick={() => runBackgroundProcesses("manual")}
              disabled={isRunningBackground || !activeProfile}
              className={`text-[11px] font-bold px-3 py-1.5 rounded-full transition-all border shadow-sm disabled:opacity-50 ${
                isRunningBackground
                  ? "bg-gray-100 text-gray-400 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600"
                  : "bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700"
              }`}
              title="Manual run, in order: voice picker (AICs without a voice) → image picker (AICs without an image) → bio writer (AICs without a bio) → evaluation (AICs who haven't evaluated you). Automatic runs fire on profile switches and every N minutes when 'Auto-runs' is on."
            >
              {isRunningBackground ? "⏳ Running background processes..." : "🛠️ Run background processes"}
            </button>
            <div className={`flex items-center gap-1 transition-opacity ${bgAutoRunsEnabled ? "" : "opacity-40"}`} title="Auto-run interval for background processes, in minutes (runs on profile switches and every N minutes when 'Auto-runs' is on)">
              <input
                type="number"
                min={1}
                value={bgIntervalInput}
                onChange={(e) => setBgIntervalInput(e.target.value)}
                onBlur={commitBgInterval}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-12 text-[11px] font-bold text-center px-1.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 focus:outline-none focus:ring-1 focus:ring-pink-300"
              />
              <span className="text-[10px] text-gray-400 font-bold select-none">min</span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleQuickRunNetwork}
            disabled={isRunningNetwork}
            className={`text-[11px] font-bold px-3 py-1.5 rounded-full transition-all border shadow-sm disabled:opacity-50 ${
              isRunningNetwork
                ? "bg-indigo-100 text-indigo-400 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-400 dark:border-indigo-800"
                : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-100 dark:bg-indigo-950/20 dark:text-indigo-300 dark:border-indigo-900/30"
            }`}
            title="Runs one AIC Social Network simulation round right now (peer match discovery + conversation turns, using the AIC Network tab settings)"
          >
            {isRunningNetwork ? "⏳ Running network round..." : "👥 Quick Run AIC Social Network"}
          </button>
          {activeProfile && (
            <button
              type="button"
              onClick={() => setBioPopupChar(activeProfile)}
              className="text-sm font-medium bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1 rounded-full flex items-center gap-1 cursor-pointer transition-all border border-transparent hover:border-pink-200 dark:hover:border-pink-900/40 shadow-sm"
              title="View your public profile card"
            >
              👤 {activeProfile.name}
            </button>
          )}
          {!firstTimeSetupDone && (
            <button
              type="button"
              onClick={() => setShowFirstTimeSetupModal(true)}
              className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-all border shadow-sm bg-pink-500 hover:bg-pink-600 text-white border-pink-600 dark:bg-pink-600 dark:hover:bg-pink-500 dark:border-pink-500 flex items-center gap-1"
              title="Set up Hothouse — guided first-time setup"
            >
              <Sparkles size={12} /> Set up Hothouse
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              const newValue = !topBarCollapsed;
              setTopBarCollapsed(newValue);
              await safeFetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ first_time_setup_bar_collapsed: String(newValue) })
              });
            }}
            className="text-[11px] font-bold px-2 py-1.5 rounded-full transition-all border shadow-sm bg-gray-50 hover:bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-400 dark:border-gray-700"
            title="Collapse the header controls into a single pull-tab"
          >
            <ChevronUp size={12} />
          </button>
        </div>
        )}
      </header>

      {/* First-time setup modal — Roadmap B3: 5-page guided startup wizard */}
      {showFirstTimeSetupModal && (
        <FirstTimeSetupModal
          onClose={() => setShowFirstTimeSetupModal(false)}
          onFinished={() => {
            setFirstTimeSetupDone(true);
            setShowFirstTimeSetupModal(false);
          }}
        />
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === "feed" && (
          <FeedTab 
            queue={feedQueue} 
            onSwipe={handleSwipe} 
            onOpenBio={(char) => setBioPopupChar(char)}
            onSearchMore={handleSearchMore}
            isGeneratingMore={isGeneratingMore}
            generationStatus={generationStatus}
          />
        )}
        {activeTab === "dms" && (
          <DMsTab 
            matches={matches} 
            onSelectChat={async (match) => {
              setActiveChat(match);
              setActiveTab("chat");
              // Clear unread count on server
              await safeFetch("/api/chat/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ interactionId: match.interactionId })
              });
              // Immediately clear badge in local state
              setMatches(prev => prev.map(m => m.interactionId === match.interactionId ? { ...m, unreadCount: 0 } : m));
            }} 
          />
        )}
        {activeTab === "chat" && (
          <ChatTab 
            activeChat={activeChat}
            onBack={() => {
              setActiveChat(null);
              setActiveTab("dms");
            }}
            onOpenBio={(char) => setBioPopupChar(char)}
          />
        )}
        {activeTab === "profile" && (
          <ProfileTab 
            profiles={profiles} 
            activeProfile={activeProfile}
            onProfileChanged={fetchProfiles}
            onOpenBio={(char: any) => setBioPopupChar(char)}
            onNavigateToGossip={() => setActiveTab("gossip")}
            onOpenCreateProfile={() => setShowCreateProfileModal(true)}
          />
        )}
        {activeTab === "editor" && (
          <ManagerTab 
            isProcessingPhotos={isProcessingPhotos}
            setIsProcessingPhotos={setIsProcessingPhotos}
            photoProgress={photoProgress}
            setPhotoProgress={setPhotoProgress}
            unprocessedPhotosCount={unprocessedPhotosCount}
            fetchUnprocessedCount={fetchUnprocessedCount}
            activeTasks={activeTasks}
            setActiveTasks={setActiveTasks}
            addTask={addTask}
            removeTask={removeTask}
            updateTaskProgress={updateTaskProgress}
            isEvaluating={isEvaluating}
            isPickingVoice={isPickingVoice}
            isTriggeringAsync={isTriggeringAsync}
            isGeneratingBio={isGeneratingBio}
            isGeneratingTags={isGeneratingTags}
            isGenerating={isGenerating}
            settings={settings}
            setSettings={setSettings}
            isSaving={isSaving}
            loadSettings={loadSettings}
            saveSettings={saveSettings}
            handleEvaluate={handleEvaluate}
            handleVoicePicker={handleVoicePicker}
            handleGeneratePortraits={handleGeneratePortraits}
            isGeneratingPortraits={isGeneratingPortraits}
            handleImagePromptWriter={handleImagePromptWriter}
            isWritingPrompts={isWritingPrompts}
            handleTriggerAsync={handleTriggerAsync}
            handleBulkGenerateBio={handleBulkGenerateBio}
            handleBulkGenerateTags={handleBulkGenerateTags}
            handleResolveNames={handleResolveNames}
            handleGenerate={handleGenerate}
            handleGenerateManual={handleGenerateManual}
          />
        )}
        {activeTab === "aic_manager" && (
          <AicManagerTab
            activeProfile={activeProfile}
            addTask={addTask}
            removeTask={removeTask}
            updateTaskProgress={updateTaskProgress}
            settings={settings}
            setSettings={setSettings}
            isSaving={isSaving}
            saveSettings={saveSettings}
            loadSettings={loadSettings}
            isGenerating={isGenerating}
            handleGenerate={handleGenerate}
            handleGenerateManual={handleGenerateManual}
          />
        )}
        {activeTab === "aic_network" && (
          <AicNetworkTab />
        )}
        {activeTab === "gossip" && (
          <GossipTab activeProfile={activeProfile} onOpenBio={(char) => setBioPopupChar(char)} />
        )}
      </main>

      {/* Floating Global Background Task Status Widget (Misc #3) */}
      {activeTasks.length > 0 && (
        tasksCollapsed ? (
          <button
            onClick={() => setTasksCollapsed(false)}
            className="fixed bottom-4 right-4 z-[90] bg-pink-500 hover:bg-pink-600 text-white rounded-full px-4 py-2.5 shadow-xl flex items-center gap-1.5 transition-all text-xs font-extrabold cursor-pointer animate-pulse border border-pink-400"
            title="Expand background processes"
          >
            ⚙️ <span>{activeTasks.length} process{activeTasks.length > 1 ? "es" : ""} running</span>
          </button>
        ) : (
          <div className="fixed bottom-4 right-4 z-[90] max-w-sm w-full bg-white dark:bg-gray-900 border border-pink-200 dark:border-pink-900/50 rounded-2xl shadow-xl p-4 space-y-3 font-sans animate-fade-in-up">
            <div className="flex items-center justify-between border-b pb-1.5 dark:border-gray-800">
              <h4 className="font-extrabold text-xs text-pink-600 flex items-center gap-1.5 animate-pulse">
                <span>⚙️</span> Active Background Processes ({activeTasks.length})
              </h4>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setTasksCollapsed(true)}
                  className="text-[10px] text-pink-500 hover:text-pink-600 dark:hover:text-pink-400 font-extrabold uppercase px-1.5 py-0.5 rounded bg-pink-50 dark:bg-pink-950/20 hover:bg-pink-100 transition cursor-pointer"
                  title="Collapse panel"
                >
                  Collapse
                </button>
                <span className="text-[9px] font-extrabold text-pink-500 bg-pink-50 dark:bg-pink-950/30 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Running
                </span>
              </div>
            </div>
            <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
              {activeTasks.map((t: any) => {
                const hasProgress = t.progress !== undefined && t.total !== undefined && t.total > 0;
                const percent = hasProgress ? Math.round((t.progress / t.total) * 100) : 0;
                return (
                  <div key={t.id} className="space-y-1.5 bg-gray-50/50 dark:bg-gray-800/20 p-2 rounded-xl border border-gray-150/50 dark:border-gray-800/30">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{t.name}</span>
                      {hasProgress && <span className="text-[10px] font-extrabold text-pink-500">{percent}%</span>}
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold truncate leading-none">{t.status}</p>
                    {hasProgress && (
                      <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className="bg-pink-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    )}
                    {t.isSafe && (
                      <p className="text-[9px] text-green-600 dark:text-green-400 font-extrabold flex items-center gap-1">
                        <span>✔️</span> Safe to browse & message!
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-[9px] text-gray-400 leading-normal border-t pt-2 dark:border-gray-800">
              LLM calls and database operations are fully asynchronous and safe to execute while you chat or browse.
            </div>
          </div>
        )
      )}


      {/* Floating Push Notification Popup (Feature #3) */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            onClick={handleNotificationClick}
            className="absolute bottom-20 left-4 right-4 z-40 flex items-center gap-3 bg-white/95 dark:bg-gray-800/95 backdrop-blur border border-pink-100 dark:border-pink-900/50 p-3 rounded-xl shadow-lg shadow-pink-500/10 cursor-pointer hover:border-pink-300 dark:hover:border-pink-700 transition-colors"
          >
            {notification.characterAvatar ? (
              <img
                src={notification.characterAvatar}
                alt={notification.characterName}
                className="w-10 h-10 rounded-full object-cover border border-pink-200 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center text-white font-bold shrink-0">
                {notification.characterName[0]}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-pink-500 uppercase tracking-wider">
                {notification.type === "match" ? "New Match!" : "New Message!"}
              </p>
              <h5 className="text-sm font-semibold truncate text-gray-900 dark:text-white">{notification.characterName}</h5>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {notification.message}
              </p>
            </div>
            <span className="text-xs text-pink-500 font-bold px-2 py-1 bg-pink-50 dark:bg-pink-950/40 rounded-lg">
              {notification.type === "match" ? "View" : "Reply"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* In-app toast stack + confirmation modals (Roadmap C1) */}
      <NotifyHost />

      {/* Bottom Navigation */}
      <nav className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex justify-around p-3 pb-safe">
        <NavButton icon={<Heart />} label="Feed" active={activeTab === "feed"} onClick={() => setActiveTab("feed")} />
        <NavButton 
          icon={<MessageSquare />} 
          label="Matches" 
          active={activeTab === "dms"} 
          onClick={() => setActiveTab("dms")} 
          hasBadge={matches.some(m => m.unreadCount > 0)}
        />
        <NavButton icon={<MessageCircle />} label="Chat" active={activeTab === "chat"} onClick={() => setActiveTab("chat")} />
        <NavButton icon={<User />} label="Profile" active={activeTab === "profile"} onClick={() => setActiveTab("profile")} />
        <NavButton icon={<Settings />} label="Manager" active={activeTab === "editor"} onClick={() => setActiveTab("editor")} />
        {/* Secondary simulation tools — deliberately de-emphasized (non-bold, dimmer) */}
        <NavButton icon={<Users />} label="AICs" muted active={activeTab === "aic_manager"} onClick={() => setActiveTab("aic_manager")} />
        <NavButton icon={<Bot />} label="Network" muted active={activeTab === "aic_network"} onClick={() => setActiveTab("aic_network")} />
        <NavButton icon={<Coffee />} label="Gossip" muted active={activeTab === "gossip"} onClick={() => setActiveTab("gossip")} />
      </nav>
    </div>
  );
}

function NavButton({ icon, label, active, onClick, hasBadge, muted = false }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, hasBadge?: boolean, muted?: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center p-2 rounded-lg transition-colors relative ${
        active
          ? "text-pink-500"
          : muted
            ? "text-gray-400 hover:text-gray-700 dark:hover:text-gray-400"
            : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-300"
      }`}
    >
      <div className="relative">
        {icon}
        {hasBadge && (
          <span className="absolute -top-1.5 -right-1.5 block h-2.5 w-2.5 rounded-full bg-pink-500 ring-2 ring-white dark:ring-gray-800 animate-pulse" />
        )}
      </div>
      <span className={`text-xs mt-1 ${muted ? "font-normal opacity-80" : "font-bold"}`}>{label}</span>
    </button>
  );
}

function renderFeedCardBio(bio: string) {
  if (!bio) return null;
  const lines = bio.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  
  let currentSection: "intro" | "aboutme" | "favorites" | "prompts" = "intro";
  let introText = "";
  const aboutMeItems: { label: string, val: string }[] = [];
  
  lines.forEach((line) => {
    const cleanLine = line.replace(/\*\*/g, "").trim();
    const lowerLine = cleanLine.toLowerCase();
    
    if (lowerLine === "intro" || lowerLine === "intro:") {
      currentSection = "intro";
      return;
    }
    if (lowerLine === "about me" || lowerLine === "about me:") {
      currentSection = "aboutme";
      return;
    }
    if (lowerLine === "favorites" || lowerLine === "favorites:") {
      currentSection = "favorites";
      return;
    }
    if (lowerLine === "my prompts" || lowerLine === "my prompts:") {
      currentSection = "prompts";
      return;
    }
    
    if (currentSection === "intro") {
      const cleaned = line.replace(/\*\*Intro\*\*:/gi, "")
                          .replace(/\*\*Intro:\*\*/gi, "")
                          .replace(/\*\*Intro\*\*/gi, "")
                          .replace(/intro:/gi, "")
                          .replace(/introduction:/gi, "")
                          .replace(/[*#`_]/g, "")
                          .trim();
      if (cleaned.length > 0 && cleaned.toLowerCase() !== "intro" && cleaned.toLowerCase() !== "intro:") {
        introText = cleaned;
      }
    } else if (currentSection === "aboutme") {
      if (line.startsWith("*") || line.startsWith("-")) {
        let cleanItem = line.substring(1).trim();
        cleanItem = cleanItem.replace(/\*\*/g, "");
        const [label, ...valParts] = cleanItem.split(":");
        const val = valParts.join(":").trim();
        if (label && val) {
          aboutMeItems.push({ label: label.trim(), val });
        }
      }
    }
  });

  // Filter about me items to only keep Age, Profession, Hometown, Location, and Neighborhood
  const targetLabels = ["age", "profession", "hometown", "work", "job", "curator", "profession:", "location", "neighborhood", "area"];
  const filteredItems = aboutMeItems.filter(item => {
    const lbl = item.label.toLowerCase();
    return targetLabels.some(t => lbl.includes(t));
  });

  return (
    <div className="space-y-3">
      {/* Mini About Me Badges */}
      {filteredItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filteredItems.map((item, idx) => {
            let icon = "📍";
            const lowerLabel = item.label.toLowerCase();
            if (lowerLabel.includes("age")) icon = "🎂";
            else if (lowerLabel.includes("profession") || lowerLabel.includes("work") || lowerLabel.includes("curator") || lowerLabel.includes("job")) icon = "💼";
            else if (lowerLabel.includes("location") || lowerLabel.includes("neighborhood") || lowerLabel.includes("area")) icon = "🏙️";
            else if (lowerLabel.includes("hometown")) icon = "📍";

            return (
              <span 
                key={idx} 
                className="inline-flex items-center gap-1 px-2 py-1 bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300 rounded-full text-[11px] font-semibold border border-violet-100/50 dark:border-violet-900/20"
              >
                <span>{icon}</span>
                <span className="opacity-75">{item.label}:</span>
                <span className="font-bold">{item.val}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Full Cleaned Intro Text */}
      {introText && (
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-medium line-clamp-3">
          {introText}
        </p>
      )}
    </div>
  );
}

// --------------------------------------------------------
// TABS
// --------------------------------------------------------

function FeedTab({ 
  queue, 
  onSwipe, 
  onOpenBio, 
  isLoadingProfile,
  onSearchMore,
  isGeneratingMore,
  generationStatus
}: { 
  queue: any[], 
  onSwipe: (id: string, action: "pass" | "like") => void, 
  onOpenBio: (char: any) => void, 
  isLoadingProfile?: boolean,
  onSearchMore?: () => void,
  isGeneratingMore?: boolean,
  generationStatus?: string
}) {
  if (isLoadingProfile) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <p>Loading your profile...</p>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4 p-4 text-center">
        {isGeneratingMore ? (
          <div className="space-y-3">
            <RefreshCw className="w-10 h-10 animate-spin text-pink-500 mx-auto" />
            <p className="font-bold text-gray-800 dark:text-gray-200">Preparing more profiles...</p>
            <p className="text-sm text-gray-500">{generationStatus}</p>
          </div>
        ) : (
          <>
            <p className="font-medium">No more profiles in your area.</p>
            {onSearchMore && (
              <button
                onClick={onSearchMore}
                className="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-pink-500/20 hover:scale-[1.02] transition-all text-sm flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> Search for more profiles (generate 10 new matches)
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const activeCard = queue[0];

  return (
    <div className="h-full flex flex-col items-center justify-center p-4">
      <AnimatePresence>
        <motion.div
          key={activeCard.id}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ x: -300, opacity: 0 }}
          onClick={() => onOpenBio({
            name: activeCard.name,
            avatar: activeCard.avatar,
            publicBio: activeCard.publicBio,
            gender: activeCard.gender,
            lookingFor: activeCard.lookingFor
          })}
          className="relative w-full max-w-sm h-[60vh] bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden flex flex-col cursor-pointer group hover:shadow-2xl transition-all"
        >
          <div className="h-2/3 bg-gray-200 relative overflow-hidden flex items-center justify-center">
            {hasRenderableAvatar(activeCard.avatar) ? (
              <img src={activeCard.avatar} alt={activeCard.name} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" />
            ) : (
              <div className="w-full h-full bg-pink-50 dark:bg-pink-950/20 flex items-center justify-center text-pink-500 font-extrabold italic text-2xl select-none">Hothouse</div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
              <h2 className="text-2xl font-bold text-white drop-shadow-md flex items-center gap-2">
                {activeCard.name}
                <span className="text-[10px] bg-pink-500 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse">View Info</span>
              </h2>
            </div>
          </div>
          <div className="p-4 flex-1 overflow-y-auto bg-white dark:bg-gray-800">
            {renderFeedCardBio(activeCard.publicBio)}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex gap-6 mt-6">
        <button 
          onClick={() => onSwipe(activeCard.id, "pass")}
          className="w-16 h-16 bg-white dark:bg-gray-800 rounded-full shadow-lg flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors border border-gray-200 dark:border-gray-700"
        >
          <X size={32} />
        </button>
        <button 
          onClick={() => onSwipe(activeCard.id, "like")}
          className="w-16 h-16 bg-white dark:bg-gray-800 rounded-full shadow-lg flex items-center justify-center text-green-500 hover:bg-green-50 transition-colors border border-gray-200 dark:border-gray-700"
        >
          <Heart size={32} />
        </button>
      </div>
    </div>
  );
}

function DMCardItem({ m, onSelectChat, isSlideIn = false }: { m: any, onSelectChat: (m: any) => void, isSlideIn?: boolean }) {
  const isYourTurn = isSlideIn 
    ? true 
    : (m.chatHistory.length > 0 && m.chatHistory[m.chatHistory.length - 1].role === "assistant");
  const lastTimestamp = m.chatHistory.length > 0 
    ? m.chatHistory[m.chatHistory.length - 1].timestamp 
    : m.updatedAt;
  const formattedTime = formatMessageTime(lastTimestamp);
  const previewText = m.chatHistory.length > 0 
    ? stripBrackets(m.chatHistory[m.chatHistory.length - 1].content) 
    : (m.dmMessage ? stripBrackets(m.dmMessage) : "Say hi!");

  return (
    <div 
      onClick={() => onSelectChat(m)}
      className={`p-4 md:p-5 rounded-2xl transition duration-150 cursor-pointer flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6 relative border shadow-sm hover:shadow-md ${
        isYourTurn 
          ? "bg-white dark:bg-gray-800 border-pink-100 dark:border-pink-900/40 hover:border-pink-300 dark:hover:border-pink-700" 
          : "bg-gray-100/90 dark:bg-gray-800/60 border-gray-200/80 dark:border-gray-700/60 hover:bg-gray-100 dark:hover:bg-gray-800"
      }`}
    >
      {/* Left: Thumbnail */}
      <div className="relative shrink-0">
        {hasRenderableAvatar(m.characterAvatar) ? (
          <img 
            src={m.characterAvatar} 
            alt={m.characterName} 
            className="w-16 h-16 md:w-20 md:h-20 rounded-full object-cover shadow-xs" 
          />
        ) : (
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-pink-100 dark:bg-pink-950/40 flex items-center justify-center text-pink-500 font-bold text-lg shadow-xs select-none">
            {(m.characterName || "?")[0]}
          </div>
        )}
        {m.unreadCount > 0 && (
          <span 
            className="absolute top-0 right-0 w-3.5 h-3.5 bg-pink-500 rounded-full border-2 border-white dark:border-gray-800 shadow-sm" 
            title={`${m.unreadCount} new`}
          />
        )}
      </div>

      {/* Middle: Character Name, Counts, Time, Your Turn */}
      <div className="w-full md:w-64 shrink-0 flex flex-col justify-center gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-lg md:text-xl font-extrabold tracking-tight text-gray-900 dark:text-white truncate">
            {m.characterName}
          </h3>
          {isYourTurn && (
            <span className="text-[10px] bg-pink-100 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider select-none shrink-0">
              your turn
            </span>
          )}
        </div>

        {formattedTime && (
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium tracking-wide">
            {formattedTime}
          </div>
        )}

        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400 font-medium flex-wrap">
          <span>
            💬 {m.chatHistory.length} {m.chatHistory.length === 1 ? "message" : "messages"}
          </span>
          {m.unreadCount > 0 && (
            <span className="bg-pink-500 text-white text-[10px] font-bold px-2 py-0.2 rounded-full">
              {m.unreadCount} new
            </span>
          )}
        </div>
      </div>

      {/* Right: Message Preview */}
      <div className="flex-1 min-w-0 w-full md:border-l md:border-gray-200/60 md:dark:border-gray-700/60 md:pl-6 flex items-center">
        <p className="text-[15px] md:text-base text-gray-900 dark:text-gray-100 font-normal line-clamp-2 md:line-clamp-3 leading-relaxed">
          {previewText || "Say hi!"}
        </p>
      </div>
    </div>
  );
}

function DMsTab({ matches, onSelectChat }: { matches: any[], onSelectChat: (m: any) => void }) {
  // Sort, filter out unmatched, deleted, inactive, or active chats nicely (Feature #2)
  const slideIns = matches.filter(m => m.aicStatus === "slide-in" && !m.matched && !m.unmatched && !m.deleted && !m.characterDisabled);
  const activeMatches = matches.filter(m => m.matched && !m.unmatched && !m.deleted && !m.characterDisabled);
  const unmatchedMatches = matches.filter(m => m.unmatched && !m.deleted && !m.characterDisabled);
  const inactiveMatches = matches.filter(m => m.characterDisabled && !m.deleted && !m.unmatched);
  const deletedMatches = matches.filter(m => m.deleted);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 space-y-6">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Direct Messages */}
        {slideIns.length > 0 && (
          <section>
            <h2 className="font-bold text-lg mb-3 text-pink-500">Direct Messages</h2>
            <div className="space-y-3">
              {slideIns.map(m => (
                <DMCardItem key={m.characterId} m={m} onSelectChat={onSelectChat} isSlideIn={true} />
              ))}
            </div>
          </section>
        )}

        {/* Matches */}
        <section>
          <h2 className="font-bold text-lg mb-3 text-pink-500">Matches</h2>
          {activeMatches.length === 0 ? (
            <p className="text-gray-500 text-sm">No active matches yet. Keep swiping!</p>
          ) : (
            <div className="space-y-3">
              {activeMatches.map(m => (
                <DMCardItem key={m.characterId} m={m} onSelectChat={onSelectChat} />
              ))}
            </div>
          )}
        </section>

      {/* Collapsible Unmatched Connections */}
      {unmatchedMatches.length > 0 && (
        <details className="group border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50/50 dark:bg-gray-800/30">
          <summary className="font-bold text-sm text-gray-500 dark:text-gray-400 cursor-pointer list-none flex justify-between items-center select-none py-1">
            <span>💔 Unmatched Connections ({unmatchedMatches.length})</span>
            <span className="transition-transform group-open:rotate-180 text-xs">▼</span>
          </summary>
          <div className="space-y-3 mt-3">
            {unmatchedMatches.map(m => (
              <div 
                key={m.characterId} 
                onClick={() => onSelectChat(m)}
                className="bg-white/70 dark:bg-gray-800/70 p-3 rounded-lg flex gap-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition opacity-70"
              >
                {hasRenderableAvatar(m.characterAvatar) ? (
                  <img src={m.characterAvatar} alt={m.characterName} className="w-10 h-10 rounded-full object-cover filter grayscale shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 font-bold text-xs filter grayscale shrink-0 select-none">{(m.characterName || "?")[0]}</div>
                )}
                <div className="flex-1 overflow-hidden">
                  <h3 className="font-bold text-sm text-gray-600 dark:text-gray-300">{m.characterName} (Unmatched)</h3>
                  <p className="text-xs text-gray-400 truncate">
                    {m.chatHistory.length > 0 
                      ? stripBrackets(m.chatHistory[m.chatHistory.length - 1].content) 
                      : "No messages."}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Collapsible Matches with Inactive Characters (Feature #2) */}
      {inactiveMatches.length > 0 && (
        <details className="group border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50/50 dark:bg-gray-800/30">
          <summary className="font-bold text-sm text-gray-500 dark:text-gray-400 cursor-pointer list-none flex justify-between items-center select-none py-1">
            <span>💤 Matches with Inactive Characters ({inactiveMatches.length})</span>
            <span className="transition-transform group-open:rotate-180 text-xs">▼</span>
          </summary>
          <div className="space-y-3 mt-3">
            {inactiveMatches.map(m => (
              <div 
                key={m.characterId} 
                onClick={() => onSelectChat(m)}
                className="bg-white/70 dark:bg-gray-800/70 p-3 rounded-lg flex gap-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition opacity-70 border border-transparent hover:border-gray-200 dark:hover:border-gray-700"
              >
                {hasRenderableAvatar(m.characterAvatar) ? (
                  <img src={m.characterAvatar} alt={m.characterName} className="w-10 h-10 rounded-full object-cover filter grayscale opacity-80 shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 font-bold text-xs filter grayscale opacity-80 shrink-0 select-none">{(m.characterName || "?")[0]}</div>
                )}
                <div className="flex-1 overflow-hidden">
                  <h3 className="font-bold text-sm text-gray-600 dark:text-gray-300">
                    {m.characterName} {m.characterOutdated ? "(Outdated)" : "(Inactive)"}
                  </h3>
                  <p className="text-xs text-gray-400 truncate">
                    {m.chatHistory.length > 0 
                      ? stripBrackets(m.chatHistory[m.chatHistory.length - 1].content) 
                      : "No messages."}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Collapsible Chats with Deleted Characters */}
      {deletedMatches.length > 0 && (
        <details className="group border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-gray-50/50 dark:bg-gray-800/30">
          <summary className="font-bold text-sm text-gray-500 dark:text-gray-400 cursor-pointer list-none flex justify-between items-center select-none py-1">
            <span>🗑️ Chats with Deleted Characters ({deletedMatches.length})</span>
            <span className="transition-transform group-open:rotate-180 text-xs">▼</span>
          </summary>
          <div className="space-y-3 mt-3">
            {deletedMatches.map(m => (
              <div 
                key={m.characterId} 
                onClick={() => onSelectChat(m)}
                className="bg-white/70 dark:bg-gray-800/70 p-3 rounded-lg flex gap-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition opacity-60"
              >
                {hasRenderableAvatar(m.characterAvatar) ? (
                  <img src={m.characterAvatar} alt={m.characterName} className="w-10 h-10 rounded-full object-cover filter grayscale blur-[0.5px] shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 font-bold text-xs filter grayscale blur-[0.5px] shrink-0 select-none">{(m.characterName || "?")[0]}</div>
                )}
                <div className="flex-1 overflow-hidden">
                  <h3 className="font-bold text-sm text-gray-600 dark:text-gray-300">{m.characterName} (Deleted)</h3>
                  <p className="text-xs text-gray-400 truncate">
                    {m.chatHistory.length > 0 
                      ? stripBrackets(m.chatHistory[m.chatHistory.length - 1].content) 
                      : "No messages."}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
      </div>
    </div>
  );
}

// Format ISO timestamp to local readable date and time (e.g. "Aug 28, 2026 · 10:32 AM")
function formatMessageTime(isoString: string) {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${dateStr} · ${timeStr}`;
  } catch (e) {
    return "";
  }
}

// Helper to parse text in brackets [like this] to hide it from rendering (keeping only conversational dialogue on-screen)
function parseBrackets(text: string) {
  if (!text) return "";
  const bracketRegex = /(\[[^\]]+\])/g;
  const parts = text.split(bracketRegex);
  return parts.map((part, i) => {
    if (part.startsWith("[") && part.endsWith("]")) {
      // Return null so that bracketed roleplay action descriptions are completely hidden from display
      return null;
    }
    return part;
  });
}

// Helper to strip all bracketed text [like this] from message preview snippets
function stripBrackets(text: string): string {
  if (!text) return "";
  return text.replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim();
}

// Render message content with parsed media blocks
function renderMessageContent(content: string, onImageClick?: (src: string) => void) {
  if (!content) return "";
  const mediaRegex = /(!?\[([^\]]*)\]\(([^)]+)\))/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = mediaRegex.exec(content)) !== null) {
    const [fullMatch, isImgMark, label, urlPath] = match;
    const index = match.index;

    if (index > lastIndex) {
      parts.push(<span key={lastIndex} className="whitespace-pre-wrap">{parseBrackets(content.substring(lastIndex, index))}</span>);
    }

    const lowerPath = urlPath.toLowerCase();
    const isImage = isImgMark.startsWith("!") || lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg") || lowerPath.endsWith(".png") || lowerPath.endsWith(".webp") || lowerPath.endsWith(".gif");
    const isAudio = lowerPath.endsWith(".mp3") || lowerPath.endsWith(".wav") || lowerPath.endsWith(".mpeg");
    const isVideo = lowerPath.endsWith(".mp4") || lowerPath.endsWith(".webm");

    if (isImage) {
      parts.push(
        <img key={urlPath} src={urlPath} alt={label || "image"} onClick={() => onImageClick?.(urlPath)} className={`max-w-full max-h-60 rounded-xl my-2 object-contain block border border-gray-100 dark:border-gray-800 ${onImageClick ? "cursor-zoom-in hover:opacity-90 transition-opacity" : ""}`} />
      );
    } else if (isAudio) {
      parts.push(
        <audio key={urlPath} src={urlPath} controls className="my-2 max-w-full block" />
      );
    } else if (isVideo) {
      parts.push(
        <video key={urlPath} src={urlPath} controls className="max-w-full max-h-60 rounded-xl my-2 block border border-gray-100 dark:border-gray-800" />
      );
    } else {
      parts.push(
        <a key={urlPath} href={urlPath} target="_blank" rel="noopener noreferrer" className="underline text-pink-400 hover:text-pink-300 block my-1">
          {label || "Attached File"}
        </a>
      );
    }

    lastIndex = mediaRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(<span key={lastIndex} className="whitespace-pre-wrap">{parseBrackets(content.substring(lastIndex))}</span>);
  }

  return parts.length > 0 ? parts : <span className="whitespace-pre-wrap">{parseBrackets(content)}</span>;
}

function ChatTab({ activeChat, onBack, onOpenBio }: { activeChat: any, onBack: () => void, onOpenBio?: (char: any) => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  // ElevenLabs Voice states using a Ref to prevent re-render loop triggers in useEffect
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingVoiceId, setLoadingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Inline Message Editing States (inline chat style)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");

  // Synchronize local messages state when the active chat match changes
  useEffect(() => {
    if (activeChat) {
      setMessages(activeChat.chatHistory);
    }
  }, [activeChat]);

  // Clean up audio when switching chat or leaving
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
      setLoadingVoiceId(null);
    };
  }, [activeChat]);

  // AUTO-SCROLL: Keep the newest message / "Typing..." indicator in view
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

  // Track whether the viewer is already at (or near) the bottom, so reading
  // history higher up is never yanked away by incoming messages
  const handleChatScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Jump straight to the bottom instantly whenever a different conversation is opened
  useEffect(() => {
    const t = setTimeout(() => {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 80);
    return () => clearTimeout(t);
  }, [activeChat?.interactionId]);

  // Follow new content (new message populating or the "Typing..." bubble appearing)
  // as long as the viewer was already near the bottom
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const lastMsg = messages[messages.length - 1];
    const userJustSent = !!lastMsg && lastMsg.role === "user";
    if (isNearBottomRef.current || userJustSent) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isSending]);

  if (!activeChat) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 p-4 text-center">
        Select a conversation from the DMs tab to start chatting.
      </div>
    );
  }

  // Handle attaching any file (image, audio, video) inside chat
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setIsUploadingFile(true);
    try {
      const file = e.target.files[0];
      const url = await uploadImage(file);
      const lowerName = file.name.toLowerCase();
      const isImg = file.type.startsWith("image/") || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") || lowerName.endsWith(".png") || lowerName.endsWith(".webp") || lowerName.endsWith(".gif");
      const isAud = file.type.startsWith("audio/") || lowerName.endsWith(".mp3") || lowerName.endsWith(".wav");
      const isVid = file.type.startsWith("video/") || lowerName.endsWith(".mp4") || lowerName.endsWith(".webm");

      let markdown = "";
      if (isImg) {
        markdown = `![image](${url})`;
      } else if (isAud) {
        markdown = `[audio](${url})`;
      } else if (isVid) {
        markdown = `[video](${url})`;
      } else {
        markdown = `[file](${url})`;
      }

      setInput((prev) => (prev ? `${prev} ${markdown}` : markdown));
    } catch (err: any) {
      showToast("File upload failed: " + err.message);
    } finally {
      setIsUploadingFile(false);
    }
  };

  // Generate and play text-to-speech
  const speakMessage = async (text: string, voiceId: string, messageId: string) => {
    if (!voiceId || !text || !text.trim()) {
      return;
    }

    // Stop current playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }

    setLoadingVoiceId(messageId);
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to generate voice" }));
        throw new Error(data.error || "Failed to generate voice");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlayingId(messageId);
      audio.onended = () => {
        setPlayingId(null);
        URL.revokeObjectURL(url);
      };
      audio.play();
    } catch (err: any) {
      console.error("TTS generation error:", err.message);
    } finally {
      setLoadingVoiceId(null);
    }
  };

  const toggleVoice = (text: string, voiceId: string, messageId: string) => {
    if (playingId === messageId) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
    } else {
      speakMessage(text, voiceId, messageId);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isSending) return;
    
    const userMsg = input.trim();
    setInput("");
    setIsSending(true);

    // Optimistic UI (force auto-scroll follow: the user acted from the bottom input)
    isNearBottomRef.current = true;
    const tempMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(tempMessages);

    const data = await safeFetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: activeChat.characterId,
        message: userMsg
      })
    });
    if (data.success) {
      setMessages(data.history);
      // Autoplay voice
      const lastMsg = data.history[data.history.length - 1];
      if (lastMsg && lastMsg.role === "assistant" && activeChat.characterVoiceId) {
        speakMessage(lastMsg.content, activeChat.characterVoiceId, lastMsg.id);
      }
    } else {
      showToast("Chat failed: " + data.error);
    }
    setIsSending(false);
  };

  const handleAction = async (msgId: string, action: "delete" | "regenerate" | "edit", newContent?: string) => {
    if (action === "edit" && !newContent) return;
    
    setIsSending(true);
    const data = await safeFetch("/api/chat/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interactionId: activeChat.interactionId,
        messageId: msgId,
        action,
        newContent
      })
    });
    if (data.success) {
      setMessages(data.history);
      // Autoplay voice on regenerate
      if (action === "regenerate") {
        const lastMsg = data.history[data.history.length - 1];
        if (lastMsg && lastMsg.role === "assistant" && activeChat.characterVoiceId) {
          speakMessage(lastMsg.content, activeChat.characterVoiceId, lastMsg.id);
        }
      }
    } else {
      showToast("Action failed: " + data.error);
    }
    setIsSending(false);
  };

  return (
    <div className="h-full flex bg-gray-50 dark:bg-gray-900 overflow-hidden relative">
      {/* Full-size image lightbox (click any image in chat to expand) */}
      {lightboxImage && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6 cursor-zoom-out" onClick={() => setLightboxImage(null)}>
          <button type="button" aria-label="Close" className="absolute top-4 right-4 p-2 text-white/70 hover:text-white" onClick={() => setLightboxImage(null)}>
            <X className="w-7 h-7" />
          </button>
          <img src={lightboxImage} alt="Expanded image" className="max-w-[92vw] max-h-[92vh] object-contain rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      
      {/* Left Column: Chat Stream */}
      <div className="flex-1 flex flex-col h-full border-r border-gray-200 dark:border-gray-700">
        <div className="p-3 bg-white dark:bg-gray-800 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-500 hover:text-black">←</button>
            {hasRenderableAvatar(activeChat.characterAvatar) ? (
              <img src={activeChat.characterAvatar} alt="" className="w-10 h-10 rounded-full object-cover md:hidden" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-pink-100 dark:bg-pink-950/40 flex items-center justify-center text-pink-500 font-bold md:hidden select-none">{(activeChat.characterName || "?")[0]}</div>
            )}
            <h2 className="font-bold">{activeChat.characterName}</h2>
          </div>
          {!activeChat.unmatched && !activeChat.deleted && (
            <button 
              onClick={async () => {
                if (await confirmInApp(`Are you sure you want to unmatch ${activeChat.characterName}? This will move the conversation to unmatched section and disable messaging.`)) {
                  const res = await safeFetch("/api/unmatch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ interactionId: activeChat.interactionId, unmatchedBy: "user" })
                  });
                  if (res.success) {
                    showToast(`You successfully unmatched ${activeChat.characterName}.`);
                    onBack(); // go back to Matches tab
                  } else {
                    showToast("Unmatching failed: " + res.error);
                  }
                }
              }}
              className="text-xs bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/40 text-red-500 font-bold px-3 py-1.5 rounded-full transition flex items-center gap-1"
            >
              💔 Unmatch
            </button>
          )}
        </div>

        <div ref={scrollContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Milestone Banners at the beginning of chats */}
          <div className="flex flex-col items-center gap-2 mb-4">
            {activeChat.aicStatus === "slide-in" && activeChat.dmMessage && (
              <div className="text-xs bg-purple-50 dark:bg-purple-950/20 text-purple-600 dark:text-purple-400 px-4 py-2 rounded-2xl border border-purple-100/40 dark:border-purple-900/20 max-w-sm text-center shadow-sm">
                ✨ <strong>{activeChat.characterName}</strong> slid into your DMs with an opening line!
              </div>
            )}
            {activeChat.matched && (
              <div className="text-xs bg-pink-50 dark:bg-pink-950/20 text-pink-600 dark:text-pink-400 px-4 py-2 rounded-2xl border border-pink-100/40 dark:border-pink-900/20 max-w-sm text-center shadow-sm">
                💖 You and <strong>{activeChat.characterName}</strong> matched!
              </div>
            )}
            {activeChat.unmatched && (
              <div className="text-xs bg-red-50/80 dark:bg-red-950/20 text-red-600 dark:text-red-400 px-4 py-2 rounded-2xl border border-red-100/40 dark:border-red-900/20 max-w-sm text-center shadow-sm font-semibold">
                💔 Connection Unmatched {activeChat.unmatchedBy === "user" ? "by you" : `by ${activeChat.characterName}`}.
              </div>
            )}
            {activeChat.deleted && (
              <div className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-4 py-2 rounded-2xl border border-gray-200 dark:border-gray-700 max-w-sm text-center shadow-sm font-semibold">
                🗑️ This character has been deleted.
              </div>
            )}
          </div>

          {messages.map((m, i) => (
            <div key={m.id || i} className={`flex flex-col group ${m.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[85%] p-3 rounded-2xl relative ${
                m.role === "user" 
                  ? "bg-pink-500 text-white rounded-tr-none" 
                  : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm rounded-tl-none border border-gray-100 dark:border-gray-700"
              }`}>
                {editingMessageId === m.id ? (
                  <div className="flex flex-col gap-2 min-w-[200px] sm:min-w-[300px]">
                    <textarea
                      rows={3}
                      value={editingMessageText}
                      onChange={(e) => setEditingMessageText(e.target.value)}
                      onKeyDown={async (e) => {
                        // Allow saving on Ctrl+Enter (inline chat style)
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          if (editingMessageText.trim() && editingMessageText !== m.content) {
                            await handleAction(m.id, "edit", editingMessageText);
                          }
                          setEditingMessageId(null);
                          setEditingMessageText("");
                        }
                      }}
                      className="w-full bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 p-2 rounded border border-pink-400 focus:outline-none focus:ring-2 focus:ring-pink-500 text-sm font-sans"
                    />
                    <div className="flex justify-end gap-2 text-[10px]">
                      <button 
                        onClick={() => {
                          setEditingMessageId(null);
                          setEditingMessageText("");
                        }}
                        className="px-2 py-1 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:opacity-80 transition font-bold"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={async () => {
                          if (editingMessageText.trim() && editingMessageText !== m.content) {
                            await handleAction(m.id, "edit", editingMessageText);
                          }
                          setEditingMessageId(null);
                          setEditingMessageText("");
                        }}
                        className="px-2 py-1 bg-pink-600 text-white rounded hover:opacity-90 transition font-bold"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-sm">{renderMessageContent(m.content, setLightboxImage)}</div>
                    <div className={`text-[9px] mt-1 text-right select-none ${m.role === "user" ? "text-pink-100" : "text-gray-400"}`}>
                      {formatMessageTime(m.timestamp)}
                    </div>
                  </>
                )}
              </div>

              {/* Voice Generation & Playing Statuses */}
              {m.role === "assistant" && loadingVoiceId === m.id && (
                <span className="text-[10px] text-blue-500 animate-pulse ml-2 mt-0.5">
                  Generating voice...
                </span>
              )}
              {m.role === "assistant" && playingId === m.id && (
                <span className="text-[10px] text-pink-500 animate-pulse ml-2 mt-0.5 flex items-center gap-1">
                  <Volume2 className="w-2.5 h-2.5" /> Playing voice...
                </span>
              )}
              
              {/* Message Actions (standard chat-app style) */}
              <div className={`flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <button 
                  onClick={() => {
                    setEditingMessageId(m.id);
                    setEditingMessageText(m.content);
                  }}
                  className="text-gray-400 hover:text-blue-500 p-1" title="Edit"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
                <button 
                  onClick={async () => {
                    if (await confirmInApp("Delete this message?")) handleAction(m.id, "delete");
                  }}
                  className="text-gray-400 hover:text-red-500 p-1" title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                {m.role === "assistant" && (
                  <button 
                    onClick={() => handleAction(m.id, "regenerate")}
                    className="text-gray-400 hover:text-green-500 p-1" title="Regenerate"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
                {m.role === "assistant" && activeChat.characterVoiceId && (
                  <button 
                    onClick={() => toggleVoice(m.content, activeChat.characterVoiceId, m.id)}
                    className={`p-1 transition-colors ${
                      playingId === m.id 
                        ? "text-pink-500 animate-pulse" 
                        : "text-gray-400 hover:text-pink-500"
                    }`}
                    title={playingId === m.id ? "Stop voice" : "Play voice"}
                  >
                    {playingId === m.id ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex justify-start">
              <div className="bg-gray-200 dark:bg-gray-700 p-3 rounded-2xl rounded-tl-none text-gray-500 text-sm animate-pulse">
                Typing...
              </div>
            </div>
          )}
        </div>

        {/* File Upload Pending Status Overlay */}
        {isUploadingFile && (
          <div className="absolute bottom-20 left-4 bg-black/75 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg border border-gray-700 animate-pulse flex items-center gap-2 z-10">
            <Paperclip className="w-3.5 h-3.5 animate-spin" /> Uploading attachment...
          </div>
        )}

        <div className="p-4 bg-white dark:bg-gray-800 flex gap-2 items-end">
          <label className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 hover:text-gray-950 dark:hover:text-gray-50 p-3 rounded-xl cursor-pointer transition flex items-center justify-center h-12 w-12 shrink-0 border border-gray-200 dark:border-gray-600">
            <Paperclip className="w-5 h-5" />
            <input 
              type="file" 
              className="hidden" 
              onChange={handleFileUpload} 
              disabled={isUploadingFile}
              accept="image/*,audio/*,video/*"
            />
          </label>
          <textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={
              activeChat.unmatched 
                ? "This connection is unmatched. Messaging disabled." 
                : activeChat.deleted 
                  ? "This character has been deleted. Messaging disabled." 
                  : activeChat.characterDisabled
                    ? "This character is currently inactive. Messaging disabled."
                    : "Type a message..."
            }
            disabled={activeChat.unmatched || activeChat.deleted || activeChat.characterDisabled}
            rows={1}
            className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-xl px-4 py-3 outline-none text-sm resize-none disabled:opacity-60"
          />
          <button 
            onClick={sendMessage}
            disabled={!input.trim() || isSending || activeChat.unmatched || activeChat.deleted || activeChat.characterDisabled}
            className="bg-pink-500 hover:bg-pink-600 text-white w-12 h-12 rounded-xl flex items-center justify-center disabled:opacity-50 transition"
          >
            ↑
          </button>
        </div>
      </div>

      {/* Right Column: AIC Portrait */}
      <div 
        onClick={() => onOpenBio && onOpenBio({
          characterName: activeChat.characterName,
          characterAvatar: activeChat.characterAvatar,
          characterPublicBio: activeChat.characterPublicBio,
          gender: activeChat.characterGender,
          lookingFor: activeChat.characterLookingFor
        })}
        className="hidden md:flex w-1/3 flex-col bg-black relative cursor-pointer group hover:opacity-95 transition-all"
      >
        {hasRenderableAvatar(activeChat.characterAvatar) ? (
          <img 
            src={activeChat.characterAvatar} 
            alt={activeChat.characterName} 
            className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-[1.02] transition-transform duration-500"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-pink-200/20 to-purple-300/10 dark:from-pink-950/30 dark:to-purple-950/20 flex items-center justify-center text-white/50 font-black text-6xl italic select-none">
            {(activeChat.characterName || "?")[0]}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"></div>
        <div className="absolute bottom-0 left-0 right-0 p-6">
          <h2 className="text-3xl font-bold text-white mb-1 flex items-center gap-2">
            {activeChat.characterName}
            <span className="text-[10px] bg-pink-500 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">View Info</span>
          </h2>
          <p className="text-gray-300 text-sm leading-relaxed line-clamp-2 italic opacity-95">
            {getIntroSentence(activeChat.characterPublicBio)}
          </p>
        </div>
      </div>

    </div>
  );
}

// --------------------------------------------------------
// STRUCTURED BIO EDITOR SUBCOMPONENT (Bio updates #3, #6)
// Provides a gorgeous, tabbed form for editing all profile bio sections cleanly,
// with a toggle to edit raw Markdown directly.
// --------------------------------------------------------
function StructuredBioEditor({ value, onChange, masterQuestions }: { value: string; onChange: (val: string) => void; masterQuestions: string[] }) {
  const [isRaw, setIsRaw] = useState(false);
  const [bioState, setBioState] = useState<StructuredBio>(() => parseBioMarkdown(value));
  const [activeSubTab, setActiveSubTab] = useState<"intro" | "aboutme" | "favorites" | "prompts">("intro");

  // Keep internal state in sync if parent value changes
  useEffect(() => {
    setBioState(parseBioMarkdown(value));
  }, [value]);

  const updateField = (section: "aboutMe" | "favorites", key: string, val: string) => {
    const updated = {
      ...bioState,
      [section]: {
        ...bioState[section],
        [key]: val
      }
    };
    setBioState(updated);
    onChange(compileBioMarkdown(updated));
  };

  const updateIntro = (introVal: string) => {
    const updated = { ...bioState, intro: introVal };
    setBioState(updated);
    onChange(compileBioMarkdown(updated));
  };

  const updatePrompt = (index: number, question: string, answer: string) => {
    const prompts = [...bioState.prompts];
    while (prompts.length <= index) {
      prompts.push({ question: "", answer: "" });
    }
    prompts[index] = { question, answer };
    const updated = { ...bioState, prompts };
    setBioState(updated);
    onChange(compileBioMarkdown(updated));
  };

  const aboutMeFields = [
    { name: "Age", label: "Age", placeholder: "e.g. 25" },
    { name: "Hometown", label: "Hometown", placeholder: "e.g. Chicago, IL" },
    { name: "Location", label: "Location / Neighborhood (MANDATORY)", placeholder: "e.g. Brooklyn / West Loop", required: true },
    { name: "Profession", label: "Profession", placeholder: "e.g. Designer" },
    { name: "Hobbies", label: "Hobbies / Vibe", placeholder: "e.g. skiing, reading, coffee" },
    { name: "Height", label: "Height", placeholder: "e.g. 5'11\"" },
    { name: "Star sign", label: "Star sign", placeholder: "e.g. Scorpio" },
    { name: "Kink", label: "Kink Interest", placeholder: "Yes / No / Maybe" },
    { name: "Languages", label: "Languages Spoken", placeholder: "e.g. English, French" },
    { name: "Dating intentions", label: "Dating intentions", placeholder: "e.g. Long-term relationship" },
    { name: "Family", label: "Family Plans", placeholder: "e.g. Yes / Maybe" },
    { name: "Pets", label: "Pets Attitude", placeholder: "e.g. Cat person / Dog person" },
    { name: "Living situation", label: "Living situation", placeholder: "e.g. Apartment / House" },
    { name: "Roommates", label: "Do you have roommates?", placeholder: "Yes / No" },
    { name: "Messaging", label: "Messaging style", placeholder: "e.g. Fast texter" },
    { name: "Double text", label: "Double texting?", placeholder: "Double text ok" },
    { name: "In relationship with", label: "Already in a relationship?", placeholder: "e.g. No" },
    { name: "Married", label: "Married?", placeholder: "Yes / No" },
  ];
  // Note: the AIC public-bio writer prompt keeps its own optional "AI" /
  // "Lowest age" / "Highest age" fields (sync.ts prompt_bio_writing) — only
  // the USER's structured form omits them.
  const favoriteCategories = [
    "Favorite song",
    "Favorite game",
    "Favorite book",
    "Favorite movie",
    "Favorite TV show",
    "Favorite food",
    "Favorite animal",
    "Favorite color",
    "Favorite season",
    "Favorite travel destination",
    "Favorite store",
    "Favorite sport",
    "Favorite sports team",
  ];

  if (isRaw) {
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-bold text-gray-500">Edit Bio as Raw Markdown</label>
          <button type="button" onClick={() => setIsRaw(false)} className="text-xs text-pink-500 font-bold hover:underline">⚡ Use Structured Form</button>
        </div>
        <textarea 
          rows={12} 
          value={value} 
          onChange={e => onChange(e.target.value)}
          placeholder="**Intro**\nYour intro...\n\n**About Me**\n* **Age**: 25\n* **Location**: Neighborhood..."
          className="w-full bg-gray-50 dark:bg-gray-800 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-mono text-gray-900 dark:text-gray-100"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 bg-gray-50/40 dark:bg-gray-900/10">
      <div className="flex justify-between items-center border-b dark:border-gray-700 pb-2 flex-wrap gap-2">
        <div className="flex gap-2">
          {(["intro", "aboutme", "favorites", "prompts"] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveSubTab(tab)}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                activeSubTab === tab
                  ? "bg-pink-500 text-white shadow-sm"
                  : "bg-white dark:bg-gray-800 text-gray-500 hover:bg-gray-100 hover:text-gray-700 border border-gray-150 dark:border-gray-700"
              }`}
            >
              {tab === "intro" ? "📝 Intro" : tab === "aboutme" ? "👤 About Me" : tab === "favorites" ? "💖 Favorites" : "💡 Prompts"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setIsRaw(true)} className="text-xs text-pink-500 font-bold hover:underline">📝 Edit Raw Markdown</button>
      </div>

      {activeSubTab === "intro" && (
        <div className="space-y-2">
          <label className="block text-xs font-bold text-gray-500">Self-Introduction Paragraph (1-2 sentences)</label>
          <textarea
            rows={3}
            value={bioState.intro}
            onChange={e => updateIntro(e.target.value)}
            placeholder="Introduce yourself to the world..."
            className="w-full bg-white dark:bg-gray-800 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm"
          />
        </div>
      )}

      {activeSubTab === "aboutme" && (
        <div className="space-y-3">
          <p className="text-[11px] text-gray-400 font-medium">Specify your basic and optional traits. Location/neighborhood is mandatory.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
            {aboutMeFields.map(field => (
              <div key={field.name} className="space-y-1">
                <label className="block text-[11px] font-bold text-gray-500 flex justify-between">
                  <span>{field.label}</span>
                  {field.required && <span className="text-red-500">* Required</span>}
                </label>
                <input
                  type="text"
                  placeholder={field.placeholder}
                  value={bioState.aboutMe[field.name] || ""}
                  onChange={e => updateField("aboutMe", field.name, e.target.value)}
                  className={`w-full bg-white dark:bg-gray-800 p-2 rounded-xl border text-xs ${
                    field.required && !(bioState.aboutMe[field.name] || "").trim()
                      ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      {activeSubTab === "favorites" && (
        <div className="space-y-3">
          <p className="text-[11px] text-gray-400 font-medium">List your favorites. These render beautifully as compact hover-tooltip pills!</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
            {favoriteCategories.map(cat => (
              <div key={cat} className="space-y-1">
                <label className="block text-[11px] font-bold text-gray-500">{cat}</label>
                <input
                  type="text"
                  placeholder={`Your favorite ${cat.toLowerCase().replace("favorite ", "")}...`}
                  value={bioState.favorites[cat] || ""}
                  onChange={e => updateField("favorites", cat, e.target.value)}
                  className="w-full bg-white dark:bg-gray-800 p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeSubTab === "prompts" && (
        <div className="space-y-4">
          <p className="text-[11px] text-gray-400 font-medium">Select up to 3 questions and write your unique, personality-driven answers!</p>
          {[0, 1, 2].map(index => {
            const currentPrompt = bioState.prompts[index] || { question: "", answer: "" };
            return (
              <div key={index} className="p-3 bg-white dark:bg-gray-800/50 rounded-xl border border-gray-150 dark:border-gray-800 space-y-2">
                <label className="block text-[10px] font-extrabold text-pink-500 uppercase tracking-wide">Prompt {index + 1}</label>
                <select
                  value={currentPrompt.question}
                  onChange={e => updatePrompt(index, e.target.value, currentPrompt.answer)}
                  className="w-full bg-gray-50 dark:bg-gray-700 p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs"
                >
                  <option value="">-- Choose a Prompt Question --</option>
                  {masterQuestions.map((q, idx) => (
                    <option key={idx} value={q}>{q}</option>
                  ))}
                </select>
                <textarea
                  rows={2}
                  placeholder="Type your answer here..."
                  value={currentPrompt.answer}
                  onChange={e => updatePrompt(index, currentPrompt.question, e.target.value)}
                  className="w-full p-2 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}




function CreateProfileTab({ onProfileCreated }: { onProfileCreated: () => void }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState("Male");
  const [lookingFor, setLookingFor] = useState("Female");
  const [avatar, setAvatar] = useState("");
  const [bio, setBio] = useState("");
  const [masterQuestions, setMasterQuestions] = useState<string[]>([]);

  useEffect(() => {
    // Fetch master questions from settings upon mounting
    const loadQuestions = async () => {
      const data = await safeFetch("/api/settings");
      if (data.success && data.settings && data.settings.questionnaire_master) {
        try {
          const parsed = JSON.parse(data.settings.questionnaire_master);
          setMasterQuestions(parsed);
        } catch (e) {
          console.error("Error parsing master questions:", e);
        }
      }
    };
    loadQuestions();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast("Name is required!");
      return;
    }

    // Validate mandatory Location field (neighborhood)
    const parsed = parseBioMarkdown(bio);
    if (!parsed.aboutMe["Location"]?.trim()) {
      showToast("Location (neighborhood) is a mandatory field under About Me. Please fill it out!");
      return;
    }

    const res = await safeFetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        gender,
        lookingFor,
        avatar: avatar || "A nice person",
        bio
      })
    });

    if (res.success) {
      showToast("Profile successfully created!");
      onProfileCreated();
    } else {
      showToast("Failed to create profile: " + res.error);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6 bg-white dark:bg-gray-900 max-w-lg mx-auto">
      <h2 className="text-2xl font-bold text-pink-500 flex items-center gap-2">
        <UserPlus className="w-6 h-6" /> Create Structured Profile
      </h2>
      <p className="text-sm text-gray-500">Build a brand-new persona with structured prompts and basic info.</p>

      <form onSubmit={handleSubmit} className="space-y-4 pb-12">
        <div>
          <label className="block text-sm font-bold mb-1">Name</label>
          <input 
            type="text" required value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded" placeholder="e.g. Charlie"
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-bold mb-1">I am a...</label>
            <select 
              value={gender} onChange={e => setGender(e.target.value)}
              className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"
            >
              <option>Male</option><option>Female</option><option>Non-binary</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-bold mb-1">Looking for...</label>
            <select 
              value={lookingFor} onChange={e => setLookingFor(e.target.value)}
              className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"
            >
              <option>Female</option><option>Male</option><option>Everyone</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-bold mb-1">Avatar Image URL or Vibe Description</label>
          <div className="flex gap-4 items-center">
            <input 
              type="text" value={avatar} onChange={e => setAvatar(e.target.value)}
              className="flex-1 bg-gray-100 dark:bg-gray-700 p-2 rounded text-sm" placeholder="URL or e.g. Sophisticated bookworm"
            />
            <ImageUploader currentUrl={avatar} onUpload={(url) => setAvatar(url)} />
          </div>
        </div>

        <div className="pt-2 border-t dark:border-gray-800">
          <h3 className="font-bold text-lg mb-2 text-gray-800 dark:text-gray-100">Structured Profile Bio</h3>
          <StructuredBioEditor value={bio} onChange={setBio} masterQuestions={masterQuestions} />
        </div>

        <button type="submit" className="w-full bg-pink-500 hover:bg-pink-600 text-white p-3 rounded-xl font-bold shadow-md shadow-pink-500/20 transition">
          Create & Switch to Profile
        </button>
      </form>
    </div>
  );
}

function ProfileTab({ profiles, activeProfile, onProfileChanged, onOpenBio, onNavigateToGossip, onOpenCreateProfile }: any) {
  const [editingProfile, setEditingProfile] = useState<any>(null);
  const [masterQuestions, setMasterQuestions] = useState<string[]>([]);
  const [gossipStats, setGossipStats] = useState<any>(null);

  useEffect(() => {
    const fetchMasterQuestions = async () => {
      const data = await safeFetch("/api/settings");
      if (data.success && data.settings && data.settings.questionnaire_master) {
        try {
          setMasterQuestions(JSON.parse(data.settings.questionnaire_master));
        } catch (e) {
          console.error(e);
        }
      }
    };
    fetchMasterQuestions();
  }, []);

  useEffect(() => {
    const fetchReputation = async () => {
      if (!activeProfile) return;
      const data = await safeFetch(`/api/gossip?profileId=${activeProfile.id}`);
      if (data.success && data.stats) {
        setGossipStats(data.stats);
      }
    };
    fetchReputation();
  }, [activeProfile]);

  const switchProfile = async (id: string) => {
    await safeFetch("/api/profiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "switch" })
    });
    onProfileChanged();
  };

  const saveProfile = async () => {
    // Validate mandatory Location field (neighborhood)
    const parsed = parseBioMarkdown(editingProfile.bio);
    if (!parsed.aboutMe["Location"]?.trim()) {
      showToast("Location (neighborhood) is a mandatory field under About Me. Please fill it out!");
      return;
    }

    const isNew = editingProfile.id.startsWith("new_");
    const method = isNew ? "POST" : "PUT";
    
    const data = await safeFetch("/api/profiles", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingProfile)
    });
    if (data.success) {
      setEditingProfile(null);
      onProfileChanged();
    } else {
      showToast("Failed to save profile: " + data.error);
    }
  };

  const duplicateProfile = async (p: any) => {
    const data = await safeFetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${p.name} (Copy)`,
        bio: p.bio,
        avatar: p.avatar,
        gender: p.gender,
        lookingFor: p.lookingFor,
      })
    });
    if (data.success) {
      onProfileChanged();
    } else {
      showToast("Failed to duplicate profile: " + data.error);
    }
  };

  const deleteProfile = async (p: any) => {
    if (!await confirmInApp(`Permanently delete profile "${p.name}"?\n\nThis deletes ALL data associated with this profile: every match, the entire chat history, and every community gossip post about them. This cannot be undone.`)) return;
    const data = await safeFetch(`/api/profiles?profileId=${p.id}`, { method: "DELETE" });
    if (data.success) {
      showToast(`Profile "${p.name}" and all of its associated data were deleted.`);
      onProfileChanged();
    } else {
      showToast("Failed to delete profile: " + (data.error || "unknown error"));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      <div className="flex justify-between items-center gap-2">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Your Profiles</h2>
        {editingProfile ? (
          <button
            onClick={() => setEditingProfile(null)}
            className="bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1 rounded-full text-sm font-bold"
          >
            Cancel
          </button>
        ) : (
          onOpenCreateProfile && (
            <button
              onClick={onOpenCreateProfile}
              className="bg-pink-100 text-pink-600 px-3 py-1 rounded-full text-sm font-bold"
              title="Open the full structured profile creation form"
            >
              + New Profile
            </button>
          )
        )}
      </div>

      {editingProfile && (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 space-y-3">
          <h3 className="font-bold text-lg mb-2">{editingProfile.id.startsWith("new_") ? "Create New Profile" : "Edit Profile"}</h3>
          
          <div className="flex gap-4 mb-4">
            <ImageUploader 
              currentUrl={editingProfile.avatar}
              onUpload={(url) => setEditingProfile({...editingProfile, avatar: url})}
            />
            <div className="flex-1">
              <label className="block text-sm font-bold mb-1">Your Name</label>
              <input 
                type="text" placeholder="E.g. Alex" 
                value={editingProfile.name} onChange={e => setEditingProfile({...editingProfile, name: e.target.value})}
                className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"
              />
            </div>
          </div>
          
          <div className="pt-2 border-t dark:border-gray-700">
            <h4 className="font-bold text-sm mb-2 text-gray-800 dark:text-gray-100">Your Structured Bio</h4>
            <StructuredBioEditor value={editingProfile.bio} onChange={val => setEditingProfile({...editingProfile, bio: val})} masterQuestions={masterQuestions} />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-bold mb-1">I am a...</label>
              <select 
                value={editingProfile.gender} onChange={e => setEditingProfile({...editingProfile, gender: e.target.value})}
                className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"
              >
                <option>Male</option><option>Female</option><option>Non-binary</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-bold mb-1">Looking for...</label>
              <select 
                value={editingProfile.lookingFor} onChange={e => setEditingProfile({...editingProfile, lookingFor: e.target.value})}
                className="w-full bg-gray-100 dark:bg-gray-700 p-2 rounded"
              >
                <option>Female</option><option>Male</option><option>Everyone</option>
              </select>
            </div>
          </div>
          <button onClick={saveProfile} className="w-full bg-pink-500 hover:bg-pink-600 text-white p-2 rounded font-bold mt-2 transition">
            Save Profile
          </button>
        </div>
      )}
      
      {!editingProfile && (
        <div className="space-y-4">
          {activeProfile && gossipStats && gossipStats.totalReviews > 0 && (
            <div 
              onClick={onNavigateToGossip}
              className="p-4 rounded-xl bg-gradient-to-r from-pink-50 to-purple-50 dark:from-pink-950/20 dark:to-purple-950/20 border border-pink-200 dark:border-pink-900/40 shadow-xs cursor-pointer hover:border-pink-400 transition"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">☕</span>
                  <div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      Community Dating Reputation
                      <span className="text-amber-500 font-extrabold text-xs">⭐ {gossipStats.avgRating} / 5.0</span>
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {gossipStats.totalReviews} peer reviews on the community board for @{activeProfile.name}
                    </p>
                  </div>
                </div>
                <span className="text-xs font-bold text-pink-600 dark:text-pink-400 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-pink-200 dark:border-pink-800 shadow-2xs">
                  View Gossip Board →
                </span>
              </div>
            </div>
          )}
          {profiles.map((p: any) => (
            <div 
              key={p.id} 
              className={`p-4 rounded-xl shadow-sm border-2 ${
                p.id === activeProfile?.id 
                  ? "border-pink-500 bg-pink-50 dark:bg-pink-900/20" 
                  : "border-transparent bg-white dark:bg-gray-800"
              }`}
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex gap-4">
                  {p.avatar && !p.avatar.includes("Default") && p.avatar !== "A nice person" ? (
                    <img 
                      src={p.avatar} 
                      alt="avatar" 
                      className="w-16 h-16 rounded-full object-cover cursor-pointer hover:scale-105 transition-transform shrink-0" 
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenBio(p);
                      }} 
                    />
                  ) : (
                    <div 
                      className="w-16 h-16 rounded-full bg-pink-100 dark:bg-pink-950/20 flex items-center justify-center text-pink-500 font-bold select-none text-xl cursor-pointer hover:scale-105 transition-transform shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenBio(p);
                      }}
                    >
                      {p.name.charAt(0) || "U"}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      {p.name}
                      {p.id === activeProfile?.id && <span className="text-xs bg-pink-500 text-white px-2 py-0.5 rounded-full">Active</span>}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">{p.bio}</p>
                    <div className="mt-2 text-xs text-gray-400">
                      {p.gender} looking for {p.lookingFor}
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col gap-2 shrink-0">
                  {p.id !== activeProfile?.id && (
                    <button 
                      onClick={() => switchProfile(p.id)}
                      className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 px-3 py-1 rounded-full text-sm font-medium transition"
                    >
                      Switch
                    </button>
                  )}
                  <button 
                    onClick={() => duplicateProfile(p)}
                    className="text-gray-400 hover:text-pink-500 flex items-center gap-1 text-sm justify-end"
                  >
                    <FileText className="w-3 h-3" /> Duplicate
                  </button>
                  <button
                    onClick={() => setEditingProfile(p)}
                    className="text-gray-400 hover:text-pink-500 flex items-center gap-1 text-sm justify-end"
                  >
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                  <button
                    onClick={() => deleteProfile(p)}
                    className="text-gray-400 hover:text-red-500 flex items-center gap-1 text-sm justify-end"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function InteractionLedger() {
  const [interactions, setInteractions] = useState<any[]>([]);
  const [editingInter, setEditingInter] = useState<any>(null);
  const [newReasoning, setNewReasoning] = useState("");

  useEffect(() => {
    loadLedger();
    // Re-load when interactions are evaluated or reset
    window.addEventListener("interactions-updated", loadLedger);
    return () => window.removeEventListener("interactions-updated", loadLedger);
  }, []);

  const loadLedger = async () => {
    const data = await safeFetch("/api/interactions"); 
    if (data.success && data.interactions) {
      setInteractions(data.interactions);
    }
  };

  return (
    <details className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
      <summary className="font-bold text-lg p-4 cursor-pointer focus:outline-none">
        Spoiler: Interaction Ledger
      </summary>
      <div className="p-4 pt-0 space-y-4">
        <p className="text-sm text-gray-500">Live view of evaluations. Hover over the Rationale cell to edit the decision reasoning.</p>
        
        {interactions.length === 0 ? (
          <p className="text-sm text-gray-400">No interactions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-gray-100 dark:bg-gray-700">
                <tr>
                  <th className="p-2.5">Character</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Rationale</th>
                  <th className="p-2.5 text-center">Evaluated?</th>
                  <th className="p-2.5 text-center">Matched</th>
                </tr>
              </thead>
              <tbody>
                {interactions.map((inter: any, i: number) => (
                  <tr key={i} className="border-b dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="p-2.5 font-medium">{inter.characterName}</td>
                    <td className="p-2.5 whitespace-nowrap">
                      {inter.aicStatus === "slide-in" ? (
                        <span className="text-purple-500 font-bold">Slide-In</span>
                      ) : inter.aicStatus === "like" ? (
                        <span className="text-green-500 font-bold">Liked</span>
                      ) : inter.aicStatus === "pass" ? (
                        <span className="text-red-500 font-bold">Passed</span>
                      ) : (
                        <span className="text-gray-500">Pending</span>
                      )}
                    </td>
                    <td className="p-2.5 max-w-xs group">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate block flex-1" title={inter.internalReasoning || ""}>
                          {inter.internalReasoning || "-"}
                        </span>
                        {inter.id && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingInter(inter);
                              setNewReasoning(inter.internalReasoning || "");
                            }}
                            className="text-[10px] text-pink-500 hover:text-pink-600 font-extrabold opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                          >
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5 text-center">
                      {inter.aicStatus ? "✅" : "❌"}
                    </td>
                    <td className="p-2.5 text-center">
                      {inter.matched ? "✅" : "❌"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* user-friendly rationale edit popup modal (Misc #1) */}
      {editingInter && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 max-w-lg w-full border border-gray-150 dark:border-gray-800 shadow-2xl space-y-4">
            <h4 className="font-extrabold text-lg text-pink-600 flex items-center gap-1.5">✏️ Edit Swipe Rationale</h4>
            <p className="text-xs text-gray-500">Edit the in-character evaluation rationale of {editingInter.characterName} regarding your profile compatibility.</p>
            
            <textarea
              rows={6}
              value={newReasoning}
              onChange={e => setNewReasoning(e.target.value)}
              className="w-full p-3 text-xs rounded-xl border bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-sans"
              placeholder="Type custom swipe reasoning rationale..."
            />
            
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setEditingInter(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const res = await safeFetch("/api/interactions", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: editingInter.id, internalReasoning: newReasoning })
                  });
                  if (res.success) {
                    setEditingInter(null);
                    loadLedger();
                  } else {
                    showToast("Failed to save reasoning: " + res.error);
                  }
                }}
                className="px-5 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-xl font-bold transition shadow-md shadow-pink-500/10 cursor-pointer"
              >
                Save Rationale
              </button>
            </div>
          </div>
        </div>
      )}
    </details>
  );
}

// --------------------------------------------------------
// AIC GENERATION TAB
// --------------------------------------------------------

function AicGenerationTab({ 
  addTask, 
  removeTask, 
  updateTaskProgress,
  settings,
  setSettings,
  isSaving,
  saveSettings,
  loadSettings,
  isGenerating,
  handleGenerate,
  handleGenerateManual
}: any) {
  const [preferences, setPreferences] = useState<any[]>([]);
  const [profileName, setProfileName] = useState("");
  const [interactionCount, setInteractionCount] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(false);

  // Custom Tag Generation popup states (Feature #4)
  const [showManualGen, setShowManualGen] = useState(false);
  const [manualTagsState, setManualTagsState] = useState<Record<string, number>>({});
  const [manualDevTagsState, setManualDevTagsState] = useState<string[]>([]);

  // local draft states to prevent row-jumping during active input keystrokes
  const [draftPreferences, setDraftPreferences] = useState<any[]>([]);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "ascending" | "descending" } | null>({
    key: "combinedImportance",
    direction: "descending",
  });

  // Request sort header action
  const requestSort = (key: string) => {
    let direction: "ascending" | "descending" = "ascending";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "ascending") {
      direction = "descending";
    }
    setSortConfig({ key, direction });
  };

  // Memoized, dynamically sorted list
  const sortedPreferences = useMemo(() => {
    let sortableItems = [...draftPreferences];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        // Parse numbers safely from draft strings
        let aNum = typeof aVal === "string" ? parseFloat(aVal) : aVal;
        let bNum = typeof bVal === "string" ? parseFloat(bVal) : bVal;

        if (sortConfig.key === "tag") {
          return sortConfig.direction === "ascending"
            ? a.tag.localeCompare(b.tag)
            : b.tag.localeCompare(a.tag);
        }

        if (isNaN(aNum)) aNum = 0;
        if (isNaN(bNum)) bNum = 0;

        return sortConfig.direction === "ascending"
          ? aNum - bNum
          : bNum - aNum;
      });
    }
    return sortableItems;
  }, [draftPreferences, sortConfig]);

  const handleDraftChange = (tag: string, field: "combinedTarget" | "combinedImportance" | "combinedConfidence", valueStr: string) => {
    setDraftPreferences(prev => 
      prev.map(p => p.tag === tag ? { ...p, [field]: valueStr } : p)
    );
  };

  const handleCommitChange = async (tag: string, field: "combinedTarget" | "combinedImportance" | "combinedConfidence", valueStr: string) => {
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

  const handleResetOverride = async (tag: string) => {
    await safeFetch("/api/profiles/preferences/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }) // empty target/importance deletes override
    });
    loadPreferences();
  };

  const [gender, setGender] = useState("Female");
  const [lookingFor, setLookingFor] = useState("Male");

  useEffect(() => {
    loadSettings();
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    setIsLoadingPreferences(true);
    const data = await safeFetch("/api/profiles/preferences");
    setIsLoadingPreferences(false);
    if (data.success) {
      setPreferences(data.preferences || []);
      setDraftPreferences(JSON.parse(JSON.stringify(data.preferences || [])));
      setProfileName(data.profileName || "");
      setInteractionCount(data.interactionCount || 0);
    }
  };

  const handleResetPreferences = async () => {
    if (!await confirmInApp("Are you sure you want to reset your algorithm learning history? This will start the algorithm fresh from today but won't delete your active matches/DMs. This action cannot be undone.")) return;
    setIsResetting(true);
    const data = await safeFetch("/api/profiles/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" })
    });
    setIsResetting(false);
    if (data.success) {
      showToast("Preferences reset successfully!");
      loadPreferences();
    } else {
      showToast("Failed to reset preferences: " + data.error);
    }
  };

  const handleLocalSaveSettings = async () => {
    await saveSettings({
      aic_gen_base_prompt: settings.aic_gen_base_prompt,
      aic_gen_block_template: settings.aic_gen_block_template,
      prompt_name_generation: settings.prompt_name_generation
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Sparkles className="text-pink-500 w-6 h-6 animate-pulse" /> AIC Generation Admin
        </h2>
        <p className="text-sm text-gray-500">Configure prompts and algorithmically generate new dating app characters based on your swipes.</p>
      </div>

      {/* 1. TRIGGER GENERATION */}
      <div className="bg-gradient-to-r from-pink-50 to-rose-50 dark:from-pink-950/20 dark:to-rose-950/20 p-5 rounded-2xl border border-pink-100 dark:border-pink-900/30 space-y-4">
        <div>
          <h3 className="font-extrabold text-lg text-pink-600 flex items-center gap-1.5">
            ✨ Generate Personalized AIC
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Builds a new character optimized to align with your active profile's preferences (learned through your likes, matches, and chats) with importance-weighted trait sampling.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Character Gender</label>
            <select 
              value={gender} 
              onChange={e => setGender(e.target.value)}
              className="w-full bg-white dark:bg-gray-800 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm"
            >
              <option>Female</option>
              <option>Male</option>
              <option>Non-binary</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Looking For</label>
            <select 
              value={lookingFor} 
              onChange={e => setLookingFor(e.target.value)}
              className="w-full bg-white dark:bg-gray-800 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm"
            >
              <option>Male</option>
              <option>Female</option>
              <option>Everyone</option>
            </select>
          </div>
        </div>

        <button
          onClick={() => handleGenerate(gender, lookingFor, false)}
          disabled={isGenerating}
          className="w-full bg-gradient-to-r from-pink-500 to-rose-500 text-white font-bold p-3.5 rounded-xl shadow-lg shadow-pink-500/20 hover:scale-[1.01] hover:shadow-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2 animate-none"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Generating Character Specs... (Calling LLM)
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" /> Run Algorithm & Generate AIC
            </>
          )}
        </button>

        <button
          onClick={() => handleGenerate(gender, lookingFor, true)}
          disabled={isGenerating}
          className="w-full bg-gradient-to-r from-indigo-500 to-blue-500 text-white font-bold p-3.5 rounded-xl shadow-lg shadow-indigo-500/20 hover:scale-[1.01] hover:shadow-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Generating Character Specs... (Calling LLM)
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" /> Generate Randomized AIC (Ignore Preferences)
            </>
          )}
        </button>

        <button 
          onClick={() => {
            const initialScores: Record<string, number> = {};
            const tagList = draftPreferences.map(p => p.tag);
            tagList.forEach(t => {
              initialScores[t] = 5;
            });
            setManualTagsState(initialScores);
            setManualDevTagsState([]);
            setShowManualGen(true);
          }}
          disabled={isGenerating}
          className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 text-white font-bold p-3.5 rounded-xl shadow-lg shadow-purple-500/20 hover:scale-[1.01] hover:shadow-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> Generate AIC from Manually Selected Tags
        </button>
        <p className="text-[10px] text-gray-400 mt-1">✔️ Safe to change tabs / chat. Builds your custom character in the background.</p>
      </div>

      {/* 2. SYSTEM TEMPLATES */}
      <div className="bg-gray-50 dark:bg-gray-800/50 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-1.5">
          📝 Generation Prompt & Templates
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Character-Generation Base Prompt</label>
            <p className="text-[10px] text-gray-400 mb-1.5">Supports: <code>{"{gender}"}</code>, <code>{"{looking_for}"}</code>, <code>{"{tags_specification}"}</code>, <code>{"{block_template}"}</code></p>
            <textarea 
              rows={12}
              value={settings.aic_gen_base_prompt || ""}
              onChange={e => setSettings({ ...settings, aic_gen_base_prompt: e.target.value })}
              placeholder="System prompt for generating characters..."
              className="w-full p-3 text-xs font-mono rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Block-Based Template</label>
            <p className="text-[10px] text-gray-400 mb-1.5">Define your custom blocks or private persona structure here (available as <code>{"{block_template}"}</code> inside base prompt).</p>
            <textarea 
              rows={8}
              value={settings.aic_gen_block_template || ""}
              onChange={e => setSettings({ ...settings, aic_gen_block_template: e.target.value })}
              placeholder="Custom block-based templates..."
              className="w-full p-3 text-xs font-mono rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
            />
          </div>

          <div>
            <details className="group border border-gray-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800/30">
              <summary className="font-bold text-xs text-pink-500 cursor-pointer list-none flex justify-between items-center select-none py-1">
                <span>📛 AI Character Name Generation Prompts (Names Section)</span>
                <span className="transition-transform group-open:rotate-180 text-xs text-pink-500">▼</span>
              </summary>
              <div className="space-y-3 mt-3">
                <p className="text-[10px] text-gray-400">
                  Custom instructions for generating high-quality display names based on persona traits. Supports: <code>{"{private_persona}"}</code>, <code>{"{tags_specification}"}</code>, <code>{"{taken_names}"}</code>.
                </p>
                <textarea 
                  rows={8}
                  value={settings.prompt_name_generation || ""}
                  onChange={e => setSettings({ ...settings, prompt_name_generation: e.target.value })}
                  placeholder="Custom name generation instructions..."
                  className="w-full p-3 text-xs font-mono rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-750"
                />
              </div>
            </details>
          </div>
        </div>

        <button 
          onClick={handleLocalSaveSettings}
          disabled={isSaving}
          className="bg-black dark:bg-white text-white dark:text-black font-bold px-5 py-2.5 rounded-xl text-xs transition disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Templates"}
        </button>
      </div>

      {/* 3. SPOILER-PROTECTED ANALYTICS */}
      <details className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        <summary className="font-bold text-gray-800 dark:text-white p-4 cursor-pointer focus:outline-none flex justify-between items-center bg-gray-50 dark:bg-gray-800/40 select-none">
          <span>👁️ Spoiler: View My Hidden Preferences</span>
          <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-1 rounded-full font-semibold">
            {profileName || "Loading..."} ({interactionCount} interactions analyzed)
          </span>
        </summary>
        <div className="p-4 space-y-4 border-t border-gray-150 dark:border-gray-700">
          <div className="flex justify-between items-center">
            <p className="text-xs text-gray-500">These scores represent how much the recommendation algorithm thinks you prefer each trait based on matches, swipes, and chats.</p>
            <button 
              onClick={loadPreferences}
              className="text-xs text-pink-500 hover:underline flex items-center gap-1 font-semibold"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingPreferences ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          {draftPreferences.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No preferences calculated. Go swipe on some characters in the Feed first!</p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-700">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 dark:bg-gray-700/60 text-gray-500 sticky top-0">
                  <tr className="select-none">
                    <th 
                      onClick={() => requestSort("tag")}
                      className="p-2.5 cursor-pointer hover:bg-gray-150 dark:hover:bg-gray-600 transition"
                      title="Sort by Tag Name"
                    >
                      Tag / Trait {sortConfig?.key === "tag" ? (sortConfig.direction === "ascending" ? " ▲" : " ▼") : ""}
                    </th>
                    <th 
                      onClick={() => requestSort("combinedTarget")}
                      className="p-2.5 text-right font-bold text-pink-500 cursor-pointer hover:bg-gray-150 dark:hover:bg-gray-600 transition"
                      title="Sort by Target Sweet Spot"
                    >
                      Sweet Spot (Target Value) {sortConfig?.key === "combinedTarget" ? (sortConfig.direction === "ascending" ? " ▲" : " ▼") : ""}
                    </th>
                    <th 
                      onClick={() => requestSort("combinedImportance")}
                      className="p-2.5 text-right font-bold text-blue-500 cursor-pointer hover:bg-gray-150 dark:hover:bg-gray-600 transition"
                      title="Sort by Importance"
                    >
                      Importance (Rigidity) {sortConfig?.key === "combinedImportance" ? (sortConfig.direction === "ascending" ? " ▲" : " ▼") : ""}
                    </th>
                    <th 
                      onClick={() => requestSort("combinedConfidence")}
                      className="p-2.5 text-right font-bold text-purple-500 cursor-pointer hover:bg-gray-150 dark:hover:bg-gray-600 transition"
                      title="Sort by Confidence"
                    >
                      Confidence {sortConfig?.key === "combinedConfidence" ? (sortConfig.direction === "ascending" ? " ▲" : " ▼") : ""}
                    </th>
                    <th className="p-2.5 text-right font-bold text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPreferences.map((pref: any) => (
                    <PreferenceRow 
                      key={pref.tag} 
                      pref={pref} 
                      onDraftChange={handleDraftChange} 
                      onCommit={handleCommitChange} 
                      onReset={handleResetOverride} 
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      {/* 4. DANGER ZONE */}
      <div className="bg-red-50/50 dark:bg-red-950/10 p-5 rounded-2xl border border-red-100/60 dark:border-red-900/20 space-y-3">
        <h4 className="font-bold text-sm text-red-500">Danger Zone</h4>
        <p className="text-xs text-gray-500">Reset the dynamic recommendation engine learning matrix back to a blank slate for your active profile.</p>
        <button 
          onClick={handleResetPreferences}
          disabled={isResetting}
          className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-xl text-xs disabled:opacity-50 transition"
        >
          {isResetting ? "Resetting..." : "Reset Learning Matrix"}
        </button>
      </div>

      {showManualGen && (
        <ManualAicGenModal 
          tags={draftPreferences.filter((p: any) => p.isActiveTag && isTagVisibleForGender(p.tag, parseTagVisibility(settings?.tags_gender_visibility), gender)).map((p: any) => p.tag)} 
          onClose={() => setShowManualGen(false)}
          isGenerating={isGenerating}
          onGenerate={async (scores: any, devTags: any) => {
            await handleGenerateManual(gender, lookingFor, scores, devTags, () => {
              setShowManualGen(false);
              loadPreferences();
            });
          }}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------
// AIC Manager Tab Component
// Manages the characters list, displays statistics, edits character personas,
// and supports single-character intelligent portrait repicking via Vision AI.
// --------------------------------------------------------
function AicManagerTab({
  activeProfile,
  addTask,
  removeTask,
  updateTaskProgress,
  settings,
  setSettings,
  isSaving: isSettingsSaving,
  saveSettings,
  loadSettings,
  isGenerating,
  handleGenerate,
  handleGenerateManual
}: any) {
  const [characters, setCharacters] = useState<any[]>([]);
  const [editingChar, setEditingChar] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRepicking, setIsRepicking] = useState(false);
  const [preferences, setPreferences] = useState<any[]>([]);

  useEffect(() => {
    loadCharacters();
    loadPreferences();
  }, [activeProfile]);

  // Fetch the active profile's preferences for tags (Feature #3)
  const loadPreferences = async () => {
    const prefData = await safeFetch("/api/profiles/preferences");
    if (prefData.success && prefData.preferences) {
      setPreferences(prefData.preferences);
    }
  };

  // Fetch the full list of characters from the SQLite database
  const loadCharacters = async () => {
    const url = activeProfile?.id ? `/api/characters?profileId=${activeProfile.id}` : "/api/characters";
    const charData = await safeFetch(url);
    if (charData.success && charData.characters) {
      setCharacters(charData.characters);
    }
  };

  // Write changes both to the SQLite database and the physical JSON persona file
  const saveCharacter = async () => {
    setIsSaving(true);
    const data = await safeFetch("/api/characters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingChar)
    });
    setIsSaving(false);
    if (data.success) {
      showToast("Character persona successfully written to JSON file and updated in DB!");
      setEditingChar(null);
      loadCharacters();
    } else {
      showToast("Failed to save character: " + data.error);
    }
  };

  // Run the Vision LLM-driven image selector on ONLY this character
  const handleRepickImage = async () => {
    if (!editingChar || !editingChar.id) return;
    setIsRepicking(true);
    
    // Call the portraits assign API targeting only this character
    const res = await safeFetch("/api/portraits/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId: editingChar.id })
    });
    
    setIsRepicking(false);
    if (res.success && res.selected && res.selected.length > 0) {
      const newAvatar = res.selected[0].filepath;
      // Immediately reflect the newly selected photo path on the editing form
      setEditingChar({ ...editingChar, avatar: newAvatar });
      showToast(`Successfully repicked a portrait image matching their persona!\nNew photo: ${newAvatar}`);
      loadCharacters();
    } else {
      showToast("Failed to pick a portrait: " + (res.error || "No available unused processed photos found in the portrait library. Make sure you scanned and processed portraits first under the Editor tab."));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6 bg-white dark:bg-gray-900 font-sans">
      {/* HEADER SECTION */}
      <div className="border-b border-gray-100 dark:border-gray-800 pb-3">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Users className="text-pink-500 w-7 h-7" /> AIC Manager
        </h2>
        <p className="text-sm text-gray-500">Monitor active AI Characters, edit personas, and manage physical JSON templates.</p>
      </div>

      {/* STATISTICS COUNTERS COMPONENT */}
      <AicManagerStats characters={characters} />

      {/* AIC CHARACTER FORM EDITOR & GRID */}
      <div className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 space-y-4">
        {editingChar ? (
          <div className="space-y-4 bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
            <AicEditForm 
              editingChar={editingChar} 
              setEditingChar={setEditingChar} 
              isRepicking={isRepicking} 
              handleRepickImage={handleRepickImage} 
              isSaving={isSaving} 
              saveCharacter={saveCharacter} 
              loadCharacters={loadCharacters} 
              preferences={preferences}
            />
          </div>
        ) : (
          <AicList characters={characters} setEditingChar={setEditingChar} loadCharacters={loadCharacters} activeProfile={activeProfile} />
        )}
      </div>

      {/* AIC GENERATION — rolled in from the former standalone AIC Gen tab;
          renders below everything else in the AIC Manager. */}
      <AicGenerationTab
        addTask={addTask}
        removeTask={removeTask}
        updateTaskProgress={updateTaskProgress}
        settings={settings}
        setSettings={setSettings}
        isSaving={isSettingsSaving}
        saveSettings={saveSettings}
        loadSettings={loadSettings}
        isGenerating={isGenerating}
        handleGenerate={handleGenerate}
        handleGenerateManual={handleGenerateManual}
      />
    </div>
  );
}

// --------------------------------------------------------
// AIC Manager Stats Subcomponent
// Renders active, missing bio, missing image, and missing voice indicators.
// --------------------------------------------------------
function AicManagerStats({ characters }: { characters: any[] }) {
  const activeChars = characters.filter(c => !c.disabled && !c.deleted);
  const totalActiveCount = activeChars.length;
  const missingBioCount = activeChars.filter(c => !c.publicBio || c.publicBio.trim() === "").length;
  const missingImgCount = activeChars.filter(c => !c.avatar || c.avatar.trim() === "").length;
  const missingVoiceCount = activeChars.filter(c => !c.voiceId || c.voiceId.trim() === "").length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="p-3 bg-pink-50 dark:bg-pink-950/20 border border-pink-100 dark:border-pink-900/40 rounded-xl text-center shadow-sm">
        <p className="text-xs text-pink-600 dark:text-pink-400 font-bold uppercase tracking-wider">Active AICs</p>
        <p className="text-2xl font-extrabold text-pink-700 dark:text-pink-300 mt-1">{totalActiveCount}</p>
      </div>
      <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-center shadow-sm">
        <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">Missing Bio</p>
        <p className="text-2xl font-extrabold text-blue-700 dark:text-blue-300 mt-1">{missingBioCount}</p>
      </div>
      <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 rounded-xl text-center shadow-sm">
        <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider">Missing Image</p>
        <p className="text-2xl font-extrabold text-indigo-700 dark:text-indigo-300 mt-1">{missingImgCount}</p>
      </div>
      <div className="p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/40 rounded-xl text-center shadow-sm">
        <p className="text-xs text-purple-600 dark:text-purple-400 font-bold uppercase tracking-wider">Missing Voice</p>
        <p className="text-2xl font-extrabold text-purple-700 dark:text-purple-300 mt-1">{missingVoiceCount}</p>
      </div>
    </div>
  );
}

// --------------------------------------------------------
// AIC List Subcomponent
// Renders the character list grid and triggers editing state.
// --------------------------------------------------------
// Helper to format relative dates (e.g. 10m ago, 2h ago)
function formatRelativeTime(dateString: string) {
  try {
    const now = new Date();
    const then = new Date(dateString);
    const diffMs = now.getTime() - then.getTime();
    if (isNaN(diffMs) || diffMs < 0) return "just now";
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  } catch (e) {
    return "";
  }
}

// --------------------------------------------------------
// AIC List Subcomponent
// Renders the character list grid and triggers editing state.
// --------------------------------------------------------
function AicList({ characters, setEditingChar, loadCharacters, activeProfile }: { characters: any[], setEditingChar: (char: any) => void, loadCharacters: () => void, activeProfile: any }) {
  const normalChars = characters.filter(c => !c.outdated);
  const outdatedChars = characters.filter(c => c.outdated);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // A3: download a portable persona JSON (portrait embedded as a data URL, no
  // chat history) for a single character.
  const exportCharacter = async (c: any) => {
    const res = await safeFetch(`/api/characters/export?characterId=${encodeURIComponent(c.id)}`);
    if (res.success && res.persona) {
      const blob = new Blob([JSON.stringify(res.persona, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${c.name}.persona.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      showToast("Export failed: " + res.error);
    }
  };

  // A3: import a persona JSON. The API reports an ID collision with suggestions;
  // the confirm dialogs let the user overwrite the existing character or import
  // it as a new one instead.
  const handleImportFile = async (e: any) => {
    const file = e.target?.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    let persona: any;
    try {
      persona = JSON.parse(await file.text());
    } catch {
      showToast("Import failed: the selected file is not valid JSON.");
      return;
    }
    if (!persona || typeof persona !== "object" || typeof persona.id !== "string" || typeof persona.name !== "string") {
      showToast("Import failed: this file is not a Hothouse persona file.");
      return;
    }
    if (!await confirmInApp(`Import character "${persona.name}" (ID: ${persona.id})?\n\nTheir persona, bio, tags, and portrait will be added to this app. No chat history is included.`)) return;
    let res = await safeFetch("/api/characters/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona })
    });
    if (res.collision) {
      const suggestionNote = res.nameTaken ? ` and name "${res.suggestedName}"` : "";
      const overwrite = await confirmInApp(
        `A character with ID "${res.existingId}" already exists in this app ("${res.existingName}").\n\n` +
        `OK = OVERWRITE it with the imported persona (its chats and match history are kept).\n` +
        `Cancel = import as a NEW character instead (ID: "${res.suggestedId}"${suggestionNote}).`
      );
      res = await safeFetch("/api/characters/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, resolve: overwrite ? { overwrite: true } : { id: res.suggestedId, name: res.suggestedName } })
      });
    }
    if (res.success) {
      showToast(res.mode === "overwritten"
        ? `Character "${res.name}" was overwritten with the imported persona (chats preserved).`
        : `Character "${res.name}" imported (ID: ${res.id}).`);
      loadCharacters();
    } else {
      showToast("Import failed: " + res.error);
    }
  };

  const renderCharacterCard = (c: any) => {
    const interaction = c.interactions?.[0];
    const isMatched = interaction?.matched && !interaction?.unmatched;
    const totalMessages = interaction?._count?.messages || 0;
    const lastMessageAt = interaction?.messages?.[0]?.createdAt;

    return (
      <div 
        key={c.id} 
        className={`p-3 rounded-xl border flex items-center justify-between shadow-sm transition ${
          c.disabled 
            ? "bg-red-50/50 dark:bg-red-950/10 border-red-200/50 text-red-600 dark:text-red-400" 
            : "bg-gray-50 dark:bg-gray-800 border-gray-150 dark:border-gray-700 hover:border-pink-300 dark:hover:border-pink-900"
        }`}
      >
        <button 
          onClick={() => setEditingChar(c)}
          className="font-semibold text-sm truncate flex-1 text-left flex items-center gap-2.5"
        >
          {hasRenderableAvatar(c.avatar) ? (
            <img 
              src={c.avatar} 
              alt={c.name} 
              className="w-7 h-7 rounded-full object-cover border border-pink-200 dark:border-pink-900 shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-pink-100 dark:bg-pink-950/40 border border-pink-200 dark:border-pink-900 flex items-center justify-center text-pink-500 dark:text-pink-300 font-bold text-xs shrink-0">
              {c.name[0]}
            </div>
          )}
          <span>{c.name}</span>
        </button>

        {/* Match and Message statistics */}
        {activeProfile && (
          <div className="mr-3 flex flex-col items-end text-[10px] space-y-0.5 shrink-0 select-none text-right">
            {isMatched ? (
              <span className="font-extrabold text-pink-600 dark:text-pink-400 flex items-center gap-0.5 bg-pink-100/30 dark:bg-pink-950/20 px-1.5 py-0.5 rounded">
                💖 Matched
              </span>
            ) : (
              <span className="font-bold text-gray-400 dark:text-gray-500 flex items-center gap-0.5 px-1.5 py-0.5">
                💔 No Match
              </span>
            )}
            {totalMessages > 0 ? (
              <span className="text-gray-600 dark:text-gray-300 font-medium">
                💬 {totalMessages} msgs
              </span>
            ) : (
              <span className="text-gray-400 dark:text-gray-500">
                No msgs
              </span>
            )}
            {lastMessageAt && (
              <span className="text-[9px] text-gray-500 dark:text-gray-400" title={new Date(lastMessageAt).toLocaleString()}>
                ⏱️ {formatRelativeTime(lastMessageAt)}
              </span>
            )}
          </div>
        )}
      
        {/* Active & Outdated Quick Toggles */}
      <div className="flex items-center gap-3 shrink-0 bg-white/40 dark:bg-gray-900/40 px-2 py-1 rounded-lg border border-gray-200/40 dark:border-gray-700/40">
        <div className="flex items-center gap-1">
          <input 
            type="checkbox" 
            checked={!c.disabled} 
            onChange={async (e) => {
              const isChecked = e.target.checked;
              const updated = { 
                ...c, 
                disabled: !isChecked,
                // If enabling, also unmark as outdated (since outdated characters are always disabled)
                outdated: isChecked ? false : c.outdated
              };
              const res = await safeFetch("/api/characters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated)
              });
              if (res.success) {
                loadCharacters();
              } else {
                showToast("Failed to toggle character: " + res.error);
              }
            }}
            className="w-4 h-4 cursor-pointer accent-pink-500 rounded"
            title="Toggle Active/Disabled"
          />
          <span className="text-[10px] font-bold uppercase tracking-wider opacity-65">
            {c.disabled ? "Off" : "On"}
          </span>
        </div>
        <div className="flex items-center gap-1 border-l pl-2 border-gray-200 dark:border-gray-700">
          <input 
            type="checkbox" 
            checked={c.outdated || false} 
            onChange={async (e) => {
              const isOutdated = e.target.checked;
              const updated = { 
                ...c, 
                outdated: isOutdated,
                disabled: isOutdated ? true : c.disabled 
              };
              const res = await safeFetch("/api/characters", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updated)
              });
              if (res.success) {
                loadCharacters();
              } else {
                showToast("Failed to toggle outdated status: " + res.error);
              }
            }}
            className="w-4 h-4 cursor-pointer accent-red-500 rounded text-red-500"
            title="Toggle Outdated Status"
          />
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-500 opacity-80">
            Outdated
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            exportCharacter(c);
          }}
          className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 p-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
          title="Export character (portable persona JSON with the portrait embedded — no chat history)"
        >
          ⬇️
        </button>
        {c.outdated && (
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              if (await confirmInApp(`Are you sure you want to PERMANENTLY delete outdated character ${c.name}? This will delete their persona but preserve past chats.`)) {
                const res = await safeFetch(`/api/characters?characterId=${c.id}`, { method: "DELETE" });
                if (res.success) {
                  loadCharacters();
                } else {
                  showToast("Delete failed: " + res.error);
                }
              }
            }}
            className="bg-red-100 hover:bg-red-200 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 p-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
            title="Delete Outdated Character"
          >
            🗑️
          </button>
        )}
      </div>
    </div>
  );
};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button 
          onClick={() => setEditingChar({ id: `new_${Date.now()}`, name: "New Character", gender: "Female", lookingFor: "Everyone", avatar: "", publicBio: "", privatePersona: "", voiceId: "" })}
          className="bg-pink-100 hover:bg-pink-200 text-pink-600 px-4 py-2.5 rounded-xl shadow-sm text-sm font-bold self-start transition dark:bg-pink-950/40 dark:text-pink-300 border border-pink-200 dark:border-pink-900"
        >
          + Create New AIC
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="bg-blue-100 hover:bg-blue-200 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 text-blue-600 dark:text-blue-300 px-4 py-2.5 rounded-xl shadow-sm text-sm font-bold self-start transition border border-blue-200 dark:border-blue-900"
          title="Import a portable persona JSON file (no chat history included)"
        >
          ⬆️ Import AIC
        </button>
        <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
      </div>
      
      {/* Active & Disabled Characters (Non-outdated) */}
      <div>
        <h4 className="font-bold text-xs text-gray-500 uppercase tracking-wider mb-2">Active & Disabled Characters ({normalChars.length})</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 font-sans">
          {normalChars.map(c => renderCharacterCard(c))}
        </div>
      </div>

      {/* Outdated Characters Spoiler */}
      {outdatedChars.length > 0 && (
        <details className="group border border-red-200 dark:border-red-900/40 rounded-xl p-3 bg-red-50/10 dark:bg-red-950/5 mt-4">
          <summary className="font-bold text-sm text-red-600 dark:text-red-400 cursor-pointer list-none flex justify-between items-center select-none py-1">
            <span className="flex items-center gap-1.5">⚠️ Outdated Characters ({outdatedChars.length})</span>
            <span className="transition-transform group-open:rotate-180 text-xs">▼</span>
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 font-sans mt-3">
            {outdatedChars.map(c => renderCharacterCard(c))}
          </div>
        </details>
      )}
    </div>
  );
}

// --------------------------------------------------------
// AIC Edit Form Subcomponent
// --------------------------------------------------------
function AicEditForm({ editingChar, setEditingChar, isRepicking, handleRepickImage, isSaving, saveCharacter, loadCharacters, preferences }: any) {
  return (
    <>
      <h4 className="font-bold text-base border-b dark:border-gray-600 pb-2">Editing: {editingChar.name}</h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Character Name</label>
          <input type="text" value={editingChar.name} onChange={e => setEditingChar({...editingChar, name: e.target.value})} className="w-full p-2 rounded border dark:border-gray-600 bg-white dark:bg-gray-800"/>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Gender</label>
          <select value={editingChar.gender || "Female"} onChange={e => setEditingChar({...editingChar, gender: e.target.value})} className="w-full p-2 rounded border dark:border-gray-600 bg-white dark:bg-gray-800">
            <option>Female</option><option>Male</option><option>Non-binary</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Looking For</label>
          <select value={editingChar.lookingFor || "Everyone"} onChange={e => setEditingChar({...editingChar, lookingFor: e.target.value})} className="w-full p-2 rounded border dark:border-gray-600 bg-white dark:bg-gray-800">
            <option>Female</option><option>Male</option><option>Everyone</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500 mb-1">Public Bio (Visible on Feed)</label>
        <textarea rows={3} value={editingChar.publicBio} onChange={e => setEditingChar({...editingChar, publicBio: e.target.value})} className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800"/>
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500 mb-1">Private Persona (Hidden context for LLM)</label>
        <textarea rows={4} value={editingChar.privatePersona} onChange={e => setEditingChar({...editingChar, privatePersona: e.target.value})} className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800"/>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-sans">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Voice ID (TTS — matches the active TTS provider)</label>
          <input type="text" value={editingChar.voiceId} onChange={e => setEditingChar({...editingChar, voiceId: e.target.value})} className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800"/>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Developed Tags / Gen Traits (Comma-separated, supports any size)</label>
          <input 
            type="text" 
            value={(() => {
              if (!editingChar.developedTags) return "";
              try {
                const parsed = typeof editingChar.developedTags === "string" 
                  ? JSON.parse(editingChar.developedTags) 
                  : editingChar.developedTags;
                return Array.isArray(parsed) ? parsed.join(", ") : String(editingChar.developedTags);
              } catch(e) {
                return String(editingChar.developedTags);
              }
            })()} 
            onChange={e => {
              const arr = e.target.value.split(",").map(t => t.trim()).filter(t => t.length > 0);
              setEditingChar({...editingChar, developedTags: JSON.stringify(arr)});
            }} 
            placeholder="e.g. friendly, nerdy, adventurous" 
            className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-pink-400 font-semibold"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 font-sans">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Delay Chance (e.g. 0.02 = 2%)</label>
          <input type="number" step="0.001" min="0" max="1" value={editingChar.delayChance ?? 0.02} onChange={e => setEditingChar({...editingChar, delayChance: parseFloat(e.target.value) || 0})} className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800"/>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Follow-up Reply Chance (0.05-0.95)</label>
          <input type="number" step="0.01" min="0.05" max="0.95" value={editingChar.userFollowUpResponseChance ?? 0.5} onChange={e => setEditingChar({...editingChar, userFollowUpResponseChance: parseFloat(e.target.value) || 0.5})} className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800" title="The chance that the AIC replies immediately to user follow-up messages while delayed"/>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Max Consecutive Messages (1-8)</label>
          <input type="number" min="1" max="8" value={editingChar.maxConsecutiveMessages ?? 3} onChange={e => setEditingChar({...editingChar, maxConsecutiveMessages: parseInt(e.target.value) || 3})} className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800"/>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Async Message Weight (1-5)</label>
          <input type="number" min="1" max="5" value={editingChar.asyncMessageWeight ?? 3} onChange={e => setEditingChar({...editingChar, asyncMessageWeight: parseInt(e.target.value) || 3})} className="w-full p-2 text-sm rounded border dark:border-gray-600 bg-white dark:bg-gray-800"/>
        </div>
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-500 mb-1">Avatar Image</label>
        <div className="flex flex-col sm:flex-row gap-2 items-center bg-white dark:bg-gray-800 p-2 rounded border dark:border-gray-700">
          <div className="flex-1 w-full">
            <ImageUploader currentUrl={editingChar.avatar} onUpload={(url) => setEditingChar({...editingChar, avatar: url})}/>
          </div>
          {editingChar.id && !editingChar.id.startsWith("new_") && (
            <button type="button" onClick={handleRepickImage} disabled={isRepicking} className="shrink-0 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 font-semibold px-3 py-2 rounded-xl border border-indigo-200 dark:border-indigo-900 transition flex items-center gap-1 text-xs disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${isRepicking ? "animate-spin" : ""}`} />
              {isRepicking ? "Repicking..." : "Repick Image"}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 py-1 font-sans">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="char-disabled" checked={editingChar.disabled || false} onChange={e => setEditingChar({...editingChar, disabled: e.target.checked})} className="w-4 h-4 accent-pink-500 rounded cursor-pointer"/>
          <label htmlFor="char-disabled" className="text-xs font-bold cursor-pointer select-none">Disable Character (Hide from Feed)</label>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="char-outdated" checked={editingChar.outdated || false} onChange={e => {
            const nextOutdated = e.target.checked;
            setEditingChar({
              ...editingChar,
              outdated: nextOutdated,
              // If marking outdated, also disable it automatically
              disabled: nextOutdated ? true : editingChar.disabled
            });
          }} className="w-4 h-4 accent-pink-500 rounded cursor-pointer"/>
          <label htmlFor="char-outdated" className="text-xs font-bold cursor-pointer select-none text-red-500">Mark as Outdated (Move to Outdated Section)</label>
        </div>
      </div>

      {editingChar.id && !editingChar.id.startsWith("new_") && (
        <div className="border-t border-gray-200 dark:border-gray-600 pt-2 space-y-2">
          <h5 className="font-bold text-xs text-pink-500 flex items-center gap-1">
            <Tag className="w-3.5 h-3.5" /> Self-Reported Tags & Traits (1-10)
          </h5>
          <AicTagsView editingChar={editingChar} setEditingChar={setEditingChar} preferences={preferences || []} />
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-600 flex-wrap text-sm">
        <button onClick={saveCharacter} disabled={isSaving} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded font-bold">{isSaving ? "Saving..." : "Save to File"}</button>
        {editingChar.id && !editingChar.id.startsWith("new_") && (
          <button type="button" onClick={async () => {
            if (await confirmInApp(`Are you sure you want to PERMANENTLY delete ${editingChar.name}?`)) {
              const res = await safeFetch(`/api/characters?characterId=${editingChar.id}`, { method: "DELETE" });
              if (res.success) {
                showToast(`Successfully deleted ${editingChar.name}.`);
                setEditingChar(null);
                loadCharacters();
              } else { showToast("Delete failed: " + res.error); }
            }
          }} className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded font-bold">Delete Character</button>
        )}
        <button onClick={() => setEditingChar(null)} className="bg-gray-400 hover:bg-gray-500 text-white px-3 py-1 rounded font-bold">Cancel</button>
      </div>
    </>
  );
}

// --------------------------------------------------------
// AIC Tags View Subcomponent
// Renders the searchable and editable view of character self-reported tags (Feature #2)
// --------------------------------------------------------
function AicTagsView({ editingChar, setEditingChar, preferences }: { editingChar: any; setEditingChar: (char: any) => void; preferences: any[] }) {
  const [search, setSearch] = useState("");

  if (!editingChar.tags || editingChar.tags === "{}") {
    return <p className="text-xs text-gray-500 italic">No tags generated for this character yet.</p>;
  }

  try {
    const parsed = typeof editingChar.tags === "string" ? JSON.parse(editingChar.tags) : editingChar.tags;
    
    // Safely parse developedTags (Feature #3)
    let developedTagsArray: string[] = [];
    if (editingChar.developedTags) {
      try {
        developedTagsArray = typeof editingChar.developedTags === "string" 
          ? JSON.parse(editingChar.developedTags) 
          : editingChar.developedTags;
      } catch (e) {
        if (typeof editingChar.developedTags === "string") {
          developedTagsArray = editingChar.developedTags.split(",").map((s: string) => s.trim());
        }
      }
    }
    if (!Array.isArray(developedTagsArray)) {
      developedTagsArray = [];
    }

    // Filter tags by search query
    const filteredTags = Object.entries(parsed).filter(([tag]) =>
      tag.toLowerCase().includes(search.toLowerCase())
    );

    return (
      <div className="space-y-2">
        {/* Search Input */}
        <input
          type="text"
          placeholder="🔍 Search tags (e.g. 'nerdy', 'sarcastic')..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full p-2 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
        />

        <div className="bg-white dark:bg-gray-800 p-1 rounded-xl border border-gray-200 dark:border-gray-700 max-h-60 overflow-y-auto font-sans shadow-inner">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-gray-50 dark:bg-gray-700/60 text-gray-500 sticky top-0">
              <tr className="border-b dark:border-gray-700">
                <th className="p-2 font-bold text-gray-500 dark:text-gray-400">Tag / Trait</th>
                <th className="p-2 font-bold text-gray-500 dark:text-gray-400 text-center">Gen Origin</th>
                <th className="p-2 font-bold text-pink-500 text-right" title="Your dynamic target sweet spot score based on swipes">Your Sweet Spot</th>
                <th className="p-2 font-bold text-purple-500 text-right pr-4">AIC Score (1-10)</th>
              </tr>
            </thead>
            <tbody>
              {filteredTags.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-gray-400 italic">No matching tags found</td>
                </tr>
              ) : (
                filteredTags
                  .sort((a: any, b: any) => {
                    // Prioritize tags used in generation first, then sort by character score desc
                    const aUsed = developedTagsArray.includes(a[0]);
                    const bUsed = developedTagsArray.includes(b[0]);
                    if (aUsed && !bUsed) return -1;
                    if (!aUsed && bUsed) return 1;
                    return (b[1] as number) - (a[1] as number);
                  })
                  .map(([tag, score]: any) => {
                    const isUsedInGen = developedTagsArray.includes(tag);
                    const pref = preferences.find(p => p.tag === tag);
                    const prefScore = pref ? pref.combinedTarget : "-";

                    return (
                      <tr 
                        key={tag} 
                        className={`border-b border-gray-100 dark:border-gray-800/40 hover:bg-pink-50/20 dark:hover:bg-pink-950/5 transition-all ${
                          isUsedInGen ? "bg-amber-50/10 dark:bg-amber-950/5" : ""
                        }`}
                      >
                        <td className="p-2 font-semibold text-gray-800 dark:text-gray-200">{tag}</td>
                        <td className="p-2 text-center">
                          {isUsedInGen ? (
                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/50 dark:border-amber-900/30">
                              ✨ Used in Gen
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[10px]">-</span>
                          )}
                        </td>
                        <td className="p-2 text-right font-extrabold text-pink-500">{prefScore}</td>
                        <td className="p-2 text-right pr-3">
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={score}
                            onChange={(e) => {
                              const newScore = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                              const updatedTags = { ...parsed, [tag]: newScore };
                              setEditingChar({ ...editingChar, tags: JSON.stringify(updatedTags) });
                            }}
                            className="w-12 p-1 text-center rounded border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-purple-600 dark:text-purple-400 font-extrabold focus:outline-none focus:ring-1 focus:ring-purple-400 text-xs"
                          />
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  } catch(e) {
    return <p className="text-red-500 text-xs py-1">Error reading tags</p>;
  }
}


// --------------------------------------------------------
// Preference Row Subcomponent
// Renders an individual preference row in the hidden preferences table. (Feature #2)
// --------------------------------------------------------
function PreferenceRow({ pref, onDraftChange, onCommit, onReset }: any) {
  return (
    <tr className={`border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
      pref.isOverridden ? "bg-pink-50/20 dark:bg-pink-950/10" : ""
    } ${!pref.isActiveTag ? "opacity-60 dark:opacity-50 bg-gray-50/40 dark:bg-gray-900/10" : ""}`}>
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
          type="number" 
          step="0.1" 
          min="1" 
          max="10" 
          value={pref.combinedTarget} 
          onChange={(e) => onDraftChange(pref.tag, "combinedTarget", e.target.value)}
          onBlur={(e) => onCommit(pref.tag, "combinedTarget", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onCommit(pref.tag, "combinedTarget", (e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-16 bg-gray-100 dark:bg-gray-700 p-1 text-center rounded text-xs font-bold text-pink-600 dark:text-pink-400 focus:outline-none focus:ring-1 focus:ring-pink-400"
        />
      </td>
      <td className="p-2.5 text-right whitespace-nowrap">
        <input 
          type="number" 
          step="0.05" 
          min="0" 
          max="1" 
          value={pref.combinedImportance} 
          onChange={(e) => onDraftChange(pref.tag, "combinedImportance", e.target.value)}
          onBlur={(e) => onCommit(pref.tag, "combinedImportance", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onCommit(pref.tag, "combinedImportance", (e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-16 bg-gray-100 dark:bg-gray-700 p-1 text-center rounded text-xs font-bold text-blue-600 dark:text-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </td>
      <td className="p-2.5 text-right whitespace-nowrap">
        <input 
          type="number" 
          step="0.05" 
          min="0" 
          max="1" 
          value={pref.combinedConfidence} 
          onChange={(e) => onDraftChange(pref.tag, "combinedConfidence", e.target.value)}
          onBlur={(e) => onCommit(pref.tag, "combinedConfidence", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onCommit(pref.tag, "combinedConfidence", (e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-16 bg-gray-100 dark:bg-gray-700 p-1 text-center rounded text-xs font-bold text-purple-600 dark:text-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
        />
      </td>
      <td className="p-2.5 text-right whitespace-nowrap">
        {pref.isOverridden && (
          <button 
            type="button"
            onClick={() => onReset(pref.tag)}
            className="text-red-500 hover:text-red-600 text-[10px] font-bold border border-red-200 dark:border-red-900 rounded px-1.5 py-0.5 bg-red-50/50 dark:bg-red-950/20 animate-fade-in"
            title="Reset Override"
          >
            Reset
          </button>
        )}
      </td>
    </tr>
  );
}


// --------------------------------------------------------
// Manual AIC Generation Popup Modal (Feature #4)
// --------------------------------------------------------
export function ManualAicGenModal({ tags, onClose, onGenerate, isGenerating }: any) {
  const [q, setQ] = useState("");
  const [sc, setSc] = useState<any>(() => {
    let s: any = {};
    tags.forEach((t: any) => { s[t] = 5; });
    return s;
  });
  const [dev, setDev] = useState<string[]>([]);
  
  const fil = tags.filter((t: any) => t.toLowerCase().includes(q.toLowerCase()));
  const toggle = (tag: any) => setDev(p => p.includes(tag) ? p.filter(t => t !== tag) : [...p, tag]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto font-sans">
      <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col gap-4 relative border border-gray-150 dark:border-gray-800 shadow-2xl">
        <button onClick={onClose} className="absolute top-4 right-4 z-10 w-8 h-8 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-full flex items-center justify-center text-xs cursor-pointer">✕</button>
        <div>
          <h3 className="text-xl font-extrabold text-pink-600">🛠️ Generate Character from Manual Tags</h3>
          <p className="text-xs text-gray-500 mt-1">Manually enter scores and check which tags should be marked as developed (used to form character persona).</p>
        </div>
        <input type="text" placeholder="🔍 Search tags..." value={q} onChange={e => setQ(e.target.value)} className="w-full p-2 text-xs rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"/>
        
        <div className="flex-1 overflow-y-auto border rounded-2xl bg-white dark:bg-gray-800 max-h-96">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 text-gray-500">
              <tr className="border-b dark:border-gray-600">
                <th className="p-2.5 font-bold text-center w-16">Use in Gen</th>
                <th className="p-2.5 font-bold">Tag / Trait</th>
                <th className="p-2.5 font-bold text-right pr-6 w-28">Score (1-10)</th>
              </tr>
            </thead>
            <tbody>
              {fil.length === 0 ? (
                <tr><td colSpan={3} className="p-6 text-center text-gray-400">No matching tags</td></tr>
              ) : (
                fil.map((tag: any) => {
                  const hasD = dev.includes(tag);
                  return (
                    <tr key={tag} className={`border-b dark:border-gray-800/40 hover:bg-pink-50/10 dark:hover:bg-pink-950/5 transition-colors ${hasD ? "bg-pink-50/10 dark:bg-pink-950/5" : ""}`}>
                      <td className="p-2 text-center">
                        <input type="checkbox" checked={hasD} onChange={() => toggle(tag)} className="w-4 h-4 cursor-pointer accent-pink-500 rounded"/>
                      </td>
                      <td className="p-2 font-semibold cursor-pointer select-none" onClick={() => toggle(tag)}>{tag}</td>
                      <td className="p-2 text-right pr-4">
                        <input 
                          id={`manual-tag-${tag}`} type="number" min="1" max="10" value={sc[tag] || 5}
                          onChange={e => setSc({ ...sc, [tag]: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
                          onKeyDown={e => {
                            if (e.key === "ArrowUp") {
                              e.preventDefault(); // Prevents values shifting on up/down arrows!
                              const idx = fil.indexOf(tag);
                              if (idx > 0) document.getElementById(`manual-tag-${fil[idx - 1]}`)?.focus();
                            } else if (e.key === "ArrowDown") {
                              e.preventDefault(); // Prevents values shifting on up/down arrows!
                              const idx = fil.indexOf(tag);
                              if (idx < fil.length - 1) document.getElementById(`manual-tag-${fil[idx + 1]}`)?.focus();
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                            }
                          }}
                          className="w-14 p-1 text-center font-extrabold text-pink-500 rounded border bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-700"
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center gap-4 border-t dark:border-gray-700 pt-4">
          <div className="text-xs font-bold text-gray-500">Selected: <span className="text-pink-500 font-extrabold">{dev.length}</span> (Recommended: 15-25)</div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-xl font-bold">Cancel</button>
            <button type="button" onClick={() => onGenerate(sc, dev)} disabled={isGenerating || dev.length === 0} className="px-5 py-2 text-xs bg-pink-500 hover:bg-pink-600 text-white rounded-xl font-bold flex items-center gap-1 disabled:opacity-50">Generate Custom AIC</button>
          </div>
        </div>
      </div>
    </div>
  );
}

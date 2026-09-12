"use client";

// =========================================================
// IN-APP NOTIFICATIONS (Roadmap C1)
// ---------------------------------------------------------
// Replaces blocking browser alert()/confirm() dialogs with in-app UI:
//   showToast(message, opts?)        → toast card in the bottom-right stack
//   confirmInApp(message, opts?)     → Promise<boolean> confirmation modal
//   <NotifyHost />                   → rendered once in the app root
//
// Toasts reuse the styling of the existing push-style slide-in card
// (match-delay / async-message notifications); confirms reuse the app's modal
// styling. Auto-type detection: messages mentioning failures/errors show as
// error toasts; destructive-worded confirmations get a red confirm button.
// =========================================================

import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type ToastType = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ConfirmRequest {
  id: number;
  message: string;
  title?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

type NotifyEvent =
  | { kind: "toast"; message: string; type: ToastType; duration: number }
  | { kind: "confirm"; request: Omit<ConfirmRequest, "id"> };

// Module-level event bus: any client component can raise toasts/confirms
// without prop drilling. The single <NotifyHost /> subscribes.
const listeners = new Set<(event: NotifyEvent) => void>();
let nextId = 1;

function emit(event: NotifyEvent) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // A broken listener must never break the caller's flow.
    }
  });
}

function detectToastType(message: string): ToastType {
  return /\b(fail|failed|failure|error|unable|invalid|not found|wrong)\b/i.test(message) ? "error" : "info";
}

// Non-blocking toast. Click to dismiss; auto-dismisses after `duration` ms.
export function showToast(message: string, opts?: { type?: ToastType; duration?: number }) {
  emit({
    kind: "toast",
    message,
    type: opts?.type ?? detectToastType(message),
    duration: opts?.duration ?? 5000,
  });
}

// In-app replacement for the blocking window.confirm(). Resolves true/false.
export function confirmInApp(
  message: string,
  opts?: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
): Promise<boolean> {
  return new Promise((resolve) => {
    const danger =
      opts?.danger ??
      /\b(delete|delet\w*|wipe|reset|permanent|permanently|cannot be undone|unmatch)\b/i.test(message);
    emit({
      kind: "confirm",
      request: {
        message,
        title: opts?.title,
        confirmLabel: opts?.confirmLabel ?? "OK",
        cancelLabel: opts?.cancelLabel ?? "Cancel",
        danger,
        resolve,
      },
    });
  });
}

const TOAST_STYLES: Record<ToastType, { label: string; labelClass: string; borderClass: string }> = {
  info: { label: "Notice", labelClass: "text-pink-500", borderClass: "border-pink-100 dark:border-pink-900/50" },
  success: { label: "Success", labelClass: "text-green-600 dark:text-green-400", borderClass: "border-green-200 dark:border-green-900/50" },
  error: { label: "Error", labelClass: "text-red-500", borderClass: "border-red-200 dark:border-red-900/50" },
};

// Renders the toast stack and the confirmation modal. Mount ONCE in the root
// layout container (absolute positioning, like the push notification).
export function NotifyHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    const listener = (event: NotifyEvent) => {
      if (event.kind === "toast") {
        const id = nextId++;
        setToasts((prev) => [...prev, { id, message: event.message, type: event.type }].slice(-5));
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, event.duration);
      } else {
        setConfirmRequest({ ...event.request, id: nextId++ });
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const resolveConfirm = useCallback((ok: boolean) => {
    setConfirmRequest((current) => {
      if (current) current.resolve(ok);
      return null;
    });
  }, []);

  // Esc = cancel, Enter = confirm (unless the user is typing in a field).
  useEffect(() => {
    if (!confirmRequest) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        resolveConfirm(false);
      } else if (ev.key === "Enter") {
        const target = ev.target as HTMLElement | null;
        const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (!typing) {
          ev.preventDefault();
          resolveConfirm(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmRequest, resolveConfirm]);

  return (
    <>
      {/* Toast stack (bottom-right, above the bottom navigation) */}
      <div className="absolute bottom-20 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100%-2rem)] pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            const style = TOAST_STYLES[toast.type];
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 30, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className={`pointer-events-auto cursor-pointer w-full bg-white/95 dark:bg-gray-800/95 backdrop-blur border ${style.borderClass} p-3 rounded-xl shadow-lg`}
              >
                <p className={`text-[10px] font-bold uppercase tracking-wider ${style.labelClass}`}>{style.label}</p>
                <p className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-line mt-0.5">{toast.message}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Confirmation modal (in-app replacement for window.confirm) */}
      <AnimatePresence>
        {confirmRequest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => resolveConfirm(false)}
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl max-w-md w-full p-5 space-y-4"
            >
              {confirmRequest.title && (
                <h4 className="font-bold text-sm text-gray-900 dark:text-white">{confirmRequest.title}</h4>
              )}
              <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{confirmRequest.message}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => resolveConfirm(false)}
                  className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg font-bold transition text-sm"
                >
                  {confirmRequest.cancelLabel}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => resolveConfirm(true)}
                  className={`text-white px-4 py-2 rounded-lg font-bold transition text-sm ${
                    confirmRequest.danger ? "bg-red-600 hover:bg-red-700" : "bg-pink-600 hover:bg-pink-700"
                  }`}
                >
                  {confirmRequest.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}


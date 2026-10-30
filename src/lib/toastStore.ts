import { useSyncExternalStore } from 'react';

// The toast, kept outside the app state on purpose: a toast can fire after
// nearly any action, and as app state each one redrew the whole open screen
// twice (once to show, once to hide). Only the toast layer listens here, so
// showing one redraws just the toast.

export type ToastKind = 'note' | 'error';

export type ToastAction = { label: string; onPress: () => void };

export type ToastOptions = {
  /** Defaults to 'error' for messages that read as a failure, else 'note'. */
  kind?: ToastKind;
  /** One button on the card, e.g. Undo. Gives the toast a little longer. */
  action?: ToastAction;
};

export type ToastState = {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  /** How long it stays, in ms (a held finger pauses it). */
  ms: number;
};

let current: ToastState | null = null;
let nextId = 1;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let remaining = 0;
let startedAt = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/** Failures read differently from confirmations, so mark them without every caller saying so. */
const FAILURE = /^(couldn['’]t|could not|can['’]t|failed|search failed|saving a recording needs|you can only|you don['’]t have access)/i;

/**
 * Long enough to read: a floor, plus time per character. A toast with a button
 * gets a longer floor so there is time to reach it.
 */
export function toastDuration(message: string, hasAction: boolean): number {
  const ms = 2500 + message.length * 55;
  return Math.min(10000, Math.max(hasAction ? 6000 : 3000, ms));
}

function armTimer(ms: number) {
  if (hideTimer) clearTimeout(hideTimer);
  remaining = ms;
  startedAt = Date.now();
  hideTimer = setTimeout(dismissToast, ms);
}

/**
 * Shows `msg`. A newer toast replaces an older one and cancels its timer, so
 * an earlier toast's timeout never hides a newer message early (very visible
 * during multi-verse practice).
 */
export function showToast(msg: string, opts?: ToastOptions) {
  const kind = opts?.kind ?? (FAILURE.test(msg) ? 'error' : 'note');
  const ms = toastDuration(msg, !!opts?.action);
  current = { id: nextId++, message: msg, kind, action: opts?.action, ms };
  emit();
  armTimer(ms);
}

export function dismissToast() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
  if (!current) return;
  current = null;
  emit();
}

/** A finger is down on the toast: stop the clock so it can be read or reached. */
export function pauseToast() {
  if (!hideTimer) return;
  clearTimeout(hideTimer);
  hideTimer = null;
  remaining = Math.max(1500, remaining - (Date.now() - startedAt));
}

export function resumeToast() {
  if (!current || hideTimer) return;
  armTimer(remaining);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getCurrent = () => current;

/** The toast showing right now, or null. */
export const useToast = () => useSyncExternalStore(subscribe, getCurrent, getCurrent);

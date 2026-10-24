import { useSyncExternalStore } from 'react';

// The toast's message, kept outside the app state on purpose: a toast fires
// after nearly every action ("Saved", "Reordered."), and as app state each one
// redrew the whole open screen twice (once to show, once to hide). Only the
// toast layer listens here, so showing one redraws just the toast.

let message: string | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

/**
 * Shows `msg` for three seconds. A newer toast replaces an older one and
 * cancels its timer, so an earlier toast's timeout never hides a newer message
 * early (very visible during multi-verse practice).
 */
export function showToast(msg: string) {
  if (hideTimer) clearTimeout(hideTimer);
  message = msg;
  emit();
  hideTimer = setTimeout(() => {
    message = null;
    hideTimer = null;
    emit();
  }, 3000);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getMessage = () => message;

/** The toast showing right now, or null. */
export const useToastMessage = () => useSyncExternalStore(subscribe, getMessage, getMessage);

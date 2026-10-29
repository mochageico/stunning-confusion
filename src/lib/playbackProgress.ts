import { useSyncExternalStore } from 'react';

// How far through the playing recording we are, 0-100. Kept outside the app
// state on purpose, like the toast: the player reports its position several
// times a second, and as app state every report redrew the whole open screen
// (and re-ran every bit of app-wide math). Only the progress bars listen
// here, so a tick redraws just them.

let progress = 0;
const listeners = new Set<() => void>();

/** Accepts a value or an updater, like a useState setter. */
export function setPlaybackProgress(next: number | ((prev: number) => number)) {
  const value = typeof next === 'function' ? next(progress) : next;
  if (value === progress) return;
  progress = value;
  listeners.forEach((l) => l());
}

export const getPlaybackProgress = () => progress;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The playing recording's progress, 0-100. */
export const usePlaybackProgress = () => useSyncExternalStore(subscribe, getPlaybackProgress, getPlaybackProgress);

import { useSyncExternalStore } from 'react';

// How many seconds the recording in progress has run. Kept outside the app
// state on purpose, like the toast and the playback progress: it ticks once a
// second while recording, and as app state every tick redrew the whole open
// screen. Only the little timer on the Record tab listens here, so a tick
// redraws just that.

let seconds = 0;
const listeners = new Set<() => void>();

/** Accepts a value or an updater, like a useState setter. */
export function setRecordingSeconds(next: number | ((prev: number) => number)) {
  const value = typeof next === 'function' ? next(seconds) : next;
  if (value === seconds) return;
  seconds = value;
  listeners.forEach((l) => l());
}

export const getRecordingSeconds = () => seconds;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Seconds recorded so far; 0 when not recording. */
export const useRecordingSeconds = () => useSyncExternalStore(subscribe, getRecordingSeconds, getRecordingSeconds);

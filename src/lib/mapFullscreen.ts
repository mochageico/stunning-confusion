import { useSyncExternalStore } from 'react';

// Whether the constellation map is showing full screen. Kept outside the app
// state on purpose (like toastStore): the map screen and App.tsx's tab bar both
// need it, and neither should redraw the rest of the app when it flips.

let on = false;
const listeners = new Set<() => void>();

export function setMapFullscreen(next: boolean) {
  if (on === next) return;
  on = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const get = () => on;

/** True while the map has the whole screen (header, view switch and tab bar hidden). */
export const useMapFullscreen = () => useSyncExternalStore(subscribe, get, get);

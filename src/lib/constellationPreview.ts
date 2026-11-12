import { useSyncExternalStore } from 'react';

// ============================================================================
// Which constellation the preview page shows (CONSTELLATION_SKY_PLAN.md, stage
// 2). A one-value store, set by the browse page before it navigates, so the
// choice needs no AppState field. Null means "none picked yet": the preview
// falls back to the first constellation (that is what ?s=constellationPreview
// shows in the demo).
// ============================================================================

let current: string | null = null;
const listeners = new Set<() => void>();

export function openConstellationPreview(id: string): void {
  current = id;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The constellation id the preview page is showing, or null. */
export const usePreviewId = (): string | null => useSyncExternalStore(subscribe, () => current, () => current);

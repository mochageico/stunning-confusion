import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// One-time tips: a short hint shown the first time someone reaches a spot,
// gone for good once they tap "Got it". Which ones have been seen lives on
// the device (AsyncStorage), like practice prefs -- a new phone shows them
// once more, which is harmless.
//
// The point is that no hint stays on screen forever. "Show tips again"
// (resetTips) is the only way back, so nothing is lost by dismissing one.

export type TipId = 'practice' | 'reviewCheck' | 'chapterPage' | 'versesTab' | 'constellationMap';

const TIPS_KEY = 'tips:seen:v1';

// One shared copy, so dismissing a tip (or resetting them all) updates every
// mounted tip at once instead of each re-reading storage.
let seen: Set<TipId> | null = null;
let loading: Promise<void> | null = null;
// While the tour runs it is already explaining things, so tips step aside
// rather than say the same thing twice on one screen.
let paused = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function load(): Promise<void> {
  if (!loading) {
    loading = AsyncStorage.getItem(TIPS_KEY)
      .then((raw) => {
        const parsed = raw ? JSON.parse(raw) : [];
        seen = new Set(Array.isArray(parsed) ? parsed : []);
      })
      .catch(() => {
        // Unreadable: show the tips again rather than never.
        seen = new Set();
      })
      .then(notify);
  }
  return loading;
}

async function save() {
  try {
    await AsyncStorage.setItem(TIPS_KEY, JSON.stringify([...(seen ?? [])]));
  } catch {
    // Not worth interrupting anything over; the tip may just show once more.
  }
}

export async function dismissTip(id: TipId) {
  // Read storage first: the tour can dismiss a tip before any tip has
  // mounted, and saving then would overwrite the ones already seen.
  await load();
  seen!.add(id);
  notify();
  await save();
}

/** The tour turns this on while it's showing. */
export function setTipsPaused(on: boolean) {
  paused = on;
  notify();
}

/** "Show tips again": every tip shows once more, the next time its spot comes up. */
export async function resetTips() {
  seen = new Set();
  loading = Promise.resolve();
  notify();
  await save();
}

/** Whether this tip should show. False until storage has been read, so a seen tip never flashes. */
export function useTipVisible(id: TipId): boolean {
  const [, rerender] = useState(0);
  useEffect(() => {
    const fn = () => rerender((n) => n + 1);
    listeners.add(fn);
    if (!seen) void load();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return !paused && !!seen && !seen.has(id);
}

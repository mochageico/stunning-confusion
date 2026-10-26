import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { setForgiveNearbyKeys, setReviewPassAccuracy } from './recitation';

// ============================================================================
// APP PREFERENCES
// ----------------------------------------------------------------------------
// The newer Settings choices: how strict grading is, how verse text looks,
// sounds, and light or dark. Kept on this device, like the accent color and
// practicePrefs, because they're how someone likes the app to feel, not data
// anyone else sees.
//
// A small store rather than app state, so changing one redraws only the few
// places that read it. App.tsx loads it before the first paint (a dark-mode
// user must never see a flash of light).
// ============================================================================

export type PassMark = 0.8 | 0.9 | 1;
export type VerseFont = 'serif' | 'plain';
export type PracticeTextSize = 'normal' | 'larger' | 'largest';
export type SchemeChoice = 'light' | 'dark' | 'system';

export interface AppPrefs {
  /** The word accuracy a review needs to pass. */
  passMark: PassMark;
  /** A neighboring key counts as the right letter when typing. */
  forgiveNearbyKeys: boolean;
  /** Practice shows "Reference hidden" until tapped, for drilling references too. */
  hideReference: boolean;
  /** A soft tone when a verse is done, a low one on a miss. */
  sounds: boolean;
  /** A light tap on a miss. */
  vibration: boolean;
  /** Verse text in Literata (serif) or Inter (plain). */
  verseFont: VerseFont;
  /** The practice screen's text, on top of the phone's own text size. */
  practiceTextSize: PracticeTextSize;
  colorScheme: SchemeChoice;
  /** Curated constellations hidden from the Map (ids). On this device, like the rest. */
  hiddenConstellations: string[];
}

export const DEFAULT_APP_PREFS: AppPrefs = {
  passMark: 0.9,
  forgiveNearbyKeys: true,
  hideReference: false,
  sounds: false,
  vibration: false,
  verseFont: 'serif',
  practiceTextSize: 'normal',
  colorScheme: 'light',
  hiddenConstellations: [],
};

export const PRACTICE_TEXT_SCALE: Record<PracticeTextSize, number> = { normal: 1, larger: 1.15, largest: 1.3 };

const STORAGE_KEY = 'appPrefs:v1';

let prefs: AppPrefs = DEFAULT_APP_PREFS;
const listeners = new Set<() => void>();

/** Hands the grading choices to recitation.ts, which every grader goes through. */
const apply = (p: AppPrefs) => {
  setReviewPassAccuracy(p.passMark);
  setForgiveNearbyKeys(p.forgiveNearbyKeys);
};

/** Saved values over the defaults; anything unreadable keeps its default. */
const clean = (raw: unknown): AppPrefs => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = <K extends keyof AppPrefs>(key: K, ok: readonly AppPrefs[K][]): AppPrefs[K] =>
    ok.includes(r[key] as AppPrefs[K]) ? (r[key] as AppPrefs[K]) : DEFAULT_APP_PREFS[key];
  return {
    passMark: pick('passMark', [0.8, 0.9, 1]),
    forgiveNearbyKeys: pick('forgiveNearbyKeys', [true, false]),
    hideReference: pick('hideReference', [true, false]),
    sounds: pick('sounds', [true, false]),
    vibration: pick('vibration', [true, false]),
    verseFont: pick('verseFont', ['serif', 'plain']),
    practiceTextSize: pick('practiceTextSize', ['normal', 'larger', 'largest']),
    colorScheme: pick('colorScheme', ['light', 'dark', 'system']),
    hiddenConstellations: Array.isArray(r.hiddenConstellations) ? r.hiddenConstellations.filter((x): x is string => typeof x === 'string') : [],
  };
};

/** Reads the saved choices once, at startup. Never throws. */
export async function loadAppPrefs(): Promise<AppPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    prefs = clean(raw ? JSON.parse(raw) : null);
  } catch {
    prefs = DEFAULT_APP_PREFS;
  }
  apply(prefs);
  listeners.forEach((l) => l());
  return prefs;
}

/** `save: false` changes it for this session only (the demo's ?dark=1). */
export function setAppPref<K extends keyof AppPrefs>(key: K, value: AppPrefs[K], { save = true }: { save?: boolean } = {}) {
  prefs = { ...prefs, [key]: value };
  apply(prefs);
  listeners.forEach((l) => l());
  if (!save) return;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {
    // Not worth interrupting anyone over; the choice just won't outlast a restart.
  });
}

/** The current choices, outside React (sounds, grading). */
export const getAppPrefs = (): AppPrefs => prefs;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The current choices; redraws when one changes. */
export const useAppPrefs = (): AppPrefs => useSyncExternalStore(subscribe, getAppPrefs, getAppPrefs);

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_TRANSLATION_ID, PICKER_TRANSLATIONS } from '../data';

// ============================================================================
// DEVICE PREFERENCES
// ----------------------------------------------------------------------------
// Settings that live on this device only (AsyncStorage, never Firestore):
// your usual translation, Memory Grid highlights, doodles and column count,
// and Studio playback. Split out of useAppState (see
// .claude/file-split-plan.md); useAppState passes these through to AppState
// unchanged.
// ============================================================================

const PREFERRED_TRANSLATION_KEY = 'preferredTranslation:v1';
const HIGHLIGHTED_VERSES_KEY = 'memoryGrid:highlightedVerses:v1';
const VERSE_DOODLES_KEY = 'memoryGrid:doodles:v1';
const MEMORY_GRID_COLUMNS_KEY = 'memoryGrid:columns:v1';
const STUDIO_PLAYBACK_KEY = 'studio:playbackEnabled:v1';

export function useLocalPrefs() {
  // Your usual translation: what the chapter page shows and what Add verses
  // starts on. Picking one in either place changes it for both, and it's
  // remembered on this device (it used to reset to BSB on every launch). Not
  // a per-verse setting -- each queued verse keeps its own translationId.
  const [selectedTranslationId, setSelectedTranslationIdState] = useState<string>(DEFAULT_TRANSLATION_ID);
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(PREFERRED_TRANSLATION_KEY);
        // Only a translation the picker still offers; one since removed
        // falls back to the default.
        if (stored && PICKER_TRANSLATIONS.some((t) => t.id === stored)) setSelectedTranslationIdState(stored);
      } catch {}
    })();
  }, []);
  const setSelectedTranslationId = (id: string) => {
    setSelectedTranslationIdState(id);
    AsyncStorage.setItem(PREFERRED_TRANSLATION_KEY, id).catch(() => {});
  };

  // Memory Grid highlights -- user-chosen "meaningful anchor" verses (starts
  // blank, no auto-coloring pattern). Device-local for now (AsyncStorage, not
  // synced to Firestore) -- same scope as the Recall practice preferences.
  // Keyed by verseAnnotationKey (book_chapter_verse) so the Chapter page,
  // Listen mode, and Recall all read/write the same set.
  const [highlightedVerses, setHighlightedVerses] = useState<Set<string>>(new Set());
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(HIGHLIGHTED_VERSES_KEY);
        if (raw) setHighlightedVerses(new Set(JSON.parse(raw)));
      } catch {
        // Corrupt/missing -- just start blank.
      }
    })();
  }, []);
  const toggleVerseHighlight = (key: string) => {
    setHighlightedVerses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      AsyncStorage.setItem(HIGHLIGHTED_VERSES_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  };

  // Memory Grid doodles -- backbone feature (single-pen freehand strokes per
  // verse box), same device-local storage scope as highlights above. Each
  // value is an array of SVG path "d" strings for that verse.
  const [verseDoodles, setVerseDoodles] = useState<Record<string, string[]>>({});
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(VERSE_DOODLES_KEY);
        if (raw) setVerseDoodles(JSON.parse(raw));
      } catch {
        // Corrupt/missing -- just start blank.
      }
    })();
  }, []);
  const saveVerseDoodle = (key: string, strokes: string[]) => {
    setVerseDoodles((prev) => {
      const next = { ...prev, [key]: strokes };
      AsyncStorage.setItem(VERSE_DOODLES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  // Memory Grid column count -- 2 or 4 (never odd, so boxes tile evenly on a
  // phone width), one shared preference across Chapter page / Listen / Recall.
  const [memoryGridColumns, setMemoryGridColumnsState] = useState<2 | 4>(4);
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(MEMORY_GRID_COLUMNS_KEY);
        if (raw === '2' || raw === '4') setMemoryGridColumnsState(Number(raw) as 2 | 4);
      } catch {
        // Corrupt/missing -- just start at the default.
      }
    })();
  }, []);
  const setMemoryGridColumns = (columns: 2 | 4) => {
    setMemoryGridColumnsState(columns);
    AsyncStorage.setItem(MEMORY_GRID_COLUMNS_KEY, String(columns)).catch(() => {});
  };

  // Studio mode: play the processed render (de-essed, denoised, loudness
  // normalized) instead of the raw take when one exists. On by default —
  // it's strictly better audio, and every lookup falls back to the original.
  // Device-local rather than on the profile doc: it's a listening preference,
  // not something that should follow the account across devices.
  const [studioPlaybackEnabled, setStudioPlaybackEnabledState] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STUDIO_PLAYBACK_KEY);
        if (raw === 'off') setStudioPlaybackEnabledState(false);
      } catch {
        // Corrupt/missing -- just start at the default (on).
      }
    })();
  }, []);
  const setStudioPlaybackEnabled = (enabled: boolean) => {
    setStudioPlaybackEnabledState(enabled);
    AsyncStorage.setItem(STUDIO_PLAYBACK_KEY, enabled ? 'on' : 'off').catch(() => {});
  };

  // Transient A/B override for the Studio/Original switch on the recording
  // detail screen. null == follow the setting above. Deliberately NOT
  // persisted: it exists to compare two versions back to back, and leaking
  // that choice into the next session would be surprising.
  const [studioAbOverride, setStudioAbOverride] = useState<boolean | null>(null);
  const studioPlaybackActive = studioAbOverride ?? studioPlaybackEnabled;

  return {
    selectedTranslationId,
    setSelectedTranslationId,
    highlightedVerses,
    toggleVerseHighlight,
    verseDoodles,
    saveVerseDoodle,
    memoryGridColumns,
    setMemoryGridColumns,
    studioPlaybackEnabled,
    setStudioPlaybackEnabled,
    studioAbOverride,
    setStudioAbOverride,
    studioPlaybackActive,
  };
}

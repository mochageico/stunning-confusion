import React from 'react';
import { Pressable, View } from 'react-native';
import { useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import { VerseState } from '../../types';
import { AppText, useCollapsed, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';

// Small pieces shared by the practice screen's shell and its Listen and
// Recall panels. Split out of PracticeModals.tsx (see .claude/file-split-plan.md).

/** Stable identity, so a missing photoCache prop cannot retrigger renders. */
export const EMPTY_PHOTO_CACHE: ReadonlyMap<string, string> = new Map();

/**
 * The Listen progress bar, and the ONLY thing in this file allowed to
 * subscribe to the playhead.
 *
 * useAudioPlayerStatus is useEvent under the hood: it parks the whole status
 * object -- currentTime included -- in React state, so whichever component
 * calls it re-renders on every status tick. Called up in PracticeModalsInner
 * that meant re-rendering the entire Listen screen, verse list and all, many
 * times a second, purely to move this one bar. The work saturated the JS
 * thread, which delayed the verse-boundary check, which is what made
 * playback drift seconds behind the audio.
 *
 * Isolated down here, a tick re-renders four Views and nothing else.
 */
export const ListenProgress = React.memo(function ListenProgress({
  player,
  startSec,
  endSec,
  verseIndex,
  verseCount,
  repeatsPerVerse,
  verseRepeatsDone,
}: {
  player: AudioPlayer;
  startSec: number | null;
  endSec: number | null;
  verseIndex: number;
  verseCount: number;
  repeatsPerVerse: number;
  verseRepeatsDone: number;
}) {
  const status = useAudioPlayerStatus(player);
  // Position within the current verse's own segment, so the bar advances
  // smoothly between verses instead of jumping a whole verse at a time.
  let segmentFraction = 0;
  if (startSec !== null && endSec !== null) {
    const span = Math.max(0.01, endSec - startSec);
    segmentFraction = Math.max(0, Math.min(1, (status.currentTime - startSec) / span));
  }
  const percent = verseCount > 0 ? ((verseIndex + segmentFraction) / verseCount) * 100 : 0;

  return (
    <View className="gap-1">
      <View className="w-full bg-fill h-1 rounded-full overflow-hidden">
        <View className="bg-accent h-full" style={{ width: `${percent}%` }} />
      </View>
      <AppText variant="micro" numberOfLines={1} className="font-sans font-medium text-ink-3 text-center">
        Verse {verseIndex + 1} of {verseCount}
        {repeatsPerVerse > 1 ? ` · pass ${verseRepeatsDone + 1} of ${repeatsPerVerse}` : ''}
      </AppText>
    </View>
  );
});

/**
 * Listen-mode playback speeds. Discrete stops rather than the old ±0.2
 * stepper: picking one is a single tap instead of up to eight, and every
 * value here is one somebody would actually choose. 0.6/0.8 for learning a
 * hard verse, 1.2 and up for review passes.
 */
export const LISTEN_SPEEDS = [0.6, 0.8, 1.0, 1.2, 1.5, 2.0];
/** Times each verse can repeat before playback moves on. */
export const LISTEN_REPEATS = [1, 2, 3, 4, 5];
/** Recall's words-hidden stops: 0-100% in steps of 5. Only 100 grades. */
export const HIDE_LEVELS = Array.from({ length: 21 }, (_, i) => i * 5).map((n) => ({
  id: n,
  label: n === 100 ? 'All' : `${n}%`,
}));

/**
 * Listen playlists keep each passage in one piece. The memory queue is in
 * due/priority order, so built straight from it a playlist hops between
 * chapters (Isaiah 55, Romans 8, Isaiah 55 again) and a verse being learned
 * plays apart from the verses before it that are under review. Here every
 * chapter's verses are pulled together and played in verse order; chapters
 * keep the order they first appear in, so whatever leads the list (learning,
 * in Today's Verses) still comes first.
 */
export function groupPassages(list: VerseState[]): VerseState[] {
  const groups = new Map<string, VerseState[]>();
  for (const v of list) {
    const key = `${v.translationId ?? ''}|${v.book}|${v.chapter}`;
    const group = groups.get(key);
    if (group) group.push(v);
    else groups.set(key, [v]);
  }
  return [...groups.values()].flatMap((group) => group.sort((a, b) => a.verse - b.verse));
}

// ============================================================
// DrillSetting — one row of the Recall screen's settings card.
// Mid-recall you want the passage, not panels of controls, so
// each row folds down to a single line that still states where
// it stands ("Restart verse after   5 mistakes"); tapping it
// opens the choices in place. Open/closed persists per key
// through the same store CollapsibleCard uses, so someone who
// fiddles with a knob every session keeps it open.
//
// The rows share one card (DrillSettings) and are divided by a
// hairline, the way a grouped settings list is. They used to be
// separate grey strips with grey Courier values, which read as
// disabled controls rather than as settings.
// ============================================================
export function DrillSettings({ children }: { children: React.ReactNode }) {
  return <View className="mt-2.5 bg-surface border border-line rounded-card overflow-hidden">{children}</View>;
}

export function DrillSetting({
  storageKey,
  label,
  value,
  valueClassName = 'text-ink-2',
  first = false,
  children,
}: {
  storageKey: string;
  label: string;
  /** Current setting, shown on the row so a folded row still reads. */
  value: string;
  valueClassName?: string;
  /** The first row in its card draws no divider above it. */
  first?: boolean;
  children: React.ReactNode;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const [collapsed, setCollapsed] = useCollapsed(storageKey, true);
  const Chevron = collapsed ? ChevronDown : ChevronUp;

  return (
    <View
      className={first ? '' : 'border-t border-hairline'}
      style={{ paddingHorizontal: space(12), paddingVertical: space(10), gap: space(8) }}
    >
      <Pressable
        onPress={() => setCollapsed(!collapsed)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        hitSlop={6}
        className="flex-row items-center active:opacity-60"
        style={{ gap: space(8) }}
      >
        <AppText variant="label" className="font-sans font-medium text-ink shrink">
          {label}
        </AppText>
        <AppText variant="label" className={`font-sans flex-1 text-right ${valueClassName}`}>
          {value}
        </AppText>
        <Chevron size={Math.round(space(14))} color={palette.ink3} />
      </Pressable>
      {!collapsed && children}
    </View>
  );
}

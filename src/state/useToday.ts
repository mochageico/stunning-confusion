import { useMemo } from 'react';

import type { AppState } from './useAppState';
import type { QueueItem, VerseState } from '../types';
import { translationLabel } from '../data';
import { getLogicalDate, localDayKey } from '../lib/logicalDate';
import { gradedOnDay } from '../lib/retention';
import { verseStage } from '../lib/stageProgress';

// ============================================================================
// useToday — what is on Today, sorted once and shared by the Today screen and
// the Today's verses page (UI simplify plan, Job 1). Moved out of
// HomeScreen.tsx unchanged, plus `doneTodayGroups` for the page's ticked rows.
// ============================================================================

export interface TodayGroup {
  label: string;
  book: string;
  chapter: number;
  translationId: string;
  items: QueueItem[];
}

export function groupQueueItems(items: QueueItem[]): TodayGroup[] {
  const groups: { [key: string]: QueueItem[] } = {};
  items.forEach((item) => {
    // Translation is part of the group key too -- ESV Ephesians 2 and KJV
    // Ephesians 2 are independent progress (see buildVerseId), so they must
    // render as separate rows, not merged into one mixed-translation group.
    const key = `${item.book} ${item.chapter} ${item.translationId}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return Object.entries(groups).map(([, list]) => {
    const book = list[0].book;
    const chapter = list[0].chapter;
    const translationId = list[0].translationId;
    list.sort((a, b) => a.verseNumber - b.verseNumber);
    const versesStr =
      list.length === 1 ? `${list[0].verseNumber}` : `${list[0].verseNumber}-${list[list.length - 1].verseNumber}`;
    const translationSuffix = translationId && translationId !== 'ESV' ? ` (${translationLabel(translationId)})` : '';
    return { label: `${book} ${chapter}:${versesStr}${translationSuffix}`, book, chapter, translationId, items: list };
  });
}

export function toVerseStates(items: QueueItem[]): VerseState[] {
  return items.map((item) => ({
    book: item.book,
    chapter: item.chapter,
    verse: item.verseNumber,
    text: item.text,
    status: item.status === 'retained' ? 'memorized' : 'learning',
    translationId: item.translationId || 'ESV',
  }));
}

// Due reviews are grouped by where they are on the ladder, in the order
// "review one at a time" chains them.
export const REVIEW_STAGES = [
  { key: 'settling', label: 'Settling', dot: 'bg-stage-daily' },
  { key: 'steady', label: 'Steady', dot: 'bg-stage-weekly' },
  { key: 'kept', label: 'Kept', dot: 'bg-stage-complete' },
  { key: 'secure', label: 'Secure', dot: 'bg-stage-top' },
] as const;
export type ReviewStageKey = (typeof REVIEW_STAGES)[number]['key'];

export function useToday(state: AppState) {
  const {
    memoryQueue,
    masteryTouches,
    reviewsPaused,
    isReviewDue,
    primingLookahead,
    getEstimatedReviewTime,
    cognitiveLoadSensitivity,
    dayStartHour,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    pausedAt,
    pausedUntil,
  } = state;
  const todayKey = localDayKey(getLogicalDate(dayStartHour));

  // Sorting the whole queue into today's groups walks every verse several
  // times over, so it only reruns when the verses, the settings it reads or
  // the day change. The engine's helpers are fresh functions each render, so
  // the settings they close over are listed instead.
  const lists = useMemo(() => {
    // Excludes verses that already banked every touch: they're done learning
    // and only waiting for their reviews to clear.
    const learningItems = memoryQueue.filter(
      (item) => item.status === 'learning' && (item.touchLogs?.length || 0) < masteryTouches
    );
    const dueReviewItems = reviewsPaused
      ? []
      : memoryQueue.filter((item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate) && !gradedOnDay(item, todayKey));
    const doneTodayItems = memoryQueue.filter((item) => (item.status === 'reviewing' || item.status === 'retained') && gradedOnDay(item, todayKey));
    const queuedLookahead = memoryQueue.filter((item) => item.status === 'queued').slice(0, primingLookahead);
    const estMinutes = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);

    const reviewGroupsByStage: Record<ReviewStageKey, TodayGroup[]> = {
      settling: groupQueueItems(dueReviewItems.filter((item) => verseStage(item) === 'settling')),
      steady: groupQueueItems(dueReviewItems.filter((item) => verseStage(item) === 'steady')),
      kept: groupQueueItems(dueReviewItems.filter((item) => verseStage(item) === 'kept')),
      secure: groupQueueItems(dueReviewItems.filter((item) => verseStage(item) === 'secure')),
    };

    return {
      learningItems,
      dueReviewItems,
      doneTodayItems,
      queuedLookahead,
      estMinutes,
      learningGroups: groupQueueItems(learningItems),
      reviewGroupsByStage,
      dueGroups: REVIEW_STAGES.flatMap((s) => reviewGroupsByStage[s.key]),
      doneTodayGroups: groupQueueItems(doneTodayItems),
      comingUpGroups: groupQueueItems(queuedLookahead),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    memoryQueue,
    reviewsPaused,
    todayKey,
    masteryTouches,
    primingLookahead,
    cognitiveLoadSensitivity,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    pausedAt,
    pausedUntil,
    dayStartHour,
  ]);

  // Plays every verse on Today: learning, due reviews and what's coming up.
  const listenToToday = () => {
    const all = [...lists.learningItems, ...lists.dueReviewItems, ...lists.queuedLookahead];
    if (all.length > 0) {
      // Opens on Today's verses, so Listen builds (and names) the list itself.
      state.startPractice('listen', toVerseStates(all), { listenSource: 'all' });
    } else {
      state.triggerToast('Nothing on Today to listen to yet.');
    }
  };

  const practiceGroup = (mode: 'listen' | 'learn', items: QueueItem[]) => state.startPractice(mode, toVerseStates(items));

  // Every due group in one continuous session, Settling first.
  const reviewOneAtATime = () => state.startReviewSession(lists.dueGroups.map((g) => g.items));

  return { ...lists, todayKey, listenToToday, practiceGroup, reviewOneAtATime };
}

/** Banked perfect recalls across a group, e.g. 4 of 6 for two verses needing 3 each. */
export function groupTouches(group: TodayGroup, needed: number): { done: number; needed: number } {
  const done = group.items.reduce((n, item) => n + Math.min(item.touchLogs?.length || 0, needed), 0);
  return { done, needed: needed * group.items.length };
}

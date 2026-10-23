import { useEffect, useRef, useState } from 'react';
import { doc, increment, updateDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { QueueItem, VerseState } from '../types';
import { mapQueueItemsToVerseStates } from '../lib/appData';
import type { ListenSource } from '../components/practice/useListenPlayback';
import type { LearnMode } from '../components/practice/useRecall';
import type { ScreenName, ThreadDrillPreset } from './useAppState';

// ============================================================================
// PRACTICE SESSION
// ----------------------------------------------------------------------------
// Which practice overlay is open and on which verses, the chained "Review All
// Due" session, opening Pick up the thread / Guided learning, and measured
// study time. Split out of useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface UsePracticeSessionDeps {
  navigateTo: (screen: ScreenName) => void;
}

export function usePracticeSession({ navigateTo }: UsePracticeSessionDeps) {
  // Practice Overlays
  const [activeModal, setActiveModal] = useState<'listen' | 'learn' | null>(null);
  const [modalVerses, setModalVerses] = useState<VerseState[]>([]);
  // Which list Listen opens on. 'selection' plays the verses handed in;
  // Home's "Listen to all of today's verses" opens on 'all' instead, so the
  // picker reads Today's verses rather than Selected verses.
  const [listenSource, setListenSource] = useState<ListenSource>('selection');
  // Which Learn tab the overlay opens on, or null for Recall. The chapter
  // page's First words button sets it; every other way in leaves it null.
  const [practiceLearnTab, setPracticeLearnTab] = useState<LearnMode | null>(null);
  // Set just before opening Pick up the thread from a passing Recall, so its
  // setup starts on that chapter and verse. The screen clears it once read.
  const [threadDrillPreset, setThreadDrillPreset] = useState<ThreadDrillPreset | null>(null);
  // The passage Guided learning opens on (Passage.key in lib/guided.ts), or
  // null to let the screen pick the most recent one.
  const [guidedPassageKey, setGuidedPassageKey] = useState<string | null>(null);

  // Real, measured cumulative practice time (Dashboard's "Time Studied"),
  // in seconds. Tracked via the activeModal effect below, not an estimate.
  const [totalStudySeconds, setTotalStudySeconds] = useState<number>(0);
  const studySessionStartRef = useRef<number | null>(null);

  // Chained review session ("Review All Due") -- groups still to come after
  // the one currently showing in the overlay. A ref (not state) since
  // it's only ever read/written by the session functions below, never
  // rendered directly; reviewSessionPosition/Total ARE state because
  // PracticeModals shows them as a "2 of 5" progress badge.
  const reviewQueueRef = useRef<QueueItem[][]>([]);
  const [reviewSessionPosition, setReviewSessionPosition] = useState(0);
  const [reviewSessionTotal, setReviewSessionTotal] = useState(0);

  // Pick up the thread, opened on a given verse. Closes any practice overlay
  // first: the drill is a screen, and the overlay would sit on top of it.
  const openThreadDrill = (preset: ThreadDrillPreset | null) => {
    abortReviewSession();
    setThreadDrillPreset(preset);
    navigateTo('threadDrill');
  };

  // Guided learning, optionally on one passage. Closes any practice overlay
  // first, for the same reason as openThreadDrill.
  const openGuided = (passageKey?: string) => {
    abortReviewSession();
    setGuidedPassageKey(passageKey ?? null);
    navigateTo('guided');
  };

  // Mixed review (MIXED_REVIEW_PLAN.md, stage 5), opened like Guided learning.
  const openMixedReview = () => {
    abortReviewSession();
    navigateTo('mixedReview');
  };

  // Launch practice session
  const startPractice = (
    mode: 'listen' | 'learn',
    passageVerses: VerseState[],
    opts?: { listenSource?: ListenSource; learnTab?: LearnMode }
  ) => {
    setListenSource(opts?.listenSource ?? 'selection');
    setPracticeLearnTab(opts?.learnTab ?? null);
    setModalVerses(passageVerses);
    setActiveModal(mode);
  };

  // ==========================================
  // CHAINED REVIEW SESSION -- "Review All Due" on Home queues up every
  // due group (each its own book/chapter cluster) and walks through them
  // one at a time in the SAME overlay, per explicit user direction ("let
  // them continuously review... in order, without having to be taken back
  // to the home screen each time"). Each group is still graded
  // independently (a separate onUpdateStatus call per group, exactly as if
  // the user had tapped each group's button one by one) -- only the
  // navigation between them is automatic.
  // ==========================================
  const startReviewSession = (groups: QueueItem[][]) => {
    const nonEmpty = groups.filter((g) => g.length > 0);
    if (nonEmpty.length === 0) return;
    reviewQueueRef.current = nonEmpty.slice(1);
    setReviewSessionTotal(nonEmpty.length);
    setReviewSessionPosition(1);
    setPracticeLearnTab(null);
    setModalVerses(mapQueueItemsToVerseStates(nonEmpty[0]));
    setActiveModal('learn');
  };

  // Called after a group is graded/logged (never after an early X-out --
  // see abortReviewSession) -- moves on to the next queued group in place,
  // or closes normally if this wasn't a chained session (queue empty) /
  // it was the last group.
  const advanceReviewSession = () => {
    if (reviewQueueRef.current.length === 0) {
      setActiveModal(null);
      setModalVerses([]);
      setReviewSessionPosition(0);
      setReviewSessionTotal(0);
      return;
    }
    const [next, ...rest] = reviewQueueRef.current;
    reviewQueueRef.current = rest;
    setReviewSessionPosition((p) => p + 1);
    setModalVerses(mapQueueItemsToVerseStates(next));
  };

  // Explicit exit (the overlay's X button) -- always a full stop, even
  // mid-session: abandons whatever groups were still queued rather than
  // skipping to the next one, since tapping X reads as "I'm done for now."
  const abortReviewSession = () => {
    reviewQueueRef.current = [];
    setReviewSessionPosition(0);
    setReviewSessionTotal(0);
    setActiveModal(null);
    setModalVerses([]);
  };

  // Sanity ceiling on any single recorded session -- guards against a
  // backgrounded/left-open practice overlay (activeModal stays non-null,
  // e.g. a phone put to sleep mid-session) producing a nonsense multi-hour
  // "time studied" entry. Same spirit as MAX_LEARNING_DAY_SCAN elsewhere.
  const MAX_SESSION_SECONDS = 3600;

  const recordStudySession = (elapsedSeconds: number) => {
    setTotalStudySeconds((prev) => prev + elapsedSeconds);
    if (auth.currentUser) {
      updateDoc(doc(db, 'profiles', auth.currentUser.uid), { totalStudySeconds: increment(elapsedSeconds) }).catch(
        (err) => console.error('Failed to sync study time:', err)
      );
    }
  };

  // Real, measured practice time: activeModal is null whenever no
  // practice/listen overlay is open, and stays non-null across a chained
  // multi-group "Review All Due" session (advancing between groups swaps
  // modalVerses in place without touching activeModal), returning to null
  // only on a real close -- so this one effect captures exactly one
  // continuous practice session, with no changes needed in PracticeModals.
  useEffect(() => {
    if (activeModal) {
      if (studySessionStartRef.current === null) {
        studySessionStartRef.current = Date.now();
      }
    } else if (studySessionStartRef.current !== null) {
      const elapsedSeconds = Math.min(
        MAX_SESSION_SECONDS,
        Math.round((Date.now() - studySessionStartRef.current) / 1000)
      );
      studySessionStartRef.current = null;
      if (elapsedSeconds > 0) recordStudySession(elapsedSeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal]);

  return {
    activeModal,
    setActiveModal,
    modalVerses,
    setModalVerses,
    listenSource,
    practiceLearnTab,
    threadDrillPreset,
    setThreadDrillPreset,
    guidedPassageKey,
    setGuidedPassageKey,
    totalStudySeconds,
    setTotalStudySeconds,
    studySessionStartRef,
    reviewSessionPosition,
    reviewSessionTotal,
    openThreadDrill,
    openGuided,
    openMixedReview,
    startPractice,
    startReviewSession,
    advanceReviewSession,
    abortReviewSession,
  };
}

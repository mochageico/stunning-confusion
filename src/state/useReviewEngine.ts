import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { appendReviewLog } from '../lib/reviewLog';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { getBookByName } from '../data';
import { fetchChapterText } from './useScripture';
import { GroupPlan, GroupPlanMembership, QueueItem, ReviewGrade, TouchLog, VerseState } from '../types';
import { computeDailyPull, PersonalPacingSettings } from '../lib/groupPlanScheduler';
import { formatDate } from '../lib/format';
import { VerseRange } from '../lib/verseRange';
import { buildVerseId } from '../lib/appData';
import { DAY_ABBREVS, getLogicalDate, localDayKey, nextOccurrenceOfWeekday } from '../lib/logicalDate';
import { TOP_STEP } from '../lib/ladder';
import { migrateQueue } from '../lib/ladderMigration';
import { reconcile } from '../lib/passages';
import { gradeVerse, joinMessage, mergeChanged, type ReviewNote } from '../lib/ladderEngine';

/** How many recap lines the engine keeps (a long day's worth). */
const REVIEW_NOTES_KEPT = 80;
import { GradeInput, isSelfCheckInput, resolveGrade } from '../lib/grading';
import {
  estimateReviewMinutes,
  forecastMemoryLoad,
  isReviewDue,
  isTouchSpaced,
  nextDueDateISO as nextDueDateISOFor,
} from '../lib/retention';
import type { ReviewCompletedOpts } from './useAppState';
import type { PlanSettings } from './usePlanSettings';

// ============================================================================
// REVIEW ENGINE
// ----------------------------------------------------------------------------
// The review engine as it touches the live queue: what's due, the daily pull,
// adding and promoting verses, manual status overrides, and grading a
// practice result (handleReviewCompleted). Verses past Learning are graded
// as passages on the review ladder (REVIEW_LADDER_PLAN.md; the pure math is
// in src/lib/ladder.ts, passages.ts and ladderEngine.ts); late reviews and
// partly covered days are handled when the app opens (useAppState's load
// path). The settings it schedules with come from usePlanSettings. Split out of
// useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface UseReviewEngineDeps {
  plan: PlanSettings;
  memoryQueue: QueueItem[];
  /** Always-current queue (see updateMemoryQueue in useAppState). */
  memoryQueueRef: MutableRefObject<QueueItem[]>;
  updateMemoryQueue: (updater: (prev: QueueItem[]) => QueueItem[]) => void;
  /** Verse ids the user asked to remove; the queue auto-sync deletes only these. */
  pendingQueueDeletionsRef: MutableRefObject<Set<string>>;
  joinedGroupPlanMemberships: GroupPlanMembership[];
  joinedGroupPlanDetails: GroupPlan[];
  syncChallengeProgress: () => void;
  selectedTranslationId: string;
  verses: VerseState[];
  setVerses: Dispatch<SetStateAction<VerseState[]>>;
  triggerToast: (message: string) => void;
}

export function useReviewEngine({
  plan,
  memoryQueue,
  memoryQueueRef,
  updateMemoryQueue,
  pendingQueueDeletionsRef,
  joinedGroupPlanMemberships,
  joinedGroupPlanDetails,
  syncChallengeProgress,
  selectedTranslationId,
  verses,
  setVerses,
  triggerToast,
}: UseReviewEngineDeps) {
  // The live Review Settings and Rhythm this engine schedules with.
  const {
    cognitiveLoadSensitivity,
    dayStartHour,
    learningDays,
    masteryTouches,
    maxReviewCap,
    newVersesPace,
    pausedAt,
    pausedUntil,
    reviewsPaused,
    sabbathDay,
    sabbathEnabled,
    thoroughness,
    cleanPct,
    swapCanBeClean,
  } = plan;

  // The missed-review popup is retired with the review ladder (late reviews
  // are handled on load, REVIEW_LADDER_PLAN.md §3). Its state stays, always
  // empty, until stage 8 deletes the popup itself.
  const [missedReviewQueue, setMissedReviewQueue] = useState<{ item: QueueItem; missedCycles: number }[]>([]);
  const [showMissedReviewPrompt, setShowMissedReviewPrompt] = useState(false);
  // What each passage's review did this session, newest last: the Mixed
  // review recap reads its own session's lines from here. Not saved.
  const [reviewNotes, setReviewNotes] = useState<ReviewNote[]>([]);

  // Firm-up attempts: grades given today to verses whose passage has a
  // firm-up today, kept across calls because verses are graded one at a
  // time (see gradeVerse). Reset when the day changes.
  const firmUpGradesRef = useRef<{ day: string; grades: Map<string, ReviewGrade> }>({ day: '', grades: new Map() });

  // ==========================================
  // 7-6-5 DETERMINISTIC RETENTION ENGINE & HELPERS
  // ==========================================
  const getTodayAbbreviation = () => DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];

  const isTodayLearningDay = () => {
    const todayAbbr = getTodayAbbreviation();
    if (sabbathEnabled && todayAbbr === sabbathDay) return false;
    return learningDays.includes(todayAbbr);
  };

  // The scheduling math itself lives in src/lib/retention.ts; these bind it
  // to the active plan's settings.
  const reviewClock = { dayStartHour, sabbathEnabled, sabbathDay, pausedAt, pausedUntil };

  // Next-due date `days` from today, nudged off the Sabbath.
  const nextDueDateISO = (days: number) => nextDueDateISOFor(days, reviewClock);

  // Retired with the missed-review popup (see above): closes it.
  const resolveMissedReviewChoice = (
    _choice: 'grace' | 'escalate' | 'reset',
    _overrides?: Record<string, 'grace' | 'escalate' | 'reset'>
  ) => {
    setShowMissedReviewPrompt(false);
    setMissedReviewQueue([]);
  };

  const validateTouch = (item: QueueItem, _type: 'speak' | 'type' | 'reveal'): boolean => isTouchSpaced(item);

  const getEstimatedReviewTime = (queue: QueueItem[], sensitivity: 'low' | 'medium' | 'high') =>
    estimateReviewMinutes(queue, sensitivity, reviewClock);

  const getMemoryLoadForecast = (
    queue: QueueItem[],
    sensitivity: 'low' | 'medium' | 'high',
    learningDaysList: string[],
    pace: number,
    days: number
  ) => forecastMemoryLoad(queue, sensitivity, learningDaysList, pace, days, reviewClock);

  // `bypassShield`: the caller (HomeScreen) already showed an "are you
  // sure?" confirm card explaining the shield is active and re-invokes with
  // this set once the user confirms they want to pull anyway -- see the
  // Pull New Verses button. Every other guard (non-learning-day, nothing
  // left queued) still applies unconditionally; only the review-time shield
  // itself is bypassable, since that's the one guarding a real but
  // reversible choice ("I know reviews are already full today, pull more
  // anyway"), not a hard constraint.
  const triggerDailyPull = async (opts?: { bypassShield?: boolean }) => {
    if (reviewsPaused) {
      triggerToast('Reviews are paused -- resume from Settings to pull new verses.');
      return;
    }
    if (!isTodayLearningDay()) {
      triggerToast(`Today (${getTodayAbbreviation()}) is a non-learning day. Focus on reviews!`);
      return;
    }

    const estTime = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);
    const shieldActive = estTime >= maxReviewCap && !opts?.bypassShield;

    // An 'additive' plan is defined as deliberately going over your daily
    // limits -- BOTH the new-verse pace and the review-time cap. So the
    // Review Shield holds back your own queue and your capped plans, but
    // never an additive one; otherwise "additive" would quietly mean
    // "additive until you get busy", which is the opposite of why someone
    // picks it. With the shield up we re-run the pull with a zero personal
    // budget and only the additive memberships, so exactly that plan's own
    // weekly share comes through.
    const additiveMemberships = joinedGroupPlanMemberships.filter((m) => m.priority === 'additive');
    if (shieldActive && additiveMemberships.length === 0) {
      triggerToast(`Review Shield is Active! Review time (${estTime}m) >= limit (${maxReviewCap}m). No new verses pulled today.`);
      return;
    }

    if (!memoryQueue.some((item) => item.status === 'queued')) {
      triggerToast('No more queued verses to pull!');
      return;
    }

    // Blends the personal queue with however many GroupPlans this member has
    // joined, at whatever pace/priority each calls for -- see
    // src/lib/groupPlanScheduler.ts for the full resolution rules (additive
    // plans first and uncapped, then group-priority > individual >
    // individual-priority within the personal daily budget).
    const personal: PersonalPacingSettings = {
      newVersesPace: shieldActive ? 0 : newVersesPace,
      learningDays,
    };
    const { verseIds: pulledVerseIds, fromIndividual, fromPlans } = computeDailyPull(
      memoryQueue,
      personal,
      joinedGroupPlanDetails,
      shieldActive ? additiveMemberships : joinedGroupPlanMemberships,
      new Date()
    );

    if (shieldActive && pulledVerseIds.length > 0) {
      triggerToast(
        `Review Shield held back your own queue (${estTime}m >= ${maxReviewCap}m), but your additive plan still pulled. 🛡️`
      );
    }

    if (pulledVerseIds.length === 0) {
      triggerToast('No more queued verses to pull!');
      return;
    }

    const pulledSet = new Set(pulledVerseIds);
    const itemsToPull = memoryQueueRef.current.filter((item) => pulledSet.has(item.verseId));

    const updatedQueue = memoryQueueRef.current.map((item) => {
      if (!pulledSet.has(item.verseId)) return item;
      return {
        ...item,
        status: 'learning' as const,
        dateStarted: new Date().toISOString(),
        lastReviewDate: null,
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 0,
        gracePeriodUsedToday: false,
      };
    });

    updateMemoryQueue(() => updatedQueue);

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        itemsToPull.forEach((item) => {
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
          batch.set(docRef, {
            ...item,
            status: 'learning',
            dateStarted: new Date().toISOString(),
            lastReviewDate: null,
            nextReviewDueDate: null,
            currentStreakCount: 0,
            totalSuccessfulReviews: 0,
            gracePeriodUsedToday: false,
          });
        });
        await batch.commit();
      } catch (err) {
        console.error('Failed to commit pull batch to firestore:', err);
      }
    }

    const planBreakdown = Object.entries(fromPlans)
      .map(([planId, ids]) => {
        const planName = joinedGroupPlanDetails.find((p) => p.planId === planId)?.name || 'a group plan';
        return `${ids.length} from "${planName}"`;
      })
      .join(', ');
    const breakdown =
      fromIndividual.length > 0 && planBreakdown
        ? ` (${fromIndividual.length} individual, ${planBreakdown})`
        : planBreakdown
          ? ` (${planBreakdown})`
          : '';

    triggerToast(
      `Successfully pulled ${pulledVerseIds.length} new ${pulledVerseIds.length === 1 ? 'verse' : 'verses'} into your learning queue!${breakdown} 🚀`
    );
  };

  // The ONLY supported way to remove verses from the queue. Records the
  // intent first, so the auto-sync is allowed to delete these specific
  // documents; anything that leaves `memoryQueue` by any other route is
  // treated as a bug and left alone in Firestore.
  const removeQueueItems = (verseIds: string[]) => {
    if (verseIds.length === 0) return;
    verseIds.forEach((id) => pendingQueueDeletionsRef.current.add(id));
    const doomed = new Set(verseIds);
    updateMemoryQueue((prev) => prev.filter((item) => !doomed.has(item.verseId)));
  };

  // Read-only preview of what the next learning day's pull would promote,
  // for the "Where verses come from" block on the queue screen. Runs the
  // exact same pure function the real pull runs, so the preview can't drift
  // from the behaviour it describes -- which is the whole point of showing
  // it, since the priority setting was previously impossible to observe.
  const getNextPullPreview = () =>
    computeDailyPull(
      memoryQueue,
      { newVersesPace, learningDays },
      joinedGroupPlanDetails,
      joinedGroupPlanMemberships,
      new Date()
    );

  // Manually moves specific queued verses straight into Learning, bypassing
  // triggerDailyPull's pace/learning-day/review-cap gating -- those exist to
  // keep the *automatic* daily pull from overloading a non-learning day, but
  // a deliberate "start this verse now" action is a different, intentional
  // choice and shouldn't be blocked by them. Persistence is handled by the
  // existing debounced memoryQueue auto-sync effect, same as every other
  // queue mutation (reorder, delete, add).
  const promoteToLearning = (verseIds: string[]) => {
    const idSet = new Set(verseIds);
    const nowISO = new Date().toISOString();
    let promotedCount = 0;
    updateMemoryQueue((prev) =>
      prev.map((item) => {
        if (!idSet.has(item.verseId) || item.status !== 'queued') return item;
        promotedCount++;
        return {
          ...item,
          status: 'learning' as const,
          dateStarted: nowISO,
          lastReviewDate: null,
          nextReviewDueDate: null,
          currentStreakCount: 0,
          totalSuccessfulReviews: 0,
          gracePeriodUsedToday: false,
        };
      })
    );
    if (promotedCount > 0) {
      triggerToast(`Moved ${promotedCount === 1 ? 'that verse' : `${promotedCount} verses`} into Learning!`);
      syncChallengeProgress();
    }
  };

  // Fetches every verse in `range` (looping fetchChapterText per chapter) as
  // VerseState[] ready for addVersesToQueue, plus the total count -- shared
  // by challenge creation/accept/join.
  const fetchRangeVerses = async (
    translationId: string,
    range: VerseRange
  ): Promise<{ verses: VerseState[]; totalVerses: number }> => {
    const bookMeta = getBookByName(range.book);
    if (!bookMeta) return { verses: [], totalVerses: 0 };
    const verses: VerseState[] = [];
    for (let chapter = range.startChapter; chapter <= range.endChapter; chapter++) {
      const chapterText = await fetchChapterText(translationId, bookMeta.id, chapter);
      if (!chapterText) continue;
      Object.entries(chapterText.verses).forEach(([verseNumStr, text]) => {
        const verseNum = Number(verseNumStr);
        if (range.startChapter === range.endChapter && chapter === range.startChapter) {
          if (range.startVerse != null && verseNum < range.startVerse) return;
          if (range.endVerse != null && verseNum > range.endVerse) return;
        }
        verses.push({ book: range.book, chapter, verse: verseNum, text, status: 'untouched' });
      });
    }
    return { verses, totalVerses: verses.length };
  };

  // Adds specific already-fetched verses (e.g. a selection made on
  // ChapterLandingScreen, which already has real text loaded) to the queue
  // as 'queued' items. Skips any verse whose verseId is already present in
  // the queue in any status, rather than duplicating it -- selecting a mix
  // of new and already-queued/learning/reviewing verses just adds the new
  // ones. Persistence is handled by the existing debounced auto-sync
  // effect, same as every other queue mutation.
  const addVersesToQueue = (versesToAdd: VerseState[], translationId: string) => {
    const existingIds = new Set(memoryQueueRef.current.map((q) => q.verseId));
    const newItems: QueueItem[] = [];
    let skipped = 0;
    versesToAdd.forEach((v) => {
      const bookMeta = getBookByName(v.book);
      if (!bookMeta) {
        skipped++;
        return;
      }
      const verseId = buildVerseId(translationId, bookMeta.id, v.chapter, v.verse);
      if (existingIds.has(verseId)) {
        skipped++;
        return;
      }
      existingIds.add(verseId); // guards against duplicate verses within versesToAdd itself
      newItems.push({
        verseId,
        translationId,
        book: v.book,
        chapter: v.chapter,
        verseNumber: v.verse,
        text: v.text,
        orderIndex: memoryQueueRef.current.length + newItems.length,
        status: 'queued',
        origin: 'individual',
        retentionPhase: 'none',
        dateStarted: null,
        lastReviewDate: null,
        nextReviewDueDate: null,
        currentStreakCount: 0,
        totalSuccessfulReviews: 0,
        gracePeriodUsedToday: false,
      });
    });

    if (newItems.length === 0) {
      triggerToast(skipped > 0 ? "Those verses are already on your list." : 'No verses to add.');
      return;
    }

    updateMemoryQueue((prev) => [...prev, ...newItems]);
    const skippedNote = skipped > 0 ? ` (${skipped} already on your list, skipped)` : '';
    triggerToast(
      `Added ${newItems.length} ${newItems.length === 1 ? 'verse' : 'verses'} to your list!${skippedNote} 📖`
    );
  };

  // Adds a book/chapter/verse RANGE, fetching the real chapter text first.
  // Differs from addVersesToQueue above, which takes verses whose text the
  // caller already has (a chapter the user is looking at); this one is for
  // callers that only know a reference -- the setup flow and the Add verses
  // screen. The translation defaults to your usual one (selectedTranslationId);
  // Add verses passes the one picked on it explicitly.
  //
  // Returns a result rather than toasting, because its two callers report
  // differently: the form shows a toast, setup shows an inline confirmation
  // on the card itself.
  const addVerseRangeToQueue = async (
    book: string,
    chapter: number,
    startVerse: number,
    endVerse: number,
    translationId: string = selectedTranslationId
  ): Promise<{ added: number; alreadyThere: number; missingText: number; error?: string }> => {
    const empty = { added: 0, alreadyThere: 0, missingText: 0 };
    const bookId = getBookByName(book)?.id;
    if (!bookId) return { ...empty, error: `Unrecognized book: ${book}` };

    const start = Math.min(startVerse, endVerse);
    const end = Math.max(startVerse, endVerse);
    const targets = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    // Read through the ref, not the render-time `memoryQueue` snapshot --
    // same reason every other queue mutation does (see updateMemoryQueue).
    const existingIds = new Set(memoryQueueRef.current.map((q) => q.verseId));
    const toAdd = targets.filter(
      (v) => !existingIds.has(buildVerseId(translationId, bookId, chapter, v))
    );
    const alreadyThere = targets.length - toAdd.length;
    if (toAdd.length === 0) return { ...empty, alreadyThere };

    const chapterData = await fetchChapterText(translationId, bookId, chapter);
    if (!chapterData) {
      return { ...empty, alreadyThere, error: `Couldn't find ${book} ${chapter} in the scripture library yet.` };
    }

    const found = toAdd.filter((v) => chapterData.verses[String(v)]);
    if (found.length === 0) {
      return { ...empty, alreadyThere, missingText: toAdd.length, error: `No verse text found for ${book} ${chapter}.` };
    }

    const newItems: QueueItem[] = found.map((v, i) => ({
      verseId: buildVerseId(translationId, bookId, chapter, v),
      translationId: translationId,
      book,
      chapter,
      verseNumber: v,
      text: chapterData.verses[String(v)],
      orderIndex: memoryQueueRef.current.length + i,
      status: 'queued',
      origin: 'individual',
      retentionPhase: 'none',
      dateStarted: null,
      lastReviewDate: null,
      nextReviewDueDate: null,
      currentStreakCount: 0,
      totalSuccessfulReviews: 0,
      gracePeriodUsedToday: false,
    }));

    updateMemoryQueue((prev) => [...prev, ...newItems]);
    return { added: newItems.length, alreadyThere, missingText: toAdd.length - found.length };
  };

  // Manually places a set of verses at a specific point in the memory-
  // progression ladder, bypassing the normal learn-then-graduate flow --
  // for verses already memorized outside the app (e.g. "I already know all
  // of Ephesians, put it straight into Weekly review"). Creates a fresh
  // QueueItem for any verse not yet queued; overwrites an existing one's
  // phase/streak/schedule fields in place otherwise. Every demotion-
  // softening/mastery-touch field is cleared to a blank slate for the new
  // phase, since this is a deliberate manual reset, not a real graduation.
  //
  // targetWeekday (weekly/monthly only) lets a batch's review cycle land on
  // a chosen day of the week -- since a phase's due date always recurs by a
  // fixed number of days from wherever it first starts (7 for weekly, 30
  // for monthly), picking which day the FIRST one lands on is all that's
  // needed to keep every future cycle on that same weekday.
  const overrideVerseMemoryStatus = (
    versesToOverride: VerseState[],
    targetPhase: 'learning' | 'daily' | 'weekly' | 'monthly' | 'retained',
    translationId: string,
    targetWeekday?: string,
    // How far into the phase's graduation cycle to start (1 = just began,
    // same as the old hardcoded behavior). Only meaningful for
    // daily/weekly/monthly -- ignored for learning/retained, which have no
    // partial-progress concept. Callers should clamp this to
    // [1, graduation threshold for targetPhase] themselves (the UI reads
    // dailyPhaseWeeks/weeklyPhaseMonths/monthlyPhaseYears to compute that
    // same threshold handleReviewCompleted graduates on).
    progressCount?: number
  ) => {
    const nowISO = new Date().toISOString();
    const existingByVerseId = new Map(memoryQueueRef.current.map((q) => [q.verseId, q]));
    const cycleDays = targetPhase === 'daily' ? 1 : targetPhase === 'weekly' ? 7 : 30;

    const dueDateISO: string | null =
      targetPhase === 'learning' || targetPhase === 'retained'
        ? null
        : targetWeekday && (targetPhase === 'weekly' || targetPhase === 'monthly')
          ? nextOccurrenceOfWeekday(getLogicalDate(dayStartHour), targetWeekday, sabbathEnabled, sabbathDay).toISOString()
          : nextDueDateISO(cycleDays);

    const nextQueue = [...memoryQueueRef.current];
    const additions: QueueItem[] = [];
    let updatedCount = 0;

    versesToOverride.forEach((v) => {
      const bookMeta = getBookByName(v.book);
      if (!bookMeta) return;
      const verseId = buildVerseId(translationId, bookMeta.id, v.chapter, v.verse);
      const existing = existingByVerseId.get(verseId);

      const base: QueueItem = existing
        ? { ...existing }
        : {
            verseId,
            translationId,
            book: v.book,
            chapter: v.chapter,
            verseNumber: v.verse,
            text: v.text,
            orderIndex: memoryQueueRef.current.length + additions.length,
            status: 'queued',
            origin: 'individual',
            retentionPhase: 'none',
            dateStarted: null,
            lastReviewDate: null,
            nextReviewDueDate: null,
            currentStreakCount: 0,
            totalSuccessfulReviews: 0,
            gracePeriodUsedToday: false,
          };

      delete base.touchLogs;
      base.reviewsToday = 0;
      base.gracePeriodUsedToday = false;
      base.dailyPhaseExtensionDays = 0;
      delete base.refresherActive;
      delete base.refresherReturnPhase;
      delete base.refresherReturnProgress;
      delete base.refresherTargetUnits;
      delete base.guidedSetAside;
      delete base.guidedShakyJoin;
      delete base.ladderStep;
      delete base.ladderReviews;
      delete base.catchUp;
      delete base.dayResult;
      delete base.lastSelfChecked;
      delete base.firmUp;
      delete base.slipped;

      if (targetPhase === 'learning') {
        base.status = 'learning';
        base.retentionPhase = 'none';
        base.dateStarted = nowISO;
        base.lastReviewDate = null;
        base.nextReviewDueDate = null;
        base.currentStreakCount = 0;
      } else if (targetPhase === 'retained') {
        base.status = 'retained';
        base.retentionPhase = 'none';
        base.dateStarted = base.dateStarted || nowISO;
        base.nextReviewDueDate = null;
        base.currentStreakCount = 0;
      } else {
        base.status = 'reviewing';
        base.retentionPhase = targetPhase;
        base.dateStarted = base.dateStarted || nowISO;
        base.lastReviewDate = base.lastReviewDate || nowISO;
        base.currentStreakCount = Math.max(1, progressCount ?? 1);
        base.nextReviewDueDate = dueDateISO;
      }
      // Everything above is a deliberate reset, but the history stays --
      // those reviews really happened. Note the move itself.
      appendReviewLog(base, base, 'placed');

      if (existing) {
        const idx = nextQueue.findIndex((q) => q.verseId === verseId);
        if (idx !== -1) nextQueue[idx] = base;
        updatedCount++;
      } else {
        additions.push(base);
      }
    });

    const total = updatedCount + additions.length;
    if (total === 0) {
      triggerToast('No recognized verses to update.');
      return;
    }

    // Placed verses go onto the ladder from the stage they were given, the
    // same mapping the migration uses (their ladder fields were cleared
    // above), so the passage they land in agrees on one schedule.
    // Stage 8 replaces this screen's daily / weekly / monthly choices.
    const placed = [...nextQueue, ...additions];
    updateMemoryQueue(() => mergeChanged(placed, migrateQueue(placed, { clock: reviewClock, thoroughness }).changed));
    syncChallengeProgress();

    const phaseLabel =
      targetPhase === 'learning'
        ? 'Learning'
        : targetPhase === 'retained'
          ? 'Retained'
          : `${targetPhase[0].toUpperCase()}${targetPhase.slice(1)} Review`;
    const dueNote = dueDateISO
      ? ` Next due ${new Date(dueDateISO).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}.`
      : '';
    triggerToast(`Set ${total} ${total === 1 ? 'verse' : 'verses'} to ${phaseLabel}.${dueNote}`);
  };

  // A verse that banked all its touches joins the review ladder: past
  // Learning with no ladder step yet, which reconcile reads as a verse
  // arriving (REVIEW_LADDER_PLAN.md stage 2 notes). reconcile then gives it
  // its passage's schedule -- joining a neighbour drops that passage to
  // Every day with the short catch-up -- and writes the due date.
  const leaveLearning = (q: QueueItem, nowISO: string): QueueItem => {
    const next: QueueItem = {
      ...q,
      status: 'reviewing',
      retentionPhase: 'daily',
      dateStarted: nowISO,
      currentStreakCount: 1,
      reviewsToday: 0,
      nextReviewDueDate: null,
    };
    delete next.ladderStep;
    delete next.ladderReviews;
    delete next.catchUp;
    return next;
  };

  /** Reconciles after verses left Learning; returns the queue, the changed ids and the join toasts. */
  const joinLadder = (queue: QueueItem[]) => {
    const { changed, joins } = reconcile(queue, { clock: reviewClock });
    return { queue: mergeChanged(queue, changed), ids: changed.map((q) => q.verseId), messages: joins.map(joinMessage) };
  };

  /** Writes these verses (as they stand in `queue`) together, in batches. */
  const persistItems = async (queue: QueueItem[], ids: Iterable<string>) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const want = new Set(ids);
    const items = queue.filter((q) => want.has(q.verseId));
    try {
      for (let start = 0; start < items.length; start += 450) {
        const batch = writeBatch(db);
        items.slice(start, start + 450).forEach((q) => batch.set(doc(db, 'users', uid, 'memoryQueue', q.verseId), q));
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/memoryQueue`);
    }
  };

  // Activity feed: a passage reaching Every 6 months (the old "retained").
  // A whole chapter (in that translation) at the top is one chapter event;
  // otherwise one event per verse, as before.
  const postReachedTop = async (queue: QueueItem[], reached: QueueItem[]) => {
    const user = auth.currentUser;
    if (!user || reached.length === 0) return;
    const first = reached[0];
    const chapterMates = queue.filter(
      (q) => q.book === first.book && q.chapter === first.chapter && q.translationId === first.translationId
    );
    const chapterDone = chapterMates.every((q) => q.ladderStep === TOP_STEP);
    const events = chapterDone
      ? [{ type: 'chapter' as const, verseCount: chapterMates.length }]
      : reached.map((q) => ({ type: 'verse' as const, verse: q.verseNumber }));
    for (const [i, e] of events.entries()) {
      const eventId = `evt_${Date.now()}_${i}`;
      try {
        await setDoc(doc(db, 'activityEvents', eventId), {
          uid: user.uid,
          authorName: user.displayName || 'Someone',
          book: first.book,
          chapter: first.chapter,
          ...e,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `activityEvents/${eventId}`);
      }
    }
  };

  /** Moves fully touched Learning verses onto the ladder once nothing is due today. */
  const releaseWaitingVerses = (queue: QueueItem[]) => {
    const none = { queue, ids: [] as string[], count: 0, messages: [] as string[] };
    const dueRemaining = queue.some((q) => q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate, getLogicalDate(dayStartHour)));
    if (dueRemaining) return none;
    const nowISO = new Date().toISOString();
    const waiting = new Set(
      queue.filter((q) => q.status === 'learning' && (q.touchLogs?.length || 0) >= masteryTouches).map((q) => q.verseId)
    );
    if (waiting.size === 0) return none;
    const moved = queue.map((q) => (waiting.has(q.verseId) ? leaveLearning(q, nowISO) : q));
    const joined = joinLadder(moved);
    return { queue: joined.queue, ids: [...new Set([...waiting, ...joined.ids])], count: waiting.size, messages: joined.messages };
  };

  /**
   * Grades one practice result (REVIEW_LADDER_PLAN.md stage 4b).
   * - Learning: unchanged -- a perfect, spaced run banks a touch, and the
   *   last touch moves the verse onto the ladder once no reviews are due
   *   today (retention first).
   * - Past Learning: the verse's grade goes to its passage's current
   *   review (gradeVerse); the outcome is applied once every verse in the
   *   passage has one today. Not due = practice, except a firm-up attempt.
   * `opts.graded` is what the screen saw (accuracy, a self-check answer,
   * Find the wrong word misses), graded here with the user's settings;
   * `opts.grade` an already decided grade. A caller with neither gets clean
   * for a pass and a stumble for a fail.
   * Returns the toasts instead of showing them, so a multi-verse caller can
   * show one.
   */
  const gradeQueueItem = async (
    item: QueueItem,
    success: boolean,
    drillType?: 'speak' | 'type' | 'reveal',
    opts?: ReviewCompletedOpts
  ): Promise<{ early: boolean; messages: string[] }> => {
    const messages: string[] = [];
    const nowISO = new Date().toISOString();
    const via = opts?.via ? { via: opts.via } : {};
    const live = memoryQueueRef.current.find((q) => q.verseId === item.verseId) ?? item;

    if (live.status === 'learning') {
      if (!success) return { early: false, messages: ['Incorrect. Keep practicing!'] };
      // Perfection gate: a run with any missed words never banks a touch,
      // no matter how close — "close enough" only exists for reviews.
      if (opts?.perfect === false) {
        return { early: false, messages: ['Good recall! A run must be perfect (no missed words) to bank a mastery touch.'] };
      }
      // PracticeModals' Recall mode and the manual-log action always pass an
      // explicit drillType; 'speak' only remains as a fallback.
      const inferredType = drillType || 'speak';
      if (!validateTouch(live, inferredType)) {
        return { early: false, messages: ['Touch logged, but within 1-hour constraint. Only 1 touch per hour counts toward Mastery!'] };
      }
      let updated: QueueItem = { ...live, lastReviewDate: nowISO };
      const newTouch: TouchLog = { timestamp: nowISO, drillType: inferredType };
      const updatedLogs = [...(live.touchLogs || []), newTouch];
      updated.touchLogs = updatedLogs;
      appendReviewLog(updated, live, 'pass', { drillType: inferredType, ...via });
      updated.totalSuccessfulReviews += 1;
      updated.currentStreakCount += 1;

      let queue = memoryQueueRef.current.map((q) => (q.verseId === live.verseId ? updated : q));
      const ids = new Set([live.verseId]);
      if (updatedLogs.length >= masteryTouches) {
        // Retention beats new learning: a verse can bank all its touches,
        // but doesn't leave Learning while other verses still have reviews
        // due today. It's released the moment the last due review clears
        // (releaseWaitingVerses). While paused nothing is due, so there's
        // nothing to wait for.
        const dueReviewsPending =
          !reviewsPaused &&
          queue.some(
            (q) => q.verseId !== live.verseId && q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate, getLogicalDate(dayStartHour))
          );
        if (dueReviewsPending) {
          messages.push(`Mastery touches complete (${updatedLogs.length}/${masteryTouches})! Finish today's reviews to lock this verse in.`);
        } else {
          updated = leaveLearning(updated, nowISO);
          queue = queue.map((q) => (q.verseId === live.verseId ? updated : q));
          const joined = joinLadder(queue);
          queue = joined.queue;
          joined.ids.forEach((id) => ids.add(id));
          messages.push(joined.messages.length > 0 ? `Learned! ${joined.messages.join(' ')}` : 'Learned! It moves up to review, every day for now.');
        }
      } else {
        messages.push(`Recall logged! Mastery progress: ${updatedLogs.length}/${masteryTouches} touches.`);
      }
      updateMemoryQueue(() => queue);
      syncChallengeProgress();
      await persistItems(queue, ids);
      return { early: false, messages };
    }

    if (live.status !== 'reviewing' && live.status !== 'retained') return { early: false, messages };

    const day = localDayKey(getLogicalDate(dayStartHour));
    if (firmUpGradesRef.current.day !== day) firmUpGradesRef.current = { day, grades: new Map() };
    const input = opts?.graded;
    const grade: ReviewGrade = input ? resolveGrade(input, { cleanPct, swapCanBeClean }) : opts?.grade ?? (success ? 'clean' : 'stumble');
    const g = gradeVerse(memoryQueueRef.current, live.verseId, grade, {
      clock: reviewClock,
      thoroughness,
      via: opts?.via,
      drillType,
      selfCheck: opts?.selfCheck || (input ? isSelfCheckInput(input) : false),
      canMoveUp: opts?.canMoveUp,
      firmUpGrades: firmUpGradesRef.current.grades,
    });
    let queue = mergeChanged(memoryQueueRef.current, g.changed);
    const ids = new Set(g.changed.map((q) => q.verseId));
    messages.push(...g.messages);
    if (g.notes.length > 0) setReviewNotes((prev) => [...prev, ...g.notes].slice(-REVIEW_NOTES_KEPT));

    // This review may have cleared the last one due today: release any
    // verses that banked all their touches while reviews were pending.
    const released = releaseWaitingVerses(queue);
    if (released.count > 0) {
      queue = released.queue;
      released.ids.forEach((id) => ids.add(id));
      messages.push(
        `All reviews done! ${released.count} verse${released.count > 1 ? 's' : ''} locked in and moved up to review. 🔓`,
        ...released.messages
      );
    }

    updateMemoryQueue(() => queue);
    syncChallengeProgress();
    await persistItems(queue, ids);
    if (g.reachedTop && g.passage) {
      const members = new Set(g.passage.items.map((m) => m.verseId));
      await postReachedTop(queue, queue.filter((q) => members.has(q.verseId)));
    }
    return { early: g.practice, messages };
  };

  // `opts.perfect` — accuracy tier of the practice run behind this result
  // (graded in src/lib/recitation.ts). A success with perfect === false was
  // "close enough": it doesn't bank a mastery touch for a Learning verse
  // (touches require a perfect run). `opts.grade` (clean / stumble / blank)
  // is what a verse past Learning is graded with. Resolves to 'early' when
  // the verse's passage wasn't due, so the result was practice.
  const handleReviewCompleted = async (
    item: QueueItem,
    success: boolean,
    drillType?: 'speak' | 'type' | 'reveal',
    opts?: ReviewCompletedOpts
  ): Promise<'early' | void> => {
    const { early, messages } = await gradeQueueItem(item, success, drillType, opts);
    // A quiet caller (Pick up the thread) shows its own per-verse results.
    if (!opts?.quiet && messages.length > 0) triggerToast(messages.join(' '));
    if (early) return 'early';
  };

  /**
   * Clears the weak-spot dot on these verses (the "Fix the transitions"
   * drill, finished). Nothing else changes: no credit, no schedule.
   */
  const clearSlipped = async (verseIds: string[]) => {
    const ids = new Set(verseIds);
    const touched = memoryQueueRef.current.filter((q) => ids.has(q.verseId) && q.slipped);
    if (touched.length === 0) return;
    const hit = new Set(touched.map((q) => q.verseId));
    const queue = memoryQueueRef.current.map((q) => {
      if (!hit.has(q.verseId)) return q;
      const next = { ...q };
      delete next.slipped;
      return next;
    });
    updateMemoryQueue(() => queue);
    await persistItems(queue, hit);
  };

  const triggerMockDueReviews = async () => {
    if (memoryQueue.length === 0) {
      triggerToast('Your memory queue is empty! Please add some verses first.');
      return;
    }

    // Undoes today's completed reviews -- and ONLY those. A verse qualifies
    // solely by having lastReviewDate on today's calendar date (i.e. you
    // actually completed it today); its nextReviewDueDate gets pushed back
    // to due so it reappears in Due Reviews. Nothing else about the verse
    // is touched -- not retentionPhase, not streaks, not lastReviewDate
    // itself, and nothing reviewed on any earlier day is affected at all.
    // (An earlier version of this button touched every verse currently in
    // ANY review phase regardless of when it was last reviewed, which on a
    // real account with a large memorized library meant hundreds of verses
    // with real, varied schedules all got collapsed to "due right now" in
    // one click -- their real per-verse due dates aren't recoverable from
    // here. This version is deliberately narrow to make that impossible.)
    const todayStr = getLogicalDate(dayStartHour).toDateString();
    const reviewedToday = memoryQueueRef.current.filter(
      (item) =>
        item.status === 'reviewing' &&
        item.lastReviewDate &&
        getLogicalDate(dayStartHour, new Date(item.lastReviewDate)).toDateString() === todayStr
    );

    if (reviewedToday.length === 0) {
      triggerToast("Nothing reviewed today yet to reset.");
      return;
    }

    const targetIds = new Set(reviewedToday.map((item) => item.verseId));
    // Due now, not yesterday: a date before today reads as late on the next
    // open and would move the passage back (Late reviews move you back).
    const resetDueDate = new Date().toISOString();
    const updatedQueue = memoryQueueRef.current.map((item) =>
      targetIds.has(item.verseId) ? { ...item, nextReviewDueDate: resetDueDate } : item
    );

    updateMemoryQueue(() => updatedQueue);

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        reviewedToday.forEach((item) => {
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'memoryQueue', item.verseId);
          batch.update(docRef, { nextReviewDueDate: resetDueDate });
        });
        await batch.commit();
      } catch (err) {
        console.error('Failed to sync mock queue items:', err);
      }
    }
    triggerToast(` ${reviewedToday.length} verse${reviewedToday.length === 1 ? '' : 's'} reviewed today reset back to due.`);
  };

  const handleUpdateVerseStatus = async (
    versesToUpdate: VerseState[],
    newStatus: 'memorized' | 'learning',
    customDrillType?: 'speak' | 'type' | 'reveal',
    opts?: ReviewCompletedOpts
  ) => {
    setVerses((prev) => {
      return prev.map((v) => {
        const isTarget = versesToUpdate.some((u) => u.book === v.book && u.chapter === v.chapter && u.verse === v.verse);
        if (isTarget) {
          return {
            ...v,
            status: newStatus,
            dueDate: newStatus === 'memorized' ? 'Completed' : 'Due: Tomorrow',
          };
        }
        return v;
      });
    });

    if (auth.currentUser) {
      try {
        const batch = writeBatch(db);
        versesToUpdate.forEach((v) => {
          const vId = `${v.book}_${v.chapter}_${v.verse}`;
          const docRef = doc(db, 'users', auth.currentUser!.uid, 'verses', vId);
          batch.set(docRef, {
            book: v.book,
            chapter: v.chapter,
            verse: v.verse,
            text: v.text,
            status: newStatus,
            dueDate: newStatus === 'memorized' ? 'Completed' : 'Due: Tomorrow',
            updatedAt: new Date(),
          });
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${auth.currentUser.uid}/verses`);
      }
    }

    // Route completion results to our 7-6-5 Deterministic Retention Engine!
    const success = newStatus === 'memorized';
    // PracticeModals' Recall mode and the manual-log action always pass an
    // explicit customDrillType now; 'speak' only remains as a fallback.
    const drillType = customDrillType || 'speak';
    // Verses that weren't due yet, so nothing was logged for them.
    const early: QueueItem[] = [];
    // What the grading said (a passage's outcome, a join); shown in place of
    // the generic toast below when there is any.
    const messages: string[] = [];
    for (const v of versesToUpdate) {
      // Read through the ref, not the render-time snapshot — each loop
      // iteration must see the queue updates the previous iteration made.
      // Matched by translation too when the verse says which: Psalm 23:1 in
      // the BSB and in Hebrew are independent items, and grading a Hebrew
      // recall must not credit the BSB one. ('ESV' is the same legacy
      // default for translation-less items used everywhere else here.)
      const itemInQueue = memoryQueueRef.current.find(
        (q) =>
          q.book === v.book &&
          q.chapter === v.chapter &&
          q.verseNumber === v.verse &&
          (!v.translationId || (q.translationId || 'ESV') === v.translationId)
      );
      if (itemInQueue) {
        // A grade per verse (Recall, Pick up the thread, ...) rides on gradeFor.
        const graded = opts?.gradeFor?.(v);
        const result = await gradeQueueItem(itemInQueue, success, drillType, graded ? { ...opts, graded } : opts);
        if (result.early) early.push(itemInQueue);
        messages.push(...result.messages);
      }
    }

    const refStr =
      versesToUpdate.length === 1
        ? `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}`
        : `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}-${versesToUpdate[versesToUpdate.length - 1].verse}`;

    if (opts?.quiet) return;
    if (messages.length > 0) {
      triggerToast(messages.join(' '));
      return;
    }
    if (early.length > 0) {
      const soonest = early.map((i) => i.nextReviewDueDate || '').filter(Boolean).sort()[0];
      const day = soonest ? formatDate(soonest, 'relative') : '';
      const when = day === 'Tomorrow' ? 'tomorrow' : day;
      if (early.length === versesToUpdate.length) {
        triggerToast(`Not due until ${when}, so this was practice. Your schedule hasn't changed.`);
      } else {
        const list = early.map((i) => `v${i.verseNumber}`).join(', ');
        triggerToast(`Logged. ${list} ${early.length === 1 ? "isn't" : "aren't"} due until ${when}, so ${early.length === 1 ? 'it was' : 'they were'} practice.`);
      }
      return;
    }
    triggerToast(`Completed practice for ${refStr}!`);
  };

  // Marks a verse Guided learning set aside after repeated misses, or clears
  // the mark. The key is deleted to clear it -- never written as false or
  // undefined (Firestore rejects undefined). The auto-sync saves it.
  const setGuidedSetAside = (verseId: string, on: boolean) => {
    updateMemoryQueue((prev) =>
      prev.map((item) => {
        if (item.verseId !== verseId) return item;
        if (on) return item.guidedSetAside ? item : { ...item, guidedSetAside: true as const };
        if (!item.guidedSetAside) return item;
        const next = { ...item };
        delete next.guidedSetAside;
        return next;
      })
    );
  };

  // Marks the joins Guided learning saw slip (`shaky`) and clears the ones it
  // saw held (`steady`), in one queue update. Same delete-to-clear rule as
  // setGuidedSetAside.
  const setGuidedShakyJoins = (shaky: string[], steady: string[]) => {
    if (shaky.length === 0 && steady.length === 0) return;
    updateMemoryQueue((prev) =>
      prev.map((item) => {
        if (shaky.includes(item.verseId)) return item.guidedShakyJoin ? item : { ...item, guidedShakyJoin: true as const };
        if (!steady.includes(item.verseId) || !item.guidedShakyJoin) return item;
        const next = { ...item };
        delete next.guidedShakyJoin;
        return next;
      })
    );
  };

  // Guided learning's "Add verse N to Learning": moves exactly one queued
  // verse into Learning, with the same field resets as triggerDailyPull. It
  // ignores the daily pace and the learning-day check (the user asked for
  // this verse), but still refuses while reviews are paused, matching
  // triggerDailyPull. Returns whether the verse moved.
  const pullVerseIntoLearning = (verseId: string): boolean => {
    if (reviewsPaused) {
      triggerToast('Reviews are paused -- resume from Settings to add new verses.');
      return false;
    }
    const item = memoryQueueRef.current.find((q) => q.verseId === verseId);
    if (!item || item.status !== 'queued') return false;
    updateMemoryQueue((prev) =>
      prev.map((q) =>
        q.verseId !== verseId
          ? q
          : {
              ...q,
              status: 'learning' as const,
              dateStarted: new Date().toISOString(),
              lastReviewDate: null,
              nextReviewDueDate: null,
              currentStreakCount: 0,
              totalSuccessfulReviews: 0,
              gracePeriodUsedToday: false,
            }
      )
    );
    return true;
  };

  // Guided learning's credit path, the same calls Pick up the thread makes
  // (finishRound in ThreadDrillScreen): 'touch' banks a Learning run
  // (perfect), 'review' counts a due review. Every verse carries its
  // translationId, so Psalm 23:1 in BSB and in Hebrew stay separate items.
  // Resolves to the credited items as they stand afterwards, read from the
  // live queue, so the caller can tell whether a third run graduated the
  // verse or graduation is being held for due reviews. `accuracy` (by
  // verseId) grades a review clean, stumble or blank.
  const creditGuided = async (
    items: QueueItem[],
    kind: 'touch' | 'review',
    drill: 'speak' | 'type',
    accuracy?: ReadonlyMap<string, number>
  ): Promise<QueueItem[]> => {
    if (items.length > 0) {
      const states: VerseState[] = items.map((i) => ({
        book: i.book,
        chapter: i.chapter,
        verse: i.verseNumber,
        text: i.text,
        status: 'memorized',
        translationId: i.translationId,
      }));
      const gradeFor = (v: VerseState): GradeInput | undefined => {
        const item = items.find((i) => i.book === v.book && i.chapter === v.chapter && i.verseNumber === v.verse && i.translationId === v.translationId);
        const a = item ? accuracy?.get(item.verseId) : undefined;
        return a === undefined ? undefined : { kind: 'recall', accuracy: a };
      };
      await handleUpdateVerseStatus(states, 'memorized', drill, { perfect: kind === 'touch', quiet: true, via: 'guided', gradeFor });
    }
    const ids = new Set(items.map((i) => i.verseId));
    return memoryQueueRef.current.filter((q) => ids.has(q.verseId));
  };

  return {
    missedReviewQueue,
    setMissedReviewQueue,
    showMissedReviewPrompt,
    setShowMissedReviewPrompt,
    getTodayAbbreviation,
    isTodayLearningDay,
    resolveMissedReviewChoice,
    validateTouch,
    getEstimatedReviewTime,
    getMemoryLoadForecast,
    triggerDailyPull,
    removeQueueItems,
    getNextPullPreview,
    promoteToLearning,
    fetchRangeVerses,
    addVersesToQueue,
    addVerseRangeToQueue,
    overrideVerseMemoryStatus,
    handleReviewCompleted,
    reviewNotes,
    clearSlipped,
    triggerMockDueReviews,
    handleUpdateVerseStatus,
    setGuidedSetAside,
    setGuidedShakyJoins,
    pullVerseIntoLearning,
    creditGuided,
  };
}

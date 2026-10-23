import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { appendReviewLog } from '../lib/reviewLog';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { getBookByName } from '../data';
import { fetchChapterText } from './useScripture';
import { GroupPlan, GroupPlanMembership, QueueItem, TouchLog, VerseState } from '../types';
import { computeDailyPull, PersonalPacingSettings } from '../lib/groupPlanScheduler';
import { formatDate } from '../lib/format';
import { VerseRange } from '../lib/verseRange';
import { buildVerseId } from '../lib/appData';
import {
  DAY_ABBREVS,
  DAY_FULL_NAMES,
  getLogicalDate,
  nextOccurrenceOfWeekday,
  nthOccurrenceOfWeekday,
} from '../lib/logicalDate';
import {
  applyMissToItem,
  computeMissedCycles,
  describeMissOutcome,
  resolveMissedCycles,
} from '../lib/missPolicy';
import {
  estimateReviewMinutes,
  findChapterReviewAnchor,
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
// The 7-6-5 retention engine as it touches the live queue: what's due, the
// missed-review catch-up, the daily pull, adding and promoting verses, manual
// status overrides, and grading a practice result (handleReviewCompleted).
// The pure scheduling math lives in src/lib/retention.ts and missPolicy.ts;
// the settings it schedules with come from usePlanSettings. Split out of
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
    dailyPhaseWeeks,
    dayStartHour,
    graceCount,
    learningDays,
    masteryTouches,
    maxReviewCap,
    missPolicy,
    monthlyPhaseYears,
    newVersesPace,
    pausedAt,
    pausedUntil,
    refresherDailyDays,
    refresherWeeklyWeeks,
    reviewsPaused,
    reviewsRequired,
    sabbathDay,
    sabbathEnabled,
    weeklyPhaseMonths,
  } = plan;

  // Missed-review popup: items found overdue on this app-open, awaiting the
  // user's choice (see resolveMissedReviewChoice). Populated once, in
  // loadUserData, when the active plan's missPolicyAskEveryTime is on --
  // never re-scanned mid-session, so it can't re-open itself as normal
  // review activity changes items' due dates.
  const [missedReviewQueue, setMissedReviewQueue] = useState<{ item: QueueItem; missedCycles: number }[]>([]);
  const [showMissedReviewPrompt, setShowMissedReviewPrompt] = useState(false);

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

  // Applies the user's missed-review popup choice. `choice` is the bulk
  // default; `overrides` (verseId -> choice) lets "Customize per verse"
  // pick something different for specific items. Every affected item's due
  // date moves to today regardless of choice, so the verse is still due now
  // (the user just opened the app to review -- pushing it to tomorrow made
  // Daily verses vanish from today's list) and the old past due date can't
  // be counted as missed a second time by handleReviewCompleted's catch-up.
  const resolveMissedReviewChoice = (
    choice: 'grace' | 'escalate' | 'reset',
    overrides?: Record<string, 'grace' | 'escalate' | 'reset'>
  ) => {
    const outcomeFor = (verseId: string) => overrides?.[verseId] || choice;
    const resolvedById = new Map(
      missedReviewQueue.map(({ item, missedCycles }) => {
        const { updatedItem, tag } = resolveMissedCycles(item, missedCycles, missPolicy, {
          graceCount,
          refresherDailyDays,
          refresherWeeklyWeeks,
        }, outcomeFor(item.verseId));
        appendReviewLog(updatedItem, item, 'skipped', {
          cycles: missedCycles,
          ...(tag === 'frozen' || tag === 'grace' ? { forgiven: true as const } : {}),
        });
        if (tag !== 'grace' && tag !== 'frozen' && tag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        updatedItem.nextReviewDueDate = nextDueDateISO(0);
        return [item.verseId, updatedItem];
      })
    );

    updateMemoryQueue((prev) => prev.map((q) => resolvedById.get(q.verseId) || q));
    setShowMissedReviewPrompt(false);
    setMissedReviewQueue([]);
    triggerToast(
      `Caught up on ${resolvedById.size} verse${resolvedById.size === 1 ? '' : 's'} with missed reviews. 🎯`
    );
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

    updateMemoryQueue(() => [...nextQueue, ...additions]);
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

  // `opts.perfect` — accuracy tier of the practice run behind this result
  // (graded in src/lib/recitation.ts). A success with perfect === false was
  // "close enough" (>= 90% word accuracy): it still counts as a completed
  // spaced-repetition review, but does NOT bank a mastery touch for a
  // learning verse — touches require a perfect run. Omitted (undefined)
  // means nothing measured the accuracy (the manual-log action's "Perfect"
  // option, where the user reviewed off-app) and is treated as the user
  // claiming a perfect run.
  const handleReviewCompleted = async (
    item: QueueItem,
    success: boolean,
    drillType?: 'speak' | 'type' | 'reveal',
    opts?: ReviewCompletedOpts
  ): Promise<'early' | void> => {
    // A quiet caller (Pick up the thread) shows its own per-verse results, so
    // one toast per verse would just stack up over them.
    const toast = opts?.quiet ? (_message: string) => {} : triggerToast;
    // Which practice produced this review, kept in the review history.
    const via = opts?.via ? { via: opts.via } : {};

    // Practicing ahead: a verse on a review schedule that isn't due yet is
    // practice, pass or miss (the user's call, 2026-10-10). Before this, an
    // early pass counted as a whole cycle -- Recalling a monthly verse a week
    // early moved it on a month -- and an early miss demoted it for
    // practicing ahead. Nothing changes, lastReviewDate included: "Reset
    // today's reviews" reads that date and would pull the verse back to due
    // today. Same due test as Home's review list.
    if (item.status === 'reviewing' && !isReviewDue(item.nextReviewDueDate)) return 'early';

    let updatedItem = { ...item };
    updatedItem.lastReviewDate = new Date().toISOString();

    // Catch up on any full review cycles silently missed while the app
    // wasn't opened -- being late is the same kind of "miss" as an active
    // failed attempt, just detected from elapsed time instead of a tap.
    // Being less than one full cycle late isn't a miss at all, which is
    // also what gives due dates their day-or-two of natural flexibility.
    // Any sabbath days or paused days in the elapsed span don't count as
    // elapsed time -- the engine treats them as though they didn't happen.
    // This is the reactive fallback path: it always auto-resolves per the
    // plan's missPolicy (no forcedOutcome), same as before the missed-review
    // popup existed. Items the popup already resolved on this app-open won't
    // still be overdue by the time they're reviewed, since resolving there
    // moves nextReviewDueDate forward too -- see resolveMissedReviewChoice.
    if (item.status === 'reviewing' && updatedItem.nextReviewDueDate) {
      const missedCycles = computeMissedCycles(updatedItem, dayStartHour, sabbathEnabled, sabbathDay, pausedAt, pausedUntil);
      if (missedCycles > 0) {
        const { updatedItem: resolvedItem, tag } = resolveMissedCycles(updatedItem, missedCycles, missPolicy, {
          graceCount,
          refresherDailyDays,
          refresherWeeklyWeeks,
        });
        updatedItem = resolvedItem;
        appendReviewLog(updatedItem, item, 'skipped', {
          cycles: missedCycles,
          ...(tag === 'frozen' || tag === 'grace' ? { forgiven: true as const } : {}),
        });
        if (tag !== 'grace' && tag !== 'frozen' && tag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        const dailyGraduationDaysTotal = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const message = describeMissOutcome(tag, updatedItem, dailyGraduationDaysTotal);
        if (message) {
          toast(`${missedCycles} review cycle${missedCycles > 1 ? 's' : ''} passed unattempted. ${message}`);
        }
      }
    }

    if (success) {
      if (item.status === 'learning') {
        // Perfection gate: a run with any missed words never banks a touch,
        // no matter how close — "close enough" only exists for reviews.
        if (opts?.perfect === false) {
          toast('Good recall! A run must be perfect (no missed words) to bank a mastery touch.');
          return;
        }
        // 3-Touch Mastery Gate checks. PracticeModals' Recall mode and the
        // manual-log action always pass an explicit drillType now; 'speak'
        // only remains as a fallback for any caller that doesn't.
        const inferredType = drillType || 'speak';
        const isValid = validateTouch(item, inferredType);

        if (isValid) {
          const newTouch: TouchLog = {
            timestamp: new Date().toISOString(),
            drillType: inferredType,
          };
          const updatedLogs = [...(item.touchLogs || []), newTouch];
          updatedItem.touchLogs = updatedLogs;
          appendReviewLog(updatedItem, item, 'pass', { drillType: inferredType, ...via });
          updatedItem.totalSuccessfulReviews += 1;
          updatedItem.currentStreakCount += 1;

          if (updatedLogs.length >= masteryTouches) {
            // Retention beats new learning: a verse can bank all its touches,
            // but doesn't actually graduate to spaced review while other
            // verses still have reviews due today. It releases automatically
            // the moment the last due review clears (see the sweep at the
            // end of this function).
            // While paused nothing is due, so there's nothing to wait for --
            // holding the verse back would strand it behind reviews Home
            // isn't even showing.
            const dueReviewsPending = !reviewsPaused && memoryQueueRef.current.some(
              (q) =>
                q.verseId !== item.verseId &&
                q.status === 'reviewing' &&
                isReviewDue(q.nextReviewDueDate, getLogicalDate(dayStartHour))
            );
            if (dueReviewsPending) {
              toast(`Mastery touches complete (${updatedLogs.length}/${masteryTouches})! Finish today's reviews to lock this verse in.`);
            } else {
              updatedItem.status = 'reviewing';
              updatedItem.retentionPhase = 'daily';
              updatedItem.dateStarted = new Date().toISOString();
              updatedItem.currentStreakCount = 1;
              updatedItem.nextReviewDueDate = nextDueDateISO(1);
              updatedItem.reviewsToday = 0;
              toast('Learned! It moves up to Daily review.');
            }
          } else {
            toast(`Recall logged! Mastery progress: ${updatedLogs.length}/${masteryTouches} touches.`);
          }
        } else {
          toast('Touch logged, but within 1-hour constraint. Only 1 touch per hour counts toward Mastery!');
        }
      } else if (item.status === 'reviewing') {
        // Logged against the stage as it stands before this review moves it on.
        appendReviewLog(updatedItem, updatedItem, 'pass', { ...(drillType ? { drillType } : {}), ...via });
        // Check reviewsRequired per day constraint
        const lastReviewDateStr = item.lastReviewDate;
        const isSameDay =
          lastReviewDateStr &&
          getLogicalDate(dayStartHour, new Date(lastReviewDateStr)).toDateString() === getLogicalDate(dayStartHour).toDateString();
        const currentReviewsToday = isSameDay ? (item.reviewsToday || 0) + 1 : 1;
        updatedItem.reviewsToday = currentReviewsToday;
        updatedItem.totalSuccessfulReviews += 1;
        updatedItem.gracePeriodUsedToday = false;
        updatedItem.graceMissesUsed = 0;

        // Graduation thresholds derived from the plan's retention rigor
        // (weeks/months/years -> review-count thresholds the engine checks).
        // Daily's own target also grows permanently from past misses (see
        // applyMissToItem); Weekly/Monthly instead send misses to a
        // temporary refresher rather than extending their own target.
        const dailyGraduationDays = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const weeklyGraduationReviews = Math.round(weeklyPhaseMonths * (52 / 12));
        const monthlyGraduationReviews = monthlyPhaseYears * 12;

        if (currentReviewsToday >= reviewsRequired) {
          // Advances once per completed day/week/month cycle (not once per
          // rep), so it accurately tracks elapsed cycles even when "Reviews
          // Required per Day" is set above 1.
          updatedItem.currentStreakCount += 1;

          // Chapter review-day anchoring ("Snap-to-Grid"): tomorrow is the
          // earliest a freshly-computed Weekly/Monthly due date can land,
          // matching nextDueDateISO's own "at least one day out" convention.
          const tomorrow = getLogicalDate(dayStartHour);
          tomorrow.setDate(tomorrow.getDate() + 1);

          if (updatedItem.refresherActive) {
            if (updatedItem.currentStreakCount >= (updatedItem.refresherTargetUnits || 1)) {
              const returnPhase = updatedItem.refresherReturnPhase || 'weekly';
              updatedItem.retentionPhase = returnPhase;
              updatedItem.currentStreakCount = updatedItem.refresherReturnProgress || 1;
              updatedItem.refresherActive = false;
              // delete rather than set to undefined -- Firestore's setDoc()
              // rejects explicit undefined field values at runtime.
              delete updatedItem.refresherReturnPhase;
              delete updatedItem.refresherReturnProgress;
              delete updatedItem.refresherTargetUnits;
              // Clearing a refresher is a transition back to steady-state
              // review, just like a real graduation -- re-anchor the same way.
              const returnAnchor =
                updatedItem.chapterReviewAnchorDay ||
                findChapterReviewAnchor(updatedItem.book, updatedItem.chapter, memoryQueueRef.current) ||
                DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];
              updatedItem.chapterReviewAnchorDay = returnAnchor;
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                returnAnchor,
                returnPhase === 'monthly' ? 4 : 1,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              toast(
                `Refresher complete! Back to ${returnPhase === 'monthly' ? 'Monthly' : 'Weekly'} review, resuming right where you left off, aligned to ${DAY_FULL_NAMES[returnAnchor]}. 🌟`
              );
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(updatedItem.retentionPhase === 'weekly' ? 7 : 1);
              toast(`Refresher review complete! (${updatedItem.currentStreakCount}/${updatedItem.refresherTargetUnits})`);
            }
          } else if (updatedItem.retentionPhase === 'daily') {
            if (updatedItem.currentStreakCount >= dailyGraduationDays) {
              updatedItem.retentionPhase = 'weekly';
              updatedItem.currentStreakCount = 1;
              updatedItem.dailyPhaseExtensionDays = 0;
              // First graduation out of Daily for this chunk -- adopt a
              // sibling chunk's existing anchor if this chapter already has
              // one, otherwise this chunk sets it for the whole chapter.
              const anchor =
                findChapterReviewAnchor(updatedItem.book, updatedItem.chapter, memoryQueueRef.current) ||
                DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];
              updatedItem.chapterReviewAnchorDay = anchor;
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(tomorrow, anchor, 1, sabbathEnabled, sabbathDay).toISOString();
              toast(`Moved up to Weekly! It's reviewed on ${DAY_FULL_NAMES[anchor]} with the rest of ${updatedItem.book} ${updatedItem.chapter}.`);
            } else {
              updatedItem.nextReviewDueDate = nextDueDateISO(1);
              toast('Daily reviews complete! Spaced date advanced.');
            }
          } else if (updatedItem.retentionPhase === 'weekly') {
            if (updatedItem.currentStreakCount >= weeklyGraduationReviews) {
              updatedItem.retentionPhase = 'monthly';
              updatedItem.currentStreakCount = 1;
              // Should already have an anchor from the Daily->Weekly step --
              // only a legacy pre-feature weekly item transitioning for the
              // first time under this code would still be missing one.
              const anchor =
                updatedItem.chapterReviewAnchorDay ||
                findChapterReviewAnchor(updatedItem.book, updatedItem.chapter, memoryQueueRef.current) ||
                DAY_ABBREVS[getLogicalDate(dayStartHour).getDay()];
              updatedItem.chapterReviewAnchorDay = anchor;
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(tomorrow, anchor, 4, sabbathEnabled, sabbathDay).toISOString();
              toast(`Moved up to Monthly! Still reviewed on ${DAY_FULL_NAMES[anchor]}.`);
            } else if (updatedItem.chapterReviewAnchorDay) {
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                updatedItem.chapterReviewAnchorDay,
                1,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              toast('Weekly review complete! Spaced date advanced.');
            } else {
              // Not retroactive -- a legacy weekly item with no anchor yet
              // keeps the old unanchored math until it actually transitions.
              updatedItem.nextReviewDueDate = nextDueDateISO(7);
              toast('Weekly review complete! Spaced date advanced.');
            }
          } else if (updatedItem.retentionPhase === 'monthly') {
            if (updatedItem.currentStreakCount >= monthlyGraduationReviews) {
              updatedItem.status = 'retained';
              updatedItem.retentionPhase = 'none';
              updatedItem.nextReviewDueDate = null;
              toast('Complete! No more scheduled reviews for this one.');
            } else if (updatedItem.chapterReviewAnchorDay) {
              updatedItem.nextReviewDueDate = nthOccurrenceOfWeekday(
                tomorrow,
                updatedItem.chapterReviewAnchorDay,
                4,
                sabbathEnabled,
                sabbathDay
              ).toISOString();
              toast('Monthly review complete! Spaced date advanced.');
            } else {
              // Not retroactive -- see the Weekly same-phase branch above.
              updatedItem.nextReviewDueDate = nextDueDateISO(30);
              toast('Monthly review complete! Spaced date advanced.');
            }
          }
          updatedItem.reviewsToday = 0; // Reset for next review cycle
        } else {
          toast(`Review logged! (${currentReviewsToday}/${reviewsRequired} required for today)`);
        }
      }
    } else {
      // FAILED REVIEW (today's actual attempt, on top of any catch-up above)
      if (item.status === 'reviewing') {
        const beforeMiss = { ...updatedItem };
        const tag = applyMissToItem(updatedItem, { graceCount, refresherDailyDays, refresherWeeklyWeeks });
        appendReviewLog(updatedItem, beforeMiss, tag === 'grace' ? 'grace' : 'miss', drillType ? { drillType } : {});
        if (tag !== 'grace' && tag !== 'none') {
          updatedItem.reviewsToday = 0;
        }
        const dailyGraduationDaysTotal = dailyPhaseWeeks * 7 + (updatedItem.dailyPhaseExtensionDays || 0);
        const message = describeMissOutcome(tag, updatedItem, dailyGraduationDaysTotal);
        if (message) toast(message);
      } else {
        toast('Incorrect. Keep practicing!');
      }
    }

    // A "reviewing" item was just resolved (success or failure), which may
    // have cleared the last due review for today. If so, release any
    // learning verses that banked all their mastery touches while reviews
    // were still pending (see the touch-gate above) -- retention comes
    // first, but a fully-touched verse shouldn't wait a moment longer than
    // it has to once nothing is left to review.
    // Built through updateMemoryQueue (the always-current ref), NOT the
    // render-time memoryQueue snapshot: when a passage of several verses is
    // completed together, this function runs once per verse in the same
    // interaction, and rebuilding from the stale snapshot made each call
    // erase the previous verse's update.
    let releasedCount = 0;
    updateMemoryQueue((prev) => {
      let finalQueue = prev.map((q) => (q.verseId === item.verseId ? updatedItem : q));
      if (item.status === 'reviewing') {
        const dueReviewsRemaining = finalQueue.some(
          (q) => q.status === 'reviewing' && isReviewDue(q.nextReviewDueDate, getLogicalDate(dayStartHour))
        );
        if (!dueReviewsRemaining) {
          finalQueue = finalQueue.map((q) => {
            if (q.status === 'learning' && (q.touchLogs?.length || 0) >= masteryTouches) {
              releasedCount++;
              return {
                ...q,
                status: 'reviewing' as const,
                retentionPhase: 'daily' as const,
                dateStarted: new Date().toISOString(),
                currentStreakCount: 1,
                nextReviewDueDate: nextDueDateISO(1),
                reviewsToday: 0,
              };
            }
            return q;
          });
        }
      }
      return finalQueue;
    });
    if (releasedCount > 0) {
      toast(
        `All reviews done! ${releasedCount} verse${releasedCount > 1 ? 's' : ''} locked in and moved to spaced review. 🔓`
      );
    }
    syncChallengeProgress();

    if (auth.currentUser) {
      try {
        const docRef = doc(db, 'users', auth.currentUser.uid, 'memoryQueue', item.verseId);
        await setDoc(docRef, updatedItem);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${auth.currentUser.uid}/memoryQueue/${item.verseId}`);
      }

      // Real activity-feed milestone: only fires on the actual queued->retained
      // transition (never re-fires on subsequent successful reviews of an
      // already-retained item). If every other verse from this same
      // book+chapter already in the queue is also retained, this is a whole
      // chapter finishing, not just one verse.
      const justRetained = item.status !== 'retained' && updatedItem.status === 'retained';
      if (justRetained) {
        const chapterMates = memoryQueueRef.current.filter((q) => q.book === item.book && q.chapter === item.chapter);
        const isChapterComplete = chapterMates.every((q) => q.verseId === item.verseId || q.status === 'retained');
        const eventId = `evt_${Date.now()}`;
        const eventData = {
          uid: auth.currentUser.uid,
          authorName: auth.currentUser.displayName || 'Someone',
          book: item.book,
          chapter: item.chapter,
          ...(isChapterComplete
            ? { type: 'chapter' as const, verseCount: chapterMates.length }
            : { type: 'verse' as const, verse: item.verseNumber }),
          createdAt: serverTimestamp(),
        };
        try {
          await setDoc(doc(db, 'activityEvents', eventId), eventData);
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `activityEvents/${eventId}`);
        }
      }
    }
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
    const resetDueDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString(); // due yesterday
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
        const outcome = await handleReviewCompleted(itemInQueue, success, drillType, opts);
        if (outcome === 'early') early.push(itemInQueue);
      }
    }

    const refStr =
      versesToUpdate.length === 1
        ? `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}`
        : `${versesToUpdate[0].book} ${versesToUpdate[0].chapter}:${versesToUpdate[0].verse}-${versesToUpdate[versesToUpdate.length - 1].verse}`;

    if (opts?.quiet) return;
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
  // verse or graduation is being held for due reviews.
  const creditGuided = async (items: QueueItem[], kind: 'touch' | 'review', drill: 'speak' | 'type'): Promise<QueueItem[]> => {
    if (items.length > 0) {
      const states: VerseState[] = items.map((i) => ({
        book: i.book,
        chapter: i.chapter,
        verse: i.verseNumber,
        text: i.text,
        status: 'memorized',
        translationId: i.translationId,
      }));
      await handleUpdateVerseStatus(states, 'memorized', drill, { perfect: kind === 'touch', quiet: true, via: 'guided' });
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
    triggerMockDueReviews,
    handleUpdateVerseStatus,
    setGuidedSetAside,
    setGuidedShakyJoins,
    pullVerseIntoLearning,
    creditGuided,
  };
}

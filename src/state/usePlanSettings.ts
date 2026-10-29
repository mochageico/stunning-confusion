import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { DEFAULT_RHYTHM } from '../data';
import { Rhythm } from '../types';
import { isPauseInEffect } from '../lib/reviewCalendar';
import { DEFAULT_LADDER_PREFS, type LadderPrefs } from '../lib/ladderEngine';

// ============================================================================
// MEMORY PLAN: RHYTHM AND REVIEW SETTINGS
// ----------------------------------------------------------------------------
// One plan per account, edited live in the Verses tab's Plan section (the
// Memory Plan Designer). Rhythm: your own pace (learning days, new verses,
// review cap, Sabbath, day start, pause). Review settings: Retention Level,
// perfect recalls to learn a verse, accuracy needed for clean, and what late
// reviews do. Every value commits the moment it changes and lives at the root
// of memoryPlans/{uid}. Every value the review engine schedules with comes
// from here. Split out of useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface UsePlanSettingsDeps {
  triggerToast: (message: string) => void;
}

export function usePlanSettings({ triggerToast }: UsePlanSettingsDeps) {
  const [cognitiveLoadSensitivity, setCognitiveLoadSensitivity] = useState<'low' | 'medium' | 'high'>('medium');

  // Rhythm: your personal cadence, user-level and independent of any plan.
  // The `preset` field ('drip'/'warrior'/'custom') was deleted with the
  // plan/rhythm split -- it only ever labelled a combination of the three
  // dials below, and every manual change slammed it straight back to
  // 'custom', so it carried no information the dials don't already hold.
  const [learningDays, setLearningDays] = useState<string[]>(DEFAULT_RHYTHM.learningDays);
  const [newVersesPace, setNewVersesPace] = useState<number>(DEFAULT_RHYTHM.newVersesPace);
  const [maxReviewCap, setMaxReviewCap] = useState<number>(DEFAULT_RHYTHM.maxReviewCap);
  // 3-Touch Mastery & Group Plan States
  const [masteryTouches, setMasteryTouches] = useState<number>(3);
  // Sabbath: an optional single weekday, off by default, free from both
  // learning and reviewing -- the engine treats it as not existing at all.
  const [sabbathEnabled, setSabbathEnabled] = useState<boolean>(false);
  const [sabbathDay, setSabbathDay] = useState<string>('Su');
  // See MemoryPlan.dayStartHour in types.ts -- 0/1/2, defaults to real midnight.
  const [dayStartHour, setDayStartHour] = useState<number>(0);
  // Pause -- see MemoryPlan.pausedAt/pausedUntil in types.ts.
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);
  // Paused right now? While it is, nothing reads as due anywhere -- Home,
  // the time estimate, the calendar and Listen all go through this.
  const reviewsPaused = isPauseInEffect(pausedAt, pausedUntil);

  // Review ladder settings (REVIEW_LADDER_PLAN.md decision 5): user-level,
  // like Rhythm, at the root of memoryPlans/{uid}, and committed live.
  // `ladderVersion` is 2 once this account's queue has been moved onto the
  // ladder (see the load path in useAppState).
  const [thoroughness, setThoroughness] = useState<LadderPrefs['thoroughness']>(DEFAULT_LADDER_PREFS.thoroughness);
  const [cleanPct, setCleanPct] = useState<number>(DEFAULT_LADDER_PREFS.cleanPct);
  const [lateMovesBack, setLateMovesBack] = useState<boolean>(DEFAULT_LADDER_PREFS.lateMovesBack);
  const [swapCanBeClean, setSwapCanBeClean] = useState<boolean>(DEFAULT_LADDER_PREFS.swapCanBeClean);
  const [balanceDays, setBalanceDays] = useState<boolean>(DEFAULT_LADDER_PREFS.balanceDays);
  const [ladderVersion, setLadderVersion] = useState<number | null>(null);
  const ladderPrefs: LadderPrefs = { thoroughness, cleanPct, lateMovesBack, swapCanBeClean, balanceDays };

  // The live Rhythm, flattened for the memoryPlans/{uid} doc root. These
  // field names are unchanged from before the split -- pre-split docs already
  // mirrored the active plan's pacing to exactly these root keys, so existing
  // documents migrate by simply being read from the root instead of from the
  // active plan (see the load path), with no destructive rewrite needed.
  const rhythmFields = (): Rhythm => ({
    learningDays,
    newVersesPace,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    dayStartHour,
    cognitiveLoadSensitivity,
    pausedAt,
    pausedUntil,
  });

  // Rhythm commits LIVE -- every dial on the queue page calls this straight
  // away. There is no dirty state and no Save button, because the engine
  // already reads these values from live state the moment they change; the
  // old "Save Rhythm" button only ever controlled whether the change survived
  // a reload, while pretending to control whether it applied at all.
  const persistRhythm = async (overrides: Partial<Rhythm> = {}) => {
    if (!auth.currentUser) return;
    try {
      await setDoc(
        doc(db, 'memoryPlans', auth.currentUser.uid),
        { ...rhythmFields(), ...overrides, updatedAt: new Date() },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
    }
  };

  // The single entry point every Rhythm control uses. `patch` is passed
  // through to the write as an override because the setState calls below
  // won't have landed yet when persistRhythm reads rhythmFields() in this
  // same tick.
  const updateRhythm = (patch: Partial<Rhythm>) => {
    if (patch.learningDays !== undefined) setLearningDays(patch.learningDays);
    if (patch.newVersesPace !== undefined) setNewVersesPace(patch.newVersesPace);
    if (patch.maxReviewCap !== undefined) setMaxReviewCap(patch.maxReviewCap);
    if (patch.sabbathEnabled !== undefined) setSabbathEnabled(patch.sabbathEnabled);
    if (patch.sabbathDay !== undefined) setSabbathDay(patch.sabbathDay);
    if (patch.dayStartHour !== undefined) setDayStartHour(patch.dayStartHour);
    if (patch.cognitiveLoadSensitivity !== undefined) setCognitiveLoadSensitivity(patch.cognitiveLoadSensitivity);
    if (patch.pausedAt !== undefined) setPausedAt(patch.pausedAt);
    if (patch.pausedUntil !== undefined) setPausedUntil(patch.pausedUntil);
    void persistRhythm(patch);
  };

  // Every ladder setting control calls this; same live-commit shape as
  // updateRhythm.
  const updateLadderSettings = async (patch: Partial<LadderPrefs>) => {
    if (patch.thoroughness !== undefined) setThoroughness(patch.thoroughness);
    if (patch.cleanPct !== undefined) setCleanPct(patch.cleanPct);
    if (patch.lateMovesBack !== undefined) setLateMovesBack(patch.lateMovesBack);
    if (patch.swapCanBeClean !== undefined) setSwapCanBeClean(patch.swapCanBeClean);
    if (patch.balanceDays !== undefined) setBalanceDays(patch.balanceDays);
    if (!auth.currentUser) return;
    try {
      await setDoc(
        doc(db, 'memoryPlans', auth.currentUser.uid),
        { ...ladderPrefs, ...patch, updatedAt: new Date() },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
    }
  };

  // Loads the saved ladder settings into state (useAppState's load path).
  const applyLadderPrefs = (prefs: LadderPrefs) => {
    setThoroughness(prefs.thoroughness);
    setCleanPct(prefs.cleanPct);
    setLateMovesBack(prefs.lateMovesBack);
    setSwapCanBeClean(prefs.swapCanBeClean);
    setBalanceDays(prefs.balanceDays);
  };

  // Perfect recalls before a verse counts as learned: user-level like the
  // rest of the plan, written live to the doc root.
  const updateMasteryTouches = async (n: number) => {
    const next = Math.min(6, Math.max(1, Math.round(n)));
    setMasteryTouches(next);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'memoryPlans', auth.currentUser.uid), { masteryTouches: next, updatedAt: new Date() }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
    }
  };

  // Persists pausedAt/pausedUntil to whichever plan is currently active, and
  // mirrors a plain isPaused flag onto the public profile doc so a friend's
  // accountability-nudge flow (sendAccountabilityNudge in useAccountabilityNudges) can check
  // pause status without needing read access to this private plan doc.
  // Immediate, not gated behind Plan Designer's Save button -- pausing is a
  // "I'm leaving right now" action, same urgency as the rest of Settings.
  // Pause is part of Rhythm, so it targets the user, not a plan. Before the
  // split it was written into whichever plan was active, which meant
  // activating a different plan reloaded that plan's (null) pause fields and
  // silently un-paused you mid-vacation.
  const setPauseState = async (newPausedAt: string | null, newPausedUntil: string | null) => {
    updateRhythm({ pausedAt: newPausedAt, pausedUntil: newPausedUntil });

    if (auth.currentUser) {
      try {
        await setDoc(doc(db, 'profiles', auth.currentUser.uid), { isPaused: !!newPausedAt }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `profiles/${auth.currentUser.uid}`);
      }
    }
  };

  const pauseReviews = (untilISO: string | null) => {
    setPauseState(new Date().toISOString(), untilISO);
    triggerToast(
      untilISO
        ? `Paused until ${new Date(untilISO).toLocaleDateString()} -- nothing will be due while you're away. 🌴`
        : "Paused -- nothing will be due until you resume. 🌴"
    );
  };

  const resumeReviews = () => {
    setPauseState(null, null);
    triggerToast('Welcome back! Reviews have resumed.');
  };

  // saveActivePlanRhythm was deleted here. It existed to persist the queue
  // screen's rhythm edits into a plan, which is exactly the coupling the
  // plan/rhythm split removes -- rhythm now commits live via updateRhythm and
  // targets the user, so there is nothing to "save to a plan" any more.

  return {
    cognitiveLoadSensitivity,
    setCognitiveLoadSensitivity,
    learningDays,
    setLearningDays,
    newVersesPace,
    setNewVersesPace,
    maxReviewCap,
    setMaxReviewCap,
    masteryTouches,
    setMasteryTouches,
    sabbathEnabled,
    setSabbathEnabled,
    sabbathDay,
    setSabbathDay,
    dayStartHour,
    setDayStartHour,
    pausedAt,
    setPausedAt,
    pausedUntil,
    setPausedUntil,
    reviewsPaused,
    thoroughness,
    cleanPct,
    lateMovesBack,
    swapCanBeClean,
    balanceDays,
    ladderPrefs,
    ladderVersion,
    setLadderVersion,
    updateLadderSettings,
    applyLadderPrefs,
    updateRhythm,
    updateMasteryTouches,
    pauseReviews,
    resumeReviews,
  };
}

export type PlanSettings = ReturnType<typeof usePlanSettings>;

import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { DEFAULT_PLANS, DEFAULT_RHYTHM } from '../data';
import { MemoryPlan, Rhythm } from '../types';
import { isPauseInEffect } from '../lib/reviewCalendar';
import type { ScreenName } from './useAppState';

// ============================================================================
// REVIEW SETTINGS AND RHYTHM
// ----------------------------------------------------------------------------
// Review Settings: the saved retention plans (phase lengths, mastery touches,
// missed-review policy), the one in the editor, and saving/activating them.
// Rhythm: your own pace (learning days, new verses, review cap, Sabbath, day
// start, pause), which commits live and never lives on a plan. Every value
// the review engine schedules with comes from here. Split out of useAppState
// (see .claude/file-split-plan.md).
// ============================================================================

interface UsePlanSettingsDeps {
  navigateTo: (screen: ScreenName) => void;
  triggerToast: (message: string) => void;
}

export function usePlanSettings({ navigateTo, triggerToast }: UsePlanSettingsDeps) {
  const [cognitiveLoadSensitivity, setCognitiveLoadSensitivity] = useState<'low' | 'medium' | 'high'>('medium');

  // Rhythm: your personal cadence, user-level and independent of any plan.
  // The `preset` field ('drip'/'warrior'/'custom') was deleted with the
  // plan/rhythm split -- it only ever labelled a combination of the three
  // dials below, and every manual change slammed it straight back to
  // 'custom', so it carried no information the dials don't already hold.
  const [learningDays, setLearningDays] = useState<string[]>(DEFAULT_RHYTHM.learningDays);
  const [newVersesPace, setNewVersesPace] = useState<number>(DEFAULT_RHYTHM.newVersesPace);
  const [maxReviewCap, setMaxReviewCap] = useState<number>(DEFAULT_RHYTHM.maxReviewCap);
  // Retention rigor: how long a verse stays in each review phase before
  // graduating (default 7-6-5 == today's previously-hardcoded behavior).
  const [retentionRigor, setRetentionRigor] = useState<'light' | 'standard' | 'deep' | 'custom'>('standard');
  const [dailyPhaseWeeks, setDailyPhaseWeeks] = useState<number>(7);
  const [weeklyPhaseMonths, setWeeklyPhaseMonths] = useState<number>(6);
  const [monthlyPhaseYears, setMonthlyPhaseYears] = useState<number>(5);

  // 3-Touch Mastery & Group Plan States
  const [masteryTouches, setMasteryTouches] = useState<number>(3);
  const [reviewsRequired, setReviewsRequired] = useState<number>(1);
  // Sabbath: an optional single weekday, off by default, free from both
  // learning and reviewing -- the engine treats it as not existing at all.
  const [sabbathEnabled, setSabbathEnabled] = useState<boolean>(false);
  const [sabbathDay, setSabbathDay] = useState<string>('Su');
  // See MemoryPlan.dayStartHour in types.ts -- 0/1/2, defaults to real midnight.
  const [dayStartHour, setDayStartHour] = useState<number>(0);
  // Missed-review handling -- see MemoryPlan.missPolicy in types.ts.
  const [missPolicy, setMissPolicy] = useState<'lenient' | 'standard' | 'graceDiscretion' | 'custom'>('standard');
  const [missPolicyAskEveryTime, setMissPolicyAskEveryTime] = useState<boolean>(false);
  const [graceCount, setGraceCount] = useState<number>(1);
  const [refresherDailyDays, setRefresherDailyDays] = useState<number>(7);
  const [refresherWeeklyWeeks, setRefresherWeeklyWeeks] = useState<number>(4);
  // Pause -- see MemoryPlan.pausedAt/pausedUntil in types.ts.
  const [pausedAt, setPausedAt] = useState<string | null>(null);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);
  // Paused right now? While it is, nothing reads as due anywhere -- Home,
  // the time estimate, the calendar and Listen all go through this.
  const reviewsPaused = isPauseInEffect(pausedAt, pausedUntil);

  // The name of the Review Settings currently open in the editor. Naming is
  // what forks a built-in preset into your own copy -- see handleSavePlan.
  const [customPlanName, setCustomPlanName] = useState('My Review Settings');

  // Multi-Plan States
  const [savedPlans, setSavedPlans] = useState<MemoryPlan[]>(DEFAULT_PLANS);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);

  // ==========================================
  // PLAN <-> DESIGNER STATE SYNC HELPERS
  // ==========================================
  // Single source of truth for "load a plan's settings into the live designer
  // state" and "flatten a plan into the memoryPlans/{uid} doc's top-level
  // fields".
  //
  // Post plan/rhythm split these touch ONLY retention fields. Rhythm
  // (learningDays, pace, review cap, sabbath, dayStartHour, load sensitivity,
  // pause) is user-level and is never read from or written to a plan --
  // that's the whole point of the split, and it's why activating another
  // plan can no longer change your pacing or silently un-pause you.
  const syncDesignerFromPlan = (plan: MemoryPlan) => {
    setRetentionRigor(plan.retentionRigor || 'standard');
    setDailyPhaseWeeks(plan.dailyPhaseWeeks ?? 7);
    setWeeklyPhaseMonths(plan.weeklyPhaseMonths ?? 6);
    setMonthlyPhaseYears(plan.monthlyPhaseYears ?? 5);
    setMasteryTouches(plan.masteryTouches ?? 3);
    setReviewsRequired(plan.reviewsRequired ?? 1);
    setMissPolicy(plan.missPolicy || 'standard');
    setMissPolicyAskEveryTime(plan.missPolicyAskEveryTime ?? false);
    setGraceCount(plan.graceCount ?? 1);
    setRefresherDailyDays(plan.refresherDailyDays ?? 7);
    setRefresherWeeklyWeeks(plan.refresherWeeklyWeeks ?? 4);
    setCustomPlanName(plan.name);
  };

  const planTopLevelFields = (plan: MemoryPlan) => ({
    retentionRigor: plan.retentionRigor,
    dailyPhaseWeeks: plan.dailyPhaseWeeks,
    weeklyPhaseMonths: plan.weeklyPhaseMonths,
    monthlyPhaseYears: plan.monthlyPhaseYears,
    masteryTouches: plan.masteryTouches,
    reviewsRequired: plan.reviewsRequired,
    missPolicy: plan.missPolicy,
    missPolicyAskEveryTime: plan.missPolicyAskEveryTime,
    graceCount: plan.graceCount,
    refresherDailyDays: plan.refresherDailyDays,
    refresherWeeklyWeeks: plan.refresherWeeklyWeeks,
    name: plan.name,
  });

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

  // ==========================================
  // REVIEW SETTINGS ARE NOT SHAREABLE
  // ==========================================
  // There used to be two ways to hand your retention method to someone else
  // -- a public `sharedPlans` collection (browse/join/publish) and a
  // friends-only snapshot on your profile -- and both were removed on purpose:
  // a set of phase lengths and miss rules is a personal calibration, not
  // content worth a distribution system, and every surface it touched
  // (Community browse, profile visibility settings, adoption toasts) cost a
  // new user more confusion than the feature was ever worth. Anyone who wants
  // to compare notes with a friend can screenshot the screen. handleSavePlan
  // is the only way a set of Review Settings is written now, and it writes to
  // your own savedPlans and nowhere else (publishSharedPlan went with the rest).
  //
  // GroupPlan (useGroupPlans) is a different thing entirely and stays: it's a
  // circle's curated LIST OF VERSES plus a target pace, not a retention method.

  const handleActivatePlan = async (planId: string) => {
    const updatedPlans = savedPlans.map((p) => ({
      ...p,
      isActive: p.id === planId,
    }));
    setSavedPlans(updatedPlans);

    const activePlan = updatedPlans.find((p) => p.isActive);
    if (activePlan) {
      syncDesignerFromPlan(activePlan);

      triggerToast(`Now using "${activePlan.name}".`);

      if (auth.currentUser) {
        try {
          const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
          // merge: true — preserve activeGroupPlanId, which lives on this
          // same doc but isn't part of this write.
          await setDoc(
            planRef,
            {
              savedPlans: updatedPlans,
              ...planTopLevelFields(activePlan),
              updatedAt: new Date(),
            },
            { merge: true }
          );
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
        }
      }
    }
  };

  // Deletes a saved plan. Refuses to delete the last remaining plan (a user
  // must always have at least one). If the deleted plan was the active one,
  // the first remaining plan becomes active and its settings are synced into
  // the live editing state, the same way switching plans normally works.
  const handleDeletePlan = async (planId: string) => {
    if (savedPlans.length <= 1) {
      triggerToast("You need at least one set of review settings. Make another first.");
      return;
    }
    const deletedPlan = savedPlans.find((p) => p.id === planId);
    const wasActive = !!deletedPlan?.isActive;
    let updatedPlans = savedPlans.filter((p) => p.id !== planId);
    if (wasActive) {
      updatedPlans = updatedPlans.map((p, i) => ({ ...p, isActive: i === 0 }));
    }

    if (wasActive) {
      syncDesignerFromPlan(updatedPlans[0]);
    }
    if (editingPlanId === planId) setEditingPlanId(null);

    setSavedPlans(updatedPlans);
    triggerToast(`Deleted "${deletedPlan?.name || 'plan'}".`);

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        const activePlan = updatedPlans.find((p) => p.isActive) || updatedPlans[0];
        await setDoc(
          planRef,
          {
            savedPlans: updatedPlans,
            ...planTopLevelFields(activePlan),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }
  };

  const handleEditPlan = (plan: MemoryPlan) => {
    setEditingPlanId(plan.id);
    syncDesignerFromPlan(plan);
    navigateTo('planDesigner');
  };

  // "Plan & Pacing" from the Memory Desk: edit whichever plan is actually
  // active. Explicit rather than a navigateTo side effect -- see the note
  // there.
  const openActivePlanDesigner = () => {
    const active = savedPlans.find((p) => p.isActive) || savedPlans[0];
    if (active) {
      setEditingPlanId(active.id);
      syncDesignerFromPlan(active);
    } else {
      setEditingPlanId(null);
    }
    navigateTo('planDesigner');
  };

  const handleCreateNewPlan = () => {
    setEditingPlanId(null);
    setRetentionRigor('standard');
    setDailyPhaseWeeks(7);
    setWeeklyPhaseMonths(6);
    setMonthlyPhaseYears(5);
    setMasteryTouches(3);
    setReviewsRequired(1);
    setMissPolicy('standard');
    setMissPolicyAskEveryTime(false);
    setGraceCount(1);
    setRefresherDailyDays(7);
    setRefresherWeeklyWeeks(4);
    setCustomPlanName('My settings');
    navigateTo('planDesigner');
  };

  // Is the designer currently pointed at the shipped, immutable plan?
  // PlanDesignerScreen uses this to require a new name before saving.
  const isEditingBuiltInPlan = savedPlans.some((p) => p.id === editingPlanId && p.isBuiltIn);

  const handleSavePlan = async () => {
    let updatedPlans = [...savedPlans];

    // Retention fields only -- pacing lives in Rhythm now and is never
    // written to a plan.
    const editedFields = {
      retentionRigor,
      dailyPhaseWeeks,
      weeklyPhaseMonths,
      monthlyPhaseYears,
      masteryTouches,
      reviewsRequired,
      missPolicy,
      missPolicyAskEveryTime,
      graceCount,
      refresherDailyDays,
      refresherWeeklyWeeks,
    };

    const targetPlan = savedPlans.find((p) => p.id === editingPlanId);
    // Copy-on-write: the shipped plan is the baseline every account starts
    // from, so editing it forks a renamed copy instead of mutating it. The
    // screen requires a changed name before it will call this, so reaching
    // here with the built-in's own name would mean a UI bug, not a user
    // choice -- fall back to a suffixed name rather than silently
    // overwriting the baseline.
    const isForkingBuiltIn = !!targetPlan?.isBuiltIn;

    if (targetPlan && !isForkingBuiltIn) {
      updatedPlans = updatedPlans.map((p) =>
        p.id === editingPlanId
          ? { ...p, name: customPlanName || 'My settings', ...editedFields, updatedAt: new Date().toISOString() }
          : p
      );
      triggerToast(`Saved "${customPlanName}".`);
    } else {
      const forkedName =
        isForkingBuiltIn && customPlanName.trim() === targetPlan?.name
          ? `${targetPlan.name} (Custom)`
          : customPlanName || 'My settings';

      const newPlan: MemoryPlan = {
        id: 'plan-' + Date.now(),
        name: forkedName,
        ...editedFields,
        isActive: true,
        updatedAt: new Date().toISOString(),
      };

      updatedPlans = updatedPlans.map((p) => ({ ...p, isActive: false }));
      updatedPlans.push(newPlan);
      triggerToast(
        isForkingBuiltIn
          ? `Saved "${forkedName}" as your own copy and switched to it.`
          : `Saved "${forkedName}" and switched to it.`
      );
    }

    const activePlan = updatedPlans.find((p) => p.isActive) || updatedPlans[0];
    if (activePlan) {
      syncDesignerFromPlan(activePlan);
    }

    setSavedPlans(updatedPlans);
    setEditingPlanId(null);

    if (auth.currentUser) {
      try {
        const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
        // merge: true — a plain setDoc here erased activeGroupPlanId every
        // time a plan was saved. The full
        // planTopLevelFields spread also fixes this write silently dropping
        // the rigor/mastery/sabbath fields.
        await setDoc(
          planRef,
          {
            savedPlans: updatedPlans,
            ...planTopLevelFields(activePlan),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `memoryPlans/${auth.currentUser.uid}`);
      }
    }

    navigateTo('savedPlans');
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
    retentionRigor,
    setRetentionRigor,
    dailyPhaseWeeks,
    setDailyPhaseWeeks,
    weeklyPhaseMonths,
    setWeeklyPhaseMonths,
    monthlyPhaseYears,
    setMonthlyPhaseYears,
    masteryTouches,
    setMasteryTouches,
    reviewsRequired,
    setReviewsRequired,
    sabbathEnabled,
    setSabbathEnabled,
    sabbathDay,
    setSabbathDay,
    dayStartHour,
    setDayStartHour,
    missPolicy,
    setMissPolicy,
    missPolicyAskEveryTime,
    setMissPolicyAskEveryTime,
    graceCount,
    setGraceCount,
    refresherDailyDays,
    setRefresherDailyDays,
    refresherWeeklyWeeks,
    setRefresherWeeklyWeeks,
    pausedAt,
    setPausedAt,
    pausedUntil,
    setPausedUntil,
    reviewsPaused,
    customPlanName,
    setCustomPlanName,
    savedPlans,
    setSavedPlans,
    editingPlanId,
    setEditingPlanId,
    syncDesignerFromPlan,
    planTopLevelFields,
    updateRhythm,
    handleActivatePlan,
    handleDeletePlan,
    handleEditPlan,
    openActivePlanDesigner,
    handleCreateNewPlan,
    isEditingBuiltInPlan,
    handleSavePlan,
    pauseReviews,
    resumeReviews,
  };
}

export type PlanSettings = ReturnType<typeof usePlanSettings>;

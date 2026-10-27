// What happens to a verse when a review is missed: grace, a longer Daily
// stint, a refresher detour out of Weekly/Monthly, or (by the user's choice)
// a freeze or a plain streak reset. Pure -- operates on QueueItem drafts and
// never touches React state or Firestore.
import type { MemoryPlan, QueueItem } from '../types';
import { getLogicalDate, scheduledDaysBetween } from './logicalDate';

export type MissTag = 'grace' | 'daily-extended' | 'refresher-start' | 'refresher-extended' | 'frozen' | 'streak-reset' | 'none';

// The active plan's own graceCount/refresherDailyDays/refresherWeeklyWeeks
// (see MemoryPlan.missPolicy in types.ts).
export interface MissPolicyConfig {
  graceCount: number;
  refresherDailyDays: number;
  refresherWeeklyWeeks: number;
}

// Applies exactly one "miss" to a draft QueueItem (mutated in place) and
// returns a tag describing what happened, so callers can build a toast.
// Called once per real failed review, and once per calendar cycle silently
// skipped while the app wasn't opened (see the catch-up loop in
// handleReviewCompleted) -- both are the same kind of "miss" to this engine.
// `policy` comes from the active plan's missPolicy settings (Plan Designer
// Advanced tab); a plan on the 'graceDiscretion' preset never reaches this
// function at all for catch-up misses -- see resolveMissedCycles below,
// which freezes the whole gap before looping ever starts.
export const applyMissToItem = (draft: QueueItem, policy: MissPolicyConfig): MissTag => {
  const graceUsed = draft.graceMissesUsed || 0;
  if (graceUsed < policy.graceCount) {
    draft.graceMissesUsed = graceUsed + 1;
    draft.gracePeriodUsedToday = true;
    return 'grace';
  }

  const priorStreak = draft.currentStreakCount;
  draft.currentStreakCount = 0;
  // graceMissesUsed stays at its cap here -- grace only refills on an actual
  // success (handled in handleReviewCompleted's success branch). Otherwise
  // consecutive misses would each get fresh grace instead of escalating.

  if (draft.refresherActive) {
    const extension = draft.refresherReturnPhase === 'monthly' ? policy.refresherWeeklyWeeks : policy.refresherDailyDays;
    draft.refresherTargetUnits = (draft.refresherTargetUnits || 0) + extension;
    return 'refresher-extended';
  }

  if (draft.retentionPhase === 'daily') {
    draft.dailyPhaseExtensionDays = (draft.dailyPhaseExtensionDays || 0) + 1;
    return 'daily-extended';
  }

  if (draft.retentionPhase === 'weekly') {
    draft.refresherActive = true;
    draft.refresherReturnPhase = 'weekly';
    draft.refresherReturnProgress = priorStreak;
    draft.refresherTargetUnits = policy.refresherDailyDays;
    draft.retentionPhase = 'daily';
    return 'refresher-start';
  }

  if (draft.retentionPhase === 'monthly') {
    draft.refresherActive = true;
    draft.refresherReturnPhase = 'monthly';
    draft.refresherReturnProgress = priorStreak;
    draft.refresherTargetUnits = policy.refresherWeeklyWeeks;
    draft.retentionPhase = 'weekly';
    return 'refresher-start';
  }

  return 'none';
};

// Builds the toast copy for a single miss tag (see applyMissToItem). Shared
// between the "silently missed cycles while away" catch-up and today's own
// failed attempt, so both describe the same outcomes the same way.
export const describeMissOutcome = (tag: MissTag, draft: QueueItem, dailyGraduationDaysTotal: number): string | null => {
  const returnLabel = draft.refresherReturnPhase === 'monthly' ? 'Monthly' : 'Weekly';
  const unitLabel = draft.refresherReturnPhase === 'monthly' ? 'weeks' : 'days';
  switch (tag) {
    case 'grace':
      return 'Grace period used! Get it right next time to avoid falling back. 🛡️';
    case 'daily-extended':
      return `Missed after your grace period was already used -- streak reset, and Daily now needs ${dailyGraduationDaysTotal} days total instead of fewer. Still Daily, just a bit longer. 🔄`;
    case 'refresher-start':
      return `Missed after your grace period was already used -- sent to a ${draft.refresherTargetUnits}-${
        unitLabel === 'weeks' ? 'week' : 'day'
      } refresher, then back to ${returnLabel} review right where you left off. 🔄`;
    case 'refresher-extended':
      return `Missed again during the refresher -- it's now ${draft.refresherTargetUnits} ${unitLabel} before you return to ${returnLabel} review. 🔄`;
    case 'frozen':
      return "No penalty -- streak and progress are untouched, right where you left off. 🕊️";
    case 'streak-reset':
      return 'Streak reset, but no refresher detour -- staying right where you are. 🔄';
    default:
      return null;
  }
};

// Resolves a full catch-up event (missedCycles worth of silently-skipped
// cycles) for one item in a single call, so both the reactive per-item
// catch-up in handleReviewCompleted and the proactive missed-review popup
// (shown on app open) can share the exact same outcomes instead of two
// hand-written copies drifting apart.
//
// `forcedOutcome` is the user's explicit popup choice for this item, if any:
//   - 'grace'    -- freeze the whole gap, as if it never happened.
//   - 'escalate' -- run the normal per-cycle miss loop (today's default).
//   - 'reset'    -- lose streak progress only, no phase/refresher change.
// With no forcedOutcome (the reactive fallback path, or auto-apply when
// missPolicyAskEveryTime is off), a plan on the 'graceDiscretion' preset
// always resolves to 'grace'; every other preset resolves to 'escalate'.
export const resolveMissedCycles = (
  item: QueueItem,
  missedCycles: number,
  missPolicy: MemoryPlan['missPolicy'],
  policy: MissPolicyConfig,
  forcedOutcome?: 'grace' | 'escalate' | 'reset'
): { updatedItem: QueueItem; tag: MissTag } => {
  const outcome = forcedOutcome || (missPolicy === 'graceDiscretion' ? 'grace' : 'escalate');
  const updatedItem = { ...item };

  if (outcome === 'grace') {
    return { updatedItem, tag: 'frozen' };
  }

  if (outcome === 'reset') {
    updatedItem.currentStreakCount = 0;
    return { updatedItem, tag: 'streak-reset' };
  }

  let lastTag: MissTag = 'none';
  for (let i = 0; i < missedCycles; i++) {
    lastTag = applyMissToItem(updatedItem, policy);
  }
  return { updatedItem, tag: lastTag };
};

// How many full review cycles have been silently missed for this item, net
// of Sabbath and Pause days (neither counts as elapsed time). Shared by the
// reactive per-item catch-up in handleReviewCompleted and the proactive
// missed-review popup scan in loadUserData, so both agree on what counts as
// "missed" -- see resolveMissedCycles for what happens once this is > 0.
export const computeMissedCycles = (
  item: QueueItem,
  dayStartHour: number,
  sabbathEnabled: boolean,
  sabbathDay: string,
  pausedAt: string | null,
  pausedUntil: string | null
): number => {
  if (item.status !== 'reviewing' || !item.nextReviewDueDate) return 0;
  const cycleLengthDays = item.retentionPhase === 'weekly' ? 7 : item.retentionPhase === 'monthly' ? 30 : 1;
  const dueDate = new Date(item.nextReviewDueDate);
  const now = getLogicalDate(dayStartHour);
  const adjustedElapsedDays = scheduledDaysBetween(dueDate, now, sabbathEnabled, sabbathDay, pausedAt, pausedUntil);
  return Math.max(0, Math.floor(adjustedElapsedDays / cycleLengthDays));
};

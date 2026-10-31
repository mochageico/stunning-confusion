import type { GroupPlan, QueueItem } from '../types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface GroupPlanProgress {
  /** Verses in the plan. */
  total: number;
  /** Plan verses past Learning (Settling or later). */
  learned: number;
  /** Plan verses pulled out of the queue in the last 7 days. */
  pulledThisWeek: number;
  /** Of those, how many are already learned. */
  learnedThisWeek: number;
  /** Pulls still due this week against the plan's weekly pace. */
  leftThisWeek: number;
}

// Pure. Reads only this member's own queue: what they have learned and pulled
// from the plan, the same 7-day window the scheduler uses for its weekly
// budget (groupPlanScheduler's pulledFromPlanLast7Days).
export function groupPlanProgress(queue: QueueItem[], plan: GroupPlan, now: Date = new Date()): GroupPlanProgress {
  const cutoff = now.getTime() - 7 * MS_PER_DAY;
  let learned = 0;
  let pulledThisWeek = 0;
  let learnedThisWeek = 0;
  for (const item of queue) {
    if (item.originPlanId !== plan.planId) continue;
    const isLearned = item.status === 'reviewing' || item.status === 'retained';
    if (isLearned) learned++;
    if (item.status !== 'queued' && item.dateStarted !== null && new Date(item.dateStarted).getTime() >= cutoff) {
      pulledThisWeek++;
      if (isLearned) learnedThisWeek++;
    }
  }
  return {
    total: plan.verseIds.length,
    learned,
    pulledThisWeek,
    learnedThisWeek,
    leftThisWeek: Math.max(0, plan.versesPerWeek - pulledThisWeek),
  };
}

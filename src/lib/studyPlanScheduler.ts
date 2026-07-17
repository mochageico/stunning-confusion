import { QueueItem, StudyPlan, StudyPlanMembership } from '../types';

// ============================================================================
// STUDY PLAN SCHEDULER
// ----------------------------------------------------------------------------
// Pure logic, no React/Firestore -- mirrors reviewCalendar.ts's/recitation.ts's
// shape. Decides which verseIds a member's daily new-verse pull should
// actually promote out of 'queued' today, blending their own individual
// queue with verses from however many StudyPlans they've joined.
//
// Deployment TIMING (which days count at all) always comes from the member's
// own personal learningDays/Sabbath -- a StudyPlan has no day-of-week concept
// of its own. This module assumes the caller has already confirmed today is
// a real learning day for this member; it only decides HOW MANY of which
// origin to pull once that's true.
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PersonalPacingSettings {
  newVersesPace: number; // personal daily cap for new verses, on a learning day
  learningDays: string[]; // DAY_ABBREVS values, e.g. ['M', 'W', 'F'] -- only its LENGTH matters here
}

export interface DailyPullResult {
  verseIds: string[]; // every verseId to promote 'queued' -> 'learning' today, in pull order
  fromIndividual: string[];
  fromPlans: Record<string, string[]>; // planId -> verseIds pulled from that plan today
}

// How many of a plan's verses has this member pulled (promoted out of
// 'queued') in the last 7 days? Derived straight from the queue itself --
// no separate stored weekly counter needed, same reasoning as memoryStreak/
// activityByDay being derived from touchLogs rather than a counter.
function pulledFromPlanLast7Days(queue: QueueItem[], planId: string, today: Date): number {
  const cutoff = today.getTime() - 7 * MS_PER_DAY;
  return queue.filter(
    (item) =>
      item.originPlanId === planId &&
      item.status !== 'queued' &&
      item.dateStarted !== null &&
      new Date(item.dateStarted).getTime() >= cutoff
  ).length;
}

// A plan's target pace for TODAY: its weekly pace spread evenly across the
// member's own fixed weekly learning-day count, but never more than what's
// actually left of this plan's weekly budget (self-corrects if a learning
// day was skipped, rather than permanently losing that capacity).
function dailyShareForPlan(plan: StudyPlan, queue: QueueItem[], learningDaysPerWeek: number, today: Date): number {
  const remainingWeeklyBudget = Math.max(0, plan.versesPerWeek - pulledFromPlanLast7Days(queue, plan.planId, today));
  const evenShare = Math.ceil(plan.versesPerWeek / Math.max(1, learningDaysPerWeek));
  return Math.min(evenShare, remainingWeeklyBudget);
}

function queuedVerseIdsForPlan(queue: QueueItem[], planId: string): string[] {
  return queue
    .filter((item) => item.status === 'queued' && item.originPlanId === planId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((item) => item.verseId);
}

function queuedIndividualVerseIds(queue: QueueItem[]): string[] {
  return queue
    .filter((item) => item.status === 'queued' && item.origin !== 'group')
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((item) => item.verseId);
}

/**
 * Decides today's new-verse pull. Resolution order when a member has joined
 * more than one plan with different priorities:
 *
 *  1. 'additive' plans pull their own daily share first, in full (bounded
 *     only by how many of that plan's verses are actually still queued) --
 *     deliberately UNCAPPED by the personal daily budget.
 *  2. The personal daily budget (newVersesPace) is then consumed in order:
 *     a. 'group'-priority plans' queued verses (in the order joined)
 *     b. the member's own individual-origin queued verses
 *     c. 'individual'-priority plans' queued verses (in the order joined)
 */
export function computeDailyPull(
  queue: QueueItem[],
  personal: PersonalPacingSettings,
  joinedPlans: StudyPlan[],
  memberships: StudyPlanMembership[],
  today: Date = new Date()
): DailyPullResult {
  const learningDaysPerWeek = personal.learningDays.length;
  const planById = new Map(joinedPlans.map((p) => [p.planId, p]));

  const membershipsWithPlan = memberships
    .map((m) => ({ membership: m, plan: planById.get(m.planId) }))
    .filter((x): x is { membership: StudyPlanMembership; plan: StudyPlan } => !!x.plan);

  const fromPlans: Record<string, string[]> = {};
  const verseIds: string[] = [];

  const pullFromPlan = (plan: StudyPlan, cap: number): string[] => {
    const available = queuedVerseIdsForPlan(queue, plan.planId);
    const share = dailyShareForPlan(plan, queue, learningDaysPerWeek, today);
    const take = Math.max(0, Math.min(share, cap, available.length));
    return available.slice(0, take);
  };

  // 1. Additive plans -- uncapped by personal budget.
  membershipsWithPlan
    .filter((x) => x.membership.priority === 'additive')
    .forEach(({ plan }) => {
      const pulled = pullFromPlan(plan, Infinity);
      if (pulled.length > 0) {
        fromPlans[plan.planId] = [...(fromPlans[plan.planId] || []), ...pulled];
        verseIds.push(...pulled);
      }
    });

  // 2. Personal daily budget, consumed in priority order.
  let remainingBudget = personal.newVersesPace;

  membershipsWithPlan
    .filter((x) => x.membership.priority === 'group')
    .forEach(({ plan }) => {
      if (remainingBudget <= 0) return;
      const pulled = pullFromPlan(plan, remainingBudget);
      if (pulled.length > 0) {
        fromPlans[plan.planId] = [...(fromPlans[plan.planId] || []), ...pulled];
        verseIds.push(...pulled);
        remainingBudget -= pulled.length;
      }
    });

  const fromIndividual: string[] = [];
  if (remainingBudget > 0) {
    const availableIndividual = queuedIndividualVerseIds(queue);
    const pulled = availableIndividual.slice(0, remainingBudget);
    fromIndividual.push(...pulled);
    verseIds.push(...pulled);
    remainingBudget -= pulled.length;
  }

  membershipsWithPlan
    .filter((x) => x.membership.priority === 'individual')
    .forEach(({ plan }) => {
      if (remainingBudget <= 0) return;
      const pulled = pullFromPlan(plan, remainingBudget);
      if (pulled.length > 0) {
        fromPlans[plan.planId] = [...(fromPlans[plan.planId] || []), ...pulled];
        verseIds.push(...pulled);
        remainingBudget -= pulled.length;
      }
    });

  return { verseIds, fromIndividual, fromPlans };
}

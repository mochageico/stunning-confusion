import { QueueItem, GroupPlan, GroupPlanMembership } from '../types';

// ============================================================================
// GROUP PLAN SCHEDULER
// ----------------------------------------------------------------------------
// Pure logic, no React/Firestore -- mirrors reviewCalendar.ts's/recitation.ts's
// shape. Decides which verseIds a member's daily new-verse pull should
// actually promote out of 'queued' today, blending their own individual
// queue with verses from however many GroupPlans they've joined.
//
// Deployment TIMING (which days count at all) always comes from the member's
// own personal learningDays/Sabbath -- a GroupPlan has no day-of-week concept
// of its own. This module assumes the caller has already confirmed today is
// a real learning day for this member; it only decides HOW MANY of which
// origin to pull once that's true.
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PersonalPacingSettings {
  newVersesPace: number; // personal daily cap for new verses, on a learning day
  learningDays: string[]; // DAY_ABBREVS values, e.g. ['M', 'W', 'F'] -- only its LENGTH matters here
  /** Today is this member's own Sabbath: scheduled plan verses wait for the next plan day. */
  sabbathToday?: boolean;
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
function dailyShareForPlan(plan: GroupPlan, queue: QueueItem[], learningDaysPerWeek: number, today: Date): number {
  const remainingWeeklyBudget = Math.max(0, plan.versesPerWeek - pulledFromPlanLast7Days(queue, plan.planId, today));
  const evenShare = Math.ceil(plan.versesPerWeek / Math.max(1, learningDaysPerWeek));
  return Math.min(evenShare, remainingWeeklyBudget);
}

const isScheduled = (plan: GroupPlan): boolean => !!plan.days && plan.days.length > 0;

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
  joinedPlans: GroupPlan[],
  memberships: GroupPlanMembership[],
  today: Date = new Date()
): DailyPullResult {
  const learningDaysPerWeek = personal.learningDays.length;
  const planById = new Map(joinedPlans.map((p) => [p.planId, p]));

  const membershipsWithPlan = memberships
    .map((m) => ({ membership: m, plan: planById.get(m.planId) }))
    .filter((x): x is { membership: GroupPlanMembership; plan: GroupPlan } => !!x.plan);

  const fromPlans: Record<string, string[]> = {};
  const verseIds: string[] = [];

  const pullFromPlan = (plan: GroupPlan, cap: number): string[] => {
    const available = queuedVerseIdsForPlan(queue, plan.planId);
    const share = dailyShareForPlan(plan, queue, learningDaysPerWeek, today);
    const take = Math.max(0, Math.min(share, cap, available.length));
    return available.slice(0, take);
  };

  // 1. Additive plans -- uncapped by personal budget.
  membershipsWithPlan
    .filter((x) => x.membership.priority === 'additive' && !isScheduled(x.plan))
    .forEach(({ plan }) => {
      const pulled = pullFromPlan(plan, Infinity);
      if (pulled.length > 0) {
        fromPlans[plan.planId] = [...(fromPlans[plan.planId] || []), ...pulled];
        verseIds.push(...pulled);
      }
    });

  // 2. Personal daily budget, consumed in priority order.
  let remainingBudget = personal.newVersesPace;

  // Scheduled plans (the leader set days and a count per day) hand out their
  // own verses on their own days, whatever the member's personal learning
  // days are. 'Counts toward my pace' takes them out of today's personal
  // budget; 'on top' leaves the budget alone.
  membershipsWithPlan
    .filter((x) => isScheduled(x.plan))
    .forEach(({ plan, membership }) => {
      if (personal.sabbathToday) return;
      const due = scheduledDue(queue, plan, today, membership.joinedAt);
      if (!due || due.due === 0) return;
      const pulled = queuedVerseIdsForPlan(queue, plan.planId).slice(0, due.due);
      if (pulled.length === 0) return;
      fromPlans[plan.planId] = [...(fromPlans[plan.planId] || []), ...pulled];
      verseIds.push(...pulled);
      if (membership.priority !== 'additive') remainingBudget = Math.max(0, remainingBudget - pulled.length);
    });

  membershipsWithPlan
    .filter((x) => x.membership.priority === 'group' && !isScheduled(x.plan))
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
    .filter((x) => x.membership.priority === 'individual' && !isScheduled(x.plan))
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

// ---------------------------------------------------------------------------
// Scheduled plans (a leader-set schedule: days + verses per day)
// ---------------------------------------------------------------------------

/** Local midnight of the Monday that starts `d`'s week. */
export function weekStartMonday(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export interface ScheduledDue {
  /** Plan verses to start today, carried-over ones included. */
  due: number;
  /** Of those, how many were due on an earlier plan day this week. */
  carried: number;
}

const DAY_ABBREVS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']; // index matches Date.getDay()

/**
 * How many of a scheduled plan's verses are due to start today. Counts every
 * plan day this week up to today (a member's own Sabbath included: that day's
 * verses simply come due on the next plan day), minus what was already
 * started this week. Missed days carry over but never past the week's total,
 * so nothing piles up from week to week. Days before `joinedAt` don't count.
 * Returns null for a plan with no schedule (older plans).
 */
export function scheduledDue(queue: QueueItem[], plan: GroupPlan, today: Date, joinedAt?: string): ScheduledDue | null {
  if (!plan.days || plan.days.length === 0) return null;
  const perDay = Math.max(1, plan.versesPerDay ?? 1);
  const ws = weekStartMonday(today);
  const joined = joinedAt ? new Date(joinedAt) : null;
  const from = joined && !Number.isNaN(joined.getTime()) ? new Date(joined.getFullYear(), joined.getMonth(), joined.getDate()) : ws;
  const counted = from.getTime() > ws.getTime() ? from : ws;
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let soFar = 0;
  let weekTotal = 0;
  for (let i = 0; i < 7; i++) {
    const date = new Date(ws);
    date.setDate(ws.getDate() + i);
    if (date.getTime() < counted.getTime()) continue;
    if (!plan.days.includes(DAY_ABBREVS[date.getDay()])) continue;
    weekTotal += perDay;
    if (date.getTime() <= todayStart.getTime()) soFar += perDay;
  }
  const startedThisWeek = queue.filter(
    (item) =>
      item.originPlanId === plan.planId &&
      item.status !== 'queued' &&
      item.dateStarted !== null &&
      new Date(item.dateStarted).getTime() >= ws.getTime()
  ).length;
  const available = queue.filter((item) => item.status === 'queued' && item.originPlanId === plan.planId).length;
  const owed = Math.min(soFar, weekTotal) - startedThisWeek;
  const due = Math.max(0, Math.min(owed, available));
  const dayShare = plan.days.includes(DAY_ABBREVS[today.getDay()]) && todayStart.getTime() >= counted.getTime() ? perDay : 0;
  return { due, carried: Math.max(0, due - dayShare) };
}

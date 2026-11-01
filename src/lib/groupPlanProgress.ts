import type { GroupPlan, QueueItem } from '../types';
import { scheduledDue } from './groupPlanScheduler';

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

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_KEYS = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']; // index matches Date.getDay()

/** "Romans 8:5-6", or "Romans 8:9, 11-12" for verses with a gap. */
export function formatVerseRefs(items: Pick<QueueItem, 'book' | 'chapter' | 'verseNumber'>[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < items.length) {
    const first = items[i];
    let j = i;
    while (j + 1 < items.length && items[j + 1].book === first.book && items[j + 1].chapter === first.chapter && items[j + 1].verseNumber === items[j].verseNumber + 1) j++;
    const last = items[j];
    const prev = parts.length > 0 ? items[i - 1] : null;
    const sameChapter = prev && prev.book === first.book && prev.chapter === first.chapter;
    const range = j > i ? `${first.verseNumber}-${last.verseNumber}` : `${first.verseNumber}`;
    parts.push(sameChapter ? range : `${first.book} ${first.chapter}:${range}`);
    i = j + 1;
  }
  return parts.join(', ');
}

export interface UpcomingPlanDay {
  /** "Today", "Tomorrow", or a weekday name. */
  day: string;
  refs: string;
}

/**
 * The next plan days and the waiting verses each will hand out, for the plan
 * page. Today is listed only while something is still due; later days take
 * the plan's verses in order, `versesPerDay` at a time.
 */
export function upcomingPlanDays(
  queue: QueueItem[],
  plan: GroupPlan,
  today: Date,
  joinedAt: string | undefined,
  max = 3
): UpcomingPlanDay[] {
  if (!plan.days || plan.days.length === 0) return [];
  const perDay = Math.max(1, plan.versesPerDay ?? 1);
  const waiting = queue
    .filter((item) => item.status === 'queued' && item.originPlanId === plan.planId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const out: UpcomingPlanDay[] = [];
  let used = 0;
  const due = scheduledDue(queue, plan, today, joinedAt)?.due ?? 0;
  if (due > 0) {
    out.push({ day: 'Today', refs: formatVerseRefs(waiting.slice(0, due)) });
    used = due;
  }
  for (let d = 1; d <= 14 && out.length < max && used < waiting.length; d++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
    if (!plan.days.includes(DAY_KEYS[date.getDay()])) continue;
    out.push({ day: d === 1 ? 'Tomorrow' : WEEKDAY_NAMES[date.getDay()], refs: formatVerseRefs(waiting.slice(used, used + perDay)) });
    used += perDay;
  }
  return out;
}

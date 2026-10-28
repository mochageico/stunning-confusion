import type { GroupPlan, GroupPlanMembership, QueueItem } from '../types';
import { computeDailyPull } from './groupPlanScheduler';
import {
  applyOutcome,
  DEFAULT_THOROUGHNESS,
  FIRST_WEEKLY_STEP,
  nextDue,
  stepInfo,
  stepReviewCount,
  type LadderGroup,
  type LadderState,
  type Thoroughness,
} from './ladder';
import { DAY_ABBREVS } from './logicalDate';
import { passages, type Passage } from './passages';
import {
  findChapterReviewAnchor,
  LEARNING_SECONDS_PER_VERSE,
  REVIEW_SECONDS_PER_VERSE,
  type LoadSensitivity,
  type ReviewClock,
} from './retention';
import { isDayPaused, type CalendarPlanSettings } from './reviewCalendar';
import { ladderPlace } from './stageProgress';

// ============================================================================
// MEMORY CALENDAR: THE LADDER, PLAYED FORWARD
// ----------------------------------------------------------------------------
// Pure logic, no React or Firestore. Projects which passages come due each
// future day by playing the engine's own applyOutcome and nextDue forward from
// each passage's real place on the ladder, assuming every review goes well.
// It does not try to predict slips: the same promise the calendar screen makes.
// The Today "Next 7 days" chart, the Verses > Calendar list and the review
// reminders all read this, so none of them can disagree.
// ============================================================================

/** One passage coming due on one day. */
export interface CalendarReview {
  key: string;
  book: string;
  chapter: number;
  first: number;
  last: number;
  /** Verses in the passage: what a review costs. */
  verses: number;
  /** The ladder place it is reviewed at on that day. */
  step: number;
  reviews: number;
  /** Reviews to move up from `step` (null on the top step). */
  need: number | null;
  group: LadderGroup;
  label: string;
  /** First member verse, for opening the verse page. */
  item: QueueItem;
}

export interface CalendarDayProjection {
  date: Date;
  isLearningDay: boolean;
  isSabbath: boolean;
  isPaused: boolean;
  /** Passages projected due this day. */
  dueReviews: CalendarReview[];
  /** Verses in those passages. */
  dueVerses: number;
  /** Review seconds by group, before the load sensitivity multiplier. */
  groupSeconds: Record<LadderGroup, number>;
  /** Verses in Learning that day: today's, until they bank their recalls, plus projected pulls. */
  learningCount: number;
  /** New verses projected to be pulled into Learning this day. */
  newVersesPulled: number;
  /** WHICH verses that pull takes: the real computeDailyPull run forward, day by day. */
  newVerseItems: QueueItem[];
  /** Minutes the day is expected to take, learning and reviews together. */
  minutes: number;
}

export interface CalendarOpts {
  plan: CalendarPlanSettings;
  sensitivity?: LoadSensitivity;
}

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const sensitivityMultiplier = (s: LoadSensitivity | undefined) => (s === 'low' ? 0.75 : s === 'high' ? 1.5 : 1.0);

const clockOf = (plan: CalendarPlanSettings): ReviewClock => ({
  dayStartHour: plan.dayStartHour ?? 0,
  sabbathEnabled: plan.sabbathEnabled,
  sabbathDay: plan.sabbathDay,
  pausedAt: plan.pausedAt ?? null,
  pausedUntil: plan.pausedUntil ?? null,
});

const GROUPS: LadderGroup[] = ['settling', 'steady', 'kept', 'secure'];

const reviewLabel = (p: Pick<Passage, 'book' | 'chapter' | 'first' | 'last'>) =>
  `${p.book} ${p.chapter}:${p.first}${p.last > p.first ? `–${p.last}` : ''}`;

/** A passage's place on the ladder today, for unmigrated verses too. */
const placeOf = (p: Passage): LadderState => ladderPlace(p.items[0]) ?? { step: 0, reviews: 0 };

const earliestDue = (p: Passage): Date | null => {
  let best: Date | null = null;
  for (const q of p.items) {
    if (!q.nextReviewDueDate) continue;
    const d = new Date(q.nextReviewDueDate);
    if (best === null || d < best) best = d;
  }
  return best;
};

/** Every date one passage is reviewed on in [firstDay, windowEnd], with its place that day. */
function projectPassage(p: Passage, queue: QueueItem[], plan: CalendarPlanSettings, firstDay: Date, windowEnd: Date): { date: Date; state: LadderState }[] {
  const thoroughness: Thoroughness = plan.thoroughness ?? DEFAULT_THOROUGHNESS;
  const clock = clockOf(plan);
  const out: { date: Date; state: LadderState }[] = [];
  let state = placeOf(p);
  let anchor = p.items.find((q) => q.chapterReviewAnchorDay)?.chapterReviewAnchorDay ?? findChapterReviewAnchor(p.book, p.chapter, queue);

  // An overdue passage (or one due mid-pause) is due on the first active day,
  // not on its stale date; every later date cascades from there, the way the
  // real due date is always counted from when the review is actually done.
  const stored = earliestDue(p);
  let due = stored ? startOfDay(stored) : new Date(firstDay);
  if (due < firstDay) due = new Date(firstDay);

  for (let i = 0; due <= windowEnd && i < 400; i++) {
    out.push({ date: due, state });
    const after = applyOutcome(state, 'up', thoroughness);
    if (after.step >= FIRST_WEEKLY_STEP && !anchor) anchor = DAY_ABBREVS[due.getDay()];
    const noon = new Date(due);
    noon.setHours(12, 0, 0, 0);
    due = startOfDay(new Date(nextDue(after.step, anchor, clock, noon)));
    state = after;
  }
  return out;
}

/**
 * Projects the next `days` days (today first): which passages are due, the
 * ongoing Learning count, and new-verse pulls on future learning days. Shares
 * the ladder's math with the review engine and the pull math with
 * triggerDailyPull, so this never quietly disagrees with either.
 */
export function getMemoryCalendarProjection(queue: QueueItem[], plan: CalendarPlanSettings, days: number, opts: { sensitivity?: LoadSensitivity } = {}): CalendarDayProjection[] {
  const today = startOfDay(new Date());
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + days - 1);
  const thoroughness: Thoroughness = plan.thoroughness ?? DEFAULT_THOROUGHNESS;
  const multiplier = sensitivityMultiplier(opts.sensitivity);

  // A verse in Learning takes one perfect recall a day, so it costs its 90
  // seconds only until it has banked them all: today's Learning verses for
  // the touches they still need, and each projected pull for `mastery` days.
  const mastery = Math.max(1, plan.masteryTouches ?? 3);
  const learningLeft = queue
    .filter((item) => item.status === 'learning')
    .map((item) => mastery - (item.touchLogs?.length ?? 0))
    .filter((left) => left > 0);
  const pulledOn: number[] = Array.from({ length: days }, () => 0);

  const pausedByIndex = Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    return isDayPaused(date, i === 0, plan.pausedAt, plan.pausedUntil);
  });
  // Reviews start from the first unpaused day in the window: anything due
  // before then is due that day instead. An open-ended pause shows none.
  const firstActiveIndex = pausedByIndex.indexOf(false);
  const firstActiveDay = new Date(today);
  firstActiveDay.setDate(firstActiveDay.getDate() + Math.max(firstActiveIndex, 0));

  const byDate = new Map<string, CalendarReview[]>();
  if (firstActiveIndex !== -1) {
    for (const p of passages(queue)) {
      for (const { date, state } of projectPassage(p, queue, plan, firstActiveDay, windowEnd)) {
        const key = date.toDateString();
        const bucket = byDate.get(key) ?? [];
        bucket.push({
          key: p.key,
          book: p.book,
          chapter: p.chapter,
          first: p.first,
          last: p.last,
          verses: p.items.length,
          step: state.step,
          reviews: state.reviews,
          need: stepReviewCount(state.step, thoroughness),
          group: stepInfo(state.step).group,
          label: reviewLabel(p),
          item: p.items[0],
        });
        byDate.set(key, bucket);
      }
    }
  }

  // Forward simulation of the real daily pull; see the note in the git history
  // of reviewCalendar.ts: a plan's weekly budget comes from the previous 7
  // days, so each day's pull must be recorded for the next day to see.
  const byId = new Map(queue.map((item) => [item.verseId, item]));
  let simQueue = queue;

  return Array.from({ length: days }, (_, i) => {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const dayAbbrev = DAY_ABBREVS[date.getDay()];
    const isSabbath = plan.sabbathEnabled && dayAbbrev === plan.sabbathDay;
    const isLearningDay = !isSabbath && plan.learningDays.includes(dayAbbrev);

    // Today's own pull is already in the real queue; only project later days.
    let newVerseItems: QueueItem[] = [];
    if (i > 0 && isLearningDay && !pausedByIndex[i]) {
      const { verseIds } = computeDailyPull(
        simQueue,
        { newVersesPace: plan.newVersesPace, learningDays: plan.learningDays },
        plan.joinedPlans || [],
        plan.memberships || [],
        date
      );
      newVerseItems = verseIds.map((id) => byId.get(id)).filter((item): item is QueueItem => !!item);
      if (verseIds.length > 0) {
        const pulled = new Set(verseIds);
        const startedISO = date.toISOString();
        simQueue = simQueue.map((item) => (pulled.has(item.verseId) ? { ...item, status: 'learning' as const, dateStarted: startedISO } : item));
      }
    }
    pulledOn[i] = newVerseItems.length;

    const dueReviews = (byDate.get(date.toDateString()) || []).sort((a, b) => a.step - b.step || a.label.localeCompare(b.label));
    const groupSeconds = { settling: 0, steady: 0, kept: 0, secure: 0 } as Record<LadderGroup, number>;
    let dueVerses = 0;
    for (const r of dueReviews) {
      groupSeconds[r.group] += r.verses * REVIEW_SECONDS_PER_VERSE;
      dueVerses += r.verses;
    }
    let learningCount = learningLeft.filter((left) => left > i).length;
    for (let j = Math.max(1, i - mastery + 1); j <= i; j++) learningCount += pulledOn[j];
    const reviewSeconds = GROUPS.reduce((n, g) => n + groupSeconds[g], 0);
    const minutes = Math.ceil(((reviewSeconds + learningCount * LEARNING_SECONDS_PER_VERSE) * multiplier) / 60);

    return {
      date,
      isLearningDay,
      isSabbath,
      isPaused: pausedByIndex[i],
      dueReviews,
      dueVerses,
      groupSeconds,
      learningCount,
      newVersesPulled: newVerseItems.length,
      newVerseItems,
      minutes,
    };
  });
}

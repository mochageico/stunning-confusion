// ============================================================================
// CIRCLE TOTALS -- what a circle did together this week
// ----------------------------------------------------------------------------
// Each member writes one small stats doc into each of their circles
// (circles/{circleId}/memberStats/{uid}, see useCircleTotals): verses
// reviewed this week, verses held, and which week that was. The circle page
// adds them up into one weekly line, a bar of everyone's share and one
// shared landmark line. Working together, not competing: nothing here ranks
// anyone, and the share bar keeps a fixed member order (join date), never
// sorted by amount.
//
// Pure -- no React, no Firestore -- and checked by `npm run check:circletotals`.
// ============================================================================

import type { CircleMember, CircleMemberStats, QueueItem, ReviewLog } from '../types';
import { getLogicalDate, localDayKey } from './logicalDate';
import { heldLine, ladderPosition, versesHeld } from './milestones';

// ----------------------------------------------------------------------------
// The week
// ----------------------------------------------------------------------------

export interface WeekBounds {
  /** The week's Monday as a local day key (YYYY-MM-DD); what a stats doc stores. */
  key: string;
  /** Monday at the day-start hour, local time. */
  start: Date;
  /** The next Monday at the day-start hour (not included). */
  end: Date;
}

/**
 * The week `now` falls in, Monday first, by the app's logical day: with a
 * 2am day-start hour, Monday 1am still belongs to the week before.
 */
export function weekBounds(now: Date, dayStartHour: number): WeekBounds {
  const logical = getLogicalDate(dayStartHour, now);
  const back = (logical.getDay() + 6) % 7; // Monday 0 ... Sunday 6
  const y = logical.getFullYear();
  const m = logical.getMonth();
  const d = logical.getDate() - back;
  return {
    key: localDayKey(new Date(y, m, d)),
    start: new Date(y, m, d, dayStartHour || 0),
    end: new Date(y, m, d + 7, dayStartHour || 0),
  };
}

const inWeek = (iso: string | undefined, week: WeekBounds): boolean => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= week.start.getTime() && t < week.end.getTime();
};

// ----------------------------------------------------------------------------
// One member's own numbers (what they write)
// ----------------------------------------------------------------------------

/**
 * A review is a counted attempt at a verse past Learning: a pass, a miss, or
 * a miss covered by grace. Learning practice, skipped dates and hand
 * placements are not reviews.
 */
export const isReviewLog = (log: ReviewLog): boolean =>
  log.stage !== 'learning' && (log.result === 'pass' || log.result === 'miss' || log.result === 'grace');

/** Reviews logged this week, across the whole queue (each translation's copy is its own review). */
export function reviewsInWeek(queue: QueueItem[], week: WeekBounds): number {
  let n = 0;
  for (const item of queue) for (const log of item.reviewLogs ?? []) if (isReviewLog(log) && inWeek(log.at, week)) n++;
  return n;
}

/** The fields of the stats doc that matter for "has it changed?" (no time stamp). */
export interface MyWeekStats {
  weekStart: string;
  reviewed: number;
  held: number;
}

export function myWeekStats(queue: QueueItem[], now: Date, dayStartHour: number): MyWeekStats {
  const week = weekBounds(now, dayStartHour);
  return { weekStart: week.key, reviewed: reviewsInWeek(queue, week), held: versesHeld(queue) };
}

/** Caps the rules also enforce (memberStats in firestore.rules). */
export const STATS_REVIEWED_MAX = 100000;
export const STATS_HELD_MAX = 40000;

const count = (v: unknown, max: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
  return Math.min(Math.max(n, 0), max);
};

/** A stats doc as read, cleaned: anything missing or odd reads as zero. */
export function cleanStats(uid: string, data: any): CircleMemberStats {
  return {
    uid,
    weekStart: typeof data?.weekStart === 'string' ? data.weekStart : '',
    reviewed: count(data?.reviewed, STATS_REVIEWED_MAX),
    held: count(data?.held, STATS_HELD_MAX),
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : '',
  };
}

// ----------------------------------------------------------------------------
// The circle together
// ----------------------------------------------------------------------------

export interface SharePart {
  uid: string;
  name: string;
  reviewed: number;
  /** reviewed / the circle's total this week; 0 when nobody has reviewed. */
  fraction: number;
}

export interface CircleTotals {
  reviewed: number;
  held: number;
  /** Takeaways shared to this circle that were written this week, by people still in it. */
  takeaways: number;
  /** Every current member, in join order (never by amount). */
  parts: SharePart[];
}

/** Fixed member order: the day each joined, then uid, so it never moves with the numbers. */
export const memberOrder = (members: CircleMember[]): CircleMember[] =>
  [...members].sort((a, b) => (a.joinedAt || '').localeCompare(b.joinedAt || '') || a.uid.localeCompare(b.uid));

/**
 * Adds up a circle's week. Only current members count: someone who left
 * drops out even if their stats doc is still there, and a member with no doc
 * yet counts as zero. A doc from an earlier week counts as zero reviews this
 * week; its verses held still count (holding doesn't reset on Monday).
 */
export function combineCircle(
  members: CircleMember[],
  stats: CircleMemberStats[],
  shared: { authorUid: string; createdAt: string }[],
  week: WeekBounds
): CircleTotals {
  const byUid = new Map<string, CircleMemberStats>();
  for (const s of stats) {
    const prev = byUid.get(s.uid);
    if (!prev || (s.updatedAt || '') > (prev.updatedAt || '')) byUid.set(s.uid, s);
  }
  const ordered = memberOrder(members);
  const current = new Set(ordered.map((m) => m.uid));
  const rows = ordered.map((m) => {
    const s = byUid.get(m.uid);
    return {
      uid: m.uid,
      name: m.displayName || 'Someone',
      reviewed: s && s.weekStart === week.key ? s.reviewed : 0,
      held: s ? s.held : 0,
    };
  });
  const reviewed = rows.reduce((n, r) => n + r.reviewed, 0);
  return {
    reviewed,
    held: rows.reduce((n, r) => n + r.held, 0),
    takeaways: shared.filter((t) => current.has(t.authorUid) && inWeek(t.createdAt, week)).length,
    parts: rows.map((r) => ({ uid: r.uid, name: r.name, reviewed: r.reviewed, fraction: reviewed > 0 ? r.reviewed / reviewed : 0 })),
  };
}

// ----------------------------------------------------------------------------
// Words
// ----------------------------------------------------------------------------

/** 2140 -> "2,140" (Hermes' toLocaleString isn't reliable). */
export const withCommas = (n: number): string => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const plural = (n: number, one: string, many: string) => `${withCommas(n)} ${n === 1 ? one : many}`;

/** "This week Grace Church Men reviewed 2,140 verses and wrote 6 takeaways." */
export function weeklyLine(circleName: string, t: Pick<CircleTotals, 'reviewed' | 'takeaways'>): string {
  const did = [
    t.reviewed > 0 ? `reviewed ${plural(t.reviewed, 'verse', 'verses')}` : null,
    t.takeaways > 0 ? `wrote ${plural(t.takeaways, 'takeaway', 'takeaways')}` : null,
  ].filter(Boolean);
  if (did.length === 0) return 'No reviews yet this week.';
  return `This week ${circleName} ${did.join(' and ')}.`;
}

/**
 * "Together you hold more verses than the book of Hebrews." Before the first
 * landmark, "Together you hold 8 verses."
 * Empty when nobody holds anything yet.
 */
export function togetherLine(held: number): string {
  if (held <= 0) return '';
  const pos = ladderPosition(held);
  const first = heldLine(pos, 'Together you') ?? `Together you hold ${plural(pos.held, 'verse', 'verses')}.`;
  return first;
}

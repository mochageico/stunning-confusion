import type { GroupPlan, GroupPlanMembership } from '../types';
import type { Thoroughness } from './ladder';

// ============================================================================
// MEMORY CALENDAR SETTINGS AND PAUSE
// ----------------------------------------------------------------------------
// The projection itself (which passages come due each day) lives in
// ladderCalendar.ts. This file keeps the settings it reads and the Pause
// Reviews rules that Home, the time estimate, the calendar and Listen share.
// ============================================================================

export interface CalendarPlanSettings {
  /** Review thoroughness (Retention Level). Standard when left out. */
  thoroughness?: Thoroughness;
  /** Perfect recalls to learn a verse: how many days a verse stays in Learning. Three when left out. */
  masteryTouches?: number;
  /** The hour the user's day starts (Settings). Midnight when left out. */
  dayStartHour?: number;
  learningDays: string[];
  newVersesPace: number;
  sabbathEnabled: boolean;
  sabbathDay: string;
  // Joined group plans, so the projection matches what the real pull will
  // do. Without these the calendar assumed every learning day pulls exactly
  // newVersesPace of your own verses, which is wrong for anyone in a study
  // plan and badly wrong on an 'additive' membership, where the real pull
  // deliberately exceeds the personal pace. Optional: callers with no group
  // plans (and the layout lab) can leave them out.
  joinedPlans?: GroupPlan[];
  memberships?: GroupPlanMembership[];
  // Settings -> Pause Reviews. A paused day has no reviews and no pull, and
  // anything that came due during the pause lands on the first day back --
  // the real engine never moves a due date for a pause, it just stops
  // treating it as due (see isPauseInEffect).
  pausedAt?: string | null;
  pausedUntil?: string | null;
}

/**
 * Whether Pause Reviews is in effect at `at`. An indefinite pause (pausedUntil
 * null) lasts until resumed manually; a dated one ends at its pausedUntil
 * instant. The one definition Home, the time estimate, the calendar and
 * Listen all share, so none of them can show reviews the others hide.
 */
export function isPauseInEffect(pausedAt: string | null | undefined, pausedUntil: string | null | undefined, at: Date = new Date()): boolean {
  if (!pausedAt) return false;
  return !pausedUntil || new Date(pausedUntil) > at;
}

/**
 * Whether a whole calendar day counts as paused. Today follows the pause
 * exactly as it stands right now (matching Home); a future day is paused
 * only if the pause still holds at its end, so the day you come back on
 * shows its reviews.
 */
export function isDayPaused(date: Date, isToday: boolean, pausedAt: string | null | undefined, pausedUntil: string | null | undefined): boolean {
  if (isToday) return isPauseInEffect(pausedAt, pausedUntil);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return isPauseInEffect(pausedAt, pausedUntil, endOfDay);
}

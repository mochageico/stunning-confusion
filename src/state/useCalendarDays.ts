import { useMemo } from 'react';

import type { AppState } from './useAppState';
import { getMemoryCalendarProjection, type CalendarDayProjection } from '../lib/ladderCalendar';

/**
 * The next `days` days of the ladder played forward (ladderCalendar.ts), from
 * the live queue and plan. Today's Next 7 days and the Verses > Calendar list
 * both read this, so they can never disagree.
 */
export function useCalendarDays(state: AppState, days: number): CalendarDayProjection[] {
  const {
    memoryQueue,
    thoroughness,
    masteryTouches,
    dayStartHour,
    learningDays,
    newVersesPace,
    sabbathEnabled,
    sabbathDay,
    joinedGroupPlanDetails,
    joinedGroupPlanMemberships,
    pausedAt,
    pausedUntil,
    cognitiveLoadSensitivity,
  } = state;
  return useMemo(
    () =>
      getMemoryCalendarProjection(
        memoryQueue,
        {
          thoroughness,
          masteryTouches,
          dayStartHour,
          learningDays,
          newVersesPace,
          sabbathEnabled,
          sabbathDay,
          joinedPlans: joinedGroupPlanDetails,
          memberships: joinedGroupPlanMemberships,
          pausedAt,
          pausedUntil,
        },
        days,
        { sensitivity: cognitiveLoadSensitivity }
      ),
    [memoryQueue, thoroughness, masteryTouches, dayStartHour, learningDays, newVersesPace, sabbathEnabled, sabbathDay, joinedGroupPlanDetails, joinedGroupPlanMemberships, pausedAt, pausedUntil, cognitiveLoadSensitivity, days]
  );
}

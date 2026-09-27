import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppState } from '../state/useAppState';
import { QueueItem } from '../types';
import { getMemoryCalendarProjection, CalendarDayProjection, RetentionPhase } from '../lib/reviewCalendar';
import { FadeInView } from '../components/ui';
import { AppText, useScaledSpace } from '../components/design';
import { Dialog, GroupedList, ListRow, ScreenHeader, SegmentedControl } from '../components/blocks';

const PHASE_LABEL: Record<RetentionPhase, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // Sunday-first, matches Date.getDay()

// Rolling windows, not calendar-month-boundary paging -- "what's coming up
// starting today" is more useful for a study-planning tool than "what
// happened earlier this calendar month before today", and it keeps the
// projection safely inside reviewCalendar.ts's ~60-day cap without needing
// month-to-month navigation plumbing.
const WEEK_VIEW_DAYS = 7;
const MONTH_VIEW_WEEKS = 5;

const PHASE_COLORS: Record<RetentionPhase, { dot: string; text: string; bg: string; border: string }> = {
  // Stage color on the dot and stripe only; stage text is too light to read.
  daily: { dot: 'bg-stage-daily', text: 'text-ink', bg: 'bg-surface', border: 'border-line border-l-stage-daily' },
  weekly: { dot: 'bg-stage-weekly', text: 'text-ink', bg: 'bg-surface', border: 'border-line border-l-stage-weekly' },
  monthly: { dot: 'bg-stage-monthly', text: 'text-ink', bg: 'bg-surface', border: 'border-line border-l-stage-monthly' },
};

interface GroupedDueVerse {
  book: string;
  chapter: number;
  verses: number[];
  phase: RetentionPhase;
}

// Same lightweight "consecutive verse run" grouping HomeScreen/ActivePlanScreen
// already each have their own local copy of -- kept local here too rather
// than extracting a shared helper for one more screen's read-only display.
function groupDueReviews(dueReviews: { item: QueueItem; phase: RetentionPhase }[]): GroupedDueVerse[] {
  const sorted = [...dueReviews].sort((a, b) =>
    a.item.book === b.item.book && a.item.chapter === b.item.chapter
      ? a.item.verseNumber - b.item.verseNumber
      : `${a.item.book}${a.item.chapter}`.localeCompare(`${b.item.book}${b.item.chapter}`)
  );
  const groups: GroupedDueVerse[] = [];
  sorted.forEach(({ item, phase }) => {
    const last = groups[groups.length - 1];
    if (last && last.book === item.book && last.chapter === item.chapter && last.phase === phase && last.verses[last.verses.length - 1] === item.verseNumber - 1) {
      last.verses.push(item.verseNumber);
    } else {
      groups.push({ book: item.book, chapter: item.chapter, verses: [item.verseNumber], phase });
    }
  });
  return groups;
}

function versesLabel(verses: number[]): string {
  return verses.length === 1 ? `${verses[0]}` : `${verses[0]}-${verses[verses.length - 1]}`;
}

// Same consecutive-run grouping as groupDueReviews, for the new verses a
// projected day would START (rather than review). Splits on originPlanId as
// well as book/chapter so a run never merges verses from two different
// sources under one plan label.
function groupNewVerses(
  items: QueueItem[],
  planNameById: (planId?: string) => string | undefined
): { book: string; chapter: number; verses: number[]; planName?: string }[] {
  const groups: { book: string; chapter: number; verses: number[]; planId?: string; planName?: string }[] = [];
  items.forEach((item) => {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.book === item.book &&
      last.chapter === item.chapter &&
      last.planId === item.originPlanId &&
      last.verses[last.verses.length - 1] === item.verseNumber - 1
    ) {
      last.verses.push(item.verseNumber);
    } else {
      groups.push({
        book: item.book,
        chapter: item.chapter,
        verses: [item.verseNumber],
        planId: item.originPlanId,
        planName: planNameById(item.originPlanId),
      });
    }
  });
  return groups;
}

export default function MemoryCalendarScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    handleBack,
    navigateTo,
    memoryQueue,
    dailyPhaseWeeks,
    weeklyPhaseMonths,
    monthlyPhaseYears,
    learningDays,
    newVersesPace,
    sabbathEnabled,
    sabbathDay,
    joinedGroupPlanDetails,
    joinedGroupPlanMemberships,
    pausedAt,
    pausedUntil,
    cognitiveLoadSensitivity,
    getEstimatedReviewTime,
  } = state;

  const [viewMode, setViewMode] = useState<'week' | 'month'>('month');
  const [selectedDayIdx, setSelectedDayIdx] = useState<number | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Month view is a rolling grid, not a calendar-month boundary -- starts on
  // the most recent Sunday on/before today so full weeks render, padded with
  // faded past-days-of-this-week cells before today.
  const gridStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [today]);

  // Week view's grid starts at today, not gridStart (that's only for the
  // month view's Sunday-aligned rows) -- using gridStart here regardless of
  // viewMode meant the projection only ever got queried for a few days
  // (today through the following Saturday) in week view, leaving the rest
  // of the 7-day row with no data to show.
  const activeGridStart = viewMode === 'week' ? today : gridStart;
  const totalGridDays = viewMode === 'week' ? WEEK_VIEW_DAYS : MONTH_VIEW_WEEKS * 7;
  const daysFromTodayThroughGridEnd = Math.round((activeGridStart.getTime() - today.getTime()) / 86400000) + totalGridDays;

  const projection = useMemo(
    () =>
      getMemoryCalendarProjection(
        memoryQueue,
        {
          dailyPhaseWeeks,
          weeklyPhaseMonths,
          monthlyPhaseYears,
          learningDays,
          newVersesPace,
          sabbathEnabled,
          sabbathDay,
          joinedPlans: joinedGroupPlanDetails,
          memberships: joinedGroupPlanMemberships,
          pausedAt,
          pausedUntil,
        },
        Math.max(daysFromTodayThroughGridEnd, 1)
      ),
    [memoryQueue, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, learningDays, newVersesPace, sabbathEnabled, sabbathDay, joinedGroupPlanDetails, joinedGroupPlanMemberships, pausedAt, pausedUntil, daysFromTodayThroughGridEnd]
  );

  // Estimated minutes for a projected day, reusing the same per-verse math
  // the Home screen's "about N min today" uses. This is what the 7-day
  // Memory Load Forecast on the queue screen used to show; it belongs here,
  // next to the day it describes and the verses that make it up.
  const planNameById = (planId?: string) =>
    planId ? joinedGroupPlanDetails.find((p) => p.planId === planId)?.name : undefined;

  const loadMinsFor = (day: CalendarDayProjection | null) => {
    if (!day) return 0;
    const dayItems = [
      ...day.dueReviews.map((r) => r.item),
      ...day.newVerseItems,
    ];
    return dayItems.length === 0 ? 0 : getEstimatedReviewTime(dayItems, cognitiveLoadSensitivity);
  };

  // projection[0] is always TODAY -- look up a projection day by its offset
  // from today (may be negative for the faded pre-today grid padding, which
  // simply has no data to show).
  const projectionByOffset = (offset: number): CalendarDayProjection | null => (offset >= 0 && offset < projection.length ? projection[offset] : null);

  const gridDays = useMemo(() => {
    return Array.from({ length: viewMode === 'week' ? WEEK_VIEW_DAYS : MONTH_VIEW_WEEKS * 7 }, (_, i) => {
      const date = new Date(viewMode === 'week' ? today : gridStart);
      date.setDate(date.getDate() + i);
      const offsetFromToday = Math.round((date.getTime() - today.getTime()) / 86400000);
      return { date, offsetFromToday, data: projectionByOffset(offsetFromToday) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, today, gridStart, projection]);

  const selectedDay = selectedDayIdx != null ? gridDays[selectedDayIdx] : null;

  const openChapter = (book: string, chapter: number) => {
    setSelectedDayIdx(null);
    navigateTo('chapterLanding', book, chapter);
  };

  const dueGroups = selectedDay?.data ? groupDueReviews(selectedDay.data.dueReviews) : [];
  const newGroups = selectedDay?.data ? groupNewVerses(selectedDay.data.newVerseItems, planNameById) : [];
  const dayTitle =
    selectedDay?.offsetFromToday === 0
      ? 'Today'
      : selectedDay?.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title="Memory Calendar"
          subtitle="Your reviews ahead, if every one goes well. A miss moves things, so treat this as a preview, not a promise."
          onBack={handleBack}
          backLabel="My Memory Work"
        />

        <View style={{ gap: space(12) }}>
          <SegmentedControl
            value={viewMode}
            onChange={(mode) => {
              setViewMode(mode);
              setSelectedDayIdx(null);
            }}
            accessibilityLabel="Calendar view"
            options={[
              { id: 'week', label: 'Week' },
              { id: 'month', label: 'Month' },
            ]}
          />

          {/* What the dots mean. Stage colors appear on dots only. */}
          <View className="flex-row flex-wrap items-center justify-center" style={{ columnGap: space(14), rowGap: space(4) }}>
            {(['daily', 'weekly', 'monthly'] as RetentionPhase[]).map((phase) => (
              <View key={phase} className="flex-row items-center" style={{ gap: space(5) }}>
                <View className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase].dot}`} />
                <AppText variant="caption" className="font-sans text-ink-2">
                  {PHASE_LABEL[phase]}
                </AppText>
              </View>
            ))}
            <View className="flex-row items-center" style={{ gap: space(5) }}>
              <View className="w-2 h-2 rounded-full bg-fill" />
              <AppText variant="caption" className="font-sans text-ink-2">
                Learning
              </AppText>
            </View>
          </View>
        </View>

        {viewMode === 'week' ? (
          <View className="flex-row" style={{ gap: space(4) }}>
            {gridDays.map((day, idx) => (
              <DayCell
                key={idx}
                day={day}
                isToday={day.offsetFromToday === 0}
                large
                loadMins={loadMinsFor(day.data)}
                onPress={() => setSelectedDayIdx(idx)}
              />
            ))}
          </View>
        ) : (
          <View style={{ gap: space(4) }}>
            {/* The weekday is said once, in this row, not again in every cell. */}
            <View className="flex-row" style={{ gap: space(4) }}>
              {DAY_LABELS.map((label) => (
                <View key={label} className="flex-1 items-center">
                  <AppText variant="caption" className="font-sans font-medium text-ink-3">
                    {label}
                  </AppText>
                </View>
              ))}
            </View>
            {Array.from({ length: MONTH_VIEW_WEEKS }, (_, week) => (
              <View key={week} className="flex-row" style={{ gap: space(4) }}>
                {gridDays.slice(week * 7, week * 7 + 7).map((day, i) => (
                  <DayCell
                    key={i}
                    day={day}
                    isToday={day.offsetFromToday === 0}
                    faded={day.offsetFromToday < 0}
                    loadMins={loadMinsFor(day.data)}
                    onPress={() => setSelectedDayIdx(week * 7 + i)}
                  />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* One day's detail. */}
      <Dialog
        visible={selectedDay != null}
        onClose={() => setSelectedDayIdx(null)}
        placement="sheet"
        title={dayTitle}
        message={selectedDay?.data?.isSabbath ? 'Sabbath. Nothing is scheduled.' : undefined}
      >
        {selectedDay?.offsetFromToday != null && selectedDay.offsetFromToday < 0 ? (
          <AppText variant="label" className="font-sans text-ink-3">
            This day has already passed.
          </AppText>
        ) : (
          <>
            {dueGroups.length > 0 && (
              <GroupedList header="Due for review">
                {dueGroups.map((g, idx) => (
                  <ListRow
                    key={idx}
                    title={`${g.book} ${g.chapter}:${versesLabel(g.verses)}`}
                    value={PHASE_LABEL[g.phase]}
                    onPress={() => openChapter(g.book, g.chapter)}
                  />
                ))}
              </GroupedList>
            )}

            {/* The specific verses this day's pull would start, not just how
                many. The projection runs the real computeDailyPull forward,
                so this also reflects any joined group plans and their
                priority. */}
            {newGroups.length > 0 && (
              <GroupedList header="Starting this day">
                {newGroups.map((g, idx) => (
                  <ListRow
                    key={idx}
                    title={`${g.book} ${g.chapter}:${versesLabel(g.verses)}`}
                    value={g.planName}
                    onPress={() => openChapter(g.book, g.chapter)}
                  />
                ))}
              </GroupedList>
            )}

            {selectedDay?.data && selectedDay.data.learningCount > 0 && (
              <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
                Plus {selectedDay.data.learningCount} {selectedDay.data.learningCount === 1 ? 'verse' : 'verses'} you're
                learning, which aren't tied to a day.
              </AppText>
            )}

            {selectedDay?.data &&
              !selectedDay.data.isSabbath &&
              dueGroups.length === 0 &&
              newGroups.length === 0 &&
              selectedDay.data.learningCount === 0 && (
                <AppText variant="label" className="font-sans text-ink-3">
                  Nothing scheduled this day.
                </AppText>
              )}
          </>
        )}
      </Dialog>
    </FadeInView>
  );
}

function DayCell({
  day,
  isToday,
  faded,
  large,
  loadMins,
  onPress,
}: {
  day: { date: Date; offsetFromToday: number; data: CalendarDayProjection | null };
  isToday: boolean;
  faded?: boolean;
  large?: boolean;
  /** Estimated minutes for this day -- the old queue-screen forecast, per cell. */
  loadMins: number;
  onPress: () => void;
}) {
  const space = useScaledSpace();
  const phasesPresent = Array.from(new Set((day.data?.dueReviews || []).map((r) => r.phase)));
  const totalDue = day.data?.dueReviews.length || 0;
  const hasLearning = (day.data?.learningCount || 0) > 0;
  // Week view has room to name what's actually due, which is the thing the
  // old bar chart could never show. Month cells stay dots-only.
  const firstRef = day.data?.dueReviews[0]?.item;
  const extraRefs = Math.max(0, totalDue - 1);
  const weekday = day.date.toLocaleDateString('en-US', { weekday: 'short' });

  return (
    <Pressable
      onPress={onPress}
      disabled={day.offsetFromToday < 0}
      accessibilityRole="button"
      accessibilityLabel={`${day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${
        totalDue > 0 ? `, ${totalDue} due` : ''
      }${loadMins > 0 ? `, about ${loadMins} ${loadMins === 1 ? 'minute' : 'minutes'}` : ''}`}
      className={`flex-1 items-center rounded-btn border ${isToday ? 'border-accent bg-accent-soft' : 'border-line'} ${
        faded ? 'opacity-30' : isToday ? '' : 'bg-surface'
      }`}
      style={{ gap: space(large ? 6 : 3), paddingVertical: space(large ? 10 : 6), minWidth: 0 }}
    >
      {large && (
        <AppText variant="micro" className={`font-sans font-medium ${isToday ? 'text-accent' : 'text-ink-3'}`}>
          {weekday}
        </AppText>
      )}
      <AppText
        variant={large ? 'title' : 'label'}
        className={`font-sans font-semibold ${isToday ? 'text-accent' : 'text-ink'}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {day.date.getDate()}
      </AppText>

      {!faded && (
        <View className="items-center px-0.5" style={{ gap: space(2), minHeight: space(14) }}>
          <View className="flex-row" style={{ gap: 2 }}>
            {phasesPresent.map((phase) => (
              <View key={phase} className={`w-1.5 h-1.5 rounded-full ${PHASE_COLORS[phase].dot}`} />
            ))}
            {hasLearning && <View className="w-1.5 h-1.5 rounded-full bg-fill" />}
          </View>

          {large && firstRef && (
            <AppText variant="micro" className="font-sans font-medium text-ink-2 text-center" numberOfLines={2}>
              {firstRef.book.slice(0, 3)} {firstRef.chapter}:{firstRef.verseNumber}
              {extraRefs > 0 ? ` +${extraRefs}` : ''}
            </AppText>
          )}
          {large && !firstRef && day.data && day.data.newVersesPulled > 0 && (
            <AppText variant="micro" className="font-sans font-medium text-ink-3 text-center" numberOfLines={1}>
              +{day.data.newVersesPulled} new
            </AppText>
          )}

          {loadMins > 0 && (
            <AppText variant="micro" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {loadMins}m
            </AppText>
          )}
        </View>
      )}
    </Pressable>
  );
}

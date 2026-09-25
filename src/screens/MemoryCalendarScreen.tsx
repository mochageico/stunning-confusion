import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, BookOpen, Sparkles, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { QueueItem } from '../types';
import { getMemoryCalendarProjection, CalendarDayProjection, RetentionPhase } from '../lib/reviewCalendar';
import { FadeInView } from '../components/ui';
import { AppIconButton, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
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
  const palette = useThemeColors();
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
        },
        Math.max(daysFromTodayThroughGridEnd, 1)
      ),
    [memoryQueue, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, learningDays, newVersesPace, sabbathEnabled, sabbathDay, joinedGroupPlanDetails, joinedGroupPlanMemberships, daysFromTodayThroughGridEnd]
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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface" />
          <View className="flex-1">
            <AppText variant="title" className="font-serif font-black text-ink mt-0.5">Memory Calendar</AppText>
          </View>
        </View>

        <AppText variant="caption" className="text-ink-3 leading-relaxed -mt-2">
          Projects your Daily, Weekly, and Monthly reviews forward assuming every one goes well. A real miss shifts
          things, so treat this as a preview, not a promise.
        </AppText>

        {/* Week / Month Toggle */}
        <View className="flex-row items-center justify-between bg-surface-2 p-1.5 border border-line rounded-xl">
          <AppText variant="label" className="font-sans font-bold text-ink-2 pl-1">Calendar View</AppText>
          <View className="flex-row bg-surface border border-line rounded-lg p-0.5">
            <Pressable
              onPress={() => {
                setViewMode('week');
                setSelectedDayIdx(null);
              }}
              className={`px-3 py-1.5 rounded-md ${viewMode === 'week' ? 'bg-accent' : ''}`}
            >
              <AppText variant="label" className={`font-bold ${viewMode === 'week' ? 'text-on-accent' : 'text-ink-3'}`}>Week</AppText>
            </Pressable>
            <Pressable
              onPress={() => {
                setViewMode('month');
                setSelectedDayIdx(null);
              }}
              className={`px-3 py-1.5 rounded-md ${viewMode === 'month' ? 'bg-accent' : ''}`}
            >
              <AppText variant="label" className={`font-bold ${viewMode === 'month' ? 'text-on-accent' : 'text-ink-3'}`}>Month</AppText>
            </Pressable>
          </View>
        </View>

        {/* Phase legend */}
        <View className="flex-row items-center gap-3 flex-wrap">
          {(['daily', 'weekly', 'monthly'] as RetentionPhase[]).map((phase) => (
            <View key={phase} className="flex-row items-center gap-1">
              <View className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase].dot}`} />
              <AppText variant="micro" className="font-sans font-bold text-ink-3 capitalize">{phase}</AppText>
            </View>
          ))}
          <View className="flex-row items-center gap-1">
            <View className="w-2 h-2 rounded-full bg-fill" />
            <AppText variant="micro" className="font-sans font-bold text-ink-3">Learning</AppText>
          </View>
        </View>

        {viewMode === 'week' ? (
          <View className="flex-row gap-1.5">
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
          <View style={{ gap: 4 }}>
            <View className="flex-row">
              {DAY_LABELS.map((label) => (
                <View key={label} className="flex-1 items-center">
                  <AppText variant="micro" className="font-sans font-extrabold text-ink-3 uppercase">{label}</AppText>
                </View>
              ))}
            </View>
            {Array.from({ length: MONTH_VIEW_WEEKS }, (_, week) => (
              <View key={week} className="flex-row gap-1">
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

      {/* Day-detail bottom sheet -- same pattern as BookPicker's sheet */}
      <Modal visible={selectedDay != null} animationType="slide" transparent onRequestClose={() => setSelectedDayIdx(null)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface rounded-t-3xl" style={{ height: '70%' }}>
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-hairline">
              <View>
                <AppText variant="title" className="font-serif font-bold text-ink">
                  {selectedDay?.offsetFromToday === 0
                    ? 'Today'
                    : selectedDay?.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </AppText>
                {selectedDay?.data?.isSabbath && <AppText variant="caption" className="text-ink-3 font-sans mt-0.5">Sabbath — nothing scheduled</AppText>}
              </View>
              <AppIconButton Icon={X} diameter={28} iconSize={14} iconColor={palette.ink} onPress={() => setSelectedDayIdx(null)} className="rounded-full border border-line-strong" />
            </View>

            <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingTop: 12, paddingBottom: 24, gap: 16 }}>
              {selectedDay?.offsetFromToday != null && selectedDay.offsetFromToday < 0 ? (
                <AppText variant="label" className="text-center text-ink-3 py-6">This day has already passed.</AppText>
              ) : (
                <>
                  {selectedDay?.data && groupDueReviews(selectedDay.data.dueReviews).length > 0 && (
                    <View style={{ gap: 8 }}>
                      <AppText variant="caption" className="font-bold text-ink-3 tracking-widest font-sans">DUE FOR REVIEW</AppText>
                      {groupDueReviews(selectedDay.data.dueReviews).map((g, idx) => {
                        const colors = PHASE_COLORS[g.phase];
                        return (
                          <Pressable
                            key={idx}
                            onPress={() => {
                              setSelectedDayIdx(null);
                              navigateTo('chapterLanding', g.book, g.chapter);
                            }}
                            className={`flex-row items-center justify-between px-3 py-2.5 rounded-xl border-l-4 ${colors.border} border ${colors.bg}`}
                          >
                            <View className="flex-row items-center gap-2">
                              <BookOpen size={13} color={palette.ink2} />
                              <AppText variant="label" className={`font-serif font-black ${colors.text}`}>
                                {g.book} {g.chapter}:{versesLabel(g.verses)}
                              </AppText>
                            </View>
                            <AppText variant="micro" className={`font-sans font-bold uppercase ${colors.text}`}>{g.phase}</AppText>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {selectedDay?.data && selectedDay.data.learningCount > 0 && (
                    <View className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-surface-2">
                      <Sparkles size={13} color={palette.ink3} />
                      <AppText variant="label" className="font-sans font-bold text-ink-2">
                        {selectedDay.data.learningCount} verse{selectedDay.data.learningCount === 1 ? '' : 's'} in Learning phase
                        (ongoing, not date-specific)
                      </AppText>
                    </View>
                  )}

                  {/* The specific verses this day's pull would start, not
                      just how many. The projection runs the real
                      computeDailyPull forward, so this also reflects any
                      joined group plans and their priority. */}
                  {selectedDay?.data && selectedDay.data.newVerseItems.length > 0 && (
                    <View style={{ gap: 8 }}>
                      <AppText variant="caption" className="font-bold text-ink-3 tracking-widest font-sans">STARTING THIS DAY</AppText>
                      {groupNewVerses(selectedDay.data.newVerseItems, planNameById).map((g, idx) => (
                        <Pressable
                          key={idx}
                          onPress={() => {
                            setSelectedDayIdx(null);
                            navigateTo('chapterLanding', g.book, g.chapter);
                          }}
                          className="flex-row items-center justify-between px-3 py-2.5 rounded-xl border-l-4 border-l-line-strong border border-line bg-surface-2"
                        >
                          <View className="flex-row items-center gap-2 flex-1">
                            <Sparkles size={13} color={palette.ink2} />
                            <AppText variant="label" className="font-serif font-black text-ink-2">
                              {g.book} {g.chapter}:{versesLabel(g.verses)}
                            </AppText>
                          </View>
                          {g.planName && (
                            <AppText variant="micro" className="font-sans font-bold uppercase text-accent shrink-0">
                              {g.planName}
                            </AppText>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {selectedDay?.data &&
                    selectedDay.data.dueReviews.length === 0 &&
                    selectedDay.data.learningCount === 0 && (
                      <AppText variant="label" className="text-center text-ink-3 py-6">Nothing scheduled this day.</AppText>
                    )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  const phasesPresent = Array.from(new Set((day.data?.dueReviews || []).map((r) => r.phase)));
  const totalDue = day.data?.dueReviews.length || 0;
  const hasLearning = (day.data?.learningCount || 0) > 0;
  // Week view has room to name what's actually due, which is the thing the
  // old bar chart could never show. Month cells stay dots-only.
  const firstRef = day.data?.dueReviews[0]?.item;
  const extraRefs = Math.max(0, totalDue - 1);

  return (
    <Pressable
      onPress={onPress}
      disabled={day.offsetFromToday < 0}
      className={`flex-1 items-center rounded-xl border ${isToday ? 'border-2 border-ink' : 'border-line'} ${
        faded ? 'opacity-30' : 'bg-surface'
      }`}
      style={{ gap: large ? 6 : 3, paddingVertical: large ? 10 : 6 }}
    >
      <AppText variant="micro" className={`font-sans font-extrabold uppercase ${isToday ? 'text-ink' : 'text-ink-3'}`}>
        {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
      </AppText>
      <AppText variant={large ? 'title' : 'caption'} className={`font-serif font-black ${isToday ? 'text-ink' : 'text-ink-2'}`}>
        {day.date.getDate()}
      </AppText>

      {!faded && (
        <View className="items-center px-0.5" style={{ gap: 2, minHeight: 14 }}>
          <View className="flex-row gap-0.5">
            {phasesPresent.map((phase) => (
              <View key={phase} className={`w-1.5 h-1.5 rounded-full ${PHASE_COLORS[phase].dot}`} />
            ))}
            {hasLearning && <View className="w-1.5 h-1.5 rounded-full bg-fill" />}
          </View>

          {large && firstRef && (
            <AppText variant="micro" className="font-serif font-bold text-ink-2 text-center" numberOfLines={2}>
              {firstRef.book.slice(0, 3)} {firstRef.chapter}:{firstRef.verseNumber}
              {extraRefs > 0 ? ` +${extraRefs}` : ''}
            </AppText>
          )}
          {large && !firstRef && day.data && day.data.newVersesPulled > 0 && (
            <AppText variant="micro" className="font-sans font-bold text-ink-3 text-center" numberOfLines={1}>
              +{day.data.newVersesPulled} new
            </AppText>
          )}

          {loadMins > 0 && (
            <AppText variant="micro" className="font-mono font-bold text-ink-3">{loadMins}m</AppText>
          )}
        </View>
      )}
    </Pressable>
  );
}

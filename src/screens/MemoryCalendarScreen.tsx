import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, BookOpen, Sparkles, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { QueueItem } from '../types';
import { getMemoryCalendarProjection, CalendarDayProjection, RetentionPhase } from '../lib/reviewCalendar';
import { FadeInView } from '../components/ui';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // Sunday-first, matches Date.getDay()

// Rolling windows, not calendar-month-boundary paging -- "what's coming up
// starting today" is more useful for a study-planning tool than "what
// happened earlier this calendar month before today", and it keeps the
// projection safely inside reviewCalendar.ts's ~60-day cap without needing
// month-to-month navigation plumbing.
const WEEK_VIEW_DAYS = 7;
const MONTH_VIEW_WEEKS = 5;

const PHASE_COLORS: Record<RetentionPhase, { dot: string; text: string; bg: string; border: string }> = {
  daily: { dot: 'bg-emerald-500', text: 'text-emerald-900', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  weekly: { dot: 'bg-blue-500', text: 'text-blue-900', bg: 'bg-blue-50', border: 'border-blue-200' },
  monthly: { dot: 'bg-amber-500', text: 'text-amber-900', bg: 'bg-amber-50', border: 'border-amber-200' },
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

export default function MemoryCalendarScreen({ state }: { state: AppState }) {
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
        { dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, learningDays, newVersesPace, sabbathEnabled, sabbathDay },
        Math.max(daysFromTodayThroughGridEnd, 1)
      ),
    [memoryQueue, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, learningDays, newVersesPace, sabbathEnabled, sabbathDay, daysFromTodayThroughGridEnd]
  );

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
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <Pressable onPress={handleBack} className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white">
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">Memory Plan &amp; Queue</Text>
            <Text className="text-xl font-serif font-black text-neutral-900 mt-0.5">Memory Calendar</Text>
          </View>
        </View>

        <Text className="text-[10px] text-neutral-400 leading-relaxed -mt-2">
          Projects Daily/Weekly/Monthly reviews forward assuming every review goes well -- a real miss will shift things,
          so treat this as a preview, not a guarantee.
        </Text>

        {/* Week / Month Toggle */}
        <View className="flex-row items-center justify-between bg-[#F3F2F1] p-1.5 border border-[#E5E5E5] rounded-xl">
          <Text className="text-xs font-sans font-bold text-neutral-600 pl-1">Calendar View</Text>
          <View className="flex-row bg-white border border-[#E5E5E5] rounded-lg p-0.5">
            <Pressable
              onPress={() => {
                setViewMode('week');
                setSelectedDayIdx(null);
              }}
              className={`px-3 py-1.5 rounded-md ${viewMode === 'week' ? 'bg-[#1A1A1A]' : ''}`}
            >
              <Text className={`text-xs font-bold ${viewMode === 'week' ? 'text-white' : 'text-neutral-500'}`}>Week</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setViewMode('month');
                setSelectedDayIdx(null);
              }}
              className={`px-3 py-1.5 rounded-md ${viewMode === 'month' ? 'bg-[#1A1A1A]' : ''}`}
            >
              <Text className={`text-xs font-bold ${viewMode === 'month' ? 'text-white' : 'text-neutral-500'}`}>Month</Text>
            </Pressable>
          </View>
        </View>

        {/* Phase legend */}
        <View className="flex-row items-center gap-3 flex-wrap">
          {(['daily', 'weekly', 'monthly'] as RetentionPhase[]).map((phase) => (
            <View key={phase} className="flex-row items-center gap-1">
              <View className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase].dot}`} />
              <Text className="text-[9px] font-sans font-bold text-neutral-500 capitalize">{phase}</Text>
            </View>
          ))}
          <View className="flex-row items-center gap-1">
            <View className="w-2 h-2 rounded-full bg-neutral-300" />
            <Text className="text-[9px] font-sans font-bold text-neutral-500">Learning</Text>
          </View>
        </View>

        {viewMode === 'week' ? (
          <View className="flex-row gap-1.5">
            {gridDays.map((day, idx) => (
              <DayCell key={idx} day={day} isToday={day.offsetFromToday === 0} large onPress={() => setSelectedDayIdx(idx)} />
            ))}
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <View className="flex-row">
              {DAY_LABELS.map((label) => (
                <View key={label} className="flex-1 items-center">
                  <Text className="text-[9px] font-sans font-extrabold text-neutral-400 uppercase">{label}</Text>
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
          <View className="bg-white rounded-t-3xl" style={{ height: '70%' }}>
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
              <View>
                <Text className="text-base font-serif font-bold text-[#1A1A1A]">
                  {selectedDay?.offsetFromToday === 0
                    ? 'Today'
                    : selectedDay?.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </Text>
                {selectedDay?.data?.isSabbath && <Text className="text-[10px] text-neutral-400 font-sans mt-0.5">Sabbath -- day off</Text>}
              </View>
              <Pressable onPress={() => setSelectedDayIdx(null)} className="w-7 h-7 rounded-full border border-neutral-300 items-center justify-center">
                <X size={14} color="#262626" />
              </Pressable>
            </View>

            <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingTop: 12, paddingBottom: 24, gap: 16 }}>
              {selectedDay?.offsetFromToday != null && selectedDay.offsetFromToday < 0 ? (
                <Text className="text-center text-xs text-neutral-400 py-6">This day has already passed.</Text>
              ) : (
                <>
                  {selectedDay?.data && groupDueReviews(selectedDay.data.dueReviews).length > 0 && (
                    <View style={{ gap: 8 }}>
                      <Text className="text-[10px] font-bold text-neutral-400 tracking-widest font-sans">DUE FOR REVIEW</Text>
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
                              <BookOpen size={13} color="#525252" />
                              <Text className={`text-xs font-serif font-black ${colors.text}`}>
                                {g.book} {g.chapter}:{versesLabel(g.verses)}
                              </Text>
                            </View>
                            <Text className={`text-[9px] font-sans font-bold uppercase ${colors.text}`}>{g.phase}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {selectedDay?.data && selectedDay.data.learningCount > 0 && (
                    <View className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl border border-neutral-200 bg-neutral-50">
                      <Sparkles size={13} color="#737373" />
                      <Text className="text-xs font-sans font-bold text-neutral-600">
                        {selectedDay.data.learningCount} verse{selectedDay.data.learningCount === 1 ? '' : 's'} in Learning phase
                        (ongoing, not date-specific)
                      </Text>
                    </View>
                  )}

                  {selectedDay?.data && selectedDay.data.newVersesPulled > 0 && (
                    <Text className="text-[10px] text-neutral-400 font-sans px-1">
                      +{selectedDay.data.newVersesPulled} new verse{selectedDay.data.newVersesPulled === 1 ? '' : 's'} pulled into Learning this day.
                    </Text>
                  )}

                  {selectedDay?.data &&
                    selectedDay.data.dueReviews.length === 0 &&
                    selectedDay.data.learningCount === 0 && (
                      <Text className="text-center text-xs text-neutral-400 py-6">Nothing scheduled this day.</Text>
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
  onPress,
}: {
  day: { date: Date; offsetFromToday: number; data: CalendarDayProjection | null };
  isToday: boolean;
  faded?: boolean;
  large?: boolean;
  onPress: () => void;
}) {
  const phasesPresent = Array.from(new Set((day.data?.dueReviews || []).map((r) => r.phase)));
  const totalDue = day.data?.dueReviews.length || 0;
  const hasLearning = (day.data?.learningCount || 0) > 0;

  return (
    <Pressable
      onPress={onPress}
      disabled={day.offsetFromToday < 0}
      className={`flex-1 items-center rounded-xl border ${isToday ? 'border-2 border-[#1A1A1A]' : 'border-neutral-200'} ${
        faded ? 'opacity-30' : 'bg-white'
      }`}
      style={{ gap: large ? 6 : 3, paddingVertical: large ? 10 : 6 }}
    >
      <Text className={`text-[8px] font-sans font-extrabold uppercase ${isToday ? 'text-[#1A1A1A]' : 'text-neutral-400'}`}>
        {day.date.toLocaleDateString('en-US', { weekday: 'short' })}
      </Text>
      <Text className={`font-serif font-black ${large ? 'text-base' : 'text-xs'} ${isToday ? 'text-[#1A1A1A]' : 'text-neutral-700'}`}>
        {day.date.getDate()}
      </Text>

      {!faded && (
        <View className="items-center" style={{ gap: 2, minHeight: 14 }}>
          <View className="flex-row gap-0.5">
            {phasesPresent.map((phase) => (
              <View key={phase} className={`w-1.5 h-1.5 rounded-full ${PHASE_COLORS[phase].dot}`} />
            ))}
            {hasLearning && <View className="w-1.5 h-1.5 rounded-full bg-neutral-300" />}
          </View>
          {large && totalDue > 0 && <Text className="text-[9px] font-mono font-bold text-neutral-500">{totalDue} due</Text>}
        </View>
      )}
    </Pressable>
  );
}

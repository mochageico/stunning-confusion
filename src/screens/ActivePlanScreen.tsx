import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, ArrowUp, ArrowDown, Plus, X, Trash2 } from 'lucide-react-native';

import { useEffect, useState } from 'react';

import { AppState } from '../state/useAppState';
import { QueueItem, GroupedQueueItem } from '../types';
import { FadeInView, ChipRow } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { fetchChapterText } from '../state/useScripture';
import { DEFAULT_TRANSLATION_ID, getBookByName } from '../data';

const WEEK_DAYS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

// Backs a numeric TextInput with its own free-typed string so clearing the
// field doesn't instantly snap back to the clamped minimum (which used to
// force the *next* keystroke to land next to a phantom "1" instead of into
// an empty box). The real number only updates -- and the box only re-clamps
// -- once the user leaves the field.
function useClampedNumberField(value: number, commit: (n: number) => void, clamp: (n: number) => number) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return {
    value: text,
    onChangeText: setText,
    onBlur: () => {
      const parsed = parseInt(text, 10);
      const next = clamp(Number.isNaN(parsed) ? value : parsed);
      commit(next);
      setText(String(next));
    },
  };
}

function groupQueueItems(items: QueueItem[]): GroupedQueueItem[] {
  if (items.length === 0) return [];
  const groups: GroupedQueueItem[] = [];
  let currentGroup: GroupedQueueItem = {
    id: `${items[0].book}_${items[0].chapter}_${items[0].verseNumber}`,
    book: items[0].book,
    chapter: items[0].chapter,
    verses: [items[0].verseNumber],
    status: items[0].status,
    origin: (items[0].origin || 'individual') as 'individual' | 'group',
    items: [items[0]],
  };

  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    const isConsecutive =
      curr.book === prev.book &&
      curr.chapter === prev.chapter &&
      curr.verseNumber === prev.verseNumber + 1 &&
      curr.status === prev.status &&
      curr.origin === prev.origin;

    if (isConsecutive) {
      currentGroup.verses.push(curr.verseNumber);
      currentGroup.items.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = {
        id: `${curr.book}_${curr.chapter}_${curr.verseNumber}`,
        book: curr.book,
        chapter: curr.chapter,
        verses: [curr.verseNumber],
        status: curr.status,
        origin: (curr.origin || 'individual') as 'individual' | 'group',
        items: [curr],
      };
    }
  }
  groups.push(currentGroup);
  return groups;
}

export default function ActivePlanScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    learningDays,
    setLearningDays,
    setPreset,
    newVersesPace,
    setNewVersesPace,
    maxReviewCap,
    setMaxReviewCap,
    triggerToast,
    showAddQueueItemModal,
    setShowAddQueueItemModal,
    selectedAddBook,
    setSelectedAddBook,
    selectedAddChapter,
    setSelectedAddChapter,
    selectedAddVerse,
    setSelectedAddVerse,
    selectedAddEndVerse,
    setSelectedAddEndVerse,
    memoryQueue,
    setMemoryQueue,
    savedPlans,
    editingPlanId,
    saveActivePlanRhythm,
    getMemoryLoadForecast,
    cognitiveLoadSensitivity,
    sabbathEnabled,
    sabbathDay,
    memorizationGoal,
    isCalculatingGoal,
    setMemorizationGoalRange,
    clearMemorizationGoal,
    updateGoalTargetDate,
    countLearningDaysBetween,
    dateAfterNLearningDays,
  } = state;

  const [isAddingVerses, setIsAddingVerses] = useState(false);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const todayForGoal = new Date();
  const [goalBook, setGoalBook] = useState('Romans');
  const [goalStartChapter, setGoalStartChapter] = useState(1);
  const [goalEndChapter, setGoalEndChapter] = useState(1);
  const [goalStartVerse, setGoalStartVerse] = useState(1);
  const [goalEndVerse, setGoalEndVerse] = useState(5);
  const [goalMonth, setGoalMonth] = useState(todayForGoal.getMonth() + 1);
  const [goalDay, setGoalDay] = useState(todayForGoal.getDate());
  const [goalYear, setGoalYear] = useState(todayForGoal.getFullYear());

  const startChapterField = useClampedNumberField(
    goalStartChapter,
    (n) => {
      setGoalStartChapter(n);
      if (n > goalEndChapter) setGoalEndChapter(n);
    },
    (n) => Math.max(1, n)
  );
  const endChapterField = useClampedNumberField(goalEndChapter, setGoalEndChapter, (n) => Math.max(goalStartChapter, n));
  const startVerseField = useClampedNumberField(
    goalStartVerse,
    (n) => {
      setGoalStartVerse(n);
      if (n > goalEndVerse) setGoalEndVerse(n);
    },
    (n) => Math.max(1, n)
  );
  const endVerseField = useClampedNumberField(goalEndVerse, setGoalEndVerse, (n) => Math.max(goalStartVerse, n));
  const monthField = useClampedNumberField(goalMonth, setGoalMonth, (n) => Math.min(12, Math.max(1, n)));
  const dayField = useClampedNumberField(goalDay, setGoalDay, (n) => Math.min(31, Math.max(1, n)));
  const yearField = useClampedNumberField(goalYear, setGoalYear, (n) => n);

  const grouped = groupQueueItems(memoryQueue);

  const rhythmTargetPlan = savedPlans.find((p) => p.id === editingPlanId) || savedPlans.find((p) => p.isActive) || savedPlans[0];

  const sameDaySet = (a: string[], b: string[]) => a.length === b.length && a.every((d) => b.includes(d));

  const isRhythmDirty = rhythmTargetPlan
    ? !sameDaySet(learningDays, rhythmTargetPlan.learningDays) ||
      newVersesPace !== rhythmTargetPlan.newVersesPace ||
      maxReviewCap !== rhythmTargetPlan.maxReviewCap
    : false;

  // Goal progress + live bidirectional pace <-> date recalculation. Both
  // directions are pure arithmetic off the goal's cached totalVerses, so
  // moving the pace stepper above or editing the target date below
  // recomputes instantly with no re-fetching.
  const goalRemaining = memorizationGoal
    ? memorizationGoal.verseIds.filter((vid) => {
        const q = memoryQueue.find((item) => item.verseId === vid);
        return !q || q.status === 'queued';
      }).length
    : 0;
  const goalRetained = memorizationGoal
    ? memoryQueue.filter((q) => memorizationGoal.verseIds.includes(q.verseId) && q.status === 'retained').length
    : 0;
  const goalDaysNeeded = newVersesPace > 0 ? Math.ceil(goalRemaining / newVersesPace) : 0;
  const goalProjectedDate = memorizationGoal
    ? dateAfterNLearningDays(new Date(), goalDaysNeeded, learningDays, sabbathEnabled, sabbathDay)
    : null;
  const goalTargetDateObj = memorizationGoal ? new Date(memorizationGoal.targetDate) : null;
  const goalAvailableDays =
    memorizationGoal && goalTargetDateObj
      ? countLearningDaysBetween(new Date(), goalTargetDateObj, learningDays, sabbathEnabled, sabbathDay)
      : 0;
  const goalSuggestedPace = memorizationGoal
    ? goalAvailableDays > 0
      ? Math.ceil(goalRemaining / goalAvailableDays)
      : goalRemaining
    : 0;
  const formatGoalDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const moveGroupUp = (idx: number) => {
    if (idx === 0) return;
    const targetIndex = idx - 1;
    const newGroups = [...grouped];
    const temp = newGroups[idx];
    newGroups[idx] = newGroups[targetIndex];
    newGroups[targetIndex] = temp;

    const flattened: QueueItem[] = [];
    newGroups.forEach((g) => {
      g.items.forEach((item) => {
        flattened.push(item);
      });
    });

    const reindexed = flattened.map((q, qidx) => ({ ...q, orderIndex: qidx }));
    setMemoryQueue(reindexed);
    triggerToast('Moved consecutive group up.');
  };

  const moveGroupDown = (idx: number) => {
    if (idx === grouped.length - 1) return;
    const targetIndex = idx + 1;
    const newGroups = [...grouped];
    const temp = newGroups[idx];
    newGroups[idx] = newGroups[targetIndex];
    newGroups[targetIndex] = temp;

    const flattened: QueueItem[] = [];
    newGroups.forEach((g) => {
      g.items.forEach((item) => {
        flattened.push(item);
      });
    });

    const reindexed = flattened.map((q, qidx) => ({ ...q, orderIndex: qidx }));
    setMemoryQueue(reindexed);
    triggerToast('Moved consecutive group down.');
  };

  // Real 7-day projection: same time-per-verse math as HomeScreen's today
  // estimate (via getMemoryLoadForecast, sharing computeDayReviewLoad under
  // the hood) and the plan's actual learningDays, instead of a hardcoded
  // "every other day" guess with its own made-up time constants.
  const forecastDays = (() => {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const forecast = getMemoryLoadForecast(memoryQueue, cognitiveLoadSensitivity, learningDays, newVersesPace, 7);

    return forecast.map((day, i) => {
      const dateStr = day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const heightPercent = Math.min(100, Math.max(15, (day.loadMins / 30) * 100));

      return {
        dayName: daysOfWeek[day.date.getDay()],
        dateStr,
        loadMins: day.loadMins,
        versesCount: day.versesCount,
        barHeight: heightPercent,
        isToday: i === 0,
      };
    });
  })();

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 24 }}>
        {/* Header Row */}
        <View className="flex-row items-start justify-between">
          <View className="flex-row items-center gap-3">
            <Pressable
              onPress={handleBack}
              className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
            >
              <ArrowLeft size={14} color="#262626" />
            </Pressable>
            <View>
              <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
                SCRIPTURE OVERVIEW
              </Text>
              <Text className="text-xl font-serif font-black text-neutral-900 mt-0.5">Memory Plan & Queue</Text>
            </View>
          </View>
        </View>

        {/* MEMORY RHYTHM SECTION */}
        <View className="border-2 border-[#1A1A1A] rounded-2xl p-5 bg-white text-left" style={{ gap: 16 }}>
          <View>
            <Text className="text-sm font-serif font-black text-[#1A1A1A]">Memory Rhythm</Text>
            <Text className="text-[10px] text-neutral-400 mt-0.5 font-sans">
              Configure custom pacing, learn days, review days, and priming lookahead directly.
            </Text>
          </View>

          <View style={{ gap: 16 }}>
            {/* Interactive Rhythm Row */}
            <View className="bg-neutral-50/70 p-4 rounded-2xl border border-neutral-100">
              {/* mem row */}
              <View className="flex-row items-center justify-between gap-2">
                <View className="text-left">
                  <Text className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A]">mem</Text>
                  <Text className="text-[9px] text-neutral-400 font-sans -mt-0.5">Active Memory Days</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  {WEEK_DAYS.map((d) => {
                    const isActive = learningDays.includes(d);
                    return (
                      <Pressable
                        key={`mem-${d}`}
                        onPress={() => {
                          if (learningDays.includes(d)) {
                            setLearningDays(learningDays.filter((day) => day !== d));
                          } else {
                            setLearningDays([...learningDays, d]);
                          }
                          setPreset('custom');
                        }}
                        className={`w-7 h-7 rounded-full items-center justify-center border ${
                          isActive ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-sans font-bold ${isActive ? 'text-white font-black' : 'text-neutral-400'}`}
                        >
                          {d}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Steppers Row */}
            <View className="flex-row gap-4">
              {/* New Verses / Memory Day */}
              <View className="flex-1 items-center justify-center p-3.5 bg-neutral-50/50 rounded-2xl border border-neutral-100" style={{ gap: 6 }}>
                <Text className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-neutral-500 text-center">
                  New Verses / Memory Day
                </Text>
                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={() => {
                      const nextVal = Math.max(1, newVersesPace - 1);
                      setNewVersesPace(nextVal);
                      triggerToast(`Pacing speed decreased to ${nextVal} verses per day`);
                    }}
                    className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white items-center justify-center"
                  >
                    <Text className="font-bold text-[#1A1A1A] text-base">-</Text>
                  </Pressable>
                  <Text className="text-2xl font-serif font-black text-[#1A1A1A] w-12 text-center">{newVersesPace}</Text>
                  <Pressable
                    onPress={() => {
                      const nextVal = Math.min(10, newVersesPace + 1);
                      setNewVersesPace(nextVal);
                      triggerToast(`Pacing speed increased to ${nextVal} verses per day`);
                    }}
                    className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white items-center justify-center"
                  >
                    <Text className="font-bold text-[#1A1A1A] text-base">+</Text>
                  </Pressable>
                </View>
                <Text className="text-[8px] font-sans text-neutral-400 text-center">How many verses enter the learning cycle.</Text>
              </View>

              {/* Daily Review Time Limit */}
              <View className="flex-1 items-center justify-center p-3.5 bg-neutral-50/50 rounded-2xl border border-neutral-100" style={{ gap: 6 }}>
                <Text className="text-[10px] font-sans font-extrabold uppercase tracking-widest text-neutral-500 text-center">
                  Daily Review Time Limit
                </Text>
                <View className="flex-row items-center gap-4">
                  <Pressable
                    onPress={() => {
                      const nextVal = Math.max(5, maxReviewCap - 5);
                      setMaxReviewCap(nextVal);
                      triggerToast(`Daily review time limit decreased to ${nextVal} mins`);
                    }}
                    className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white items-center justify-center"
                  >
                    <Text className="font-bold text-[#1A1A1A] text-base">-</Text>
                  </Pressable>
                  <Text className="text-xl font-serif font-black text-[#1A1A1A] w-16 text-center">{maxReviewCap}m</Text>
                  <Pressable
                    onPress={() => {
                      const nextVal = Math.min(120, maxReviewCap + 5);
                      setMaxReviewCap(nextVal);
                      triggerToast(`Daily review time limit increased to ${nextVal} mins`);
                    }}
                    className="w-8 h-8 rounded-full border-2 border-[#1A1A1A] bg-white items-center justify-center"
                  >
                    <Text className="font-bold text-[#1A1A1A] text-base">+</Text>
                  </Pressable>
                </View>
                <Text className="text-[8px] font-sans text-neutral-400 text-center">Maximum target duration for daily practice.</Text>
              </View>
            </View>

            {/* Save Rhythm button — only appears once the rhythm diverges from the saved plan */}
            {isRhythmDirty && (
              <Pressable
                onPress={async () => {
                  await saveActivePlanRhythm();
                }}
                className="w-full py-2.5 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5"
              >
                <Text className="text-white font-sans font-bold text-xs uppercase tracking-widest">
                  Save Rhythm to {rhythmTargetPlan ? rhythmTargetPlan.name : 'Plan'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* MEMORIZATION GOAL SECTION */}
        <View style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center">
            <View>
              <Text className="text-sm font-serif font-black text-[#1A1A1A]">Memorization Goal</Text>
              <Text className="text-[10px] text-neutral-400 mt-0.5">
                A deadline for a book or chapter range -- a suggestion, not a hard rule.
              </Text>
            </View>
            {!memorizationGoal && (
              <Pressable
                onPress={() => setShowGoalForm(!showGoalForm)}
                className="px-3 py-1.5 bg-[#1A1A1A] rounded-xl flex-row items-center gap-1"
              >
                <Plus size={12} color="#ffffff" />
                <Text className="font-sans font-bold text-xs text-white">Set a Goal</Text>
              </Pressable>
            )}
          </View>

          {memorizationGoal ? (
            <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white text-left" style={{ gap: 12 }}>
              <View className="flex-row justify-between items-start">
                <View style={{ gap: 2 }}>
                  <Text className="text-xs font-serif font-black text-[#1A1A1A]">
                    {memorizationGoal.book}{' '}
                    {memorizationGoal.startChapter === memorizationGoal.endChapter
                      ? `${memorizationGoal.startChapter}:${memorizationGoal.startVerse}-${memorizationGoal.endVerse}`
                      : `${memorizationGoal.startChapter}-${memorizationGoal.endChapter}`}
                  </Text>
                  <Text className="text-[9px] text-neutral-400 font-mono">
                    {goalRetained}/{memorizationGoal.totalVerses} verses fully retained
                  </Text>
                </View>
                <Pressable onPress={clearMemorizationGoal} className="px-2 py-1 border border-neutral-200 rounded-lg">
                  <Text className="text-[9px] font-sans font-bold text-neutral-500">Clear</Text>
                </Pressable>
              </View>

              <View className="bg-neutral-50 rounded-xl p-3" style={{ gap: 4 }}>
                <Text className="text-[10px] font-sans text-neutral-600 leading-relaxed">
                  At your current pace (<Text className="font-bold text-[#1A1A1A]">{newVersesPace} verses/day</Text>), you'll
                  finish around{' '}
                  <Text className="font-bold text-[#1A1A1A]">
                    {goalProjectedDate ? formatGoalDate(goalProjectedDate) : '—'}
                  </Text>
                  . Adjust "New Verses / Memory Day" above to see this move.
                </Text>
                {goalTargetDateObj && (
                  <Text className="text-[9px] font-sans text-neutral-400">
                    Your target is {formatGoalDate(goalTargetDateObj)} -- that needs about{' '}
                    <Text className="font-bold text-neutral-600">{goalSuggestedPace} verses/day</Text> to hit exactly.
                  </Text>
                )}
              </View>

              <View style={{ gap: 4 }}>
                <Text className="text-[9px] font-bold text-neutral-400 uppercase">Change Target Date</Text>
                <View className="flex-row gap-2 items-center">
                  <TextInput
                    keyboardType="numeric"
                    {...monthField}
                    placeholder="MM"
                    className="w-12 p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A] text-center"
                  />
                  <Text className="text-neutral-300">/</Text>
                  <TextInput
                    keyboardType="numeric"
                    {...dayField}
                    placeholder="DD"
                    className="w-12 p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A] text-center"
                  />
                  <Text className="text-neutral-300">/</Text>
                  <TextInput
                    keyboardType="numeric"
                    {...yearField}
                    placeholder="YYYY"
                    className="w-16 p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A] text-center"
                  />
                  <Pressable
                    onPress={() => {
                      const d = new Date(goalYear, goalMonth - 1, goalDay);
                      updateGoalTargetDate(d.toISOString());
                      triggerToast('Goal target date updated.');
                    }}
                    className="flex-1 py-2 bg-[#1A1A1A] rounded-xl items-center"
                  >
                    <Text className="text-white font-sans font-bold text-[10px]">Update</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : (
            showGoalForm && (
              <FadeInView>
                <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white text-left" style={{ gap: 16 }}>
                  <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                    <Text className="text-xs font-sans font-black text-[#1A1A1A] uppercase tracking-wider">Set a Goal</Text>
                    <Pressable onPress={() => setShowGoalForm(false)}>
                      <X size={14} color="#a3a3a3" />
                    </Pressable>
                  </View>

                  <View style={{ gap: 4 }}>
                    <Text className="text-[9px] font-bold text-neutral-400 uppercase">Book</Text>
                    <BookPicker value={goalBook} onChange={setGoalBook} />
                  </View>

                  <View className="flex-row gap-2.5">
                    <View className="flex-1" style={{ gap: 4 }}>
                      <Text className="text-[9px] font-bold text-neutral-400 uppercase">Start Chapter</Text>
                      <TextInput
                        keyboardType="numeric"
                        {...startChapterField}
                        className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                      />
                    </View>
                    <View className="flex-1" style={{ gap: 4 }}>
                      <Text className="text-[9px] font-bold text-neutral-400 uppercase">End Chapter</Text>
                      <TextInput
                        keyboardType="numeric"
                        {...endChapterField}
                        className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                      />
                    </View>
                  </View>

                  {goalStartChapter === goalEndChapter && (
                    <View className="flex-row gap-2.5">
                      <View className="flex-1" style={{ gap: 4 }}>
                        <Text className="text-[9px] font-bold text-neutral-400 uppercase">Start Verse</Text>
                        <TextInput
                          keyboardType="numeric"
                          {...startVerseField}
                          className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                        />
                      </View>
                      <View className="flex-1" style={{ gap: 4 }}>
                        <Text className="text-[9px] font-bold text-neutral-400 uppercase">End Verse</Text>
                        <TextInput
                          keyboardType="numeric"
                          {...endVerseField}
                          className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                        />
                      </View>
                    </View>
                  )}
                  <Text className="text-[9px] text-neutral-400 -mt-2">
                    {goalStartChapter === goalEndChapter
                      ? 'Pick a small verse range within this one chapter -- a whole chapter (or book!) is unreachable for most people.'
                      : 'Spanning multiple chapters uses every verse in each one.'}
                  </Text>

                  <View style={{ gap: 4 }}>
                    <Text className="text-[9px] font-bold text-neutral-400 uppercase">Target Date</Text>
                    <View className="flex-row gap-2 items-center">
                      <TextInput
                        keyboardType="numeric"
                        {...monthField}
                        placeholder="MM"
                        className="w-14 p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A] text-center"
                      />
                      <Text className="text-neutral-300">/</Text>
                      <TextInput
                        keyboardType="numeric"
                        {...dayField}
                        placeholder="DD"
                        className="w-14 p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A] text-center"
                      />
                      <Text className="text-neutral-300">/</Text>
                      <TextInput
                        keyboardType="numeric"
                        {...yearField}
                        placeholder="YYYY"
                        className="w-20 p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A] text-center"
                      />
                    </View>
                  </View>

                  <View className="flex-row gap-2 justify-end pt-2 border-t border-neutral-100">
                    <Pressable onPress={() => setShowGoalForm(false)} className="px-4 py-2 border border-neutral-200 rounded-xl">
                      <Text className="text-neutral-600 font-sans font-bold text-xs">Cancel</Text>
                    </Pressable>
                    <Pressable
                      disabled={isCalculatingGoal}
                      onPress={async () => {
                        const d = new Date(goalYear, goalMonth - 1, goalDay);
                        await setMemorizationGoalRange(
                          goalBook,
                          goalStartChapter,
                          goalEndChapter,
                          goalStartVerse,
                          goalEndVerse,
                          d.toISOString()
                        );
                        setShowGoalForm(false);
                      }}
                      className={`px-4 py-2 rounded-xl ${isCalculatingGoal ? 'bg-neutral-300' : 'bg-[#1A1A1A]'}`}
                    >
                      <Text className="text-white font-sans font-bold text-xs">
                        {isCalculatingGoal ? 'Calculating…' : 'Calculate & Set Goal'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </FadeInView>
            )
          )}
        </View>

        {/* MEMORY QUEUE SECTION */}
        <View style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center">
            <View>
              <Text className="text-sm font-serif font-black text-[#1A1A1A]">Memory Queue</Text>
              <Text className="text-[10px] text-neutral-400 mt-0.5">Reorder, customize, and add individual or group scriptures.</Text>
            </View>
            <Pressable
              onPress={() => setShowAddQueueItemModal(!showAddQueueItemModal)}
              className="px-3 py-1.5 bg-[#1A1A1A] rounded-xl flex-row items-center gap-1"
            >
              <Plus size={12} color="#ffffff" />
              <Text className="font-sans font-bold text-xs text-white">Add Verses</Text>
            </Pressable>
          </View>

          {/* Inline Verse Addition Form */}
          {showAddQueueItemModal && (
            <FadeInView>
              <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white text-left" style={{ gap: 16 }}>
                <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                  <Text className="text-xs font-sans font-black text-[#1A1A1A] uppercase tracking-wider">Add Verse to Queue</Text>
                  <Pressable onPress={() => setShowAddQueueItemModal(false)}>
                    <X size={14} color="#a3a3a3" />
                  </Pressable>
                </View>

                <View className="flex-row gap-2.5">
                  <View className="flex-1" style={{ gap: 4 }}>
                    <Text className="text-[9px] font-bold text-neutral-400 uppercase">Book</Text>
                    <BookPicker value={selectedAddBook} onChange={setSelectedAddBook} />
                  </View>
                  <View className="flex-1" style={{ gap: 4 }}>
                    <Text className="text-[9px] font-bold text-neutral-400 uppercase">Chapter</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={String(selectedAddChapter)}
                      onChangeText={(text) => setSelectedAddChapter(parseInt(text, 10) || 1)}
                      className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                    />
                  </View>
                </View>

                <View className="flex-row gap-2.5">
                  <View className="flex-1" style={{ gap: 4 }}>
                    <Text className="text-[9px] font-bold text-neutral-400 uppercase">Start Verse</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={String(selectedAddVerse)}
                      onChangeText={(text) => {
                        const n = parseInt(text, 10) || 1;
                        setSelectedAddVerse(n);
                        // Keep the range valid if start is dragged past end
                        if (n > selectedAddEndVerse) setSelectedAddEndVerse(n);
                      }}
                      className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                    />
                  </View>
                  <View className="flex-1" style={{ gap: 4 }}>
                    <Text className="text-[9px] font-bold text-neutral-400 uppercase">End Verse</Text>
                    <TextInput
                      keyboardType="numeric"
                      value={String(selectedAddEndVerse)}
                      onChangeText={(text) => {
                        const n = parseInt(text, 10) || 1;
                        setSelectedAddEndVerse(Math.max(n, selectedAddVerse));
                      }}
                      className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                    />
                  </View>
                </View>

                <View className="flex-row gap-2 justify-end pt-2 border-t border-neutral-100">
                  <Pressable
                    onPress={() => setShowAddQueueItemModal(false)}
                    className="px-4 py-2 border border-neutral-200 rounded-xl"
                  >
                    <Text className="text-neutral-600 font-sans font-bold text-xs">Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={isAddingVerses}
                    onPress={async () => {
                      const bookId = getBookByName(selectedAddBook)?.id;
                      if (!bookId) {
                        triggerToast(`Unrecognized book: ${selectedAddBook}`);
                        return;
                      }

                      const start = Math.min(selectedAddVerse, selectedAddEndVerse);
                      const end = Math.max(selectedAddVerse, selectedAddEndVerse);
                      const targetVerseNumbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);

                      const alreadyQueued = targetVerseNumbers.filter((vNum) =>
                        memoryQueue.some((item) => item.verseId === `${bookId}_${selectedAddChapter}_${vNum}`)
                      );
                      const toAdd = targetVerseNumbers.filter((vNum) => !alreadyQueued.includes(vNum));

                      if (toAdd.length === 0) {
                        triggerToast(`${selectedAddBook} ${selectedAddChapter}:${start}-${end} is already in your queue!`);
                        return;
                      }

                      setIsAddingVerses(true);
                      const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookId, selectedAddChapter);
                      setIsAddingVerses(false);

                      if (!chapterData) {
                        triggerToast(`Couldn't find ${selectedAddBook} ${selectedAddChapter} in the scripture library yet.`);
                        return;
                      }

                      const foundVerseNumbers = toAdd.filter((vNum) => chapterData.verses[String(vNum)]);
                      const missingCount = toAdd.length - foundVerseNumbers.length;

                      if (foundVerseNumbers.length === 0) {
                        triggerToast(`No verse text found for ${selectedAddBook} ${selectedAddChapter}:${start}-${end}.`);
                        return;
                      }

                      const newItems: QueueItem[] = foundVerseNumbers.map((vNum, i) => ({
                        verseId: `${bookId}_${selectedAddChapter}_${vNum}`,
                        book: selectedAddBook,
                        chapter: selectedAddChapter,
                        verseNumber: vNum,
                        text: chapterData.verses[String(vNum)],
                        orderIndex: memoryQueue.length + i,
                        status: 'queued',
                        origin: 'individual',
                        retentionPhase: 'none',
                        dateStarted: null,
                        lastReviewDate: null,
                        nextReviewDueDate: null,
                        currentStreakCount: 0,
                        totalSuccessfulReviews: 0,
                        gracePeriodUsedToday: false,
                      }));

                      setMemoryQueue((prev) => [...prev, ...newItems]);
                      setShowAddQueueItemModal(false);
                      const skippedNotes = [
                        alreadyQueued.length > 0 ? `${alreadyQueued.length} already queued` : null,
                        missingCount > 0 ? `${missingCount} had no text available` : null,
                      ].filter(Boolean);
                      const skippedNote = skippedNotes.length > 0 ? ` (${skippedNotes.join(', ')}, skipped)` : '';
                      triggerToast(
                        `Added ${selectedAddBook} ${selectedAddChapter}:${start}${end > start ? `-${end}` : ''} to your Memory Queue!${skippedNote}`
                      );
                    }}
                    className={`px-4 py-2 bg-[#1A1A1A] rounded-xl ${isAddingVerses ? 'opacity-50' : ''}`}
                  >
                    <Text className="text-white font-sans font-bold text-xs">{isAddingVerses ? 'Adding…' : 'Add to Queue'}</Text>
                  </Pressable>
                </View>
              </View>
            </FadeInView>
          )}

          {/* Scrollable Queue List */}
          <ScrollView
            style={{ maxHeight: 360 }}
            className="border border-neutral-100 p-2 rounded-2xl bg-neutral-50/30"
            contentContainerStyle={{ gap: 8 }}
          >
            {grouped.length === 0 ? (
              <Text className="py-8 text-center text-xs text-neutral-400 font-sans italic">
                Memory Queue is currently empty. Add verses above.
              </Text>
            ) : (
              grouped.map((group, idx) => {
                const isGroup = group.origin === 'group';
                const hasMultiple = group.verses.length > 1;
                const versesStr = hasMultiple
                  ? `${group.verses[0]}-${group.verses[group.verses.length - 1]}`
                  : `${group.verses[0]}`;

                return (
                  <View
                    key={group.id || `${group.book}_${group.chapter}_${versesStr}`}
                    className={`flex-row items-center justify-between p-4 bg-white border rounded-xl border-l-4 ${
                      isGroup ? 'border-l-indigo-500 border-indigo-200' : 'border-l-orange-500 border-orange-200'
                    }`}
                  >
                    <View className="flex-row items-center gap-3.5 flex-1">
                      {/* Up & Down Reorder Buttons */}
                      <View className="gap-1">
                        <Pressable
                          onPress={() => moveGroupUp(idx)}
                          disabled={idx === 0}
                          className={`p-1 rounded ${idx === 0 ? 'opacity-20' : ''}`}
                        >
                          <ArrowUp size={12} color="#737373" />
                        </Pressable>
                        <Pressable
                          onPress={() => moveGroupDown(idx)}
                          disabled={idx === grouped.length - 1}
                          className={`p-1 rounded ${idx === grouped.length - 1 ? 'opacity-20' : ''}`}
                        >
                          <ArrowDown size={12} color="#737373" />
                        </Pressable>
                      </View>

                      {/* Reference details */}
                      <View className="text-left flex-1" style={{ gap: 4 }}>
                        <View className="flex-row items-center gap-2 flex-wrap">
                          <Text className="text-xs font-serif font-black text-[#1A1A1A]">
                            {group.book} {group.chapter}:{versesStr}
                          </Text>
                          <Text
                            className={`text-[8px] px-1.5 py-0.5 rounded-full font-sans font-bold uppercase tracking-wider ${
                              isGroup
                                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                : 'bg-orange-50 text-orange-700 border border-orange-200'
                            }`}
                          >
                            {isGroup ? 'Group' : 'Individual'}
                          </Text>
                          {hasMultiple && (
                            <Text className="text-[8px] px-1.5 py-0.5 rounded-full font-sans font-bold bg-neutral-100 text-neutral-600 border border-neutral-200">
                              {group.verses.length} verses
                            </Text>
                          )}
                        </View>
                        <Text className="text-[10px] font-sans text-neutral-500 italic pr-2" numberOfLines={1} ellipsizeMode="tail">
                          "{group.items[0].text}"{hasMultiple ? ' ...' : ''}
                        </Text>
                      </View>
                    </View>

                    {/* Right column status & delete */}
                    <View className="flex-row items-center gap-3">
                      <Text
                        className={`text-[9px] font-sans font-bold px-2 py-0.5 rounded-full border uppercase ${
                          group.status === 'learning'
                            ? 'bg-amber-50 text-amber-600 border-amber-200'
                            : group.status === 'retained'
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                              : 'bg-neutral-50 text-neutral-400 border-neutral-200'
                        }`}
                      >
                        {group.status}
                      </Text>
                      <Pressable
                        onPress={() => {
                          const idsToDelete = new Set(group.items.map((item) => item.verseId));
                          setMemoryQueue((prev) => prev.filter((item) => !idsToDelete.has(item.verseId)));
                          triggerToast('Removed consecutive group from Memory Queue.');
                        }}
                        className="p-1 rounded"
                      >
                        <Trash2 size={13} color="#d4d4d4" />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>

        {/* MEMORY LOAD FORECAST SECTION -- nothing to forecast with an empty queue */}
        {memoryQueue.length > 0 && (
        <View style={{ gap: 12 }}>
          <View>
            <Text className="text-sm font-serif font-black text-[#1A1A1A]">Memory Load Forecast</Text>
            <Text className="text-[10px] text-neutral-400 mt-0.5">
              Deterministic 7-day forecast representing estimated daily study time based on active queue items.
            </Text>
          </View>

          {/* Bento-style 7-day forecast row */}
          <View className="flex-row gap-1.5">
            {forecastDays.map((fDay, idx) => (
              <View
                key={idx}
                className={`flex-1 items-center p-2 rounded-xl border text-center bg-white ${
                  fDay.isToday ? 'border-2 border-[#1A1A1A]' : 'border-neutral-200'
                }`}
                style={{ gap: 8 }}
              >
                <Text className={`text-[8px] font-sans font-extrabold uppercase ${fDay.isToday ? 'text-[#1A1A1A]' : 'text-neutral-400'}`}>
                  {fDay.dayName}
                </Text>
                <Text className="text-[7px] font-mono font-bold text-neutral-400 -mt-1">{fDay.dateStr}</Text>

                {/* Relative Load Bar indicator */}
                <View className="w-2.5 h-14 bg-neutral-50 rounded-full items-center justify-end overflow-hidden border border-neutral-100">
                  <View
                    className={`w-full rounded-full ${
                      fDay.isToday ? 'bg-[#1A1A1A]' : fDay.loadMins > 18 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ height: `${fDay.barHeight}%` }}
                  />
                </View>

                <View style={{ gap: 2 }}>
                  <Text className="text-[10px] font-serif font-black text-neutral-800 leading-none">{fDay.loadMins}m</Text>
                  <Text className="text-[7px] font-sans font-medium text-neutral-400 leading-none">{fDay.versesCount} v</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}

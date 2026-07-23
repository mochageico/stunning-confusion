import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Volume2, BookMarked, FolderOpen } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { QueueItem, VerseState } from '../types';
import { FadeInView, HelpTooltip } from '../components/ui';
import { Dropdown } from '../components/Dropdown';

const LOOKAHEAD_OPTIONS = [
  { id: 10, label: '10' },
  { id: 20, label: '20' },
  { id: 30, label: '30' },
  { id: 40, label: '40' },
  { id: 50, label: '50' },
];

interface GroupedItem {
  label: string;
  book: string;
  chapter: number;
  translationId: string;
  items: QueueItem[];
}

function groupQueueItems(items: QueueItem[]): GroupedItem[] {
  const groups: { [key: string]: QueueItem[] } = {};
  items.forEach((item) => {
    // Translation is part of the group key too -- ESV Ephesians 2 and KJV
    // Ephesians 2 are independent progress (see buildVerseId), so they must
    // render as separate cards, not merged into one mixed-translation group.
    const key = `${item.book} ${item.chapter} ${item.translationId}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return Object.entries(groups).map(([, list]) => {
    const book = list[0].book;
    const chapter = list[0].chapter;
    const translationId = list[0].translationId;
    list.sort((a, b) => a.verseNumber - b.verseNumber);
    const versesStr =
      list.length === 1 ? `${list[0].verseNumber}` : `${list[0].verseNumber}-${list[list.length - 1].verseNumber}`;
    const translationSuffix = translationId && translationId !== 'ESV' ? ` (${translationId})` : '';
    return {
      label: `${book} ${chapter}:${versesStr}${translationSuffix}`,
      book,
      chapter,
      translationId,
      items: list,
    };
  });
}

export default function HomeScreen({ state }: { state: AppState }) {
  const {
    user,
    memoryQueue,
    primingLookahead,
    setPrimingLookahead,
    cognitiveLoadSensitivity,
    maxReviewCap,
    getEstimatedReviewTime,
    isTodayLearningDay,
    getTodayDateString,
    getGreeting,
    navigateTo,
    triggerToast,
    triggerMockDueReviews,
    masteryTouches,
    startPractice,
    startReviewSession,
    triggerDailyPull,
    isReviewDue,
  } = state;

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPullShieldConfirm, setShowPullShieldConfirm] = useState(false);

  // Guest/signed-out preview falls back to the same "Kenneth Carter" demo
  // persona used elsewhere (ProfileScreen, INITIAL_VERSES) — but a real
  // signed-in user's actual name should always take priority.
  const firstName = (user?.displayName || 'Kenneth Carter').split(' ')[0];

  // Excludes verses that already banked every mastery touch -- they're done
  // learning and just waiting on their reviews to clear before promotion out
  // of 'learning' status, so bundling them into a fresh "Learn" group with
  // newly-pulled verses would mean re-practicing something already finished.
  const learningItems = memoryQueue.filter(
    (item) => item.status === 'learning' && (item.touchLogs?.length || 0) < masteryTouches
  );
  const dueReviewItems = memoryQueue.filter(
    (item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate)
  );
  const queuedLookahead = memoryQueue.filter((item) => item.status === 'queued').slice(0, primingLookahead);

  const estMinutes = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);
  // shieldActive and isLearningDay are computed in the original for potential future use
  // (isTodayLearningDay is consumed by triggerDailyPull elsewhere); kept here 1:1 for parity.
  const shieldActive = estMinutes >= maxReviewCap;
  const isLearningDay = isTodayLearningDay();

  const groupedLearning = groupQueueItems(learningItems);
  const dailyReviewItems = dueReviewItems.filter((item) => item.retentionPhase === 'daily');
  const weeklyReviewItems = dueReviewItems.filter((item) => item.retentionPhase === 'weekly');
  const monthlyReviewItems = dueReviewItems.filter((item) => item.retentionPhase === 'monthly');

  const groupedDailyReviewing = groupQueueItems(dailyReviewItems);
  const groupedWeeklyReviewing = groupQueueItems(weeklyReviewItems);
  const groupedMonthlyReviewing = groupQueueItems(monthlyReviewItems);
  const groupedPriming = groupQueueItems(queuedLookahead);

  const mapQueueToVerseStates = (items: QueueItem[]): VerseState[] => {
    return items.map((item) => ({
      book: item.book,
      chapter: item.chapter,
      verse: item.verseNumber,
      text: item.text,
      status: item.status === 'retained' ? 'memorized' : 'learning',
    }));
  };

  const handleGroupPractice = (mode: 'listen' | 'learn', items: QueueItem[]) => {
    const vStates = mapQueueToVerseStates(items);
    startPractice(mode, vStates);
  };

  // "Review All Due" -- chains through every due group (daily, then weekly,
  // then monthly, same order they're already listed in below) in one
  // continuous session instead of returning to Home between each.
  const handleReviewAllDue = () => {
    const groups = [...groupedDailyReviewing, ...groupedWeeklyReviewing, ...groupedMonthlyReviewing].map(
      (g) => g.items
    );
    startReviewSession(groups);
  };

  // The Review Shield blocks pulling new verses once today's review time
  // already meets/exceeds the daily cap ("retention > learning new things").
  // Rather than a silent block, surface an explicit "are you sure?" so the
  // user can still choose to pull anyway -- triggerDailyPull itself no
  // longer shows its own blocking toast when bypassShield is set.
  const handlePullNewVerses = () => {
    if (shieldActive) {
      setShowPullShieldConfirm(true);
      return;
    }
    triggerDailyPull();
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 20 }}>
        {/* Top Editorial Header */}
        <View className="pb-3 border-b border-[#E5E5E5]">
          <Text className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#888]">
            {getTodayDateString()}
          </Text>
          <Text className="text-xl font-serif font-black mt-0.5 text-[#1A1A1A]">{getGreeting()}, {firstName}.</Text>
        </View>

        {/* TODAY'S CORE DASHBOARD CARD */}
        <View className="border-2 border-[#1A1A1A] rounded-2xl p-5 bg-white shadow-xs" style={{ gap: 16 }}>
          <View className="flex-row justify-between items-center pb-3 border-b border-neutral-100">
            <Text className="font-serif font-black text-lg tracking-tight text-[#1A1A1A]">Today's Scripture</Text>
            <Text className="bg-[#1A1A1A] text-white text-[10px] px-3 py-1 rounded-full font-mono font-bold uppercase tracking-wider overflow-hidden">
              est. {estMinutes} mins
            </Text>
          </View>

          {/* LEARNING PHASE SECTION */}
          <View style={{ gap: 8 }}>
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center">
                <Text className="text-xs font-sans font-extrabold uppercase tracking-wider text-neutral-400">
                  Learning phase...
                </Text>
                <HelpTooltip
                  text={`Verses currently in active study phase. Requires ${masteryTouches} successful touches, at least an hour apart each, to graduate to Spaced Repetition.`}
                />
                {memoryQueue.some((item) => item.status === 'queued') && (
                  <Pressable
                    onPress={handlePullNewVerses}
                    className="ml-2 bg-neutral-900 px-1.5 py-0.5 rounded flex-row items-center gap-0.5"
                  >
                    <Text className="text-[8px] text-white font-sans font-extrabold">Pull New Verses</Text>
                  </Pressable>
                )}
              </View>
              <Text className="text-[10px] font-mono text-neutral-400 font-bold">
                {learningItems.length} verses today
              </Text>
            </View>

            {showPullShieldConfirm && (
              <View className="bg-indigo-50 border border-indigo-200 rounded-xl p-3" style={{ gap: 8 }}>
                <Text className="text-[11px] font-sans font-bold text-indigo-900">
                  🛡️ Review Shield is active -- pull new verses anyway?
                </Text>
                <Text className="text-[9px] font-sans text-indigo-800/80 leading-relaxed">
                  Today's review time ({estMinutes}m) already meets or exceeds your {maxReviewCap}m daily limit.
                  Pulling more now adds on top of that, on purpose.
                </Text>
                <View className="flex-row gap-2 justify-end pt-1">
                  <Pressable
                    onPress={() => setShowPullShieldConfirm(false)}
                    className="px-3 py-1.5 border border-neutral-300 rounded-lg"
                  >
                    <Text className="text-neutral-600 font-sans font-bold text-[10px]">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      triggerDailyPull({ bypassShield: true });
                      setShowPullShieldConfirm(false);
                    }}
                    className="px-3 py-1.5 bg-indigo-600 rounded-lg"
                  >
                    <Text className="text-white font-sans font-bold text-[10px]">Yes, Pull Anyway</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {groupedLearning.length > 0 ? (
              <View style={{ gap: 8 }}>
                {groupedLearning.map((group) => (
                  <View
                    key={group.label}
                    className="flex-col bg-neutral-50 px-3 py-2.5 rounded-xl border border-neutral-100"
                    style={{ gap: 8 }}
                  >
                    <View className="flex-row justify-between items-center">
                      <Pressable onPress={() => navigateTo('chapterLanding', group.book, group.chapter)}>
                        <Text className="text-xs font-serif font-bold text-[#1A1A1A]">{group.label}</Text>
                      </Pressable>
                      <View className="flex-row gap-1">
                        <Pressable
                          onPress={() => handleGroupPractice('listen', group.items)}
                          className="bg-white border border-neutral-300 w-6 h-5 items-center justify-center rounded"
                        >
                          <Text className="text-neutral-700 text-[10px] font-bold">L</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleGroupPractice('learn', group.items)}
                          className="bg-[#1A1A1A] px-2 h-5 items-center justify-center rounded"
                        >
                          <Text className="text-white text-[9px] font-bold">Learn</Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Individual Verse mastery progress bars/dots */}
                    <View className="flex-row flex-wrap gap-x-2 gap-y-1 pt-1.5 border-t border-neutral-100">
                      {group.items.map((item) => {
                        const touchesCount = item.touchLogs ? item.touchLogs.length : 0;
                        const isBankedAwaitingReview = touchesCount >= masteryTouches;
                        return (
                          <View
                            key={item.verseId}
                            className={`flex-row items-center gap-1.5 px-2 py-0.5 rounded-md border ${
                              isBankedAwaitingReview ? 'bg-neutral-100 border-neutral-200 opacity-60' : 'bg-white border-neutral-100'
                            }`}
                          >
                            <Text className="text-[9.5px] font-sans font-bold text-neutral-500">v{item.verseNumber}</Text>
                            <View className="flex-row gap-0.5">
                              {Array.from({ length: masteryTouches }).map((_, i) => (
                                <View
                                  key={i}
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    i < touchesCount ? 'bg-emerald-500 border border-emerald-600' : 'bg-neutral-200'
                                  }`}
                                />
                              ))}
                            </View>
                            <Text className="text-[8px] font-mono font-black text-neutral-400">
                              {touchesCount}/{masteryTouches}
                            </Text>
                            {isBankedAwaitingReview && (
                              <HelpTooltip text="Fully touched, but retention comes first: this verse will lock in and move to spaced review automatically as soon as today's due reviews are finished." />
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-xs text-neutral-400 italic pl-1">No verses currently in learning phase.</Text>
            )}
          </View>

          {/* DUE REVIEWS SECTION */}
          <View className="pt-1" style={{ gap: 8 }}>
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center gap-1">
                <Text className="text-xs font-sans font-extrabold uppercase tracking-wider text-neutral-400">
                  Due reviews...
                </Text>
                <HelpTooltip text="Spaced Repetition system reviews. Verses are scheduled in Daily, Weekly, and Monthly intervals based on your retention performance." />
                <Pressable
                  onPress={() => setShowResetConfirm(true)}
                  className="ml-2 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded flex-row items-center gap-0.5"
                >
                  <Text className="text-[8px] text-red-700 font-sans font-extrabold">Reset Reviews for Today</Text>
                </Pressable>
              </View>
              <Text className="text-[10px] font-mono text-neutral-400 font-bold">
                {dueReviewItems.length} verses today
              </Text>
            </View>

            {showResetConfirm && (
              <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
                <Text className="text-[11px] font-sans font-bold text-red-800">
                  Are you sure you want to reset reviews for today?
                </Text>
                <Text className="text-[9px] font-sans text-red-700/80 leading-relaxed">
                  This undoes any reviews you already completed today -- only verses you reviewed today go back to
                  due. Nothing reviewed on an earlier day, in any phase, is touched.
                </Text>
                <View className="flex-row gap-2 justify-end pt-1">
                  <Pressable
                    onPress={() => setShowResetConfirm(false)}
                    className="px-3 py-1.5 border border-neutral-300 rounded-lg"
                  >
                    <Text className="text-neutral-600 font-sans font-bold text-[10px]">Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      triggerMockDueReviews();
                      setShowResetConfirm(false);
                    }}
                    className="px-3 py-1.5 bg-red-600 rounded-lg"
                  >
                    <Text className="text-white font-sans font-bold text-[10px]">Yes, Reset</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {dueReviewItems.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Pressable
                  onPress={handleReviewAllDue}
                  className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center justify-center"
                >
                  <Text className="text-white font-sans font-bold text-xs">
                    Review All Due ({dueReviewItems.length} {dueReviewItems.length === 1 ? 'verse' : 'verses'})
                  </Text>
                </Pressable>

                {/* Daily Reviews (Green) */}
                {groupedDailyReviewing.length > 0 && (
                  <View style={{ gap: 6 }}>
                    {groupedDailyReviewing.map((group) => (
                      <View
                        key={group.label}
                        className="flex-row justify-between items-center bg-white px-3 py-2 rounded-xl border-l-4 border-l-emerald-500 border border-neutral-200 shadow-3xs"
                      >
                        <Pressable onPress={() => navigateTo('chapterLanding', group.book, group.chapter)}>
                          <Text className="text-xs font-serif font-black text-emerald-900">{group.label}</Text>
                        </Pressable>
                        <View className="flex-row gap-1">
                          <Pressable
                            onPress={() => handleGroupPractice('listen', group.items)}
                            className="bg-white border border-emerald-200 w-6 h-5 items-center justify-center rounded"
                          >
                            <Text className="text-emerald-700 text-[10px] font-bold">L</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleGroupPractice('learn', group.items)}
                            className="bg-emerald-600 px-2 h-5 items-center justify-center rounded"
                          >
                            <Text className="text-white text-[9px] font-bold">Review</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Weekly Reviews (Blue) */}
                {groupedWeeklyReviewing.length > 0 && (
                  <View style={{ gap: 6 }}>
                    {groupedWeeklyReviewing.map((group) => (
                      <View
                        key={group.label}
                        className="flex-row justify-between items-center bg-white px-3 py-2 rounded-xl border-l-4 border-l-blue-500 border border-neutral-200 shadow-3xs"
                      >
                        <Pressable onPress={() => navigateTo('chapterLanding', group.book, group.chapter)}>
                          <Text className="text-xs font-serif font-black text-blue-900">{group.label}</Text>
                        </Pressable>
                        <View className="flex-row gap-1">
                          <Pressable
                            onPress={() => handleGroupPractice('listen', group.items)}
                            className="bg-white border border-blue-200 w-6 h-5 items-center justify-center rounded"
                          >
                            <Text className="text-blue-700 text-[10px] font-bold">L</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleGroupPractice('learn', group.items)}
                            className="bg-blue-600 px-2 h-5 items-center justify-center rounded"
                          >
                            <Text className="text-white text-[9px] font-bold">Review</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Monthly Reviews (Orange) */}
                {groupedMonthlyReviewing.length > 0 && (
                  <View style={{ gap: 6 }}>
                    {groupedMonthlyReviewing.map((group) => (
                      <View
                        key={group.label}
                        className="flex-row justify-between items-center bg-white px-3 py-2 rounded-xl border-l-4 border-l-amber-500 border border-neutral-200 shadow-3xs"
                      >
                        <Pressable onPress={() => navigateTo('chapterLanding', group.book, group.chapter)}>
                          <Text className="text-xs font-serif font-black text-amber-900">{group.label}</Text>
                        </Pressable>
                        <View className="flex-row gap-1">
                          <Pressable
                            onPress={() => handleGroupPractice('listen', group.items)}
                            className="bg-white border border-amber-200 w-6 h-5 items-center justify-center rounded"
                          >
                            <Text className="text-amber-700 text-[10px] font-bold">L</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleGroupPractice('learn', group.items)}
                            className="bg-amber-600 px-2 h-5 items-center justify-center rounded"
                          >
                            <Text className="text-white text-[9px] font-bold">Review</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <Text className="text-xs text-neutral-400 italic pl-1">No reviews due today! Keeping up nicely! 🎉</Text>
            )}
          </View>

          {/* PRIMING SECTION */}
          <View className="pt-3 border-t border-neutral-100" style={{ gap: 8 }}>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-sans font-extrabold uppercase tracking-wider text-neutral-400">
                Memory Priming
              </Text>
              <View className="flex-row items-center gap-1.5 bg-neutral-50 border border-neutral-200 px-2 py-0.5 rounded-lg">
                <Text className="text-[10px] font-sans font-bold text-neutral-500"># of verses</Text>
                <View style={{ width: 90 }}>
                  <Dropdown options={LOOKAHEAD_OPTIONS} value={primingLookahead} onChange={setPrimingLookahead} title="Priming Window Size" />
                </View>
              </View>
            </View>

            {groupedPriming.length > 0 ? (
              <View style={{ gap: 6 }}>
                {groupedPriming.map((group) => (
                  <View
                    key={group.label}
                    className="flex-row justify-between items-center bg-white px-3 py-2 rounded-xl border border-neutral-200"
                  >
                    <Pressable onPress={() => navigateTo('chapterLanding', group.book, group.chapter)}>
                      <Text className="text-xs font-serif font-bold text-[#1A1A1A]">{group.label}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleGroupPractice('listen', group.items)}
                      className="bg-neutral-100 px-3 py-1 rounded-lg"
                    >
                      <Text className="text-[#1A1A1A] font-sans font-bold text-[10px]">Listen</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-xs text-neutral-400 italic pl-1">No queued verses remaining to prime!</Text>
            )}
          </View>

          {/* CARD FOOTER BUTTONS */}
          <View className="pt-4 border-t border-neutral-100 flex-row gap-3 mt-4">
            <Pressable
              onPress={() => navigateTo('activePlan')}
              className="flex-1 py-2.5 border-2 border-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5 shadow-3xs"
            >
              <Text className="text-[#1A1A1A] font-sans font-bold text-xs">Edit Memory Verse Queue</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const allDashItems = [...learningItems, ...dueReviewItems, ...queuedLookahead];
                if (allDashItems.length > 0) {
                  handleGroupPractice('listen', allDashItems);
                } else {
                  triggerToast("No items on dashboard to listen to!");
                }
              }}
              className="flex-1 py-2.5 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5 shadow-sm"
            >
              <Volume2 size={13} color="#FFFFFF" />
              <Text className="text-white font-sans font-bold text-xs">Listen to Today's Scripture</Text>
            </Pressable>
          </View>
        </View>

        {/* FEATURES GRID */}
        <View style={{ gap: 12 }}>
          <View className="flex-row gap-3">
            {/* Feature 1 */}
            <Pressable
              onPress={() => navigateTo('audioFeed')}
              className="flex-1 border border-[#E5E5E5] p-3 rounded-xl bg-white items-center justify-center shadow-sm h-24"
              style={{ gap: 6 }}
            >
              <Volume2 size={18} color="#1A1A1A" />
              <Text className="text-[10px] font-bold font-sans text-[#444] leading-tight text-center">
                Find Audio Recordings
              </Text>
            </Pressable>

            {/* Feature 2: My Memory Plans */}
            <Pressable
              onPress={() => navigateTo('savedPlans')}
              className="flex-1 border border-[#E5E5E5] p-3 rounded-xl bg-white items-center justify-center shadow-sm h-24"
              style={{ gap: 6 }}
            >
              <FolderOpen size={18} color="#1A1A1A" />
              <Text className="text-[10px] font-bold font-sans text-[#444] leading-tight text-center">
                My Memory Plans
              </Text>
            </Pressable>

            {/* Feature 3: Verse Search / Bible */}
            <Pressable
              onPress={() => navigateTo('books')}
              className="flex-1 border-2 border-[#1A1A1A] p-3 rounded-xl bg-white items-center justify-center shadow-sm h-24"
              style={{ gap: 6 }}
            >
              <BookMarked size={18} color="#1A1A1A" />
              <Text className="text-[10px] font-extrabold font-sans text-[#1A1A1A] leading-tight text-center">
                Verse Search / Bible
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

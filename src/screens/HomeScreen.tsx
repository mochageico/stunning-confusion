import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Volume2, BookMarked, ClipboardCheck, FolderOpen, Target } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { QueueItem, VerseState } from '../types';
import { FadeInView, HelpTooltip } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { AppText, CollapsibleCard, MIN_TOUCH, useFontScale, useScaledSpace } from '../components/design';

/**
 * One tile in the feature grid. Was three across at a fixed `h-24` plus a
 * stranded `h-14` row: ~105pt per tile, so "Find Audio Recordings" wrapped to
 * three lines inside a box that could not grow. Two across gives ~160pt and
 * minHeight lets it grow.
 */
function FeatureTile({
  onPress,
  Icon,
  label,
  primary,
}: {
  onPress: () => void;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  primary?: boolean;
}) {
  const scale = useFontScale();
  const space = useScaledSpace();
  return (
    <Pressable
      onPress={onPress}
      className={`flex-1 rounded-xl bg-white items-center justify-center shadow-sm ${
        primary ? 'border-2 border-[#1A1A1A]' : 'border border-[#E5E5E5]'
      }`}
      style={{ minHeight: Math.round(76 * scale), padding: space(10), gap: space(6) }}
    >
      <Icon size={Math.round(18 * scale)} color="#1A1A1A" />
      <AppText
        variant="caption"
        className={`font-sans text-center ${primary ? 'font-extrabold text-[#1A1A1A]' : 'font-bold text-[#444]'}`}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

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

// One due-review group row. Daily/weekly/monthly rows are identical apart
// from their accent color, so they share this component rather than being
// hand-copied three times -- the same duplication that previously let the
// plan-designer sync blocks drift out of step with each other.
const REVIEW_ROW_THEMES = {
  emerald: { border: 'border-l-emerald-500', label: 'text-emerald-900', outline: 'border-emerald-200', outlineText: 'text-emerald-700', solid: 'bg-emerald-600' },
  blue: { border: 'border-l-blue-500', label: 'text-blue-900', outline: 'border-blue-200', outlineText: 'text-blue-700', solid: 'bg-blue-600' },
  amber: { border: 'border-l-amber-500', label: 'text-amber-900', outline: 'border-amber-200', outlineText: 'text-amber-700', solid: 'bg-amber-600' },
} as const;

function DueReviewRow({
  group,
  theme,
  onOpenChapter,
  onListen,
  onReview,
  onManualLog,
}: {
  group: GroupedItem;
  theme: keyof typeof REVIEW_ROW_THEMES;
  onOpenChapter: () => void;
  onListen: () => void;
  onReview: () => void;
  onManualLog: () => void;
}) {
  const t = REVIEW_ROW_THEMES[theme];
  return (
    <View className={`flex-row justify-between items-center bg-white px-3 py-2 rounded-xl border-l-4 ${t.border} border border-neutral-200 shadow-3xs`}>
      <Pressable onPress={onOpenChapter} className="flex-1 mr-2">
        <AppText variant="label" className={`font-serif font-black ${t.label}`} numberOfLines={1}>
          {group.label}
        </AppText>
      </Pressable>
      <View className="flex-row gap-1">
        {/* Manual log -- for a review genuinely done off-app, without having
            to open the practice overlay just to record it. */}
        <Pressable
          onPress={onManualLog}
          className="bg-white border border-neutral-200 px-1.5 h-5 items-center justify-center rounded"
          hitSlop={4}
        >
          <ClipboardCheck size={11} color="#525252" />
        </Pressable>
        <Pressable onPress={onListen} className={`bg-white border ${t.outline} px-2 h-5 items-center justify-center rounded`}>
          <AppText variant="micro" className={`${t.outlineText} font-bold`}>Listen</AppText>
        </Pressable>
        <Pressable onPress={onReview} className={`${t.solid} px-2 h-5 items-center justify-center rounded`}>
          <AppText variant="micro" className="text-white font-bold">Review</AppText>
        </Pressable>
      </View>
    </View>
  );
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
    handleUpdateVerseStatus,
    triggerDailyPull,
    isReviewDue,
    pausedAt,
    pausedUntil,
  } = state;

  // While paused (Settings -> Pause Reviews), nothing should read as "due" --
  // that's the whole promise of pausing. An indefinite pause (pausedUntil
  // null) stays active until resumed manually; a dated pause clears itself
  // here once its date passes even before the user taps Resume.
  const isPausedNow = !!pausedAt && (!pausedUntil || new Date(pausedUntil) > new Date());

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPullShieldConfirm, setShowPullShieldConfirm] = useState(false);
  // Which due group (if any) has its manual-log sheet open. Holds the group
  // itself rather than a boolean so the sheet knows what it's logging.
  const [manualLogGroup, setManualLogGroup] = useState<GroupedItem | null>(null);

  const firstName = (user?.displayName || 'Friend').split(' ')[0];

  const space = useScaledSpace();
  const iconSize = Math.round(14 * useFontScale());

  // Excludes verses that already banked every mastery touch -- they're done
  // learning and just waiting on their reviews to clear before promotion out
  // of 'learning' status, so bundling them into a fresh "Learn" group with
  // newly-pulled verses would mean re-practicing something already finished.
  const learningItems = memoryQueue.filter(
    (item) => item.status === 'learning' && (item.touchLogs?.length || 0) < masteryTouches
  );
  const dueReviewItems = isPausedNow
    ? []
    : memoryQueue.filter((item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate));
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

  // Manual log for a review actually done off-app. Mirrors the sheet inside
  // PracticeModals exactly (same three outcomes, same handleUpdateVerseStatus
  // contract) -- 'reveal' marks the touch as self-reported rather than
  // machine-graded, and an omitted `perfect` is treated as a claimed perfect
  // run (banks a mastery touch), while `perfect: false` counts the review
  // without one.
  const submitManualLog = (outcome: 'perfect' | 'passed' | 'practice') => {
    const group = manualLogGroup;
    setManualLogGroup(null);
    if (!group) return;
    const vStates = mapQueueToVerseStates(group.items);
    if (outcome === 'practice') {
      handleUpdateVerseStatus(vStates, 'learning', 'reveal');
    } else if (outcome === 'passed') {
      handleUpdateVerseStatus(vStates, 'memorized', 'reveal', { perfect: false });
    } else {
      handleUpdateVerseStatus(vStates, 'memorized', 'reveal');
    }
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
        {/* Top Editorial Header -- now carries the day's time estimate, which
            summarises the whole day rather than belonging to any one section. */}
        <View className="pb-3 border-b border-[#E5E5E5]" style={{ gap: 2 }}>
          <AppText variant="micro" className="font-sans font-bold uppercase tracking-[0.15em] text-[#888]">
            {getTodayDateString()}
          </AppText>
          <AppText variant="display" className="font-serif font-black text-[#1A1A1A]">
            {getGreeting()}, {firstName}.
          </AppText>
          <AppText variant="caption" className="font-mono font-bold uppercase tracking-wider text-neutral-500">
            about {estMinutes} min today
          </AppText>
        </View>

        <CollapsibleCard
          storageKey="home.learning"
          title="Learning phase"
          summary={`${learningItems.length} verses`}
          defaultCollapsed={learningItems.length === 0}
        >
          <View className="flex-row items-center" style={{ gap: space(6) }}>
            <HelpTooltip
              text={`Verses you're actively learning. Each one needs ${masteryTouches} perfect recalls, at least an hour apart, before it graduates into spaced review.`}
            />
            {memoryQueue.some((item) => item.status === 'queued') && (
              <Pressable
                onPress={handlePullNewVerses}
                className="bg-neutral-900 rounded flex-row items-center justify-center"
                style={{ minHeight: space(28), paddingHorizontal: space(8), paddingVertical: space(4) }}
              >
                <AppText variant="micro" className="text-white font-sans font-extrabold">
                  Pull New Verses
                </AppText>
              </Pressable>
            )}
          </View>

          {showPullShieldConfirm && (
            <View className="bg-indigo-50 border border-indigo-200 rounded-xl p-3" style={{ gap: 8 }}>
              <AppText variant="caption" className="font-sans font-bold text-indigo-900">
                🛡️ Review Shield is on — pull new verses anyway?
              </AppText>
              <AppText variant="micro" className="font-sans text-indigo-800/80 leading-relaxed">
                Today's review time ({estMinutes}m) already meets or exceeds your {maxReviewCap}m daily limit.
                Pulling more now adds on top of that, on purpose.
              </AppText>
              <View className="flex-row gap-2 justify-end pt-1">
                <Pressable
                  onPress={() => setShowPullShieldConfirm(false)}
                  className="px-3 py-1.5 border border-neutral-300 rounded-lg"
                >
                  <AppText variant="caption" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerDailyPull({ bypassShield: true });
                    setShowPullShieldConfirm(false);
                  }}
                  className="px-3 py-1.5 bg-indigo-600 rounded-lg"
                >
                  <AppText variant="caption" className="text-white font-sans font-bold ">Yes, Pull Anyway</AppText>
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
                      <AppText variant="label" className="font-serif font-bold text-[#1A1A1A]">{group.label}</AppText>
                    </Pressable>
                    <View className="flex-row gap-1">
                      <Pressable
                        onPress={() => handleGroupPractice('listen', group.items)}
                        className="bg-white border border-neutral-300 px-2 h-5 items-center justify-center rounded"
                      >
                        <AppText variant="micro" className="text-neutral-700 font-bold">Listen</AppText>
                      </Pressable>
                      <Pressable
                        onPress={() => handleGroupPractice('learn', group.items)}
                        className="bg-[#1A1A1A] px-2 h-5 items-center justify-center rounded"
                      >
                        <AppText variant="micro" className="text-white font-bold">Learn</AppText>
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
                          <AppText variant="micro" className="font-sans font-bold text-neutral-500">v{item.verseNumber}</AppText>
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
                          <AppText variant="micro" className="font-mono font-black text-neutral-400">
                            {touchesCount}/{masteryTouches}
                          </AppText>
                          {isBankedAwaitingReview && (
                            <HelpTooltip text="This verse has all its touches. Retention comes first, so it moves into spaced review on its own as soon as today's due reviews are done." />
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <AppText variant="label" className="text-neutral-400 italic pl-1">No verses currently in learning phase.</AppText>
          )}
        </CollapsibleCard>

        <CollapsibleCard
          storageKey="home.reviews"
          title="Due reviews"
          summary={`${dueReviewItems.length} due`}
          defaultCollapsed={dueReviewItems.length === 0}
        >
          <View className="flex-row items-center" style={{ gap: space(6) }}>
            <HelpTooltip text="Verses you've already learned, coming back around on schedule. Each one cycles daily for a while, then weekly, then monthly, before it's retained for good." />
            <Pressable
              onPress={() => setShowResetConfirm(true)}
              className="bg-red-50 border border-red-200 rounded flex-row items-center justify-center"
              style={{ minHeight: space(28), paddingHorizontal: space(8), paddingVertical: space(4) }}
            >
              <AppText variant="micro" className="text-red-700 font-sans font-extrabold">
                Reset Reviews for Today
              </AppText>
            </Pressable>
          </View>

          {showResetConfirm && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
              <AppText variant="caption" className="font-sans font-bold text-red-800">
                Are you sure you want to reset reviews for today?
              </AppText>
              <AppText variant="micro" className="font-sans text-red-700/80 leading-relaxed">
                This undoes any reviews you already finished today — only verses you reviewed today go back to
                due. Nothing you reviewed on an earlier day is affected.
              </AppText>
              <View className="flex-row gap-2 justify-end pt-1">
                <Pressable
                  onPress={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 border border-neutral-300 rounded-lg"
                >
                  <AppText variant="caption" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerMockDueReviews();
                    setShowResetConfirm(false);
                  }}
                  className="px-3 py-1.5 bg-red-600 rounded-lg"
                >
                  <AppText variant="caption" className="text-white font-sans font-bold ">Yes, Reset</AppText>
                </Pressable>
              </View>
            </View>
          )}

          {/* Manual log for a group reviewed off-app. Inline card rather
              than a modal, matching this screen's other confirm patterns. */}
          {manualLogGroup && (
            <View className="bg-neutral-50 border border-neutral-300 rounded-xl p-3" style={{ gap: 8 }}>
              <View>
                <AppText variant="caption" className="font-sans font-bold text-neutral-800">Log {manualLogGroup.label} manually</AppText>
                <AppText variant="micro" className="font-sans text-neutral-500 leading-relaxed">
                  For a review you actually did somewhere else — out loud in the car, from a card, anywhere but here.
                </AppText>
              </View>
              <View style={{ gap: 6 }}>
                <Pressable onPress={() => submitManualLog('perfect')} className="w-full py-2 bg-emerald-600 rounded-lg items-center">
                  <AppText variant="caption" className="text-white font-sans font-bold ">Perfect — no mistakes</AppText>
                </Pressable>
                <Pressable onPress={() => submitManualLog('passed')} className="w-full py-2 bg-indigo-600 rounded-lg items-center">
                  <AppText variant="caption" className="text-white font-sans font-bold ">Got it, with a stumble</AppText>
                </Pressable>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => submitManualLog('practice')}
                    className="flex-1 py-1.5 border border-dashed border-neutral-300 rounded-lg items-center"
                  >
                    <AppText variant="caption" className="text-neutral-500 font-sans font-bold ">Needs practice</AppText>
                  </Pressable>
                  <Pressable onPress={() => setManualLogGroup(null)} className="flex-1 py-1.5 border border-neutral-300 rounded-lg items-center">
                    <AppText variant="caption" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {dueReviewItems.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Pressable
                onPress={handleReviewAllDue}
                className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center justify-center"
              >
                <AppText variant="label" className="text-white font-sans font-bold ">
                  Review All Due ({dueReviewItems.length} {dueReviewItems.length === 1 ? 'verse' : 'verses'})
                </AppText>
              </Pressable>

              {/* Daily / Weekly / Monthly review groups, in that order --
                  same order handleReviewAllDue chains them in. */}
              {(
                [
                  { groups: groupedDailyReviewing, theme: 'emerald' as const },
                  { groups: groupedWeeklyReviewing, theme: 'blue' as const },
                  { groups: groupedMonthlyReviewing, theme: 'amber' as const },
                ] as const
              ).map(({ groups, theme }) =>
                groups.length === 0 ? null : (
                  <View key={theme} style={{ gap: 6 }}>
                    {groups.map((group) => (
                      <DueReviewRow
                        key={group.label}
                        group={group}
                        theme={theme}
                        onOpenChapter={() => navigateTo('chapterLanding', group.book, group.chapter)}
                        onListen={() => handleGroupPractice('listen', group.items)}
                        onReview={() => handleGroupPractice('learn', group.items)}
                        onManualLog={() => setManualLogGroup(group)}
                      />
                    ))}
                  </View>
                )
              )}
            </View>
          ) : (
            <AppText variant="label" className="text-neutral-400 italic pl-1">No reviews due today! Keeping up nicely! 🎉</AppText>
          )}
        </CollapsibleCard>

        <CollapsibleCard
          storageKey="home.priming"
          title="Memory priming"
          summary={`${queuedLookahead.length} queued`}
          defaultCollapsed={queuedLookahead.length === 0}
        >
          {/* The section title and count now live on the collapsible header
              above; this row keeps only the window-size control. */}
          <View className="flex-row items-center" style={{ gap: space(6) }}>
            <AppText variant="micro" className="font-sans font-bold text-neutral-500 shrink-0">
              # of verses
            </AppText>
            <View style={{ flex: 1, maxWidth: 150 }}>
              <Dropdown options={LOOKAHEAD_OPTIONS} value={primingLookahead} onChange={setPrimingLookahead} title="Priming Window Size" compact />
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
                    <AppText variant="label" className="font-serif font-bold text-[#1A1A1A]">{group.label}</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleGroupPractice('listen', group.items)}
                    className="bg-neutral-100 px-3 py-1 rounded-lg"
                  >
                    <AppText variant="caption" className="text-[#1A1A1A] font-sans font-bold ">Listen</AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <AppText variant="label" className="text-neutral-400 italic pl-1">No queued verses remaining to prime!</AppText>
          )}
        </CollapsibleCard>

        {/* Primary action, promoted out of the old card footer to full width.
            The "Edit Memory Verse Queue" link that used to sit under it is
            gone -- the queue is one tap away through Memory Desk in the grid
            below, and Home doesn't need a second door to it. */}
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={() => {
              const allDashItems = [...learningItems, ...dueReviewItems, ...queuedLookahead];
              if (allDashItems.length > 0) {
                handleGroupPractice('listen', allDashItems);
              } else {
                triggerToast("No items on dashboard to listen to!");
              }
            }}
            className="w-full bg-[#1A1A1A] rounded-xl flex-row items-center justify-center shadow-sm"
            style={{ minHeight: MIN_TOUCH, paddingVertical: space(12), gap: space(6) }}
          >
            <Volume2 size={iconSize} color="#FFFFFF" />
            <AppText variant="label" className="text-white font-sans font-bold">
              Listen to Today's Scripture
            </AppText>
          </Pressable>
        </View>

        {/* FEATURES GRID -- 2x2 at minHeight, replacing 3-across at a fixed
            h-24 plus a stranded h-14 row. There are exactly four features, so
            two columns is simply the right shape for them. */}
        <View style={{ gap: 12 }}>
          <View className="flex-row" style={{ gap: 12 }}>
            <FeatureTile onPress={() => navigateTo('audioFeed')} Icon={Volume2} label="Find Audio Recordings" />
            <FeatureTile onPress={() => navigateTo('memoryDesk')} Icon={FolderOpen} label="Memory Desk" />
          </View>
          <View className="flex-row" style={{ gap: 12 }}>
            <FeatureTile onPress={() => navigateTo('books')} Icon={BookMarked} label="Verse Search / Bible" />
            <FeatureTile onPress={() => navigateTo('referenceDrill')} Icon={Target} label="Reference Drill (practice)" />
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Volume2, BookMarked, ClipboardCheck, FolderOpen, Target } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { QueueItem, VerseState } from '../types';
import { FadeInView, HelpTooltip } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { AppButton, AppText, CollapsibleCard, MIN_TOUCH, useFontScale, useScaledSpace } from '../components/design';

import { useThemeColors } from '../components/theme';
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
}: {
  onPress: () => void;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-xl bg-surface items-center justify-center shadow-sm border border-line"
      style={{ minHeight: Math.round(76 * scale), padding: space(10), gap: space(6) }}
    >
      <Icon size={Math.round(18 * scale)} color={palette.ink} />
      <AppText variant="caption" className="font-sans text-center font-bold text-ink-2">
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
// from their stage stripe, so they share this component rather than being
// hand-copied three times -- the same duplication that previously let the
// plan-designer sync blocks drift out of step with each other.
const REVIEW_ROW_THEMES = {
  // The stage shows as the stripe only. Text and buttons stay ink and accent:
  // daily and monthly green/gold are too light to read as text.
  emerald: { border: 'border-l-stage-daily', label: 'text-ink', outline: 'border-line-strong', outlineText: 'text-accent', solid: 'bg-accent' },
  blue: { border: 'border-l-stage-weekly', label: 'text-ink', outline: 'border-line-strong', outlineText: 'text-accent', solid: 'bg-accent' },
  amber: { border: 'border-l-stage-monthly', label: 'text-ink', outline: 'border-line-strong', outlineText: 'text-accent', solid: 'bg-accent' },
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
  const palette = useThemeColors();
  const t = REVIEW_ROW_THEMES[theme];
  // Past 1.3x the three buttons leave the reference a letter or two, so the
  // reference gets its own line and the buttons sit under it.
  const stacked = useFontScale() >= 1.3;
  return (
    <View
      className={`${stacked ? '' : 'flex-row justify-between items-center'} bg-surface px-3 py-2 rounded-xl border-l-4 ${t.border} border border-line shadow-3xs`}
      style={stacked ? { gap: 6 } : undefined}
    >
      <Pressable onPress={onOpenChapter} className={stacked ? '' : 'flex-1 mr-2'}>
        <AppText variant="label" className={`font-serif ${t.label}`} numberOfLines={stacked ? undefined : 1}>
          {group.label}
        </AppText>
      </Pressable>
      {/* All three are `sm`: secondary actions inside a row that is itself
          tappable, so they carry hitSlop rather than a 44pt frame. They were
          pinned at h-5 (20pt), which clipped their labels outright at 1.5x. */}
      <View className={`flex-row gap-1 ${stacked ? 'self-end' : 'shrink-0'}`}>
        {/* Manual log -- for a review genuinely done off-app, without having
            to open the practice overlay just to record it. */}
        <AppButton
          size="sm"
          onPress={onManualLog}
          Icon={ClipboardCheck}
          iconColor={palette.ink2}
          className="bg-surface border border-line rounded"
          style={{ paddingHorizontal: 8 }}
        />
        <AppButton
          size="sm"
          onPress={onListen}
          label="Listen"
          className={`bg-surface border ${t.outline} rounded`}
          textClassName={`font-normal ${t.outlineText}`}
        />
        <AppButton size="sm" onPress={onReview} label="Review" className={`${t.solid} rounded`} textClassName="font-normal text-on-accent" />
      </View>
    </View>
  );
}

export default function HomeScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
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
    setShowTour,
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
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: 20 }}>
        {/* Top Editorial Header -- now carries the day's time estimate, which
            summarises the whole day rather than belonging to any one section. */}
        <View className="pb-3 border-b border-line" style={{ gap: 2 }}>
          <AppText variant="micro" className="font-sans font-bold uppercase tracking-[0.15em] text-ink-3">
            {getTodayDateString()}
          </AppText>
          <AppText variant="display" className="font-serif font-black text-ink">
            {getGreeting()}, {firstName}.
          </AppText>
          <AppText variant="caption" className="font-mono font-bold uppercase tracking-wider text-ink-3">
            about {estMinutes} min today
          </AppText>
        </View>

        {/* START HERE -- Home's own empty state, and the real replacement for
            the old dismissable Getting-Started overlay.

            Two things make it better than an overlay: it's contextual (it
            appears exactly when there's nothing to do and says the one thing
            worth doing), and it retires itself the moment the queue is
            non-empty, so it never has to be dismissed and can never be
            dismissed by mistake. Before this, a brand-new user who closed the
            checklist landed on three collapsed cards reading "No verses
            currently in learning phase" with nothing telling them what to
            do next. */}
        {memoryQueue.length === 0 && (
          <View
            className="rounded-xl border-2 border-ink bg-surface-2"
            style={{ padding: space(16), gap: space(10) }}
          >
            <AppText variant="body" className="font-serif font-black text-ink">
              Start here
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2 leading-relaxed">
              You haven't picked any verses yet. Choose a few you'd like to know by heart — the app takes care of when
              you see them after that.
            </AppText>
            <Pressable
              onPress={() => navigateTo('books')}
              accessibilityRole="button"
              className="w-full rounded-xl bg-accent flex-row items-center justify-center"
              style={{ minHeight: MIN_TOUCH, paddingVertical: space(12), gap: space(6) }}
            >
              <BookMarked size={iconSize} color={palette.onAccent} />
              <AppText variant="label" className="text-on-accent font-sans font-bold">
                Choose my first verses
              </AppText>
            </Pressable>
            <Pressable onPress={() => setShowTour(true)} className="w-full items-center" style={{ paddingVertical: space(4) }}>
              <AppText variant="caption" className="text-ink-3 font-sans font-bold underline">
                Show me around first
              </AppText>
            </Pressable>
          </View>
        )}

        <CollapsibleCard
          storageKey="home.learning"
          title="Learning now"
          summary={`${learningItems.length} verses`}
          defaultCollapsed={learningItems.length === 0}
        >
          <View className="flex-row items-center" style={{ gap: space(6) }}>
            <HelpTooltip
              text={`The verses you're working on right now. Each one needs ${masteryTouches} perfect recalls, at least an hour apart, before the app counts it as learned and starts bringing it back on a schedule.`}
            />
            {memoryQueue.some((item) => item.status === 'queued') && (
              <Pressable
                onPress={handlePullNewVerses}
                className="bg-accent rounded flex-row items-center justify-center"
                style={{ minHeight: space(28), paddingHorizontal: space(8), paddingVertical: space(4) }}
              >
                <AppText variant="micro" className="text-on-accent font-sans font-extrabold">
                  Pull Next Verses
                </AppText>
              </Pressable>
            )}
          </View>

          {showPullShieldConfirm && (
            <View className="bg-accent-soft border border-accent/30 rounded-xl p-3" style={{ gap: 8 }}>
              <AppText variant="caption" className="font-sans font-bold text-accent">
                🛡️ Start more verses anyway?
              </AppText>
              <AppText variant="micro" className="font-sans text-accent leading-relaxed">
                Today already has about {estMinutes} minutes of review, which meets the {maxReviewCap}-minute limit you
                set. Starting more verses now adds to that on purpose.
              </AppText>
              <View className="flex-row gap-2 justify-end pt-1">
                <Pressable
                  onPress={() => setShowPullShieldConfirm(false)}
                  className="px-3 py-1.5 border border-line-strong rounded-lg"
                >
                  <AppText variant="caption" className="text-ink-2 font-sans font-bold ">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerDailyPull({ bypassShield: true });
                    setShowPullShieldConfirm(false);
                  }}
                  className="px-3 py-1.5 bg-accent rounded-lg"
                >
                  <AppText variant="caption" className="text-on-accent font-sans font-bold ">Yes, start them</AppText>
                </Pressable>
              </View>
            </View>
          )}

          {groupedLearning.length > 0 ? (
            <View style={{ gap: 8 }}>
              {groupedLearning.map((group) => (
                <View
                  key={group.label}
                  className="flex-col bg-surface-2 px-3 py-2.5 rounded-xl border border-hairline"
                  style={{ gap: 8 }}
                >
                  {/* The reference wraps rather than pushing the buttons off
                      the card; the buttons never shrink. */}
                  <View className="flex-row justify-between items-center" style={{ gap: 8 }}>
                    <Pressable onPress={() => navigateTo('chapterLanding', group.book, group.chapter)} className="flex-1">
                      <AppText variant="label" className="font-serif text-ink">{group.label}</AppText>
                    </Pressable>
                    <View className="flex-row gap-1 shrink-0">
                      <AppButton
                        size="sm"
                        onPress={() => handleGroupPractice('listen', group.items)}
                        label="Listen"
                        className="bg-surface border border-line-strong rounded"
                        textClassName="font-normal text-ink-2"
                      />
                      <AppButton
                        size="sm"
                        onPress={() => handleGroupPractice('learn', group.items)}
                        label="Learn"
                        className="bg-accent rounded"
                        textClassName="font-normal text-on-accent"
                      />
                    </View>
                  </View>

                  {/* Individual Verse mastery progress bars/dots */}
                  <View className="flex-row flex-wrap gap-x-2 gap-y-1 pt-1.5 border-t border-hairline">
                    {group.items.map((item) => {
                      const touchesCount = item.touchLogs ? item.touchLogs.length : 0;
                      const isBankedAwaitingReview = touchesCount >= masteryTouches;
                      return (
                        <View
                          key={item.verseId}
                          className={`flex-row items-center gap-1.5 px-2 py-0.5 rounded-md border ${
                            isBankedAwaitingReview ? 'bg-surface-2 border-line opacity-60' : 'bg-surface border-hairline'
                          }`}
                        >
                          <AppText variant="micro" className="font-sans font-bold text-ink-3">v{item.verseNumber}</AppText>
                          <View className="flex-row gap-0.5">
                            {Array.from({ length: masteryTouches }).map((_, i) => (
                              <View
                                key={i}
                                className={`w-1.5 h-1.5 rounded-full ${
                                  i < touchesCount ? 'bg-success border border-success' : 'bg-fill'
                                }`}
                              />
                            ))}
                          </View>
                          <AppText variant="micro" className="font-mono font-black text-ink-3">
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
            <AppText variant="label" className="text-ink-3 italic pl-1">Nothing being learned right now.</AppText>
          )}
        </CollapsibleCard>

        <CollapsibleCard
          storageKey="home.reviews"
          title="Review"
          summary={`${dueReviewItems.length} due`}
          defaultCollapsed={dueReviewItems.length === 0}
        >
          <View className="flex-row items-center" style={{ gap: space(6) }}>
            <HelpTooltip text="Verses you've already learned, back for a quick check so you don't forget them. Each one comes back every day for a while, then once a week, then once a month — and then it stops." />
            <Pressable
              onPress={() => setShowResetConfirm(true)}
              className="bg-danger-soft border border-danger/30 rounded flex-row items-center justify-center"
              style={{ minHeight: space(28), paddingHorizontal: space(8), paddingVertical: space(4) }}
            >
              <AppText variant="micro" className="text-danger font-sans font-extrabold">
                Reset Reviews for Today
              </AppText>
            </Pressable>
          </View>

          {showResetConfirm && (
            <View className="bg-danger-soft border border-danger/30 rounded-xl p-3" style={{ gap: 8 }}>
              <AppText variant="caption" className="font-sans font-bold text-danger">
                Are you sure you want to reset reviews for today?
              </AppText>
              <AppText variant="micro" className="font-sans text-danger leading-relaxed">
                This undoes any reviews you already finished today — only verses you reviewed today go back to
                due. Nothing you reviewed on an earlier day is affected.
              </AppText>
              <View className="flex-row gap-2 justify-end pt-1">
                <Pressable
                  onPress={() => setShowResetConfirm(false)}
                  className="px-3 py-1.5 border border-line-strong rounded-lg"
                >
                  <AppText variant="caption" className="text-ink-2 font-sans font-bold ">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerMockDueReviews();
                    setShowResetConfirm(false);
                  }}
                  className="px-3 py-1.5 bg-danger rounded-lg"
                >
                  <AppText variant="caption" className="text-on-accent font-sans font-bold ">Yes, Reset</AppText>
                </Pressable>
              </View>
            </View>
          )}

          {/* Manual log for a group reviewed off-app. Inline card rather
              than a modal, matching this screen's other confirm patterns. */}
          {manualLogGroup && (
            <View className="bg-surface-2 border border-line-strong rounded-xl p-3" style={{ gap: 8 }}>
              <View>
                <AppText variant="caption" className="font-sans font-bold text-ink">Log {manualLogGroup.label} manually</AppText>
                <AppText variant="micro" className="font-sans text-ink-3 leading-relaxed">
                  For a review you actually did somewhere else — out loud in the car, from a card, anywhere but here.
                </AppText>
              </View>
              <View style={{ gap: 6 }}>
                <AppButton size="md" onPress={() => submitManualLog('perfect')} className="w-full bg-success rounded-lg items-center">
                  <AppText variant="caption" className="text-on-accent font-sans font-bold ">Perfect — no mistakes</AppText>
                </AppButton>
                <AppButton size="md" onPress={() => submitManualLog('passed')} className="w-full bg-accent rounded-lg items-center">
                  <AppText variant="caption" className="text-on-accent font-sans font-bold ">Got it, with a stumble</AppText>
                </AppButton>
                <View className="flex-row gap-2">
                  <AppButton size="sm" onPress={() => submitManualLog('practice')} className="flex-1 border border-dashed border-line-strong rounded-lg items-center">
                    <AppText variant="caption" className="text-ink-3 font-sans font-bold ">Needs practice</AppText>
                  </AppButton>
                  <AppButton size="sm" onPress={() => setManualLogGroup(null)} className="flex-1 border border-line-strong rounded-lg items-center">
                    <AppText variant="caption" className="text-ink-2 font-sans font-bold ">Cancel</AppText>
                  </AppButton>
                </View>
              </View>
            </View>
          )}

          {dueReviewItems.length > 0 ? (
            <View style={{ gap: 8 }}>
              <AppButton size="md" onPress={handleReviewAllDue} className="w-full bg-accent rounded-xl items-center justify-center">
                <AppText variant="label" className="text-on-accent font-sans font-bold ">
                  Review All Due ({dueReviewItems.length} {dueReviewItems.length === 1 ? 'verse' : 'verses'})
                </AppText>
              </AppButton>

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
            <AppText variant="label" className="text-ink-3 italic pl-1">No reviews due today! Keeping up nicely! 🎉</AppText>
          )}
        </CollapsibleCard>

        <CollapsibleCard
          storageKey="home.priming"
          title="Coming up next"
          summary={`${queuedLookahead.length} waiting`}
          defaultCollapsed={queuedLookahead.length === 0}
        >
          {/* The section title and count now live on the collapsible header
              above; this row keeps only the window-size control. */}
          <View className="flex-row items-center" style={{ gap: space(6) }}>
            <HelpTooltip text="Verses you've picked but haven't started yet. Listening to them ahead of time makes them easier when their turn comes." />
            <AppText variant="micro" className="font-sans font-bold text-ink-3 shrink-0">
              Show
            </AppText>
            <View style={{ flex: 1, maxWidth: 150 }}>
              <Dropdown options={LOOKAHEAD_OPTIONS} value={primingLookahead} onChange={setPrimingLookahead} title="How many to show" compact />
            </View>
          </View>

          {groupedPriming.length > 0 ? (
            <View style={{ gap: 6 }}>
              {groupedPriming.map((group) => (
                <View
                  key={group.label}
                  className="flex-row justify-between items-center bg-surface px-3 py-2 rounded-xl border border-line"
                  style={{ gap: 8 }}
                >
                  <Pressable onPress={() => navigateTo('chapterLanding', group.book, group.chapter)} className="flex-1">
                    <AppText variant="label" className="font-serif text-ink">{group.label}</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => handleGroupPractice('listen', group.items)}
                    className="bg-surface-2 px-3 py-1 rounded-lg shrink-0"
                  >
                    <AppText variant="caption" className="text-ink font-sans">Listen</AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <AppText variant="label" className="text-ink-3 italic pl-1">Nothing waiting — add more verses when you're ready.</AppText>
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
            className="w-full bg-accent rounded-xl flex-row items-center justify-center shadow-sm"
            style={{ minHeight: MIN_TOUCH, paddingVertical: space(12), gap: space(6) }}
          >
            <Volume2 size={iconSize} color={palette.onAccent} />
            <AppText variant="label" className="text-on-accent font-sans font-bold">
              Listen to Today's Scripture
            </AppText>
          </Pressable>
        </View>

        {/* FEATURES GRID -- 2x2 at minHeight, replacing 3-across at a fixed
            h-24 plus a stranded h-14 row. There are exactly four features, so
            two columns is simply the right shape for them.

            All four are visually equal (no `primary` tile). These are four
            destinations of the same kind, and the one genuinely primary
            action for a new user -- choosing their first verses -- already
            has a full-width button in the empty state above. */}
        <View style={{ gap: 12 }}>
          <View className="flex-row" style={{ gap: 12 }}>
            <FeatureTile onPress={() => navigateTo('books')} Icon={BookMarked} label="Verse Finder" />
            <FeatureTile onPress={() => navigateTo('memoryDesk')} Icon={FolderOpen} label="My Memory Work" />
          </View>
          <View className="flex-row" style={{ gap: 12 }}>
            <FeatureTile onPress={() => navigateTo('audioFeed')} Icon={Volume2} label="Find Recordings" />
            <FeatureTile onPress={() => navigateTo('referenceDrill')} Icon={Target} label="Reference Practice" />
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Volume2, BookMarked, ClipboardCheck, FolderOpen, Target } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { QueueItem, VerseState } from '../types';
import { FadeInView, HelpTooltip } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { AppButton, AppIconButton, AppText, Card, CollapsibleCard, useFontScale, useScaledSpace } from '../components/design';
import { Dialog, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { formatDate } from '../lib/format';

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

/**
 * One row inside a Today section: the reference (tap it for the chapter) and
 * that group's buttons. Rows are divided by hairlines inside the section's
 * card instead of each being a small card of its own, which is what made the
 * old sections read as boxes inside boxes.
 *
 * Past 1.3x the buttons leave the reference a letter or two, so the reference
 * gets its own line and the buttons sit under it on the right.
 */
function TodayRow({
  label,
  first,
  onOpenChapter,
  actions,
  children,
}: {
  label: string;
  first: boolean;
  onOpenChapter: () => void;
  actions: React.ReactNode;
  children?: React.ReactNode;
}) {
  const space = useScaledSpace();
  const stacked = useFontScale() >= 1.3;
  return (
    <View className={first ? '' : 'border-t border-hairline'} style={{ paddingTop: first ? 0 : space(10), gap: space(6) }}>
      <View className={stacked ? '' : 'flex-row items-center'} style={{ gap: space(stacked ? 6 : 8) }}>
        <Pressable
          onPress={onOpenChapter}
          accessibilityRole="link"
          accessibilityHint="Opens the chapter"
          className={`active:opacity-60 ${stacked ? '' : 'flex-1'}`}
        >
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {label}
          </AppText>
        </Pressable>
        <View className={`flex-row items-center ${stacked ? 'self-end' : 'shrink-0'}`} style={{ gap: space(6) }}>
          {actions}
        </View>
      </View>
      {children}
    </View>
  );
}

/** A verse's progress toward being learned: "v3" and one dot per perfect recall needed. */
function TouchDots({ verseNumber, done, needed }: { verseNumber: number; done: number; needed: number }) {
  const space = useScaledSpace();
  const dot = Math.max(6, Math.round(space(6)));
  const banked = done >= needed;
  return (
    <View
      className={`flex-row items-center ${banked ? 'opacity-60' : ''}`}
      style={{ gap: space(5) }}
      accessible
      accessibilityLabel={`Verse ${verseNumber}: ${Math.min(done, needed)} of ${needed} perfect recalls`}
    >
      <AppText variant="caption" className="font-sans font-medium text-ink-2">
        v{verseNumber}
      </AppText>
      <View className="flex-row" style={{ gap: 3 }}>
        {Array.from({ length: needed }).map((_, i) => (
          <View
            key={i}
            className={`rounded-full ${i < done ? 'bg-accent' : 'bg-fill'}`}
            // layout-ok: a dot holds no text.
            style={{ width: dot, height: dot }}
          />
        ))}
      </View>
    </View>
  );
}

// Due reviews are grouped by how often they come back. The stage shows as a
// colored dot, always beside its name, so color is never the only signal.
const REVIEW_STAGES = [
  { key: 'daily', label: 'Daily', dot: 'bg-stage-daily' },
  { key: 'weekly', label: 'Weekly', dot: 'bg-stage-weekly' },
  { key: 'monthly', label: 'Monthly', dot: 'bg-stage-monthly' },
] as const;

function StageHeading({ label, dot, count }: { label: string; dot: string; count: number }) {
  const space = useScaledSpace();
  const d = Math.max(8, Math.round(space(8)));
  return (
    <View className="flex-row items-center" style={{ gap: space(6), paddingTop: space(4) }}>
      {/* layout-ok: a dot holds no text. */}
      <View className={`rounded-full ${dot}`} style={{ width: d, height: d }} />
      <AppText variant="caption" className="font-sans font-semibold text-ink-3">
        {label} · {count}
      </AppText>
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

  const hasVerses = memoryQueue.length > 0;
  const hasQueued = memoryQueue.some((item) => item.status === 'queued');
  const reviewGroupsByStage = {
    daily: groupedDailyReviewing,
    weekly: groupedWeeklyReviewing,
    monthly: groupedMonthlyReviewing,
  };
  const listenToEverything = () => {
    const allDashItems = [...learningItems, ...dueReviewItems, ...queuedLookahead];
    if (allDashItems.length > 0) {
      handleGroupPractice('listen', allDashItems);
    } else {
      triggerToast('Nothing on Today to listen to yet.');
    }
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: space(20) }}>
        {/* The time estimate summarises the whole day rather than any one
            section, so it lives in the header. */}
        <ScreenHeader
          eyebrow={formatDate(new Date(), 'long')}
          title={`${getGreeting()}, ${firstName}`}
          subtitle={hasVerses ? `About ${estMinutes} min today` : undefined}
        />

        {/* START HERE -- Today's own empty state. It appears exactly when
            there's nothing to do, says the one thing worth doing, and retires
            itself once a verse is picked, so it never needs dismissing. The
            three sections below stay hidden until then: three "0" boxes under
            it only said the same thing three more times. */}
        {!hasVerses && (
          <Card gap={12}>
            <AppText variant="title" className="font-sans font-bold text-ink">
              Start here
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              You haven't picked any verses yet. Choose a few you'd like to know by heart — the app takes care of when
              you see them after that.
            </AppText>
            <View style={{ gap: space(8), paddingTop: space(4) }}>
              <AppButton variant="primary" Icon={BookMarked} label="Choose my first verses" onPress={() => navigateTo('books')} />
              <AppButton variant="quiet" label="Show me around first" onPress={() => setShowTour(true)} />
            </View>
          </Card>
        )}

        {hasVerses && (
          <>
            <CollapsibleCard
              storageKey="home.learning"
              title="Learning now"
              summary={`${learningItems.length} ${learningItems.length === 1 ? 'verse' : 'verses'}`}
              defaultCollapsed={learningItems.length === 0}
              accessory={
                <HelpTooltip
                  text={`The verses you're working on right now. Each one needs ${masteryTouches} perfect recalls, at least an hour apart, before the app counts it as learned and starts bringing it back on a schedule.`}
                />
              }
            >
              {groupedLearning.length > 0 ? (
                <View style={{ gap: space(10) }}>
                  {groupedLearning.map((group, i) => (
                    <TodayRow
                      key={group.label}
                      label={group.label}
                      first={i === 0}
                      onOpenChapter={() => navigateTo('chapterLanding', group.book, group.chapter)}
                      actions={
                        <>
                          <AppButton size="sm" variant="quiet" label="Listen" onPress={() => handleGroupPractice('listen', group.items)} />
                          <AppButton size="sm" variant="secondary" label="Learn" onPress={() => handleGroupPractice('learn', group.items)} />
                        </>
                      }
                    >
                      <View className="flex-row flex-wrap items-center" style={{ columnGap: space(14), rowGap: space(4) }}>
                        {group.items.map((item) => {
                          const touchesCount = item.touchLogs ? item.touchLogs.length : 0;
                          return (
                            <View key={item.verseId} className="flex-row items-center" style={{ gap: space(4) }}>
                              <TouchDots verseNumber={item.verseNumber} done={touchesCount} needed={masteryTouches} />
                              {touchesCount >= masteryTouches && (
                                <HelpTooltip text="This verse has all its touches. Retention comes first, so it moves into spaced review on its own as soon as today's due reviews are done." />
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </TodayRow>
                  ))}
                </View>
              ) : (
                <AppText variant="label" className="font-sans text-ink-3">
                  Nothing being learned right now.
                </AppText>
              )}

              {hasQueued && (
                <AppButton variant="secondary" label="Start next verses" onPress={handlePullNewVerses} />
              )}
            </CollapsibleCard>

            <CollapsibleCard
              storageKey="home.reviews"
              title="Review"
              summary={`${dueReviewItems.length} due`}
              defaultCollapsed={dueReviewItems.length === 0}
              accessory={
                <HelpTooltip text="Verses you've already learned, back for a quick check so you don't forget them. Each one comes back every day for a while, then once a week, then once a month — and then it stops." />
              }
            >
              {dueReviewItems.length > 0 ? (
                <>
                  <AppButton
                    variant="primary"
                    label={`Review all due (${dueReviewItems.length} ${dueReviewItems.length === 1 ? 'verse' : 'verses'})`}
                    onPress={handleReviewAllDue}
                  />

                  {/* Daily, then weekly, then monthly: the same order
                      handleReviewAllDue chains them in. */}
                  {REVIEW_STAGES.map((stage) => {
                    const groups = reviewGroupsByStage[stage.key];
                    if (groups.length === 0) return null;
                    const count = groups.reduce((n, g) => n + g.items.length, 0);
                    return (
                      <View key={stage.key} style={{ gap: space(10) }}>
                        <StageHeading label={stage.label} dot={stage.dot} count={count} />
                        {groups.map((group, i) => (
                          <TodayRow
                            key={group.label}
                            label={group.label}
                            first={i === 0}
                            onOpenChapter={() => navigateTo('chapterLanding', group.book, group.chapter)}
                            actions={
                              <>
                                {/* For a review genuinely done off-app, without
                                    opening practice just to record it. */}
                                <AppIconButton
                                  variant="bare"
                                  Icon={ClipboardCheck}
                                  diameter={30}
                                  onPress={() => setManualLogGroup(group)}
                                  accessibilityLabel={`Log ${group.label} as reviewed elsewhere`}
                                />
                                <AppButton size="sm" variant="quiet" label="Listen" onPress={() => handleGroupPractice('listen', group.items)} />
                                <AppButton size="sm" variant="secondary" label="Review" onPress={() => handleGroupPractice('learn', group.items)} />
                              </>
                            }
                          />
                        ))}
                      </View>
                    );
                  })}
                </>
              ) : (
                <AppText variant="label" className="font-sans text-ink-3">
                  No reviews due today. You're all caught up.
                </AppText>
              )}

              {/* Deliberately quiet and last: it undoes finished work, so it
                  must never be the first thing under the Review title. */}
              <Pressable
                onPress={() => setShowResetConfirm(true)}
                accessibilityRole="button"
                hitSlop={10}
                className="self-start active:opacity-60"
              >
                <AppText variant="caption" className="font-sans font-medium text-ink-3 underline">
                  Reset today's reviews
                </AppText>
              </Pressable>
            </CollapsibleCard>

            <CollapsibleCard
              storageKey="home.priming"
              title="Coming up next"
              summary={`${queuedLookahead.length} waiting`}
              defaultCollapsed={queuedLookahead.length === 0}
              accessory={
                <HelpTooltip text="Verses you've picked but haven't started yet. Listening to them ahead of time makes them easier when their turn comes." />
              }
            >
              <View className="flex-row items-center justify-end" style={{ gap: space(8) }}>
                <AppText variant="caption" className="font-sans font-medium text-ink-3">
                  Show
                </AppText>
                <Dropdown options={LOOKAHEAD_OPTIONS} value={primingLookahead} onChange={setPrimingLookahead} title="How many to show" compact />
              </View>

              {groupedPriming.length > 0 ? (
                <View style={{ gap: space(10) }}>
                  {groupedPriming.map((group, i) => (
                    <TodayRow
                      key={group.label}
                      label={group.label}
                      first={i === 0}
                      onOpenChapter={() => navigateTo('chapterLanding', group.book, group.chapter)}
                      actions={
                        <AppButton size="sm" variant="quiet" label="Listen" onPress={() => handleGroupPractice('listen', group.items)} />
                      }
                    />
                  ))}
                </View>
              ) : (
                <AppText variant="label" className="font-sans text-ink-3">
                  Nothing waiting — add more verses when you're ready.
                </AppText>
              )}
            </CollapsibleCard>

            <AppButton size="lg" variant="secondary" Icon={Volume2} label="Listen to all of today's verses" onPress={listenToEverything} />
          </>
        )}

        {/* Four destinations of the same kind, as one grouped list. The one
            primary action for a new user -- choosing their first verses --
            already has its own button in Start here above. */}
        <GroupedList header="More">
          <ListRow Icon={BookMarked} title="Verse Finder" onPress={() => navigateTo('books')} />
          <ListRow Icon={FolderOpen} title="My Memory Work" onPress={() => navigateTo('memoryDesk')} />
          <ListRow Icon={Volume2} title="Find recordings" onPress={() => navigateTo('audioFeed')} />
          <ListRow Icon={Target} title="Reference practice" onPress={() => navigateTo('referenceDrill')} />
        </GroupedList>
      </ScrollView>

      <Dialog
        visible={showPullShieldConfirm}
        onClose={() => setShowPullShieldConfirm(false)}
        title="Start more verses anyway?"
        message={`Today already has about ${estMinutes} minutes of review, which meets the ${maxReviewCap}-minute limit you set. Starting more verses now adds to that on purpose.`}
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowPullShieldConfirm(false)} />
            <AppButton
              variant="primary"
              label="Start them"
              onPress={() => {
                triggerDailyPull({ bypassShield: true });
                setShowPullShieldConfirm(false);
              }}
            />
          </>
        }
      />

      <Dialog
        visible={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Reset today's reviews?"
        message="This undoes any reviews you already finished today — only verses you reviewed today go back to due. Nothing you reviewed on an earlier day is affected."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowResetConfirm(false)} />
            <AppButton
              variant="destructive"
              label="Reset"
              onPress={() => {
                triggerMockDueReviews();
                setShowResetConfirm(false);
              }}
            />
          </>
        }
      />

      {/* Manual log for a group reviewed off-app. Same three outcomes as the
          sheet inside PracticeModals. */}
      <Dialog
        visible={!!manualLogGroup}
        onClose={() => setManualLogGroup(null)}
        placement="sheet"
        title={manualLogGroup ? `Log ${manualLogGroup.label}` : undefined}
        message="For a review you actually did somewhere else — out loud in the car, from a card, anywhere but here."
      >
        <View style={{ gap: space(8) }}>
          <AppButton variant="primary" label="Perfect — no mistakes" onPress={() => submitManualLog('perfect')} />
          <AppButton variant="secondary" label="Got it, with a stumble" onPress={() => submitManualLog('passed')} />
          <AppButton variant="quiet" label="Needs practice" onPress={() => submitManualLog('practice')} />
        </View>
      </Dialog>
    </FadeInView>
  );
}

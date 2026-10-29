import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, ScrollView, View } from 'react-native';
import { Volume2, BookMarked, ChevronRight, ClipboardCheck, Compass, Layers, Plus, Route, Target } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { QueueItem, VerseState } from '../types';
import { FadeInView, HelpTooltip } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { AppButton, AppIconButton, AppText, Card, CollapsibleCard, useFontScale, useScaledSpace } from '../components/design';
import { TakeawayAsk } from '../components/TakeawayAsk';
import { Dialog, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { formatDate } from '../lib/format';
import { translationLabel } from '../data';
import { useThemeColors } from '../components/theme';
import { MIX_NAMES } from '../lib/formatNames';
import { BalanceNote, FirmUpCard, MovedSheet, NextSevenDays, WelcomeBackCard } from '../components/TodayCards';
import { useCalendarDays } from '../state/useCalendarDays';
import { firmUpItems, lateNoteFor, movedNote, welcomeBack } from '../lib/todayCards';
import { movedFromDay } from '../lib/passages';
import { getLogicalDate, localDayKey } from '../lib/logicalDate';
import { gradedOnDay } from '../lib/retention';
import ManualLogSheet, { logManualAnswers } from '../components/practice/ManualLogSheet';
import type { SelfCheckAnswer } from '../lib/grading';
import { verseStage } from '../lib/stageProgress';

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
    const translationSuffix = translationId && translationId !== 'ESV' ? ` (${translationLabel(translationId)})` : '';
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
  inline = false,
  note,
}: {
  label: string;
  first: boolean;
  onOpenChapter: () => void;
  /** A small line under the reference ("Late: moved back 2 reviews"). */
  note?: string | null;
  actions: React.ReactNode;
  children?: React.ReactNode;
  /** The reference gets its own line, and `children` share the next one
   *  with the actions (actions on the right), wrapping onto a second line
   *  only when they don't fit. For Learning now's progress dots: most people
   *  learn one or two verses at a time, which fit beside the buttons. */
  inline?: boolean;
}) {
  const space = useScaledSpace();
  const stacked = useFontScale() >= 1.3;
  if (inline) {
    return (
      <View className={first ? '' : 'border-t border-hairline'} style={{ paddingTop: first ? 0 : space(10), gap: space(6) }}>
        <Pressable
          onPress={onOpenChapter}
          accessibilityRole="link"
          accessibilityHint="Opens the chapter"
          className="active:opacity-60 self-start"
        >
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {label}
          </AppText>
        </Pressable>
        <View className="flex-row flex-wrap items-center" style={{ columnGap: space(12), rowGap: space(8) }}>
          {children}
          <View className="flex-row items-center ml-auto" style={{ gap: space(6) }}>
            {actions}
          </View>
        </View>
      </View>
    );
  }
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
      {note ? (
        <AppText variant="caption" className="font-sans text-ink-3">
          {note}
        </AppText>
      ) : null}
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

// Due reviews are grouped by where they are on the ladder. The group shows as
// a colored dot, always beside its name, so color is never the only signal.
const REVIEW_STAGES = [
  { key: 'settling', label: 'Settling', dot: 'bg-stage-daily' },
  { key: 'steady', label: 'Steady', dot: 'bg-stage-weekly' },
  { key: 'kept', label: 'Kept', dot: 'bg-stage-complete' },
  { key: 'secure', label: 'Secure', dot: 'bg-stage-top' },
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

const WELCOME_DISMISSED_KEY = 'home:welcomeDismissedDay';
const BALANCE_DISMISSED_KEY = 'home:balanceNoteDismissedDay';

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
    reviewsPaused,
    pausedUntil,
    resumeReviews,
    setShowTour,
    welcomeBackDays,
    lateNotes,
    dayStartHour,
    balanceDays,
    pullMovedToday,
    getNewVerseRoom,
  } = state;

  // While paused (Settings -> Pause Reviews), nothing should read as "due" --
  // that's the whole promise of pausing. reviewsPaused is the same flag the
  // time estimate, the calendar and Listen use, so they all agree.
  const isPausedNow = reviewsPaused;

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPullShieldConfirm, setShowPullShieldConfirm] = useState(false);
  // Which due group (if any) has its manual-log sheet open. Holds the group
  // itself rather than a boolean so the sheet knows what it's logging.
  const [manualLogGroup, setManualLogGroup] = useState<GroupedItem | null>(null);

  // Today's ladder cards: welcome back after time away (until dismissed), and
  // the firm-up item for a passage that slipped on its last review.
  // The day it was dismissed is kept on the device, so closing it hides it for
  // the rest of that day, across screen changes and app restarts.
  const todayKey = localDayKey(getLogicalDate(dayStartHour));
  const [welcomeDismissedDay, setWelcomeDismissedDay] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(WELCOME_DISMISSED_KEY)
      .then((day) => setWelcomeDismissedDay((cur) => cur ?? day))
      .catch(() => {});
  }, []);
  const dismissWelcome = () => {
    setWelcomeDismissedDay(todayKey);
    AsyncStorage.setItem(WELCOME_DISMISSED_KEY, todayKey).catch(() => {});
  };
  const welcome = welcomeDismissedDay === todayKey || isPausedNow ? null : welcomeBack(welcomeBackDays, todayKey, lateNotes);
  const firmUps = isPausedNow ? [] : firmUpItems(memoryQueue, todayKey);

  // Balance my review days: passages set for today that were moved later. The
  // note closes for the rest of the day, like the welcome-back card.
  const [balanceDismissedDay, setBalanceDismissedDay] = useState<string | null>(null);
  const [showMovedList, setShowMovedList] = useState(false);
  const [showMovedConfirm, setShowMovedConfirm] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(BALANCE_DISMISSED_KEY)
      .then((day) => setBalanceDismissedDay((cur) => cur ?? day))
      .catch(() => {});
  }, []);
  const dismissBalanceNote = () => {
    setBalanceDismissedDay(todayKey);
    AsyncStorage.setItem(BALANCE_DISMISSED_KEY, todayKey).catch(() => {});
  };
  const moved = !balanceDays || isPausedNow ? null : movedNote(movedFromDay(memoryQueue, todayKey), todayKey);
  const showBalanceNote = !!moved && balanceDismissedDay !== todayKey;
  const anyMoved = !!moved;
  useEffect(() => {
    if (!anyMoved) {
      setShowMovedList(false);
      setShowMovedConfirm(false);
    }
  }, [anyMoved]);

  const weekAhead = useCalendarDays(state, 7);

  const firstName = (user?.displayName || 'Friend').split(' ')[0];

  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();

  // Excludes verses that already banked every mastery touch -- they're done
  // learning and just waiting on their reviews to clear before promotion out
  // of 'learning' status, so bundling them into a fresh "Learn" group with
  // newly-pulled verses would mean re-practicing something already finished.
  const learningItems = memoryQueue.filter(
    (item) => item.status === 'learning' && (item.touchLogs?.length || 0) < masteryTouches
  );
  const dueReviewItems = isPausedNow
    ? []
    : memoryQueue.filter((item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate) && !gradedOnDay(item, todayKey));
  const queuedLookahead = memoryQueue.filter((item) => item.status === 'queued').slice(0, primingLookahead);

  const estMinutes = getEstimatedReviewTime(memoryQueue, cognitiveLoadSensitivity);
  // What today would come to with the moved passages back on it.
  const movedIds = new Set(moved?.verseIds ?? []);
  const estWithMoved = moved
    ? getEstimatedReviewTime(
        memoryQueue.map((q) => (movedIds.has(q.verseId) ? { ...q, nextReviewDueDate: new Date().toISOString() } : q)),
        cognitiveLoadSensitivity
      )
    : estMinutes;
  // shieldActive and isLearningDay are computed in the original for potential future use
  // (isTodayLearningDay is consumed by triggerDailyPull elsewhere); kept here 1:1 for parity.
  // The shield is up when not even one more verse fits under the daily limit.
  const shieldActive = getNewVerseRoom() === 0;
  const isLearningDay = isTodayLearningDay();

  const groupedLearning = groupQueueItems(learningItems);
  const settlingReviewItems = dueReviewItems.filter((item) => verseStage(item) === 'settling');
  const steadyReviewItems = dueReviewItems.filter((item) => verseStage(item) === 'steady');
  const keptReviewItems = dueReviewItems.filter((item) => verseStage(item) === 'kept');
  const secureReviewItems = dueReviewItems.filter((item) => verseStage(item) === 'secure');

  const groupedSettlingReviewing = groupQueueItems(settlingReviewItems);
  const groupedSteadyReviewing = groupQueueItems(steadyReviewItems);
  const groupedKeptReviewing = groupQueueItems(keptReviewItems);
  const groupedSecureReviewing = groupQueueItems(secureReviewItems);
  const groupedPriming = groupQueueItems(queuedLookahead);

  const mapQueueToVerseStates = (items: QueueItem[]): VerseState[] => {
    return items.map((item) => ({
      book: item.book,
      chapter: item.chapter,
      verse: item.verseNumber,
      text: item.text,
      status: item.status === 'retained' ? 'memorized' : 'learning',
      translationId: item.translationId || 'ESV',
    }));
  };

  const handleGroupPractice = (mode: 'listen' | 'learn', items: QueueItem[]) => {
    const vStates = mapQueueToVerseStates(items);
    startPractice(mode, vStates);
  };

  // Manual log for a review actually done off-app: a self-check per verse,
  // the same sheet as inside PracticeModals (practice/ManualLogSheet).
  const manualLogVerses = useMemo(() => (manualLogGroup ? mapQueueToVerseStates(manualLogGroup.items) : []), [manualLogGroup]);
  const submitManualLog = (answers: SelfCheckAnswer[]) => {
    const vStates = manualLogVerses;
    setManualLogGroup(null);
    if (vStates.length === 0) return;
    logManualAnswers(vStates, answers, handleUpdateVerseStatus);
  };

  // "Review All Due" -- chains through every due group (Settling, then Steady,
  // then Kept, same order they're already listed in below) in one
  // continuous session instead of returning to Home between each.
  const handleReviewAllDue = () => {
    const groups = [...groupedSettlingReviewing, ...groupedSteadyReviewing, ...groupedKeptReviewing, ...groupedSecureReviewing].map(
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
    settling: groupedSettlingReviewing,
    steady: groupedSteadyReviewing,
    kept: groupedKeptReviewing,
    secure: groupedSecureReviewing,
  };
  const listenToEverything = () => {
    const allDashItems = [...learningItems, ...dueReviewItems, ...queuedLookahead];
    if (allDashItems.length > 0) {
      // Opens on Today's verses, so Listen builds (and names) the list
      // itself rather than showing these as "Selected verses".
      startPractice('listen', mapQueueToVerseStates(allDashItems), { listenSource: 'all' });
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
                      inline
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

              {learningItems.length > 0 && (
                <AppButton variant="primary" Icon={Compass} label="Guided learning" onPress={() => state.openGuided()} />
              )}

              {hasQueued && (
                <AppButton variant="secondary" label="Start next verses" onPress={handlePullNewVerses} />
              )}
            </CollapsibleCard>

            {/* A section that just reached weekly reviews: asked once, quietly. */}
            <TakeawayAsk state={state} quiet />

            {welcome && <WelcomeBackCard data={welcome} onDismiss={dismissWelcome} />}
            <FirmUpCard items={firmUps} onStart={(verses) => handleGroupPractice('learn', verses)} />

            <CollapsibleCard
              storageKey="home.reviews"
              title="Review"
              summary={isPausedNow ? 'Paused' : `${dueReviewItems.length} due`}
              defaultCollapsed={dueReviewItems.length === 0}
              accessory={
                <HelpTooltip text="Verses you've already learned, back for a quick check so you don't forget them. Each passage comes back every day for a while, then every few days, then every week or two, then every month or two, and finally every 6 months for good." />
              }
            >
              {showBalanceNote && moved && (
                <BalanceNote
                  note={moved}
                  limit={maxReviewCap}
                  onSee={() => setShowMovedList(true)}
                  onDoToday={() => setShowMovedConfirm(true)}
                  onDismiss={dismissBalanceNote}
                />
              )}

              {dueReviewItems.length > 0 ? (
                <>
                  {/* Mixed review is the main way in; reciting every group
                      in turn (the old "Review all due") stays beside it. */}
                  <View style={{ gap: space(8) }}>
                    <AppButton variant="primary" Icon={Layers} label={MIX_NAMES.mixedReview} onPress={() => state.openMixedReview()} />
                    <AppButton
                      variant="secondary"
                      label={`Recite all due (${dueReviewItems.length} ${dueReviewItems.length === 1 ? 'verse' : 'verses'})`}
                      onPress={handleReviewAllDue}
                    />
                  </View>

                  {/* Settling, then Steady, then Kept: the same order
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
                            note={lateNoteFor(group.items, lateNotes)}
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
              ) : isPausedNow ? (
                // Says why the list is empty. "All caught up" here read as
                // the reviews having vanished while the calendar still
                // showed them waiting.
                <View style={{ gap: space(8) }}>
                  <AppText variant="label" className="font-sans text-ink-2">
                    {pausedUntil
                      ? `Reviews are paused until ${formatDate(new Date(pausedUntil), 'long')}. Nothing is due and nothing counts as missed while you're away.`
                      : 'Reviews are paused. Nothing is due and nothing counts as missed until you resume.'}
                  </AppText>
                  <AppButton variant="secondary" label="Resume reviews" onPress={resumeReviews} />
                </View>
              ) : (
                <AppText variant="label" className="font-sans text-ink-3">
                  No reviews due today. You're all caught up.
                </AppText>
              )}

              {/* Deliberately quiet and last: it undoes finished work, so it
                  must never be the first thing under the Review title.
                  Hidden while paused -- there's nothing due to reset. */}
              {!isPausedNow && (
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
              )}
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

              {/* The shortcut into My Verses from Today: add straight from
                  here, or open the whole list. A header button beside the
                  greeting was tried in the sketches and dropped -- this card is
                  where "what's next" already lives. */}
              <View
                className="flex-row flex-wrap items-center justify-between border-t border-hairline"
                style={{ paddingTop: space(12), gap: space(10) }}
              >
                <AppButton size="sm" variant="primary" Icon={Plus} label="Add verses" onPress={() => navigateTo('addVerses')} />
                <Pressable
                  onPress={() => navigateTo('activePlan')}
                  accessibilityRole="link"
                  hitSlop={8}
                  className="flex-row items-center active:opacity-60 ml-auto"
                  style={{ gap: space(2) }}
                >
                  <AppText variant="label" className="font-sans font-semibold text-accent">
                    All on My Verses
                  </AppText>
                  <ChevronRight size={Math.round(18 * scale)} color={palette.accent} strokeWidth={2.2} />
                </Pressable>
              </View>
            </CollapsibleCard>

            <AppButton size="lg" variant="secondary" Icon={Volume2} label="Listen to all of today's verses" onPress={listenToEverything} />

            <NextSevenDays days={weekAhead} onOpenCalendar={() => navigateTo('memoryCalendar')} />
          </>
        )}

        {/* Destinations of the same kind, as one grouped list. (My Memory
            Work left this list when the Verses tab replaced it.) The one
            primary action for a new user -- choosing their first verses --
            already has its own button in Start here above. */}
        <GroupedList header="More">
          <ListRow Icon={BookMarked} title="Verse Finder" onPress={() => navigateTo('books')} />
          <ListRow Icon={Volume2} title="Find recordings" onPress={() => navigateTo('audioFeed')} />
          <ListRow Icon={Target} title="Reference practice" onPress={() => navigateTo('referenceDrill')} />
          <ListRow Icon={Route} title="Pick up the thread" onPress={() => state.openThreadDrill(null)} />
        </GroupedList>
      </ScrollView>

      {moved && (
        <>
          <MovedSheet
            visible={showMovedList}
            note={moved}
            onClose={() => setShowMovedList(false)}
            onDoOne={(ids) => pullMovedToday(ids)}
            onDoAll={() => {
              setShowMovedList(false);
              setShowMovedConfirm(true);
            }}
          />
          <Dialog
            visible={showMovedConfirm}
            onClose={() => setShowMovedConfirm(false)}
            title={moved.items.length === 1 ? 'Do it today?' : moved.items.length === 2 ? 'Do both today?' : 'Do all today?'}
            message={
              estWithMoved > maxReviewCap
                ? `That brings today to about ${estWithMoved} minutes, over the ${maxReviewCap}-minute limit you set. Otherwise they come back ${moved.when}, and either way they count.`
                : `That brings today to about ${estWithMoved} minutes. Otherwise they come back ${moved.when}, and either way they count.`
            }
            actions={
              <>
                <AppButton variant="quiet" label="Cancel" onPress={() => setShowMovedConfirm(false)} />
                <AppButton
                  variant="primary"
                  label={moved.items.length === 1 ? 'Do it today' : moved.items.length === 2 ? 'Do both today' : 'Do all today'}
                  onPress={() => {
                    pullMovedToday(moved.verseIds);
                    setShowMovedConfirm(false);
                  }}
                />
              </>
            }
          />
        </>
      )}

      <Dialog
        visible={showPullShieldConfirm}
        onClose={() => setShowPullShieldConfirm(false)}
        title="Start more verses anyway?"
        message={`Today already has about ${estMinutes} minutes planned, and another verse would go past the ${maxReviewCap}-minute limit you set. Starting more verses now adds to that on purpose.`}
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

      {/* Manual log for a group reviewed off-app. The same sheet as inside PracticeModals. */}
      <ManualLogSheet
        visible={!!manualLogGroup}
        title={manualLogGroup ? `Log ${manualLogGroup.label}` : undefined}
        verses={manualLogVerses}
        selfCheckedLast={!!manualLogGroup?.items.some((i) => i.lastSelfChecked)}
        onClose={() => setManualLogGroup(null)}
        onLog={submitManualLog}
      />
    </FadeInView>
  );
}

import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScrollView, View } from 'react-native';
import {
  BookMarked,
  Check,
  Compass,
  Flame,
  Headphones,
  Layers,
  List,
  Plus,
  RotateCcw,
  Route,
  Sprout,
  Target,
  Volume2,
} from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, Card, useFontScale, useScaledSpace } from '../components/design';
import { TakeawayAsk } from '../components/TakeawayAsk';
import { Dialog, GroupedList, ListRow, SectionHeader } from '../components/blocks';
import { ActionCard, IconTile, OverflowMenu, type MenuItem } from '../components/session';
import { formatDate } from '../lib/format';
import { useThemeColors } from '../components/theme';
import { ExploreConstellationsButton } from '../components/map/ExploreConstellationsButton';
import { BalanceNote, FirmUpCard, MovedSheet, WelcomeBackCard } from '../components/TodayCards';
import { firmUpItems, movedNote, welcomeBack } from '../lib/todayCards';
import { movedFromDay } from '../lib/passages';
import { groupTouches, toVerseStates, useToday } from '../state/useToday';

// ============================================================================
// Today (UI simplify plan, Job 1, option A from the sketches).
//
// Top to bottom: date, streak and the "..." menu; the greeting; the last seven
// days; one Today card with the two big buttons (Review, Learn next verses);
// any one-off notes; then two rows -- Today's verses (the full list, its own
// page) and Listen to today's scripture. Everything else that used to sit on
// this page (Recite one at a time, Next 7 days, the extra practices, Bible,
// Find recordings, Add verses, Reset) lives in the "..." menu.
// ============================================================================

const WELCOME_DISMISSED_KEY = 'home:welcomeDismissedDay';
const BALANCE_DISMISSED_KEY = 'home:balanceNoteDismissedDay';
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The last seven days, today last: filled when something was practiced or reviewed. */
function WeekStrip({ days }: { days: { weekday: number; count: number; day: string }[] }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const d = Math.round(30 * scale);
  return (
    <View className="flex-row justify-between" style={{ paddingHorizontal: space(2) }}>
      {days.map((day, i) => {
        const today = i === days.length - 1;
        const active = day.count > 0;
        return (
          <View
            key={i}
            className="items-center"
            style={{ gap: space(6), minWidth: d }}
            accessible
            accessibilityLabel={`${today ? 'Today' : day.day}: ${active ? 'done' : 'not done'}`}
          >
            {/* layout-ok: a day circle, no text. */}
            <View
              className={`rounded-full items-center justify-center ${active ? 'bg-stage-complete' : today ? 'bg-surface border-2 border-stage-complete' : 'bg-fill'}`}
              style={{ width: d, height: d }}
            >
              {active ? <Check size={Math.round(15 * scale)} color={palette.onAccent} strokeWidth={3} /> : null}
            </View>
            <AppText variant="micro" className={`font-sans ${today ? 'font-bold text-ink' : 'text-ink-3'}`}>
              {WEEKDAY_LETTERS[day.weekday]}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

export default function HomeScreen({ state }: { state: AppState }) {
  const {
    user,
    memoryQueue,
    maxReviewCap,
    getEstimatedReviewTime,
    cognitiveLoadSensitivity,
    getGreeting,
    navigateTo,
    masteryTouches,
    startPractice,
    triggerMockDueReviews,
    triggerDailyPull,
    reviewsPaused,
    pausedUntil,
    resumeReviews,
    setShowTour,
    welcomeBackDays,
    lateNotes,
    balanceDays,
    pullMovedToday,
    getNewVerseRoom,
    memoryStreak,
    activityLast15Days,
  } = state;

  const today = useToday(state);
  const { todayKey, learningGroups, dueReviewItems, doneTodayItems, estMinutes } = today;

  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();

  const [showPullShieldConfirm, setShowPullShieldConfirm] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);

  // Welcome back after time away (until dismissed for the day), and the
  // firm-up item for a passage that slipped on its last review.
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
  const welcome = welcomeDismissedDay === todayKey || reviewsPaused ? null : welcomeBack(welcomeBackDays, todayKey, lateNotes);
  const firmUps = useMemo(() => (reviewsPaused ? [] : firmUpItems(memoryQueue, todayKey)), [reviewsPaused, memoryQueue, todayKey]);

  // Balance my review days: passages set for today that were moved later.
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
  const moved = useMemo(
    () => (!balanceDays || reviewsPaused ? null : movedNote(movedFromDay(memoryQueue, todayKey), todayKey)),
    [balanceDays, reviewsPaused, memoryQueue, todayKey]
  );
  const showBalanceNote = !!moved && balanceDismissedDay !== todayKey;
  const anyMoved = !!moved;
  useEffect(() => {
    if (!anyMoved) {
      setShowMovedList(false);
      setShowMovedConfirm(false);
    }
  }, [anyMoved]);
  const estWithMoved = useMemo(() => {
    if (!moved) return estMinutes;
    const movedIds = new Set(moved.verseIds);
    return getEstimatedReviewTime(
      memoryQueue.map((q) => (movedIds.has(q.verseId) ? { ...q, nextReviewDueDate: new Date().toISOString() } : q)),
      cognitiveLoadSensitivity
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moved, memoryQueue, estMinutes, cognitiveLoadSensitivity]);

  const firstName = (user?.displayName || 'Friend').split(' ')[0];
  const hasVerses = memoryQueue.length > 0;
  const hasQueued = memoryQueue.some((item) => item.status === 'queued');

  // What starting new verses would begin right now: today's scheduled plan
  // verses (carried ones included) plus your own on a learning day.
  const pullPreview = state.getTodayPullPreview();
  const pullSources = [
    ...Object.entries(pullPreview.fromPlans).map(
      ([planId, ids]) => `${ids.length} from ${state.joinedGroupPlanDetails.find((p) => p.planId === planId)?.name ?? 'a group plan'}`
    ),
    ...(pullPreview.personalCount > 0 ? [`${pullPreview.personalCount} of your own`] : []),
    ...(pullPreview.carried > 0 ? [`${pullPreview.carried} from earlier this week`] : []),
  ].join(' · ');
  const startLabel = pullPreview.total > 0 ? `Start today's verses · ${pullPreview.total}` : 'Start next verses';

  // The Review Shield: past the daily limit, starting more asks first.
  const handlePullNewVerses = () => {
    setLearnOpen(false);
    if (getNewVerseRoom() === 0) {
      setShowPullShieldConfirm(true);
      return;
    }
    triggerDailyPull();
  };

  // ---- The two big buttons -------------------------------------------------
  const dueCount = dueReviewItems.length;
  const doneCount = doneTodayItems.length;
  const reviewTotal = doneCount + dueCount;

  const firstLearning = learningGroups[0];
  const firstTouches = firstLearning ? groupTouches(firstLearning, masteryTouches) : null;
  const learnSubtitle = firstLearning
    ? learningGroups.length === 1
      ? `${firstLearning.label} · ${firstTouches!.done} of ${firstTouches!.needed}`
      : `${learningGroups.length} passages in progress`
    : pullPreview.total > 0
      ? `${pullPreview.total} new ${pullPreview.total === 1 ? 'verse' : 'verses'} today`
      : 'Start the next verses in My Verses';
  const onLearn = () => {
    // With one passage in progress and nothing waiting there is no choice to
    // make, so it goes straight in. Otherwise the Learn next pop-up asks.
    if (firstLearning && learningGroups.length === 1 && !hasQueued) state.openGuided();
    else if (firstLearning) setLearnOpen(true);
    else handlePullNewVerses();
  };

  // ---- The "..." menu ------------------------------------------------------
  const menu: MenuItem[][] = [
    [
      { label: 'Reference practice', Icon: Target, onPress: () => navigateTo('referenceDrill') },
      { label: 'Pick up the thread', Icon: Route, onPress: () => state.openThreadDrill(null) },
      { label: 'Bible', Icon: BookMarked, onPress: () => navigateTo('books') },
      { label: 'Find recordings', Icon: Volume2, onPress: () => navigateTo('audioFeed') },
      { label: 'Add verses', Icon: Plus, onPress: () => navigateTo('addVerses') },
    ],
    reviewsPaused
      ? []
      : [
          {
            label: "Reset today's reviews",
            Icon: RotateCcw,
            destructive: true,
            confirm: {
              title: "Reset today's reviews?",
              message: 'Only verses you reviewed today go back to due. Nothing from an earlier day changes.',
              confirmLabel: 'Reset',
            },
            onPress: triggerMockDueReviews,
          },
        ],
  ];

  const passageCount =
    learningGroups.length + today.dueGroups.length + today.doneTodayGroups.length + today.comingUpGroups.length;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: space(20) }}>
        {/* Header: date with the streak and the menu beside it, then the greeting. */}
        <View style={{ gap: space(4) }}>
          <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
            <AppText variant="label" className="font-sans font-semibold text-ink-3 shrink" numberOfLines={1}>
              {formatDate(new Date(), 'long')}
            </AppText>
            <View className="flex-row items-center" style={{ gap: space(8) }}>
              {memoryStreak > 0 ? (
                <View
                  className="flex-row items-center bg-warning-soft rounded-full"
                  style={{ paddingHorizontal: space(10), paddingVertical: space(5), gap: space(4) }}
                  accessible
                  accessibilityLabel={`${memoryStreak}-day streak`}
                >
                  <Flame size={Math.round(16 * scale)} color={palette.warning} strokeWidth={2.2} />
                  <AppText variant="label" className="font-sans font-bold text-warning">
                    {memoryStreak}
                  </AppText>
                </View>
              ) : null}
              {hasVerses ? <OverflowMenu title="More for today" groups={menu} accessibilityLabel="More for today" diameter={36} /> : null}
            </View>
          </View>
          <AppText variant="display" className="font-sans font-bold text-ink" style={{ letterSpacing: -0.4 }} accessibilityRole="header">
            {`${getGreeting()}, ${firstName}`}
          </AppText>
        </View>

        {!hasVerses && (
          <Card gap={12}>
            <AppText variant="title" className="font-sans font-bold text-ink">
              Start here
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              Pick a few verses you'd like to know by heart.
            </AppText>
            <View style={{ gap: space(8), paddingTop: space(4) }}>
              <AppButton variant="primary" Icon={BookMarked} label="Choose my first verses" onPress={() => navigateTo('books')} />
              <AppButton variant="quiet" label="Show me around first" onPress={() => setShowTour(true)} />
            </View>
          </Card>
        )}

        {hasVerses && (
          <>
            <WeekStrip days={activityLast15Days.slice(-7)} />

            {/* The Today card: progress, then the two big buttons. */}
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(12) }}>
              <View style={{ gap: space(8) }}>
                <View className="flex-row items-baseline justify-between flex-wrap" style={{ columnGap: space(8) }}>
                  <AppText variant="title" className="font-sans font-bold text-ink">
                    Today
                  </AppText>
                  <AppText variant="caption" className="font-sans text-ink-3">
                    {reviewTotal > 0 ? `${doneCount} of ${reviewTotal} reviews done · about ${estMinutes} min` : `About ${estMinutes} min`}
                  </AppText>
                </View>
                {reviewTotal > 0 ? (
                  // layout-ok: a progress track, no text.
                  <View className="bg-fill rounded-full overflow-hidden" style={{ height: 6 }}>
                    <View className="bg-accent rounded-full" style={{ height: 6 /* layout-ok: track fill */, width: `${(doneCount / reviewTotal) * 100}%` }} />
                  </View>
                ) : null}
              </View>

              {reviewsPaused ? (
                <View className="bg-surface-2 rounded-btn" style={{ padding: space(12), gap: space(8) }}>
                  <AppText variant="label" className="font-sans text-ink-2">
                    {pausedUntil ? `Reviews are paused until ${formatDate(new Date(pausedUntil), 'long')}.` : 'Reviews are paused.'}
                  </AppText>
                  <AppButton variant="secondary" label="Resume reviews" onPress={resumeReviews} />
                </View>
              ) : dueCount > 0 ? (
                <ActionCard
                  Icon={Layers}
                  title="Review"
                  subtitle={`${dueCount} ${dueCount === 1 ? 'verse' : 'verses'} due`}
                  onPress={() => state.openMixedReview()}
                />
              ) : (
                <View className="flex-row items-center bg-success-soft rounded-btn" style={{ padding: space(14), gap: space(10) }}>
                  <Check size={Math.round(20 * scale)} color={palette.success} strokeWidth={2.6} />
                  <AppText variant="label" className="font-sans font-semibold text-success flex-1">
                    {doneCount > 0 ? 'Reviews done for today' : 'No reviews due today'}
                  </AppText>
                </View>
              )}

              {firstLearning || hasQueued ? (
                <ActionCard Icon={Sprout} tone="soft" title="Learn next verses" subtitle={learnSubtitle} onPress={onLearn} />
              ) : (
                <ActionCard Icon={Plus} tone="soft" title="Add verses" subtitle="Pick what to learn next" onPress={() => navigateTo('addVerses')} />
              )}
            </View>

            {/* One-off notes, only when they apply. */}
            <TakeawayAsk state={state} quiet />
            {welcome && <WelcomeBackCard data={welcome} onDismiss={dismissWelcome} />}
            <FirmUpCard items={firmUps} onStart={(verses) => startPractice('learn', toVerseStates(verses))} />
            {showBalanceNote && moved && (
              <BalanceNote
                note={moved}
                limit={maxReviewCap}
                onSee={() => setShowMovedList(true)}
                onDoToday={() => setShowMovedConfirm(true)}
                onDismiss={dismissBalanceNote}
              />
            )}

            <GroupedList>
              <ListRow
                leading={<IconTile Icon={List} />}
                title="Today's verses"
                subtitle={`${passageCount} ${passageCount === 1 ? 'passage' : 'passages'}`}
                onPress={() => navigateTo('todayVerses')}
              />
              <ListRow
                leading={<IconTile Icon={Headphones} />}
                title="Listen to today's scripture"
                subtitle="Reviews and what's coming up"
                onPress={today.listenToToday}
              />
            </GroupedList>

            <ExploreConstellationsButton onPress={() => navigateTo('constellations')} />
          </>
        )}
      </ScrollView>

      {/* Learn next: shown when there is a choice -- several passages in
          progress, or new verses waiting as well. */}
      <Dialog visible={learnOpen} onClose={() => setLearnOpen(false)} title="Learn next">
        {learningGroups.length > 0 ? (
          <View style={{ gap: space(6) }}>
            <SectionHeader title="Keep going" />
            <GroupedList>
              {learningGroups.map((group) => {
                const t = groupTouches(group, masteryTouches);
                return (
                  <ListRow
                    key={group.label}
                    title={group.label}
                    value={`${t.done} of ${t.needed}`}
                    onPress={() => {
                      setLearnOpen(false);
                      today.practiceGroup('learn', group.items);
                    }}
                  />
                );
              })}
            </GroupedList>
          </View>
        ) : null}
        {learningGroups.length > 0 ? (
          <AppButton
            variant="primary"
            Icon={Compass}
            label="Guided learning"
            onPress={() => {
              setLearnOpen(false);
              state.openGuided();
            }}
          />
        ) : null}
        {hasQueued ? (
          <View style={{ gap: space(6), paddingTop: space(4) }}>
            <SectionHeader title="Start new" />
            <AppButton variant="secondary" label={startLabel} onPress={handlePullNewVerses} />
            {pullSources ? (
              <AppText variant="caption" className="font-sans text-ink-3 text-center">
                {pullSources}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </Dialog>

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
        message={`Today already has about ${estMinutes} minutes planned, past the ${maxReviewCap}-minute limit you set.`}
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
    </FadeInView>
  );
}

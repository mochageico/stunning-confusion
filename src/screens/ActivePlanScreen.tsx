import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { ArrowUp, Bookmark, CalendarDays, ChevronRight, GripVertical, History, Plus, Trash2 } from 'lucide-react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';

import { AppState } from '../state/useAppState';
import { QueueItem, GroupedQueueItem } from '../types';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { PRIORITY_LABELS } from '../components/QueueSources';
import { CompleteChips, StageDot, StageStrip, VerseStageRow, stageCaption } from '../components/VerseStages';
import VersesByBook from '../components/VersesByBook';
import ConstellationMap from '../components/map/ConstellationMap';
import { writtenCount } from '../lib/takeaways';
import { ladderPosition, landmarkText, versesHeld } from '../lib/milestones';
import { reorderQueueGroups } from '../lib/queueReorder';
import { STAGE_LABEL, STAGE_ORDER, StageGroup, VerseStage, groupByStage, referenceFor, stageCounts } from '../lib/stageProgress';
import { HORIZON_LABEL, Horizon, ForecastPlan, forecastCounts, horizonDate, learnedCount, projectStartDates } from '../lib/forecast';
import { translationLabel } from '../data';

import { useThemeColors } from '../components/theme';
import { OneTimeTip } from '../components/OneTimeTip';
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
      curr.origin === prev.origin &&
      curr.translationId === prev.translationId;

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

type VersesView = 'stage' | 'book' | 'map';
const EMPTY_STARTS = new Map<string, Date>();
// Remembered for the session, so coming back from a verse page lands on the
// view you left. Not saved to the device: By stage is the right place to open.
let lastView: VersesView = 'stage';
// Where the list was scrolled when you left it for one of its own pages (a
// verse, a chapter, the road...). Coming back puts you there again; opening
// the tab fresh starts at the top.
let returnScroll: { view: VersesView; y: number } | null = null;

export default function ActivePlanScreen({ state }: { state: AppState }) {
  const {
    navigateTo,
    openVersePage,
    learningDays,
    newVersesPace,
    memoryQueue,
    updateMemoryQueue,
    triggerToast,
    promoteToLearning,
    savedPlans,
    joinedGroupPlanDetails,
    joinedGroupPlanMemberships,
    removeQueueItems,
    isReviewDue,
    reviewsPaused,
    takeaways,
    dailyPhaseWeeks,
    weeklyPhaseMonths,
    monthlyPhaseYears,
    masteryTouches,
    sabbathEnabled,
    sabbathDay,
    pausedAt,
    pausedUntil,
    verseLinks,
    addVersesToQueue,
    addVerseLink,
    relabelVerseLink,
    deleteVerseLink,
    mapLayout,
    saveMapLayout,
    selectedTranslationId,
  } = state;

  const space = useScaledSpace();
  const palette = useThemeColors();
  const scale = useFontScale();
  const [view, setViewState] = useState<VersesView>(lastView);
  const setView = (v: VersesView) => {
    lastView = v;
    setViewState(v);
  };

  // Which waiting list is being reordered (its section key), if any.
  const [reordering, setReordering] = useState<string | null>(null);

  const plan = { dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches };
  // One clock per visit, so the memoized rows below don't all redraw
  // because a fresh Date was handed to them.
  const now = useMemo(() => new Date(), []);

  // The header, switch and strip draw on the first frame; the stage lists
  // (every verse row, and the drag-to-reorder list) follow a frame later.
  // Mounting them all before the tab could appear is what made opening the
  // tab feel laggy.
  const [listsReady, setListsReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setListsReady(true), 0);
    return () => clearTimeout(id);
  }, []);
  // Everything but Waiting, bucketed by stage. Waiting keeps its own
  // drag-to-reorder list below, because its order is the learning order.
  const byStage = useMemo(
    () => groupByStage(memoryQueue, plan, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memoryQueue, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches]
  );
  const counts = useMemo(() => stageCounts(memoryQueue), [memoryQueue]);
  const takeawayCount = useMemo(() => writtenCount(takeaways), [takeaways]);
  // "You hold more verses than the book of Ruth." Nothing before the first landmark.
  const landmark = useMemo(() => {
    const held = versesHeld(memoryQueue);
    return held > 0 ? landmarkText(ladderPosition(held)) : '';
  }, [memoryQueue]);
  const total = memoryQueue.length;

  // ---- Looking ahead ----
  // Only verses already on your list, and every review going well. Waiting
  // verses start when the real daily pull would start them (forecast.ts).
  const [horizon, setHorizon] = useState<Horizon>('now');
  const forecastPlan: ForecastPlan = {
    ...plan,
    learningDays,
    newVersesPace,
    sabbathEnabled,
    sabbathDay,
    joinedPlans: joinedGroupPlanDetails,
    memberships: joinedGroupPlanMemberships,
    pausedAt,
    pausedUntil,
  };
  // Simulating the daily pull is the costliest sum on this screen, and only
  // the look-ahead switch and By book use it -- so skip it until one is open.
  const needStarts = horizon !== 'now' || view === 'book';
  const starts = useMemo(
    () => (needStarts ? projectStartDates(memoryQueue, forecastPlan, now) : EMPTY_STARTS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needStarts, memoryQueue, learningDays, newVersesPace, sabbathEnabled, sabbathDay, joinedGroupPlanDetails, joinedGroupPlanMemberships, pausedAt, pausedUntil]
  );
  const ahead = horizon !== 'now';
  const shownCounts = useMemo(
    () => (ahead ? forecastCounts(memoryQueue, forecastPlan, horizonDate(horizon, now), starts, now) : counts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [horizon, counts, starts, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches]
  );
  const deltas = ahead
    ? (Object.fromEntries(STAGE_ORDER.map((st) => [st, shownCounts[st] - counts[st]])) as Record<VerseStage, number>)
    : undefined;
  const horizonDay = horizonDate(horizon, now);
  const horizonDayLabel = horizonDay.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(horizonDay.getFullYear() === now.getFullYear() ? null : { year: 'numeric' }),
  });
  const learnedNow = learnedCount(counts);
  const learnedThen = learnedCount(shownCounts);
  const forecastLine = ahead
    ? `By ${horizonDayLabel}, ${learnedThen === total ? `all ${total}` : `${learnedThen} of your ${total}`} verses learned${
        shownCounts.complete > 0 ? `, ${shownCounts.complete} Complete` : ''
      }.`
    : `${learnedNow} of your ${total} verses learned so far${counts.complete > 0 ? `, ${counts.complete} Complete` : ''}.`;


  // Waiting verses, in learning order. Sorted by orderIndex BEFORE grouping,
  // because orderIndex is the real source of truth for queue position -- not
  // the array's own order. reorderQueueGroups rewrites orderIndex but maps
  // over the queue in place, so grouping straight off the array rebuilt the
  // identical list and a dragged row snapped back to where it started.
  const waitingGroups = groupQueueItems(
    [...memoryQueue].sort((a, b) => a.orderIndex - b.orderIndex).filter((item) => item.status === 'queued')
  );

  // Nothing is due while reviews are paused -- same as Today.
  const dueTodayCount = reviewsPaused
    ? 0
    : memoryQueue.filter((item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate)).length;
  const summary = [
    `${total} ${total === 1 ? 'verse' : 'verses'}`,
    reviewsPaused ? 'reviews paused' : dueTodayCount > 0 ? `${dueTodayCount} due today` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const activePlan = savedPlans.find((p) => p.isActive) || savedPlans[0];

  // Group rows used to say a generic "Group", which told you a verse wasn't
  // yours but not which plan put it there -- so the priority setting had no
  // visible subject.
  const planNameFor = (planId?: string) =>
    joinedGroupPlanDetails.find((p) => p.planId === planId)?.name || 'Group';

  // With one group plan, its priority says it all; with several, the count.
  const sourcesValue =
    joinedGroupPlanMemberships.length === 1
      ? PRIORITY_LABELS.find((o) => o.id === joinedGroupPlanMemberships[0].priority)?.short ?? ''
      : `${joinedGroupPlanMemberships.length + 1} sources`;

  // Your own waiting verses and each group plan's as separate lists (ui
  // overhaul bucket 3). Which source goes first each learning day is set in
  // "Where verses come from", so mixing them in one list implied an order
  // the scheduler doesn't follow. Each list reorders only among itself:
  // reorderQueueGroups reuses the orderIndex slots of the groups it's given,
  // so moving one of your verses never shifts a plan's verses or vice versa.
  const planIds = Array.from(
    new Set(waitingGroups.filter((g) => g.origin === 'group').map((g) => g.items[0].originPlanId || ''))
  );
  const waitingSections = [
    { key: 'mine', title: 'My own verses', groups: waitingGroups.filter((g) => g.origin !== 'group') },
    ...planIds.map((id) => ({
      key: id || 'group',
      title: planNameFor(id || undefined),
      groups: waitingGroups.filter((g) => g.origin === 'group' && (g.items[0].originPlanId || '') === id),
    })),
  ].filter((s) => s.key === 'mine' || s.groups.length > 0);

  // The strip jumps to a stage's section: its place in the list's items
  // (stageIndex, below).
  const scrollRef = useRef<FlatList<ListItem>>(null);
  const stageIndexRef = useRef<Partial<Record<VerseStage, number>>>({});
  const scrollY = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const rememberScroll = () => {
    returnScroll = { view: viewRef.current, y: scrollY.current };
  };
  // navigateTo for links off this screen: remembers where the list was first.
  const go: typeof navigateTo = (...args) => {
    rememberScroll();
    navigateTo(...args);
  };

  // Put the list back where it was. The lists mount a frame late (listsReady)
  // and By book's rows can grow as chapter lengths arrive, so this waits for
  // the content to be tall enough rather than scrolling once and hoping.
  const restoreY = useRef<number | null>(returnScroll && returnScroll.view === lastView ? returnScroll.y : null);
  useEffect(() => {
    returnScroll = null;
    if (restoreY.current === null) return;
    // Stop trying after a moment, so later growth never yanks the list.
    const giveUp = setTimeout(() => (restoreY.current = null), 1500);
    return () => clearTimeout(giveUp);
  }, []);
  const tryRestore = (contentHeight?: number) => {
    const y = restoreY.current;
    if (y === null || !listsReady) return;
    if (contentHeight !== undefined && contentHeight < y) return;
    scrollRef.current?.scrollToOffset({ offset: y, animated: false });
    restoreY.current = null;
  };
  useEffect(() => {
    if (!listsReady) return;
    // Web never reports content size here, so try once the lists are in.
    const id = setTimeout(() => tryRestore(), 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsReady]);
  const scrollToStage = (stage: VerseStage) => {
    const index = stageIndexRef.current[stage];
    if (index !== undefined) scrollRef.current?.scrollToIndex({ index, animated: true, viewOffset: space(12) });
  };
  const jumpTo = (stage: VerseStage) => {
    if (view === 'stage') return scrollToStage(stage);
    // From By book the sections aren't on screen yet: switch, then scroll once they've laid out.
    setView('stage');
    setTimeout(() => scrollToStage(stage), 150);
  };

  // Stable across renders (the app state hands out a new openVersePage every
  // render), so the memoized rows don't redraw when something unrelated changes.
  const openVersePageRef = useRef(openVersePage);
  openVersePageRef.current = openVersePage;
  const openGroup = useCallback(
    (g: StageGroup) => {
      rememberScroll();
      openVersePageRef.current({ book: g.book, chapter: g.chapter, verses: g.verses, translationId: g.translationId });
    },
    []
  );

  // Nothing has moved past Learning yet: teach the road instead of showing
  // four empty sections with no explanation.
  const isNew = counts.daily + counts.weekly + counts.monthly + counts.complete === 0;
  const nextUp = byStage.learning.length > 0 ? [...byStage.learning].sort((a, b) => a.progress.remaining - b.progress.remaining)[0] : null;

  const sectionHeader = (stage: VerseStage, title: string) => (
    <View style={{ gap: space(4) }}>
      <View className="flex-row items-center" style={{ gap: space(8), paddingHorizontal: space(4) }}>
        <StageDot stage={stage} />
        <AppText variant="title" className="font-sans font-bold text-ink flex-1" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="label" className="font-sans font-semibold text-ink-2">
          {counts[stage]} {counts[stage] === 1 ? 'verse' : 'verses'}
        </AppText>
      </View>
      {counts[stage] > 0 && (
        <AppText variant="caption" className="font-sans text-ink-2" style={{ paddingLeft: space(22), paddingRight: space(4) }}>
          {stage === 'waiting' && !waitingSections.some((sec) => sec.groups.length > 1)
            ? "In the order you'll learn them."
            : stageCaption(stage, plan)}
        </AppText>
      )}
    </View>
  );

  const emptyStage = (stage: VerseStage) => (
    <View
      className="flex-row items-center border border-dashed border-line-strong rounded-card"
      style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(10) }}
    >
      <StageDot stage={stage} />
      <AppText variant="label" className="font-sans font-semibold text-ink">
        {STAGE_LABEL[stage]}
      </AppText>
      <AppText variant="caption" className="font-sans text-ink-2 flex-1">
        {stage === 'daily' ? 'None yet. Verses come here after Learning.' : 'None yet'}
      </AppText>
    </View>
  );


  const waitingRow = (group: GroupedQueueItem, drag?: () => void, isActive = false, onHold?: () => void) => (
    <VerseGroupRow
      key={group.id}
      group={group}
      drag={drag}
      onHold={onHold}
      isActive={isActive}
      onStart={() => promoteToLearning(group.items.map((item) => item.verseId))}
      onRemove={() => {
        // removeQueueItems, not a raw filter: deleting from
        // Firestore now requires recorded intent, so this is
        // the only route that actually removes documents.
        removeQueueItems(group.items.map((item) => item.verseId));
        triggerToast('Removed those verses from your list.');
      }}
    />
  );

  const waitingBody = (
    <View style={{ gap: space(12) }}>
      {waitingGroups.length === 0 ? (
        <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
          Nothing waiting. Tap Add verses to choose what you learn next.
        </AppText>
      ) : (
        waitingSections.map((section) => (
          <View key={section.key} style={{ gap: space(6) }}>
            {(waitingSections.length > 1 || section.groups.length > 1) && (
              <View className="flex-row items-center" style={{ gap: space(8) }}>
                <View className="flex-1">{waitingSections.length > 1 && <SectionHeader title={section.title} />}</View>
                {section.groups.length > 1 && (
                  <AppButton
                    size="sm"
                    variant="quiet"
                    label={reordering === section.key ? 'Done' : 'Reorder'}
                    accessibilityLabel={reordering === section.key ? 'Done reordering' : `Reorder ${section.title}`}
                    onPress={() => setReordering(reordering === section.key ? null : section.key)}
                  />
                )}
              </View>
            )}
            {section.groups.length === 0 ? (
              <AppText variant="label" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
                None waiting.
              </AppText>
            ) : reordering !== section.key ? (
              // Plain rows until you ask to reorder: setting up the drag
              // list was the slowest part of opening this tab, and it grows
              // with every waiting verse. Holding a row starts reordering too.
              <View style={{ gap: space(8) }}>
                {section.groups.map((g) =>
                  waitingRow(g, undefined, false, section.groups.length > 1 ? () => setReordering(section.key) : undefined)
                )}
              </View>
            ) : (
              // Real drag-to-reorder. scrollEnabled={false} because this
              // always nests inside the screen's own ScrollView -- same
              // pattern as the recording list on the chapter page.
              //
              // onDragEnd uses `from`/`to` rather than the reordered
              // `data` array: reorderQueueGroups permutes orderIndex
              // among this section's items only and maps over the full
              // queue, so every other verse is carried through untouched.
              // Rebuilding the queue from `data` would drop every verse
              // this list doesn't show -- the bug queueReorder.ts
              // exists to prevent.
              <DraggableFlatList
                data={section.groups}
                scrollEnabled={false}
                keyExtractor={(group) => group.id || `${group.book}_${group.chapter}_${group.verses[0]}`}
                contentContainerStyle={{ gap: space(8) }}
                onDragEnd={({ from, to }) => {
                  if (from === to) return;
                  updateMemoryQueue((prev) => reorderQueueGroups(prev, section.groups, from, to));
                  triggerToast('Reordered.');
                }}
                renderItem={({ item: group, drag, isActive }: RenderItemParams<GroupedQueueItem>) => waitingRow(group, drag, isActive)}
              />
            )}
          </View>
        ))
      )}
    </View>
  );

  // The stage lists as one flat run of items, so the list only builds the
  // rows near the screen. Building every row up front (hundreds, for a long
  // list) is what made opening this tab slow. Waiting (with its drag list)
  // and Complete (its chips) stay one item each.
  const items: ListItem[] = useMemo(() => {
    if (!listsReady || total === 0 || view === 'map') return [];
    if (view === 'book') return [{ kind: 'book', key: 'book' }];
    const out: ListItem[] = [{ kind: 'waiting', key: 'waiting', stage: 'waiting' }];
    for (const stage of ['learning', 'daily', 'weekly', 'monthly'] as const) {
      if (byStage[stage].length === 0) {
        out.push({ kind: 'empty', key: `empty-${stage}`, stage });
        continue;
      }
      out.push({ kind: 'header', key: `header-${stage}`, stage });
      byStage[stage].forEach((group, i) => out.push({ kind: 'row', key: group.key, stage, group, first: i === 0 }));
    }
    out.push({ kind: 'complete', key: 'complete', stage: 'complete' });
    return out;
  }, [listsReady, total, view, byStage]);
  // Where each stage starts in that run, for the strip's jump.
  const stageIndex = useMemo(() => {
    const m: Partial<Record<VerseStage, number>> = {};
    items.forEach((it, i) => {
      if (it.kind !== 'row' && it.stage && m[it.stage] === undefined) m[it.stage] = i;
    });
    return m;
  }, [items]);
  stageIndexRef.current = stageIndex;

  const STAGE_TITLE: Record<VerseStage, string> = {
    waiting: 'Waiting to start',
    learning: 'Learning now',
    daily: 'Daily',
    weekly: 'Weekly',
    monthly: 'Monthly',
    complete: 'Complete',
  };
  // The gaps the old single column had: 24 between stages, 10 under a
  // stage's heading, 8 between rows.
  const renderItem = ({ item }: { item: ListItem }) => {
    const top = item.kind === 'row' ? space(item.first ? 10 : 8) : item.kind === 'book' ? 0 : space(item.kind === 'waiting' ? 0 : 24);
    let body: React.ReactNode;
    switch (item.kind) {
      case 'waiting':
        body = (
          <View style={{ gap: space(10) }}>
            {sectionHeader('waiting', STAGE_TITLE.waiting)}
            {waitingBody}
          </View>
        );
        break;
      case 'empty':
        body = emptyStage(item.stage!);
        break;
      case 'header':
        body = sectionHeader(item.stage!, STAGE_TITLE[item.stage!]);
        break;
      case 'row':
        body = <VerseStageRow group={item.group!} now={now} onOpen={openGroup} />;
        break;
      case 'complete':
        body =
          counts.complete === 0 ? (
            emptyStage('complete')
          ) : (
            <View style={{ gap: space(10) }}>
              {sectionHeader('complete', STAGE_TITLE.complete)}
              <CompleteChips groups={byStage.complete} onPress={openGroup} />
            </View>
          );
        break;
      case 'book':
        body = (
          <VersesByBook
            queue={memoryQueue}
            plan={plan}
            starts={starts}
            onOpenChapter={(book, chapter) => go('chapterLanding', book, chapter, { keepBack: true })}
          />
        );
        break;
    }
    return <View style={{ paddingTop: top }}>{body}</View>;
  };

  const viewSwitch = (
    <SegmentedControl
      accessibilityLabel="Show verses"
      options={[
        { id: 'stage', label: 'By stage' },
        { id: 'book', label: 'By book' },
        { id: 'map', label: 'Map' },
      ]}
      value={view}
      onChange={setView}
    />
  );

  // The map pans and zooms, so it can't sit inside the scrolling list: it
  // gets the screen below the switch to itself (components/map).
  if (view === 'map' && total > 0) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas" style={{ paddingHorizontal: space(20), paddingTop: space(20), paddingBottom: space(8), gap: space(14) }}>
          <ScreenHeader
            title="My Verses"
            subtitle={summary}
            actions={<AppButton size="sm" variant="primary" Icon={Plus} label="Add verses" onPress={() => go('addVerses')} />}
          />
          {viewSwitch}
          <ConstellationMap
            queue={memoryQueue}
            verseLinks={verseLinks}
            mapLayout={mapLayout}
            saveMapLayout={saveMapLayout}
            translationId={selectedTranslationId}
            onOpenVerse={(page) => openVersePage(page)}
            addVersesToQueue={addVersesToQueue}
            addVerseLink={addVerseLink}
            relabelVerseLink={relabelVerseLink}
            deleteVerseLink={deleteVerseLink}
            onJoined={() => triggerToast('Joined.')}
          />
        </View>
      </FadeInView>
    );
  }

  return (
    <FadeInView style={{ flex: 1 }}>
      <FlatList
        ref={scrollRef}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        // A list skips redrawing its rows unless this changes. The rows read
        // this screen's own state (counts, the reorder switch), so they
        // redraw along with it; the verse rows inside are memoized anyway.
        extraData={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={11}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Not laid out yet: get close, then land once it has drawn.
          scrollRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
          setTimeout(() => scrollRef.current?.scrollToIndex({ index, animated: true, viewOffset: space(12) }), 120);
        }}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={32}
        onContentSizeChange={(_, h) => tryRestore(h)}
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5 pb-12"
        ListHeaderComponent={
      <View style={{ gap: space(20), paddingBottom: total === 0 ? 0 : space(20) }}>
        {/* The Verses tab's first screen, so no back link. Every verse you
            have is here, in every stage -- it used to stop at Learning and
            send you to the Memory Calendar for the rest. */}
        <ScreenHeader
          title="My Verses"
          subtitle={summary}
          actions={<AppButton size="sm" variant="primary" Icon={Plus} label="Add verses" onPress={() => go('addVerses')} />}
        />

        <OneTimeTip
          id="versesTab"
          text="Everything about your verses lives here: the list itself, My Schedule for which days you learn new ones, and Review Settings for how often learned verses come back."
        />

        {total === 0 ? (
          <EmptyState title="No verses yet" message="Tap Add verses, or add them from a chapter's page." />
        ) : (
          <>
            {landmark ? (
              <AppText variant="label" className="font-sans text-ink-2">
                {landmark}
              </AppText>
            ) : null}
            {viewSwitch}

            {/* Every stage at a glance; tap one to jump to it. The switch
                redraws the same strip for a date ahead, with the change from
                today under each count. */}
            <View
              className={`border rounded-card ${ahead ? 'bg-surface-2 border-line-strong' : 'bg-surface border-line'}`}
              style={{ paddingTop: space(10), paddingBottom: space(12), paddingHorizontal: space(4), gap: space(14) }}
            >
              <View style={{ paddingHorizontal: space(6) }}>
                <SegmentedControl
                  accessibilityLabel="When"
                  options={(['now', 'm1', 'm3', 'y1'] as Horizon[]).map((h) => ({ id: h, label: HORIZON_LABEL[h] }))}
                  value={horizon}
                  onChange={setHorizon}
                />
              </View>
              <StageStrip counts={shownCounts} onPressStage={ahead ? undefined : jumpTo} deltas={deltas} />
              <View className="border-t border-hairline" style={{ paddingTop: space(12), paddingHorizontal: space(10), gap: space(4) }}>
                <AppText variant="label" className="font-sans text-ink">
                  {forecastLine}
                </AppText>
                {ahead && (
                  <AppText variant="caption" className="font-sans text-ink-3">
                    If every review goes well. Only verses already on your list.
                  </AppText>
                )}
              </View>
              {!isNew && !ahead && (
                <Pressable
                  onPress={() => go('verseRoad')}
                  accessibilityRole="button"
                  hitSlop={8}
                  className="flex-row items-center self-center active:opacity-60"
                  style={{ gap: space(2) }}
                >
                  <AppText variant="label" className="font-sans font-semibold text-accent">
                    See them on the road
                  </AppText>
                  <ChevronRight size={Math.round(16 * scale)} color={palette.accent} />
                </Pressable>
              )}
            </View>

            {isNew && (
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(12) }}>
                <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
                  The road every verse travels
                </AppText>
                <View style={{ gap: space(8) }}>
                  {(
                    [
                      ['learning', 'a few days'],
                      ['daily', `every day for ${dailyPhaseWeeks} ${dailyPhaseWeeks === 1 ? 'week' : 'weeks'}`],
                      ['weekly', `once a week for ${weeklyPhaseMonths} ${weeklyPhaseMonths === 1 ? 'month' : 'months'}`],
                      ['monthly', `once a month for ${monthlyPhaseYears} ${monthlyPhaseYears === 1 ? 'year' : 'years'}`],
                      ['complete', 'yours for good'],
                    ] as [VerseStage, string][]
                  ).map(([stage, length]) => (
                    <View key={stage} className="flex-row items-center" style={{ gap: space(10) }}>
                      <StageDot stage={stage} />
                      <AppText variant="label" className="font-sans font-semibold text-ink" style={{ minWidth: space(80) }}>
                        {STAGE_LABEL[stage]}
                      </AppText>
                      <AppText variant="label" className="font-sans text-ink-2 flex-1">
                        {length}
                      </AppText>
                    </View>
                  ))}
                </View>
                {nextUp && (
                  <View className="flex-row items-start border-t border-hairline" style={{ paddingTop: space(12), gap: space(10) }}>
                    <ArrowUp size={Math.round(18 * scale)} color={palette.success} />
                    <AppText variant="label" className="font-sans text-ink flex-1">
                      <AppText variant="label" className="font-sans font-semibold text-ink">
                        {referenceFor(nextUp.book, nextUp.chapter, nextUp.verses)}
                      </AppText>
                      {nextUp.progress.remaining > 0
                        ? ` reaches Daily after ${nextUp.progress.remaining} more perfect ${nextUp.progress.remaining === 1 ? 'recall' : 'recalls'}.`
                        : ' reaches Daily once today’s reviews are done.'}
                    </AppText>
                  </View>
                )}
                <Pressable onPress={() => go('savedPlans')} accessibilityRole="button" className="active:opacity-60 self-start">
                  <AppText variant="label" className="font-sans font-semibold text-accent">
                    Change how long each stage lasts
                  </AppText>
                </Pressable>
              </View>
            )}

          </>
        )}
      </View>
        }
        ListFooterComponent={
      <View style={{ gap: space(20), paddingTop: space(20) }}>
        {/* How the list above gets worked through. Each opens its own screen.
            "Where verses come from" only appears once a group plan competes
            with your own verses. */}
        <GroupedList header="How these verses are scheduled">
          <ListRow
            title="My Schedule"
            value={`${learningDays.length} days · ${newVersesPace} a day`}
            onPress={() => go('mySchedule')}
          />
          {joinedGroupPlanMemberships.length > 0 && (
            <ListRow title="Where verses come from" value={sourcesValue} onPress={() => go('verseSources')} />
          )}
          <ListRow
            title="Review Settings"
            value={activePlan ? activePlan.name : 'None chosen'}
            onPress={() => go('savedPlans')}
          />
        </GroupedList>

        <GroupedList header="Your progress">
          <ListRow
            Icon={CalendarDays}
            title="Memory Calendar"
            value={reviewsPaused ? 'Paused' : dueTodayCount === 1 ? '1 due today' : `${dueTodayCount} due today`}
            onPress={() => go('memoryCalendar')}
          />
          <ListRow
            Icon={Bookmark}
            title="Takeaways"
            value={takeawayCount === 0 ? 'None yet' : `${takeawayCount} written`}
            onPress={() => go('takeaways')}
          />
          <ListRow
            Icon={History}
            title="History"
            value={`${counts.complete} complete`}
            onPress={() => go('fullHistory')}
          />
        </GroupedList>
      </View>
        }
      />
    </FadeInView>
  );
}

/** One item of My Verses' list: a stage's heading, one verse row, or a whole block. */
type ListItem = {
  kind: 'waiting' | 'empty' | 'header' | 'row' | 'complete' | 'book';
  key: string;
  stage?: VerseStage;
  group?: StageGroup;
  /** The first row under its heading (a wider gap above it). */
  first?: boolean;
};

/**
 * One run of consecutive waiting verses. The reference gets the full width of
 * the first line; the translation and the Start button sit underneath.
 */
function VerseGroupRow({
  group,
  drag,
  onHold,
  isActive,
  onStart,
  onRemove,
}: {
  group: GroupedQueueItem;
  /** Present only while its list is being reordered. */
  drag?: () => void;
  /** Holding the row outside reordering: starts reordering its list. */
  onHold?: () => void;
  isActive: boolean;
  onStart: () => void;
  onRemove: () => void;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const hasMultiple = group.verses.length > 1;
  const reference = referenceFor(group.book, group.chapter, group.verses);

  return (
    <Pressable
      onLongPress={drag ?? onHold}
      delayLongPress={250}
      accessibilityRole="button"
      accessibilityLabel={drag ? `${reference}. Press and hold to move.` : reference}
      className={`flex-row items-start rounded-card border ${isActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
      style={{ padding: space(12), gap: space(10) }}
    >
      {/* Drag affordance. The whole row is the drag target (a small handle
          is a hard thing to hit), but the grip is what makes that
          discoverable. */}
      {drag && (
        <View className="shrink-0" style={{ paddingTop: space(2) }}>
          <GripVertical size={Math.round(16 * scale)} color={isActive ? palette.accent : palette.ink3} />
        </View>
      )}

      <View className="flex-1" style={{ gap: space(6), minWidth: 0 }}>
        <View className="flex-row items-start" style={{ gap: space(8) }}>
          <AppText variant="label" className="font-sans font-semibold text-ink flex-1">
            {reference}
          </AppText>
          <AppIconButton
            Icon={Trash2}
            variant="bare"
            diameter={28}
            iconColor={palette.ink3}
            accessibilityLabel={`Remove ${reference}`}
            onPress={onRemove}
          />
        </View>
        <AppText variant="caption" className="font-serif text-ink-2" numberOfLines={1}>
          {group.items[0].text}
        </AppText>
        <View className="flex-row flex-wrap items-center" style={{ gap: space(8) }}>
          {/* The translation matters once your list can mix them: the same
              verse in two translations is two separate entries. */}
          <AppText variant="caption" className="font-sans text-ink-3">
            {translationLabel(group.items[0].translationId || 'ESV')}
            {hasMultiple ? ` · ${group.verses.length} verses` : ''}
          </AppText>
          <View className="ml-auto">
            <AppButton size="sm" variant="secondary" label="Start learning" onPress={onStart} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

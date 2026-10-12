import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ArrowUp, CalendarDays, ChevronRight, GripVertical, History, Plus, Trash2 } from 'lucide-react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';

import { AppState } from '../state/useAppState';
import { QueueItem, GroupedQueueItem } from '../types';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader, SegmentedControl } from '../components/blocks';
import { PRIORITY_LABELS } from '../components/QueueSources';
import { CompleteChips, StageDot, StageStrip, VerseStageRow, stageCaption } from '../components/VerseStages';
import VersesByBook from '../components/VersesByBook';
import { reorderQueueGroups } from '../lib/queueReorder';
import { STAGE_LABEL, STAGE_ORDER, StageGroup, VerseStage, groupByStage, referenceFor, stageCounts } from '../lib/stageProgress';
import { translationLabel } from '../data';

import { useThemeColors } from '../components/theme';
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

type VersesView = 'stage' | 'book';
// Remembered for the session, so coming back from a verse page lands on the
// view you left. Not saved to the device: By stage is the right place to open.
let lastView: VersesView = 'stage';

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
    dailyPhaseWeeks,
    weeklyPhaseMonths,
    monthlyPhaseYears,
    masteryTouches,
  } = state;

  const space = useScaledSpace();
  const palette = useThemeColors();
  const scale = useFontScale();
  const [view, setViewState] = useState<VersesView>(lastView);
  const setView = (v: VersesView) => {
    lastView = v;
    setViewState(v);
  };

  const plan = { dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches };
  const now = new Date();
  // Everything but Waiting, bucketed by stage. Waiting keeps its own
  // drag-to-reorder list below, because its order is the learning order.
  const byStage = useMemo(
    () => groupByStage(memoryQueue, plan, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memoryQueue, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches]
  );
  const counts = useMemo(() => stageCounts(memoryQueue), [memoryQueue]);
  const total = memoryQueue.length;

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

  // The strip jumps to a stage's section. Each section reports where it sits
  // inside the scroll content as it lays out.
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Partial<Record<VerseStage, number>>>({});
  const listY = useRef(0);
  const scrollToStage = (stage: VerseStage) => {
    const y = sectionY.current[stage];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, listY.current + y - space(12)), animated: true });
  };
  const jumpTo = (stage: VerseStage) => {
    if (view === 'stage') return scrollToStage(stage);
    // From By book the sections aren't on screen yet: switch, then scroll once they've laid out.
    setView('stage');
    setTimeout(() => scrollToStage(stage), 150);
  };

  const openGroup = (g: StageGroup) =>
    openVersePage({ book: g.book, chapter: g.chapter, verses: g.verses, translationId: g.translationId });

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
          {stageCaption(stage, plan)}
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

  const stageSection = (stage: VerseStage, title: string, body: React.ReactNode) => (
    <View key={stage} style={{ gap: space(10) }} onLayout={(e) => (sectionY.current[stage] = e.nativeEvent.layout.y)}>
      {counts[stage] === 0 && stage !== 'waiting' ? (
        emptyStage(stage)
      ) : (
        <>
          {sectionHeader(stage, title)}
          {body}
        </>
      )}
    </View>
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
            {waitingSections.length > 1 && <SectionHeader title={section.title} />}
            {section.groups.length === 0 ? (
              <AppText variant="label" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
                None waiting.
              </AppText>
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
                renderItem={({ item: group, drag, isActive }: RenderItemParams<GroupedQueueItem>) => (
                  <VerseGroupRow
                    group={group}
                    drag={drag}
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
                )}
              />
            )}
          </View>
        ))
      )}
    </View>
  );

  const rows = (stage: 'learning' | 'daily' | 'weekly' | 'monthly') => (
    <View style={{ gap: space(8) }}>
      {byStage[stage].map((g) => (
        <VerseStageRow key={g.key} group={g} now={now} onPress={() => openGroup(g)} />
      ))}
    </View>
  );

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* The Verses tab's first screen, so no back link. Every verse you
            have is here, in every stage -- it used to stop at Learning and
            send you to the Memory Calendar for the rest. */}
        <ScreenHeader
          title="My Verses"
          subtitle={summary}
          actions={<AppButton size="sm" variant="primary" Icon={Plus} label="Add verses" onPress={() => navigateTo('addVerses')} />}
        />

        {total === 0 ? (
          <EmptyState title="No verses yet" message="Tap Add verses, or add them from a chapter's page." />
        ) : (
          <>
            <SegmentedControl
              accessibilityLabel="Show verses"
              options={[
                { id: 'stage', label: 'By stage' },
                { id: 'book', label: 'By book' },
              ]}
              value={view}
              onChange={setView}
            />

            {/* Every stage at a glance; tap one to jump to it. */}
            <View className="bg-surface border border-line rounded-card" style={{ paddingTop: space(16), paddingBottom: space(12), paddingHorizontal: space(4), gap: space(12) }}>
              <StageStrip counts={counts} onPressStage={jumpTo} />
              {!isNew && (
                <Pressable
                  onPress={() => navigateTo('verseRoad')}
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
                <Pressable onPress={() => navigateTo('savedPlans')} accessibilityRole="button" className="active:opacity-60 self-start">
                  <AppText variant="label" className="font-sans font-semibold text-accent">
                    Change how long each stage lasts
                  </AppText>
                </Pressable>
              </View>
            )}

            {view === 'stage' ? (
              <View style={{ gap: space(24) }} onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
                {stageSection('waiting', 'Waiting to start', waitingBody)}
                {stageSection('learning', 'Learning now', rows('learning'))}
                {stageSection('daily', 'Daily', rows('daily'))}
                {stageSection('weekly', 'Weekly', rows('weekly'))}
                {stageSection('monthly', 'Monthly', rows('monthly'))}
                {stageSection('complete', 'Complete', <CompleteChips groups={byStage.complete} onPress={openGroup} />)}
              </View>
            ) : (
              <VersesByBook
                queue={memoryQueue}
                onOpenChapter={(book, chapter) => navigateTo('chapterLanding', book, chapter)}
              />
            )}
          </>
        )}

        {/* How the list above gets worked through. Each opens its own screen.
            "Where verses come from" only appears once a group plan competes
            with your own verses. */}
        <GroupedList header="How these verses are scheduled">
          <ListRow
            title="My Schedule"
            value={`${learningDays.length} days · ${newVersesPace} a day`}
            onPress={() => navigateTo('mySchedule')}
          />
          {joinedGroupPlanMemberships.length > 0 && (
            <ListRow title="Where verses come from" value={sourcesValue} onPress={() => navigateTo('verseSources')} />
          )}
          <ListRow
            title="Review Settings"
            value={activePlan ? activePlan.name : 'None chosen'}
            onPress={() => navigateTo('savedPlans')}
          />
        </GroupedList>

        <GroupedList header="Your progress">
          <ListRow
            Icon={CalendarDays}
            title="Memory Calendar"
            value={reviewsPaused ? 'Paused' : dueTodayCount === 1 ? '1 due today' : `${dueTodayCount} due today`}
            onPress={() => navigateTo('memoryCalendar')}
          />
          <ListRow
            Icon={History}
            title="History"
            value={`${counts.complete} complete`}
            onPress={() => navigateTo('fullHistory')}
          />
        </GroupedList>
      </ScrollView>
    </FadeInView>
  );
}

/**
 * One run of consecutive waiting verses. The reference gets the full width of
 * the first line; the translation and the Start button sit underneath.
 */
function VerseGroupRow({
  group,
  drag,
  isActive,
  onStart,
  onRemove,
}: {
  group: GroupedQueueItem;
  drag: () => void;
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
      onLongPress={drag}
      delayLongPress={250}
      accessibilityRole="button"
      accessibilityLabel={`${reference}. Press and hold to move.`}
      className={`flex-row items-start rounded-card border ${isActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
      style={{ padding: space(12), gap: space(10) }}
    >
      {/* Drag affordance. The whole row is the drag target (a small handle
          is a hard thing to hit), but the grip is what makes that
          discoverable. */}
      <View className="shrink-0" style={{ paddingTop: space(2) }}>
        <GripVertical size={Math.round(16 * scale)} color={isActive ? palette.accent : palette.ink3} />
      </View>

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

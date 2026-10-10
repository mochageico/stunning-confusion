import { Pressable, ScrollView, View } from 'react-native';
import { CalendarDays, GripVertical, History, Plus, Trash2 } from 'lucide-react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';

import { AppState } from '../state/useAppState';
import { QueueItem, GroupedQueueItem } from '../types';
import { FadeInView } from '../components/ui';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Badge, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { PRIORITY_LABELS } from '../components/QueueSources';
import { reorderQueueGroups } from '../lib/queueReorder';
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

export default function ActivePlanScreen({ state }: { state: AppState }) {
  const {
    navigateTo,
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
  } = state;

  const space = useScaledSpace();

  // Verses in spaced review ('reviewing') are deliberately excluded here --
  // the Memory Calendar shows that half of the picture (which verses are
  // due which day, Daily/Weekly/Monthly), so listing them again in a flat
  // queue too was redundant and confusing. Fully-memorized verses
  // ('retained') are excluded for the same reason -- they're done, there's
  // nothing to start/reorder/manage about them here, and they're already
  // browsable in History. Only queued/learning verses -- the ones actually
  // being actively managed -- show.
  // Sorted by orderIndex BEFORE grouping, because orderIndex is the real
  // source of truth for queue position -- not the array's own order.
  //
  // This is what made reordering appear to do nothing. `memoryQueue` is sorted
  // by orderIndex exactly once, when it loads (see loadUserData); every
  // reorder after that goes through reorderQueueGroups, which rewrites
  // orderIndex values but deliberately maps over the queue in place, so the
  // ARRAY order never changes. Grouping straight off the array therefore
  // rebuilt the identical list, and the row visibly snapped back to where it
  // started the moment the drag was released.
  //
  // Sorting here makes what's rendered a pure function of orderIndex, so any
  // future path that sets orderIndex shows up correctly without having to also
  // remember to reshuffle the array.
  const grouped = groupQueueItems(
    [...memoryQueue]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .filter((item) => item.status === 'queued' || item.status === 'learning')
  );

  const count = (status: QueueItem['status']) => memoryQueue.filter((item) => item.status === status).length;
  const learningCount = count('learning');
  const waitingCount = count('queued');
  const reviewingCount = count('reviewing');
  const retainedCount = count('retained');
  // Nothing is due while reviews are paused -- same as Today.
  const dueTodayCount = reviewsPaused
    ? 0
    : memoryQueue.filter((item) => item.status === 'reviewing' && isReviewDue(item.nextReviewDueDate)).length;
  const summary = [
    `${learningCount} learning`,
    `${waitingCount} waiting`,
    reviewingCount > 0 ? `${reviewingCount} in review` : null,
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

  // Your own verses and each group plan's verses as separate lists (ui
  // overhaul bucket 3). Which source goes first each learning day is set in
  // "Where verses come from", so mixing them in one list implied an order
  // the scheduler doesn't follow. Each list reorders only among itself:
  // reorderQueueGroups reuses the orderIndex slots of the groups it's given,
  // so moving one of your verses never shifts a plan's verses or vice versa.
  const planIds = Array.from(
    new Set(grouped.filter((g) => g.origin === 'group').map((g) => g.items[0].originPlanId || ''))
  );
  const sections = [
    { key: 'mine', title: 'My own verses', groups: grouped.filter((g) => g.origin !== 'group') },
    ...planIds.map((id) => ({
      key: id || 'group',
      title: planNameFor(id || undefined),
      groups: grouped.filter((g) => g.origin === 'group' && (g.items[0].originPlanId || '') === id),
    })),
  ].filter((s) => s.key === 'mine' || s.groups.length > 0);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* The Verses tab's first screen, so no back link. It replaced the My
            Memory Work menu: the list comes first, and that menu's other rows
            sit underneath it. */}
        <ScreenHeader
          title="My Verses"
          subtitle={summary}
          actions={<AppButton size="sm" variant="primary" Icon={Plus} label="Add verses" onPress={() => navigateTo('addVerses')} />}
        />

        {/* THE VERSES -- queued and learning only. Verses in spaced review
            live on the Memory Calendar (see the `grouped` filter above). */}
        <View style={{ gap: space(12) }}>
          {grouped.length > 0 && (
            <AppText variant="caption" className="font-sans text-ink-3">
              In the order you'll learn them. Press and hold one to move it.
            </AppText>
          )}

          {grouped.length === 0 ? (
            <EmptyState
              title="Nothing waiting to start"
              message="Tap Add verses, or add them from a chapter's page. Verses you're already reviewing are on the Memory Calendar."
            />
          ) : (
            sections.map((section) => (
              <View key={section.key} style={{ gap: space(6) }}>
                {sections.length > 1 && <SectionHeader title={section.title} />}
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

        {/* How the list above gets worked through. Each opens its own screen;
            My Schedule used to sit open above the list, which put the verses
            two screens down at large text. "Where verses come from" only
            appears once a group plan competes with your own verses. */}
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
            value={retainedCount === 1 ? '1 retained' : `${retainedCount} retained`}
            onPress={() => navigateTo('fullHistory')}
          />
        </GroupedList>
      </ScrollView>
    </FadeInView>
  );
}

/**
 * One run of consecutive verses on My Verses. The reference gets the full
 * width of the first line (it used to share it with three badges and a
 * button, which crushed it to a wrapped column); status and the Start button
 * sit on their own line underneath.
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
  const versesStr = hasMultiple ? `${group.verses[0]}-${group.verses[group.verses.length - 1]}` : `${group.verses[0]}`;
  const reference = `${group.book} ${group.chapter}:${versesStr}`;

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
          {/* Only 'queued'/'learning' groups reach this list. */}
          <Badge label={group.status === 'learning' ? 'Learning' : 'Waiting'} tone={group.status === 'learning' ? 'accent' : 'neutral'} />
          {/* The translation matters once your list can mix them: the same
              verse in two translations is two separate entries. */}
          <AppText variant="caption" className="font-sans text-ink-3">
            {translationLabel(group.items[0].translationId || 'ESV')}
            {hasMultiple ? ` · ${group.verses.length} verses` : ''}
          </AppText>
          {group.status === 'queued' && (
            <View className="ml-auto">
              <AppButton size="sm" variant="secondary" label="Start learning" onPress={onStart} />
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

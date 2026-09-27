import { Pressable, ScrollView, View } from 'react-native';
import { GripVertical, Plus, Trash2 } from 'lucide-react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';

import { useState } from 'react';

import { AppState, buildVerseId } from '../state/useAppState';
import { QueueItem, GroupedQueueItem } from '../types';
import { FadeInView, NumericInput, useClampedNumberField } from '../components/ui';
import { AppButton, AppIconButton, AppText, CollapsibleCard, useFontScale, useScaledSpace } from '../components/design';
import { Badge, EmptyState, GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { RhythmEditor } from '../components/RhythmEditor';
import { QueueSources } from '../components/QueueSources';
import { BookPicker } from '../components/BookPicker';
import { reorderQueueGroups } from '../lib/queueReorder';
import { fetchChapterText, useChapterText } from '../state/useScripture';
import { DEFAULT_TRANSLATION_ID, getBookByName } from '../data';

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
  const palette = useThemeColors();
  const {
    handleBack,
    navigateTo,
    learningDays,
    newVersesPace,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    dayStartHour,
    pausedAt,
    pausedUntil,
    updateRhythm,
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
    updateMemoryQueue,
    triggerDailyPull,
    promoteToLearning,
    savedPlans,
    cognitiveLoadSensitivity,
    joinedGroupPlanDetails,
    joinedGroupPlanMemberships,
    setGroupPlanPriority,
    getNextPullPreview,
    removeQueueItems,
    addVerseRangeToQueue,
  } = state;

  const space = useScaledSpace();
  // A section title with a description plus an action button is the row that
  // breaks first on this screen; past 1.3x the button moves below the text.
  const headerStacked = useFontScale() >= 1.3;

  const [isAddingVerses, setIsAddingVerses] = useState(false);

  const addChapterField = useClampedNumberField(selectedAddChapter, setSelectedAddChapter, (n) => Math.max(1, n));
  const addStartVerseField = useClampedNumberField(
    selectedAddVerse,
    (n) => {
      setSelectedAddVerse(n);
      if (n > selectedAddEndVerse) setSelectedAddEndVerse(n);
    },
    (n) => Math.max(1, n)
  );
  const addEndVerseField = useClampedNumberField(selectedAddEndVerse, setSelectedAddEndVerse, (n) =>
    Math.max(selectedAddVerse, n)
  );

  // Real verse count for the "max N" hint next to End Verse.
  const addChapterId = getBookByName(selectedAddBook)?.id || null;
  const { data: addChapterData } = useChapterText(DEFAULT_TRANSLATION_ID, addChapterId, selectedAddChapter);

  // Verses in spaced review ('reviewing') are deliberately excluded here --
  // the Memory Calendar shows that half of the picture (which verses are
  // due which day, Daily/Weekly/Monthly), so listing them again in a flat
  // queue too was redundant and confusing. Fully-memorized verses
  // ('retained') are excluded for the same reason -- they're done, there's
  // nothing to start/reorder/manage about them here, and they're already
  // browsable in Full History ("Fully memorized — reached long-term
  // retention"). Only queued/learning verses -- the ones actually being
  // actively managed -- show.
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

  // Rhythm is user-level and commits live, so there is no target plan to
  // diff against and no dirty state -- both of which this screen used to
  // maintain, along with a Save button that misrepresented what it did.
  const rhythm = {
    learningDays,
    newVersesPace,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    dayStartHour,
    cognitiveLoadSensitivity,
    pausedAt,
    pausedUntil,
  };

  const activePlan = savedPlans.find((p) => p.isActive) || savedPlans[0];

  const individualQueuedCount = memoryQueue.filter(
    (item) => item.status === 'queued' && item.origin !== 'group'
  ).length;

  const pullPreview = getNextPullPreview();

  // Group rows used to say a generic "Group", which told you a verse wasn't
  // yours but not which plan put it there -- so the priority setting had no
  // visible subject.
  const planNameFor = (planId?: string) =>
    joinedGroupPlanDetails.find((p) => p.planId === planId)?.name || 'Group';

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

  const addVerses = async () => {
    const start = Math.min(selectedAddVerse, selectedAddEndVerse);
    const end = Math.max(selectedAddVerse, selectedAddEndVerse);

    setIsAddingVerses(true);
    const result = await addVerseRangeToQueue(selectedAddBook, selectedAddChapter, start, end);
    setIsAddingVerses(false);

    if (result.error) {
      triggerToast(result.error);
      return;
    }
    if (result.added === 0) {
      triggerToast(`${selectedAddBook} ${selectedAddChapter}:${start}-${end} is already on your list!`);
      return;
    }

    setShowAddQueueItemModal(false);
    const skippedNotes = [
      result.alreadyThere > 0 ? `${result.alreadyThere} already on your list` : null,
      result.missingText > 0 ? `${result.missingText} had no text available` : null,
    ].filter(Boolean);
    const skippedNote = skippedNotes.length > 0 ? ` (${skippedNotes.join(', ')}, skipped)` : '';
    triggerToast(
      `Added ${selectedAddBook} ${selectedAddChapter}:${start}${end > start ? `-${end}` : ''} to your verses!${skippedNote}`
    );
  };

  const fieldLabel = (text: string) => (
    <AppText variant="caption" className="font-sans font-medium text-ink-2">
      {text}
    </AppText>
  );
  const numberField = 'w-full bg-surface border border-line rounded-btn text-ink font-sans';

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="My Verses" onBack={handleBack} backLabel="My Memory Work" />

        {/* MY SCHEDULE -- user-level pacing, commits live. Called "Rhythm"
            before, which collided head-on with Saved Plans calling its
            retention presets "Rhythms" too: one word, two unrelated meanings,
            one screen apart. */}
        <CollapsibleCard
          storageKey="queue.rhythm"
          title="My Schedule"
          summary={`${learningDays.length} days · ${newVersesPace}/day · ${maxReviewCap} min`}
        >
          <RhythmEditor rhythm={rhythm} onChange={updateRhythm} />
        </CollapsibleCard>

        {/* WHERE VERSES COME FROM -- only worth a section once there's more
            than one source competing for the daily budget. */}
        {joinedGroupPlanMemberships.length > 0 && (
          <CollapsibleCard
            storageKey="queue.sources"
            title="Where verses come from"
            summary={`${joinedGroupPlanMemberships.length + 1} sources`}
          >
            <QueueSources
              individualQueuedCount={individualQueuedCount}
              joinedPlans={joinedGroupPlanDetails}
              memberships={joinedGroupPlanMemberships}
              previewFromPlans={pullPreview.fromPlans}
              previewFromIndividual={pullPreview.fromIndividual}
              onChangePriority={setGroupPlanPriority}
            />
          </CollapsibleCard>
        )}

        {/* THE VERSES -- queued and learning only. Verses in spaced review
            live on the Memory Calendar (see the `grouped` filter above). */}
        <View style={{ gap: space(12) }}>
          <View
            className={headerStacked ? '' : 'flex-row justify-between items-center'}
            style={{ gap: space(headerStacked ? 10 : 12) }}
          >
            <AppText variant="caption" className={`font-sans text-ink-3 ${headerStacked ? '' : 'flex-1'}`}>
              Verses you've chosen, in the order you'll learn them. Press and hold one to move it.
            </AppText>
            <View className={headerStacked ? 'flex-row' : 'shrink-0'}>
              <AppButton
                size="sm"
                variant={showAddQueueItemModal ? 'quiet' : 'primary'}
                Icon={showAddQueueItemModal ? undefined : Plus}
                label={showAddQueueItemModal ? 'Cancel' : 'Add verses'}
                onPress={() => setShowAddQueueItemModal(!showAddQueueItemModal)}
              />
            </View>
          </View>

          {/* Add form, inline rather than in a sheet: its number fields use
              the shared keyboard Done bar, which a Modal would need its own
              copy of (see the pairing rule in ui.tsx). */}
          {showAddQueueItemModal && (
            <FadeInView>
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(14) }}>
                <View style={{ gap: space(4) }}>
                  {fieldLabel('Book')}
                  <BookPicker value={selectedAddBook} onChange={setSelectedAddBook} />
                </View>

                {/* Chapter, first verse and last verse share a row until the
                    text is large, then wrap two and one. */}
                <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
                  {[
                    { label: 'Chapter', field: addChapterField },
                    { label: 'First verse', field: addStartVerseField },
                    {
                      label: addChapterData ? `Last verse (up to ${addChapterData.verseCount})` : 'Last verse',
                      field: addEndVerseField,
                    },
                  ].map(({ label, field }) => (
                    <View key={label} style={{ flexGrow: 1, flexBasis: space(88), gap: space(4) }}>
                      {fieldLabel(label)}
                      <NumericInput {...field} className={numberField} style={{ padding: space(10) }} />
                    </View>
                  ))}
                </View>

                <View className="flex-row justify-end" style={{ gap: space(8) }}>
                  <AppButton
                    variant="primary"
                    label={isAddingVerses ? 'Adding…' : 'Add these verses'}
                    disabled={isAddingVerses}
                    onPress={addVerses}
                  />
                </View>
              </View>
            </FadeInView>
          )}

          {grouped.length === 0 ? (
            <EmptyState
              title="Nothing waiting to start"
              message="Add verses here or from a chapter's page. Verses you're already reviewing are on the Memory Calendar."
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

        {/* RETENTION FOOTER -- read-only. Keeps the two halves of the split
            visibly connected (this page owns pacing, the designer owns the
            method) without letting you edit the plan from here, which is the
            two-editors-one-state problem the split exists to remove. */}
        <GroupedList>
          <ListRow
            title="Review Settings"
            value={activePlan ? activePlan.name : 'None chosen'}
            onPress={() => navigateTo('savedPlans')}
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
          {hasMultiple && (
            <AppText variant="caption" className="font-sans text-ink-3">
              {group.verses.length} verses
            </AppText>
          )}
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

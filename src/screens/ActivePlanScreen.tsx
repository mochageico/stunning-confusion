import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, ChevronRight, GripVertical, Plus, X, Trash2 } from 'lucide-react-native';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';

import { useState } from 'react';

import { AppState, buildVerseId } from '../state/useAppState';
import { QueueItem, GroupedQueueItem } from '../types';
import { FadeInView, NumericInput, useClampedNumberField } from '../components/ui';
import { AppButton, AppIconButton, AppText, CollapsibleCard, useFontScale, useScaledSpace } from '../components/design';
import { RhythmEditor } from '../components/RhythmEditor';
import { QueueSources } from '../components/QueueSources';
import { BookPicker } from '../components/BookPicker';
import { reorderQueueGroups } from '../lib/queueReorder';
import { fetchChapterText, useChapterText } from '../state/useScripture';
import { DEFAULT_TRANSLATION_ID, getBookByName } from '../data';

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

  // Reorders two adjacent VISIBLE groups.
  //
  // This must never rebuild the queue from `grouped`. `grouped` is a filtered
  // view -- queued/learning only -- so flattening it and passing the result to
  // updateMemoryQueue() replaces the entire queue with just those items, and
  // every reviewing/retained verse silently disappears from state. The
  // auto-sync then reads that as "the user removed 100+ verses" and deletes
  // the documents. That is exactly how a real user's whole review history was
  // destroyed by a single tap on an arrow.
  //
  // So: permute orderIndex AMONG the visible items only, reusing the index
  // slots they already occupy, and map over `prev` so every other item is
  // carried through untouched.
  const reorderGroups = (from: number, to: number) => {
    updateMemoryQueue((prev) => reorderQueueGroups(prev, grouped, from, to));
  };

  // moveGroupUp/moveGroupDown were deleted with the per-row arrow buttons --
  // the list is drag-ordered now. Both were thin wrappers over reorderGroups,
  // which is still the single path every reorder goes through.

  // The 7-day Memory Load Forecast used to live here. It moved to the Memory
  // Calendar, which already projects the same days and can name the actual
  // verses due on each one instead of only counting them -- see
  // getMemoryCalendarProjection. Keeping a second, vaguer copy of that on
  // this screen was the reason this page had two jobs.

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 24 }}>
        {/* Header Row */}
        <View className="flex-row items-start justify-between">
          <View className="flex-row items-center gap-3">
            <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor="#262626" onPress={handleBack} className="rounded-full border border-neutral-200 bg-white" />
            <View>
              <AppText variant="title" className="font-serif font-black text-neutral-900 mt-0.5">My Verses</AppText>
            </View>
          </View>
        </View>

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

        {/* MEMORY QUEUE SECTION */}
        <View style={{ gap: 12 }}>
          {/* The title block needs flex-1 and the button shrink-0: without
              them the description text sets the row's width, and the Add
              Verses button was pushed partly off the right edge. Past 1.3x
              they stack instead, since a two-line title plus a button simply
              doesn't fit one row at large text sizes. */}
          <View
            className={headerStacked ? '' : 'flex-row justify-between items-center'}
            style={{ gap: space(headerStacked ? 10 : 12) }}
          >
            <View className={headerStacked ? '' : 'flex-1'}>
              <AppText variant="body" className="font-serif font-black text-[#1A1A1A]">Memory Verse Queue</AppText>
              <AppText variant="caption" className="text-neutral-400 mt-0.5">
                Verses you've chosen, in the order you'll learn them. Press and hold a verse to drag it somewhere else.
              </AppText>
            </View>
            <AppButton
              size="sm"
              onPress={() => setShowAddQueueItemModal(!showAddQueueItemModal)}
              className={`bg-[#1A1A1A] rounded-xl flex-row items-center gap-1 ${headerStacked ? 'self-start' : 'shrink-0'}`}
            >
              <Plus size={12} color="#ffffff" />
              <AppText variant="label" className="font-sans font-bold text-white">Add Verses</AppText>
            </AppButton>
          </View>

          {/* Inline Verse Addition Form */}
          {showAddQueueItemModal && (
            <FadeInView>
              <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white text-left" style={{ gap: 16 }}>
                <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                  <AppText variant="label" className="font-sans font-black text-[#1A1A1A] uppercase tracking-wider">Add Verses</AppText>
                  <Pressable onPress={() => setShowAddQueueItemModal(false)}>
                    <X size={14} color="#a3a3a3" />
                  </Pressable>
                </View>

                <View className="flex-row gap-2.5">
                  <View className="flex-1" style={{ gap: 4 }}>
                    <AppText variant="micro" className="font-bold text-neutral-400 uppercase">Book</AppText>
                    <BookPicker value={selectedAddBook} onChange={setSelectedAddBook} />
                  </View>
                  <View className="flex-1" style={{ gap: 4 }}>
                    <AppText variant="micro" className="font-bold text-neutral-400 uppercase">Chapter</AppText>
                    <NumericInput
                      {...addChapterField}
                      className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                    />
                  </View>
                </View>

                <View className="flex-row gap-2.5">
                  <View className="flex-1" style={{ gap: 4 }}>
                    <AppText variant="micro" className="font-bold text-neutral-400 uppercase">Start Verse</AppText>
                    <NumericInput
                      {...addStartVerseField}
                      className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                    />
                  </View>
                  <View className="flex-1" style={{ gap: 4 }}>
                    <View className="flex-row items-center justify-between">
                      <AppText variant="micro" className="font-bold text-neutral-400 uppercase">End Verse</AppText>
                      {addChapterData && (
                        <AppText variant="micro" className="font-mono text-neutral-400">max {addChapterData.verseCount}</AppText>
                      )}
                    </View>
                    <NumericInput
                      {...addEndVerseField}
                      className="w-full p-2 border border-neutral-200 rounded-xl text-xs font-mono font-bold text-[#1A1A1A]"
                    />
                  </View>
                </View>

                <View className="flex-row gap-2 justify-end pt-2 border-t border-neutral-100">
                  <Pressable
                    onPress={() => setShowAddQueueItemModal(false)}
                    className="px-4 py-2 border border-neutral-200 rounded-xl"
                  >
                    <AppText variant="label" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                  </Pressable>
                  <Pressable
                    disabled={isAddingVerses}
                    onPress={async () => {
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
                    }}
                    className={`px-4 py-2 bg-[#1A1A1A] rounded-xl ${isAddingVerses ? 'opacity-50' : ''}`}
                  >
                    <AppText variant="label" className="text-white font-sans font-bold ">{isAddingVerses ? 'Adding…' : 'Add these verses'}</AppText>
                  </Pressable>
                </View>
              </View>
            </FadeInView>
          )}

          {/* Queue list -- verses in Spaced Review live in the Memory
              Calendar now, not here (see the `grouped` filter above).

              A plain View, not a nested ScrollView. This used to be a
              ScrollView with maxHeight: 360 inside the screen's own
              ScrollView; on a touch device the inner one swallows vertical
              drags that start over it, so the page underneath felt stuck,
              and anything past 360px was hidden behind a scrollbar most
              people never noticed. The list is now part of the page. */}
          <View
            className="border border-neutral-100 p-2 rounded-2xl bg-neutral-50/30"
            style={{ gap: 8 }}
          >
            {grouped.length === 0 ? (
              <AppText variant="label" className="py-8 text-center text-neutral-400 font-sans italic">
                Memory Queue is currently empty. Add verses above.
              </AppText>
            ) : (
              // Real drag-to-reorder, replacing a column of up/down arrow
              // buttons per row. The description above claimed "drag to
              // reorder" while the only way to move anything was tapping an
              // arrow repeatedly.
              //
              // scrollEnabled={false} because this always nests inside the
              // screen's own ScrollView -- same reason and same pattern as
              // the recording list in ChapterLandingScreen, which is where
              // DraggableFlatList is already proven in this app.
              //
              // onDragEnd uses `from`/`to` rather than the reordered `data`
              // array: reorderGroups permutes orderIndex among the VISIBLE
              // items only and maps over the full queue, so reviewing and
              // retained verses are carried through untouched. Rebuilding
              // the queue from `data` would drop every verse this filtered
              // list doesn't show -- the exact bug the comment on
              // reorderGroups above exists to warn about.
              <DraggableFlatList
                data={grouped}
                scrollEnabled={false}
                keyExtractor={(group) => group.id || `${group.book}_${group.chapter}_${group.verses[0]}`}
                contentContainerStyle={{ gap: 8 }}
                onDragEnd={({ from, to }) => {
                  if (from === to) return;
                  reorderGroups(from, to);
                  triggerToast('Reordered.');
                }}
                renderItem={({ item: group, drag, isActive }: RenderItemParams<GroupedQueueItem>) => {
                  const isGroup = group.origin === 'group';
                  const hasMultiple = group.verses.length > 1;
                  const versesStr = hasMultiple
                    ? `${group.verses[0]}-${group.verses[group.verses.length - 1]}`
                    : `${group.verses[0]}`;

                  return (
                  <Pressable
                    onLongPress={drag}
                    delayLongPress={250}
                    accessibilityRole="button"
                    accessibilityLabel={`${group.book} ${group.chapter}:${versesStr}. Press and hold to reorder.`}
                    className={`flex-row items-center justify-between p-4 bg-white border rounded-xl border-l-4 ${
                      isGroup ? 'border-l-indigo-500 border-indigo-200' : 'border-l-orange-500 border-orange-200'
                    } ${isActive ? 'border-indigo-400 opacity-90' : ''}`}
                  >
                    <View className="flex-row items-center gap-3.5 flex-1">
                      {/* Drag affordance. The whole row is the drag target
                          (a small handle is a hard thing to hit), but the
                          grip is what makes that discoverable. */}
                      <View className="shrink-0">
                        <GripVertical size={16} color={isActive ? '#6366f1' : '#a3a3a3'} />
                      </View>

                      {/* Reference details */}
                      <View className="text-left flex-1" style={{ gap: 4 }}>
                        <View className="flex-row items-center gap-2 flex-wrap">
                          <AppText variant="label" className="font-serif font-black text-[#1A1A1A]">
                            {group.book} {group.chapter}:{versesStr}
                          </AppText>
                          <AppText variant="micro" className={`px-1.5 py-0.5 rounded-full font-sans font-bold uppercase tracking-wider ${ isGroup ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-orange-50 text-orange-700 border border-orange-200' }`} >
                            {isGroup ? planNameFor(group.items[0].originPlanId) : 'Mine'}
                          </AppText>
                          {hasMultiple && (
                            <AppText variant="micro" className="px-1.5 py-0.5 rounded-full font-sans font-bold bg-neutral-100 text-neutral-600 border border-neutral-200">
                              {group.verses.length} verses
                            </AppText>
                          )}
                        </View>
                        <AppText variant="caption" className="font-sans text-neutral-500 italic pr-2" numberOfLines={1} ellipsizeMode="tail">
                          "{group.items[0].text}"{hasMultiple ? ' ...' : ''}
                        </AppText>
                      </View>
                    </View>

                    {/* Right column status & delete */}
                    <View className="flex-row items-center gap-3">
                      {group.status === 'queued' && (
                        <Pressable
                          onPress={() => promoteToLearning(group.items.map((item) => item.verseId))}
                          className="px-2 py-0.5 rounded-full border border-[#1A1A1A] bg-white"
                        >
                          <AppText variant="micro" className="font-sans font-bold text-[#1A1A1A]">Start Learning</AppText>
                        </Pressable>
                      )}
                      {/* Only 'queued'/'learning' groups ever reach this list --
                          'reviewing' is on the Memory Calendar and 'retained'
                          is done, nothing to manage. Status colors deliberately
                          avoid amber/emerald/black, already used by the Memory
                          Load Forecast below. */}
                      <AppText variant="micro" className={`font-sans font-bold px-2 py-0.5 rounded-full border uppercase ${ group.status === 'learning' ? 'bg-violet-50 text-violet-600 border-violet-200' : 'bg-neutral-50 text-neutral-400 border-neutral-200' }`} >
                        {group.status}
                      </AppText>
                      <Pressable
                        onPress={() => {
                          // removeQueueItems, not a raw filter: deleting from
                          // Firestore now requires recorded intent, so this is
                          // the only route that actually removes documents.
                          removeQueueItems(group.items.map((item) => item.verseId));
                          triggerToast('Removed those verses from your list.');
                        }}
                        className="p-1 rounded"
                      >
                        <Trash2 size={13} color="#d4d4d4" />
                      </Pressable>
                    </View>
                  </Pressable>
                  );
                }}
              />
            )}
          </View>
        </View>

        {/* The Memory Calendar card was removed from this screen. It's reached
            from My Memory Work, which is the menu that owns every destination
            of that kind -- a second, larger door to it here made this page
            look like the hub rather than one of the things the hub leads to. */}

        {/* RETENTION FOOTER -- read-only. Keeps the two halves of the split
            visibly connected (this page owns pacing, the designer owns the
            method) without letting you edit the plan from here, which is the
            two-editors-one-state problem the split exists to remove. */}
        <Pressable
          onPress={() => navigateTo('savedPlans')}
          className="flex-row items-center border-t border-neutral-200"
          style={{ paddingTop: space(14), gap: space(8), minHeight: 44 }}
        >
          <AppText variant="micro" className="font-sans text-neutral-600 flex-1">
            Review Settings: {activePlan ? activePlan.name : 'none chosen'} — tap to change
          </AppText>
          <ChevronRight size={14} color="#737373" />
        </Pressable>
      </ScrollView>
    </FadeInView>
  );
}

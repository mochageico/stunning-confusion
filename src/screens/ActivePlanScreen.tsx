import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, ArrowUp, ArrowDown, CalendarDays, ChevronRight, Plus, X, Trash2 } from 'lucide-react-native';

import { useState } from 'react';

import { AppState, buildVerseId } from '../state/useAppState';
import { QueueItem, GroupedQueueItem } from '../types';
import { FadeInView, NumericInput, useClampedNumberField } from '../components/ui';
import { AppText, CollapsibleCard, useScaledSpace } from '../components/design';
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
  } = state;

  const space = useScaledSpace();

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
  const grouped = groupQueueItems(memoryQueue.filter((item) => item.status === 'queued' || item.status === 'learning'));

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

  const moveGroupUp = (idx: number) => {
    if (idx === 0) return;
    reorderGroups(idx, idx - 1);
    triggerToast('Moved consecutive group up.');
  };

  const moveGroupDown = (idx: number) => {
    if (idx === grouped.length - 1) return;
    reorderGroups(idx, idx + 1);
    triggerToast('Moved consecutive group down.');
  };

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
            <Pressable
              onPress={handleBack}
              className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
            >
              <ArrowLeft size={14} color="#262626" />
            </Pressable>
            <View>
              <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
                SCRIPTURE OVERVIEW
              </AppText>
              <AppText variant="title" className="font-serif font-black text-neutral-900 mt-0.5">Memory Queue</AppText>
            </View>
          </View>
        </View>

        {/* YOUR RHYTHM -- user-level pacing, commits live. */}
        <CollapsibleCard
          storageKey="queue.rhythm"
          title="Your Rhythm"
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
          <View className="flex-row justify-between items-center">
            <View>
              <AppText variant="body" className="font-serif font-black text-[#1A1A1A]">Memory Queue</AppText>
              <AppText variant="caption" className="text-neutral-400 mt-0.5">Reorder, customize, and add individual or group scriptures.</AppText>
            </View>
            <Pressable
              onPress={() => setShowAddQueueItemModal(!showAddQueueItemModal)}
              className="px-3 py-1.5 bg-[#1A1A1A] rounded-xl flex-row items-center gap-1"
            >
              <Plus size={12} color="#ffffff" />
              <AppText variant="label" className="font-sans font-bold text-white">Add Verses</AppText>
            </Pressable>
          </View>

          {/* Inline Verse Addition Form */}
          {showAddQueueItemModal && (
            <FadeInView>
              <View className="border-2 border-[#1A1A1A] rounded-2xl p-4 bg-white text-left" style={{ gap: 16 }}>
                <View className="flex-row justify-between items-center pb-2 border-b border-neutral-100">
                  <AppText variant="label" className="font-sans font-black text-[#1A1A1A] uppercase tracking-wider">Add Verse to Queue</AppText>
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
                      const bookId = getBookByName(selectedAddBook)?.id;
                      if (!bookId) {
                        triggerToast(`Unrecognized book: ${selectedAddBook}`);
                        return;
                      }

                      const start = Math.min(selectedAddVerse, selectedAddEndVerse);
                      const end = Math.max(selectedAddVerse, selectedAddEndVerse);
                      const targetVerseNumbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);

                      const alreadyQueued = targetVerseNumbers.filter((vNum) =>
                        memoryQueue.some(
                          (item) => item.verseId === buildVerseId(DEFAULT_TRANSLATION_ID, bookId, selectedAddChapter, vNum)
                        )
                      );
                      const toAdd = targetVerseNumbers.filter((vNum) => !alreadyQueued.includes(vNum));

                      if (toAdd.length === 0) {
                        triggerToast(`${selectedAddBook} ${selectedAddChapter}:${start}-${end} is already in your queue!`);
                        return;
                      }

                      setIsAddingVerses(true);
                      const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookId, selectedAddChapter);
                      setIsAddingVerses(false);

                      if (!chapterData) {
                        triggerToast(`Couldn't find ${selectedAddBook} ${selectedAddChapter} in the scripture library yet.`);
                        return;
                      }

                      const foundVerseNumbers = toAdd.filter((vNum) => chapterData.verses[String(vNum)]);
                      const missingCount = toAdd.length - foundVerseNumbers.length;

                      if (foundVerseNumbers.length === 0) {
                        triggerToast(`No verse text found for ${selectedAddBook} ${selectedAddChapter}:${start}-${end}.`);
                        return;
                      }

                      const newItems: QueueItem[] = foundVerseNumbers.map((vNum, i) => ({
                        verseId: buildVerseId(DEFAULT_TRANSLATION_ID, bookId, selectedAddChapter, vNum),
                        translationId: DEFAULT_TRANSLATION_ID,
                        book: selectedAddBook,
                        chapter: selectedAddChapter,
                        verseNumber: vNum,
                        text: chapterData.verses[String(vNum)],
                        orderIndex: memoryQueue.length + i,
                        status: 'queued',
                        origin: 'individual',
                        retentionPhase: 'none',
                        dateStarted: null,
                        lastReviewDate: null,
                        nextReviewDueDate: null,
                        currentStreakCount: 0,
                        totalSuccessfulReviews: 0,
                        gracePeriodUsedToday: false,
                      }));

                      updateMemoryQueue((prev) => [...prev, ...newItems]);
                      setShowAddQueueItemModal(false);
                      const skippedNotes = [
                        alreadyQueued.length > 0 ? `${alreadyQueued.length} already queued` : null,
                        missingCount > 0 ? `${missingCount} had no text available` : null,
                      ].filter(Boolean);
                      const skippedNote = skippedNotes.length > 0 ? ` (${skippedNotes.join(', ')}, skipped)` : '';
                      triggerToast(
                        `Added ${selectedAddBook} ${selectedAddChapter}:${start}${end > start ? `-${end}` : ''} to your Memory Queue!${skippedNote}`
                      );
                    }}
                    className={`px-4 py-2 bg-[#1A1A1A] rounded-xl ${isAddingVerses ? 'opacity-50' : ''}`}
                  >
                    <AppText variant="label" className="text-white font-sans font-bold ">{isAddingVerses ? 'Adding…' : 'Add to Queue'}</AppText>
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
              grouped.map((group, idx) => {
                const isGroup = group.origin === 'group';
                const hasMultiple = group.verses.length > 1;
                const versesStr = hasMultiple
                  ? `${group.verses[0]}-${group.verses[group.verses.length - 1]}`
                  : `${group.verses[0]}`;

                return (
                  <View
                    key={group.id || `${group.book}_${group.chapter}_${versesStr}`}
                    className={`flex-row items-center justify-between p-4 bg-white border rounded-xl border-l-4 ${
                      isGroup ? 'border-l-indigo-500 border-indigo-200' : 'border-l-orange-500 border-orange-200'
                    }`}
                  >
                    <View className="flex-row items-center gap-3.5 flex-1">
                      {/* Up & Down Reorder Buttons */}
                      <View className="gap-1">
                        <Pressable
                          onPress={() => moveGroupUp(idx)}
                          disabled={idx === 0}
                          className={`p-1 rounded ${idx === 0 ? 'opacity-20' : ''}`}
                        >
                          <ArrowUp size={12} color="#737373" />
                        </Pressable>
                        <Pressable
                          onPress={() => moveGroupDown(idx)}
                          disabled={idx === grouped.length - 1}
                          className={`p-1 rounded ${idx === grouped.length - 1 ? 'opacity-20' : ''}`}
                        >
                          <ArrowDown size={12} color="#737373" />
                        </Pressable>
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
                          triggerToast('Removed consecutive group from Memory Queue.');
                        }}
                        className="p-1 rounded"
                      >
                        <Trash2 size={13} color="#d4d4d4" />
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* MEMORY CALENDAR ENTRY -- its own prominent card, not a small button
            tucked next to the forecast, since it's the real day-by-day view of
            everything the forecast below only summarizes in aggregate. */}
        <Pressable
          onPress={() => navigateTo('memoryCalendar')}
          className="rounded-3xl p-5 bg-[#1A1A1A] flex-row items-center"
          style={{ gap: 14 }}
        >
          <View className="w-14 h-14 rounded-2xl bg-violet-500 items-center justify-center shrink-0">
            <CalendarDays size={26} color="#ffffff" />
          </View>
          <View className="flex-1">
            <AppText variant="title" className="text-white font-serif font-black ">Memory Calendar</AppText>
            <AppText variant="caption" className="text-neutral-300 font-sans mt-0.5 leading-relaxed">
              See every verse coming up, day by day -- Daily, Weekly, and Monthly reviews projected forward.
            </AppText>
          </View>
          <ChevronRight size={22} color="#ffffff" />
        </Pressable>

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
            Retention: {activePlan ? activePlan.name : 'no rhythm'} — change in Saved Memory Rhythms
          </AppText>
          <ChevronRight size={14} color="#737373" />
        </Pressable>
      </ScrollView>
    </FadeInView>
  );
}

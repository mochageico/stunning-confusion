import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ArrowLeft, Plus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, StepperRow, HelpTooltip, useClampedNumberField } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { ALL_BIBLE_BOOKS, DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { GroupPlanMembership } from '../types';
import { AppButton, AppIconButton, AppTextInput, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
// Plain language, and ordered by how most people actually want it: joining a
// group thing usually means you want the group's verses to lead. The old
// labels ("Individual First"/"Plan First"/"Additive") described the
// scheduler's internals rather than the choice being made.
const PRIORITY_OPTIONS: { id: GroupPlanMembership['priority']; label: string; description: string }[] = [
  { id: 'group', label: "Group verses first", description: "This plan leads. Your own verses fill whatever room is left in your daily pace." },
  { id: 'individual', label: 'My verses first', description: "Your own queue leads. This plan fills whatever room is left in your daily pace." },
  { id: 'additive', label: 'Both, side by side', description: "This plan pulls its full pace on top of your own — deliberately over your daily limits." },
];

// What a brand-new member gets. Previously the Join button hardcoded
// 'individual', which meant the plan only ever got leftover capacity -- so
// anyone with a full personal queue joined a group plan and saw nothing
// happen at all.
const DEFAULT_JOIN_PRIORITY: GroupPlanMembership['priority'] = 'group';

interface VerseIdGroup {
  key: string;
  book: string;
  chapter: number;
  verses: number[];
}

// Groups a GroupPlan's flat verseId list ("ROM_8_1") into consecutive
// book/chapter runs for display -- same array-adjacency grouping convention
// as groupQueueItems (ActivePlanScreen/HomeScreen), just working off plain
// verseId strings instead of full QueueItem objects, since a plan's queue
// is a manager-curated string list, not the viewer's own queue items.
function groupVerseIds(verseIds: string[]): VerseIdGroup[] {
  const groups: VerseIdGroup[] = [];
  verseIds.forEach((id) => {
    const [bookId, chapterStr, verseStr] = id.split('_');
    const book = ALL_BIBLE_BOOKS.find((b) => b.id === bookId)?.name || bookId;
    const chapter = parseInt(chapterStr, 10);
    const verse = parseInt(verseStr, 10);
    const last = groups[groups.length - 1];
    if (last && last.book === book && last.chapter === chapter && verse === last.verses[last.verses.length - 1] + 1) {
      last.verses.push(verse);
    } else {
      groups.push({ key: id, book, chapter, verses: [verse] });
    }
  });
  return groups;
}

export default function GroupPlanDetailScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const {
    user,
    viewingGroupPlan,
    handleBack,
    updateGroupPlan,
    addVersesToGroupPlan,
    joinedGroupPlanMemberships,
    joinGroupPlan,
    leaveGroupPlan,
    setGroupPlanPriority,
    triggerToast,
  } = state;

  const [isEditing, setIsEditing] = useState(false);
  const [showAddVerses, setShowAddVerses] = useState(false);
  const [addBook, setAddBook] = useState('Romans');
  const [addChapter, setAddChapter] = useState('1');
  const [addStartVerse, setAddStartVerse] = useState('1');
  const [addEndVerse, setAddEndVerse] = useState('1');
  const [joinPriority, setJoinPriority] = useState<GroupPlanMembership['priority']>(DEFAULT_JOIN_PRIORITY);

  if (!viewingGroupPlan) return null;
  const plan = viewingGroupPlan;

  const isManager = !!user && plan.managerId === user.uid;
  const membership = joinedGroupPlanMemberships.find((m) => m.planId === plan.planId);

  const versesPerWeekField = useClampedNumberField(
    plan.versesPerWeek,
    (n) => updateGroupPlan(plan.circleId, plan.planId, { versesPerWeek: n }),
    (n) => Math.max(1, Math.min(20, n))
  );

  // Real verse count for the "max N" hint next to End Verse.
  const addChapterId = getBookByName(addBook)?.id || null;
  const addChapterNum = parseInt(addChapter, 10);
  const { data: addChapterData } = useChapterText(
    DEFAULT_TRANSLATION_ID,
    addChapterId,
    Number.isNaN(addChapterNum) ? null : addChapterNum
  );

  const handleAddVerses = async () => {
    const chapter = parseInt(addChapter, 10);
    const startVerse = parseInt(addStartVerse, 10);
    const endVerse = parseInt(addEndVerse, 10);
    if (!addBook || Number.isNaN(chapter) || Number.isNaN(startVerse) || Number.isNaN(endVerse)) {
      triggerToast('Please fill in book, chapter, and a verse range. 📖');
      return;
    }
    await addVersesToGroupPlan(plan.circleId, plan.planId, addBook, chapter, startVerse, endVerse);
    setShowAddVerses(false);
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-hairline pb-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface" />
          <View className="flex-1">
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-ink-3 font-sans">GROUP PLAN</AppText>
            <AppText variant="title" className="font-serif font-bold text-ink" numberOfLines={1}>
              {plan.name}
            </AppText>
          </View>
          {isManager && (
            <Pressable
              onPress={() => setIsEditing(!isEditing)}
              className={`px-2.5 py-1.5 rounded-lg border ${isEditing ? 'bg-accent border-accent' : 'bg-surface border-line-strong'}`}
            >
              <AppText variant="caption" className={`font-sans font-bold ${isEditing ? 'text-on-accent' : 'text-ink-2'}`}>
                {isEditing ? 'Done' : 'Edit'}
              </AppText>
            </Pressable>
          )}
        </View>

        {/* TITLE / DESCRIPTION */}
        <View className="bg-surface border border-line rounded-xl p-4" style={{ gap: 10 }}>
          {isEditing ? (
            <>
              <View>
                <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3 mb-1">Plan Title</AppText>
                <AppTextInput defaultValue={plan.name} onEndEditing={(e) => { const val = e.nativeEvent.text.trim(); if (val && val !== plan.name) updateGroupPlan(plan.circleId, plan.planId, { name: val }); }} className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl font-bold text-ink" />
              </View>
              <View>
                <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3 mb-1">Description</AppText>
                <AppTextInput defaultValue={plan.description} onEndEditing={(e) => { const val = e.nativeEvent.text.trim(); if (val !== plan.description) updateGroupPlan(plan.circleId, plan.planId, { description: val }); }} multiline numberOfLines={2} textAlignVertical="top" className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-ink-2 font-sans" />
              </View>
            </>
          ) : (
            <>
              <AppText variant="label" className="text-ink-2 leading-relaxed font-sans">
                {plan.description || 'No description yet.'}
              </AppText>
              <AppText variant="micro" className="font-sans text-ink-3">
                Managed by <AppText variant="inherit" className="font-semibold text-ink">{plan.managerName || 'Leader'}</AppText>
              </AppText>
            </>
          )}
        </View>

        {/* PACE */}
        <View className="bg-surface border border-line rounded-xl p-4" style={{ gap: 10 }}>
          <View className="flex-row items-center">
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Pace</AppText>
            <HelpTooltip text="How many new verses per week this plan feeds joined members. Each member's own daily capacity and priority setting decide how that pace actually blends with their individual queue." />
          </View>
          {isManager ? (
            <View style={{ gap: 6 }}>
              <StepperRow
                value={plan.versesPerWeek}
                min={1}
                max={20}
                onChange={(n) => updateGroupPlan(plan.circleId, plan.planId, { versesPerWeek: n })}
              />
              <AppText variant="caption" className="font-sans font-bold text-ink-2">{plan.versesPerWeek} verses / week</AppText>
            </View>
          ) : (
            <AppText variant="body" className="font-serif font-bold text-ink">{plan.versesPerWeek} verses / week</AppText>
          )}
        </View>

        {/* VERSE QUEUE */}
        <View className="bg-surface border border-line rounded-xl p-4" style={{ gap: 10 }}>
          <View className="flex-row justify-between items-center">
            <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">
              Verse Queue ({plan.verseIds.length})
            </AppText>
            {isManager && (
              <AppButton size="sm" onPress={() => setShowAddVerses(!showAddVerses)} className="bg-accent-soft border border-accent/30 rounded-lg flex-row items-center gap-1">
                <Plus size={10} color={palette.accent} />
                <AppText variant="micro" className="font-bold text-accent">{showAddVerses ? 'Hide' : 'Add Verses'}</AppText>
              </AppButton>
            )}
          </View>

          {plan.verseIds.length === 0 && (
            <AppText variant="label" className="text-ink-3 font-sans">
              No verses yet. {isManager && 'Add a small range to get started — a few verses at a time, not a whole book.'}
            </AppText>
          )}

          {showAddVerses && isManager && (
            <FadeInView>
              <View className="bg-surface-2 border border-line rounded-xl p-3" style={{ gap: 8 }}>
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <AppText variant="micro" className="font-bold text-ink-3 uppercase tracking-widest mb-0.5">Book</AppText>
                    <BookPicker value={addBook} onChange={setAddBook} />
                  </View>
                  <View style={{ width: 70 }}>
                    <AppText variant="micro" className="font-bold text-ink-3 uppercase tracking-widest mb-0.5">Chapter</AppText>
                    <NumericInput
                      value={addChapter}
                      onChangeText={setAddChapter}
                      className="w-full bg-surface border border-line-strong rounded-lg px-2 py-2.5 text-xs text-center"
                    />
                  </View>
                </View>
                <View className="flex-row gap-2 items-end">
                  <View className="flex-1">
                    <AppText variant="micro" className="font-bold text-ink-3 uppercase tracking-widest mb-0.5">Start Verse</AppText>
                    <NumericInput
                      value={addStartVerse}
                      onChangeText={setAddStartVerse}
                      className="w-full bg-surface border border-line-strong rounded-lg px-2 py-1.5 text-xs text-center"
                    />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between mb-0.5">
                      <AppText variant="micro" className="font-bold text-ink-3 uppercase tracking-widest">End Verse</AppText>
                      {addChapterData && (
                        <AppText variant="micro" className="font-mono text-ink-3">max {addChapterData.verseCount}</AppText>
                      )}
                    </View>
                    <NumericInput
                      value={addEndVerse}
                      onChangeText={setAddEndVerse}
                      className="w-full bg-surface border border-line-strong rounded-lg px-2 py-1.5 text-xs text-center"
                    />
                  </View>
                  <Pressable onPress={handleAddVerses} className="bg-accent px-3 py-1.5 rounded-lg">
                    <AppText variant="caption" className="text-on-accent font-bold uppercase">Add</AppText>
                  </Pressable>
                </View>
              </View>
            </FadeInView>
          )}

          {plan.verseIds.length > 0 && (
            <View style={{ gap: 6 }}>
              {groupVerseIds(plan.verseIds).map((g) => (
                <View
                  key={g.key}
                  className="flex-row items-center justify-between px-3 py-2 bg-surface-2 border border-line rounded-lg"
                >
                  <AppText variant="label" className="font-serif font-black text-ink">
                    {g.book} {g.chapter}:{g.verses.length > 1 ? `${g.verses[0]}-${g.verses[g.verses.length - 1]}` : g.verses[0]}
                  </AppText>
                  {g.verses.length > 1 && (
                    <AppText variant="micro" className="px-1.5 py-0.5 rounded-full font-sans font-bold bg-surface-2 text-ink-2 border border-line">
                      {g.verses.length} verses
                    </AppText>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* JOIN / MEMBERSHIP */}
        <View className="bg-surface border border-line rounded-xl p-4" style={{ gap: 10 }}>
          {membership ? (
            <>
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">Verse Priority</AppText>
              <View style={{ gap: 6 }}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const active = opt.id === membership.priority;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => setGroupPlanPriority(plan.planId, opt.id)}
                      className={`px-3 py-2.5 rounded-xl border-2 ${active ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                      style={{ gap: 2 }}
                    >
                      <AppText variant="caption" className={`font-sans font-bold ${active ? 'text-ink' : 'text-ink-2'}`}>
                        {opt.label}
                      </AppText>
                      <AppText variant="micro" className="text-ink-3 font-sans leading-tight">{opt.description}</AppText>
                    </Pressable>
                  );
                })}
              </View>
              <AppButton size="md" onPress={() => leaveGroupPlan(plan.planId)} className="w-full mt-1 bg-danger-soft border border-danger/30 rounded-xl items-center">
                <AppText variant="caption" className="text-danger font-sans font-bold ">Leave Plan</AppText>
              </AppButton>
            </>
          ) : (
            <>
              {/* The priority choice is made HERE, at join, rather than being
                  hardcoded and only changeable afterwards on a screen most
                  members never come back to. */}
              <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3">
                How should these verses fit in?
              </AppText>
              <View style={{ gap: 6 }}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const active = opt.id === joinPriority;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => setJoinPriority(opt.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      aria-checked={active}
                      className={`px-3 py-2.5 rounded-xl border-2 ${active ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                      style={{ gap: 2 }}
                    >
                      <AppText variant="caption" className={`font-sans font-bold ${active ? 'text-ink' : 'text-ink-2'}`}>
                        {opt.label}
                      </AppText>
                      <AppText variant="micro" className="text-ink-3 font-sans leading-tight">{opt.description}</AppText>
                    </Pressable>
                  );
                })}
              </View>
              <AppText variant="micro" className="text-ink-3 font-sans leading-tight">
                You can change this any time. It decides which verses win when there isn't room for everything.
              </AppText>
              <AppButton size="md" onPress={() => joinGroupPlan(plan, joinPriority)} className="w-full bg-accent rounded-xl items-center">
                <AppText variant="label" className="text-on-accent font-sans font-bold ">Join Plan</AppText>
              </AppButton>
            </>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}

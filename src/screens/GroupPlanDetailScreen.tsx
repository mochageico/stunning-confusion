import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Plus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, NumericInput, StepperRow, HelpTooltip, useClampedNumberField } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { ALL_BIBLE_BOOKS, DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { useChapterText } from '../state/useScripture';
import { GroupPlanMembership } from '../types';

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
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View className="flex-1">
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">GROUP PLAN</Text>
            <Text className="text-base font-serif font-bold text-[#1A1A1A]" numberOfLines={1}>
              {plan.name}
            </Text>
          </View>
          {isManager && (
            <Pressable
              onPress={() => setIsEditing(!isEditing)}
              className={`px-2.5 py-1.5 rounded-lg border ${isEditing ? 'bg-neutral-900 border-neutral-900' : 'bg-white border-neutral-300'}`}
            >
              <Text className={`text-[10px] font-sans font-bold ${isEditing ? 'text-white' : 'text-neutral-700'}`}>
                {isEditing ? 'Done' : 'Edit'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* TITLE / DESCRIPTION */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          {isEditing ? (
            <>
              <View>
                <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Plan Title</Text>
                <TextInput
                  defaultValue={plan.name}
                  onEndEditing={(e) => {
                    const val = e.nativeEvent.text.trim();
                    if (val && val !== plan.name) updateGroupPlan(plan.circleId, plan.planId, { name: val });
                  }}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-800"
                />
              </View>
              <View>
                <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Description</Text>
                <TextInput
                  defaultValue={plan.description}
                  onEndEditing={(e) => {
                    const val = e.nativeEvent.text.trim();
                    if (val !== plan.description) updateGroupPlan(plan.circleId, plan.planId, { description: val });
                  }}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs text-neutral-700 font-sans"
                />
              </View>
            </>
          ) : (
            <>
              <Text className="text-xs text-neutral-700 leading-relaxed font-sans">
                {plan.description || 'No description yet.'}
              </Text>
              <Text className="text-[9px] font-sans text-neutral-400">
                Managed by <Text className="font-semibold text-[#1A1A1A]">{plan.managerName || 'Leader'}</Text>
              </Text>
            </>
          )}
        </View>

        {/* PACE */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          <View className="flex-row items-center">
            <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">Pace</Text>
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
              <Text className="text-[10px] font-sans font-bold text-neutral-600">{plan.versesPerWeek} verses / week</Text>
            </View>
          ) : (
            <Text className="text-sm font-serif font-bold text-neutral-800">{plan.versesPerWeek} verses / week</Text>
          )}
        </View>

        {/* VERSE QUEUE */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          <View className="flex-row justify-between items-center">
            <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">
              Verse Queue ({plan.verseIds.length})
            </Text>
            {isManager && (
              <Pressable
                onPress={() => setShowAddVerses(!showAddVerses)}
                className="bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg flex-row items-center gap-1"
              >
                <Plus size={10} color="#4338ca" />
                <Text className="text-[9px] font-bold text-indigo-600">{showAddVerses ? 'Hide' : 'Add Verses'}</Text>
              </Pressable>
            )}
          </View>

          {plan.verseIds.length === 0 && (
            <Text className="text-xs text-neutral-400 font-sans">
              No verses yet. {isManager && 'Add a small range to get started — a few verses at a time, not a whole book.'}
            </Text>
          )}

          {showAddVerses && isManager && (
            <FadeInView>
              <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-3" style={{ gap: 8 }}>
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Book</Text>
                    <BookPicker value={addBook} onChange={setAddBook} />
                  </View>
                  <View style={{ width: 70 }}>
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Chapter</Text>
                    <NumericInput
                      value={addChapter}
                      onChangeText={setAddChapter}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-2.5 text-xs text-center"
                    />
                  </View>
                </View>
                <View className="flex-row gap-2 items-end">
                  <View className="flex-1">
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Start Verse</Text>
                    <NumericInput
                      value={addStartVerse}
                      onChangeText={setAddStartVerse}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-center"
                    />
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center justify-between mb-0.5">
                      <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest">End Verse</Text>
                      {addChapterData && (
                        <Text className="text-[8px] font-mono text-neutral-400">max {addChapterData.verseCount}</Text>
                      )}
                    </View>
                    <NumericInput
                      value={addEndVerse}
                      onChangeText={setAddEndVerse}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-center"
                    />
                  </View>
                  <Pressable onPress={handleAddVerses} className="bg-[#1A1A1A] px-3 py-1.5 rounded-lg">
                    <Text className="text-white text-[10px] font-bold uppercase">Add</Text>
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
                  className="flex-row items-center justify-between px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg"
                >
                  <Text className="text-xs font-serif font-black text-[#1A1A1A]">
                    {g.book} {g.chapter}:{g.verses.length > 1 ? `${g.verses[0]}-${g.verses[g.verses.length - 1]}` : g.verses[0]}
                  </Text>
                  {g.verses.length > 1 && (
                    <Text className="text-[8px] px-1.5 py-0.5 rounded-full font-sans font-bold bg-neutral-100 text-neutral-600 border border-neutral-200">
                      {g.verses.length} verses
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* JOIN / MEMBERSHIP */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          {membership ? (
            <>
              <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">Verse Priority</Text>
              <View style={{ gap: 6 }}>
                {PRIORITY_OPTIONS.map((opt) => {
                  const active = opt.id === membership.priority;
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => setGroupPlanPriority(plan.planId, opt.id)}
                      className={`px-3 py-2.5 rounded-xl border-2 ${active ? 'border-[#1A1A1A] bg-[#FBF9F6]' : 'border-neutral-200 bg-white'}`}
                      style={{ gap: 2 }}
                    >
                      <Text className={`text-[11px] font-sans font-bold ${active ? 'text-[#1A1A1A]' : 'text-neutral-700'}`}>
                        {opt.label}
                      </Text>
                      <Text className="text-[9px] text-neutral-500 font-sans leading-tight">{opt.description}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={() => leaveGroupPlan(plan.planId)}
                className="w-full py-2 mt-1 bg-red-50 border border-red-200 rounded-xl items-center"
              >
                <Text className="text-red-600 font-sans font-bold text-[11px]">Leave Plan</Text>
              </Pressable>
            </>
          ) : (
            <>
              {/* The priority choice is made HERE, at join, rather than being
                  hardcoded and only changeable afterwards on a screen most
                  members never come back to. */}
              <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">
                How should these verses fit in?
              </Text>
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
                      className={`px-3 py-2.5 rounded-xl border-2 ${active ? 'border-[#1A1A1A] bg-[#FBF9F6]' : 'border-neutral-200 bg-white'}`}
                      style={{ gap: 2 }}
                    >
                      <Text className={`text-[11px] font-sans font-bold ${active ? 'text-[#1A1A1A]' : 'text-neutral-700'}`}>
                        {opt.label}
                      </Text>
                      <Text className="text-[9px] text-neutral-500 font-sans leading-tight">{opt.description}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className="text-[9px] text-neutral-500 font-sans leading-tight">
                You can change this any time. It decides which verses win when there isn't room for everything.
              </Text>
              <Pressable
                onPress={() => joinGroupPlan(plan, joinPriority)}
                className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center"
              >
                <Text className="text-white font-sans font-bold text-xs">Join Plan</Text>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}

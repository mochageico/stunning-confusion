import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Plus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, StepperRow, ChipRow, HelpTooltip, useClampedNumberField } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { StudyPlanMembership } from '../types';

const PRIORITY_OPTIONS: { id: StudyPlanMembership['priority']; label: string }[] = [
  { id: 'individual', label: 'Individual First' },
  { id: 'group', label: 'Plan First' },
  { id: 'additive', label: 'Additive' },
];

export default function StudyPlanDetailScreen({ state }: { state: AppState }) {
  const {
    user,
    viewingStudyPlan,
    handleBack,
    updateStudyPlan,
    addVersesToStudyPlan,
    joinedStudyPlanMemberships,
    joinStudyPlan,
    leaveStudyPlan,
    setStudyPlanPriority,
    triggerToast,
  } = state;

  const [isEditing, setIsEditing] = useState(false);
  const [showAddVerses, setShowAddVerses] = useState(false);
  const [addBook, setAddBook] = useState('Romans');
  const [addChapter, setAddChapter] = useState('1');
  const [addStartVerse, setAddStartVerse] = useState('1');
  const [addEndVerse, setAddEndVerse] = useState('1');

  if (!viewingStudyPlan) return null;
  const plan = viewingStudyPlan;

  const isManager = !!user && plan.managerId === user.uid;
  const membership = joinedStudyPlanMemberships.find((m) => m.planId === plan.planId);

  const versesPerWeekField = useClampedNumberField(
    plan.versesPerWeek,
    (n) => updateStudyPlan(plan.circleId, plan.planId, { versesPerWeek: n }),
    (n) => Math.max(1, Math.min(20, n))
  );

  const handleAddVerses = async () => {
    const chapter = parseInt(addChapter, 10);
    const startVerse = parseInt(addStartVerse, 10);
    const endVerse = parseInt(addEndVerse, 10);
    if (!addBook || Number.isNaN(chapter) || Number.isNaN(startVerse) || Number.isNaN(endVerse)) {
      triggerToast('Please fill in book, chapter, and a verse range. 📖');
      return;
    }
    await addVersesToStudyPlan(plan.circleId, plan.planId, addBook, chapter, startVerse, endVerse);
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
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">STUDY PLAN</Text>
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
                    if (val && val !== plan.name) updateStudyPlan(plan.circleId, plan.planId, { name: val });
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
                    if (val !== plan.description) updateStudyPlan(plan.circleId, plan.planId, { description: val });
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
                onChange={(n) => updateStudyPlan(plan.circleId, plan.planId, { versesPerWeek: n })}
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
              No verses yet. {isManager && 'Add a small range to get started -- a few verses at a time, not a whole book.'}
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
                    <TextInput
                      value={addChapter}
                      onChangeText={setAddChapter}
                      keyboardType="numeric"
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-2.5 text-xs text-center"
                    />
                  </View>
                </View>
                <View className="flex-row gap-2 items-end">
                  <View className="flex-1">
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Start Verse</Text>
                    <TextInput
                      value={addStartVerse}
                      onChangeText={setAddStartVerse}
                      keyboardType="numeric"
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-center"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">End Verse</Text>
                    <TextInput
                      value={addEndVerse}
                      onChangeText={setAddEndVerse}
                      keyboardType="numeric"
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
        </View>

        {/* JOIN / MEMBERSHIP */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 10 }}>
          {membership ? (
            <>
              <View className="flex-row justify-between items-center">
                <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400">Your Priority</Text>
                <HelpTooltip text="Individual First: your own queue is pulled before this plan's verses. Plan First: this plan's verses are pulled before your own queue, but still within your daily capacity. Additive: this plan's full weekly pace is added on top of your daily capacity, on purpose exceeding it." />
              </View>
              <ChipRow options={PRIORITY_OPTIONS} value={membership.priority} onChange={(p) => setStudyPlanPriority(plan.planId, p)} />
              <Pressable
                onPress={() => leaveStudyPlan(plan.planId)}
                className="w-full py-2 mt-1 bg-red-50 border border-red-200 rounded-xl items-center"
              >
                <Text className="text-red-600 font-sans font-bold text-[11px]">Leave Plan</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              onPress={() => joinStudyPlan(plan, 'individual')}
              className="w-full py-2.5 bg-[#1A1A1A] rounded-xl items-center"
            >
              <Text className="text-white font-sans font-bold text-xs">Join Plan</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, ChevronRight, Plus, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, PulseView } from '../components/ui';
import { AppText } from '../components/design';

export default function SavedPlansScreen({ state }: { state: AppState }) {
  const { handleBack, handleCreateNewPlan, handleActivatePlan, handleDeletePlan, handleEditPlan, savedPlans } = state;

  // Alert.alert is a no-op on React Native Web, so deletion confirmation is
  // a plain in-app panel (like Home's "Reset Reviews" confirm) instead --
  // works identically on native and web. Keyed by plan id so only the
  // card being deleted shows its confirm panel.
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-white"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: 20 }}
      >
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white shrink-0"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          {/* flex-1, not intrinsic width: "Saved Memory Rhythms" at display
              size is wider than the screen minus the back button, and text in
              RN doesn't wrap unless its container is allowed to bound it. */}
          <View className="flex-1">
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-neutral-600 font-sans">
              Retention Settings
            </AppText>
            <AppText variant="display" className="font-serif font-bold text-[#1A1A1A] mt-0.5">
              Saved Memory Rhythms
            </AppText>
            <AppText variant="caption" className="text-neutral-600 font-sans mt-1">
              Tap one to make it active, or Edit to change how it works.
            </AppText>
          </View>
        </View>

        {/* Create New Plan Button */}
        <Pressable
          onPress={handleCreateNewPlan}
          className="border-2 border-dashed border-neutral-300 rounded-2xl p-5 items-center justify-center gap-2"
        >
          <View className="w-8 h-8 rounded-full bg-neutral-100 items-center justify-center">
            <Plus size={16} color="#737373" />
          </View>
          <AppText variant="label" className="font-sans font-extrabold text-neutral-800">
            Create New Rhythm
          </AppText>
          <AppText variant="caption" className="text-neutral-600 font-sans text-center">
            Set how long a verse stays in each phase, and what happens when you miss one
          </AppText>
        </Pressable>

        {/* List of Saved Plans */}
        <View className="gap-3">
          <AppText variant="section" className="font-bold text-neutral-600 tracking-wider font-sans uppercase">
            MY RHYTHMS ({savedPlans.length})
          </AppText>

          <View className="gap-3">
            {savedPlans.map((plan) => (
              <Pressable
                key={plan.id}
                onPress={() => handleActivatePlan(plan.id)}
                className={`border rounded-2xl p-4 bg-white shadow-xs relative flex flex-col justify-between gap-3 ${
                  plan.isActive ? 'border-2 border-[#1A1A1A]' : 'border-neutral-200'
                }`}
              >
                <View className="flex-row items-start justify-between">
                  <View className="gap-1">
                    <View className="flex-row items-center gap-1.5">
                      {plan.isActive && (
                        <PulseView>
                          <View className="w-2 h-2 bg-emerald-500 rounded-full" />
                        </PulseView>
                      )}
                      <AppText variant="label" className="font-sans font-extrabold text-neutral-900 leading-tight">
                        {plan.name}
                      </AppText>
                    </View>
                    {/* Retention, not pacing. Every plan used to be labelled
                        by its learning days and verses-per-day, which is
                        precisely what no longer varies between plans -- and
                        was why three visibly different "plans" all behaved
                        identically once you started using them. */}
                    <AppText variant="caption" className="font-sans text-neutral-500">
                      {plan.dailyPhaseWeeks}-{plan.weeklyPhaseMonths}-{plan.monthlyPhaseYears} · {plan.masteryTouches} touches
                      {plan.isBuiltIn ? ' · built-in' : ''}
                    </AppText>
                  </View>

                  <View className="flex-row items-center gap-3">
                    {plan.isActive ? (
                      <View className="bg-emerald-500/10 px-2 py-0.5 rounded-full flex-row items-center gap-1 border border-emerald-500/20">
                        <AppText variant="micro" className="font-sans font-bold text-emerald-700 uppercase tracking-wider">
                          Active
                        </AppText>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => handleEditPlan(plan)}
                        className="flex-row items-center gap-0.5"
                      >
                        <AppText variant="micro" className="font-sans font-extrabold text-neutral-400">Edit</AppText>
                        <ChevronRight size={10} color="#a3a3a3" />
                      </Pressable>
                    )}
                    {savedPlans.length > 1 && (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setDeletingPlanId(plan.id);
                        }}
                        className="w-6 h-6 rounded-full items-center justify-center"
                        hitSlop={8}
                      >
                        <Trash2 size={13} color="#d4d4d4" />
                      </Pressable>
                    )}
                  </View>
                </View>

                {plan.isActive && (
                  <View className="flex-row justify-end pt-2 border-t border-dashed border-neutral-100">
                    <Pressable
                      onPress={() => handleEditPlan(plan)}
                      className="flex-row items-center gap-0.5"
                    >
                      <AppText variant="micro" className="font-sans font-extrabold text-neutral-500">Edit Settings</AppText>
                      <ChevronRight size={10} color="#737373" />
                    </Pressable>
                  </View>
                )}

                {deletingPlanId === plan.id && (
                  <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
                    <AppText variant="caption" className="font-sans font-bold text-red-800">Delete "{plan.name}"?</AppText>
                    <AppText variant="micro" className="font-sans text-red-700/80 leading-relaxed">
                      This permanently removes this plan. It can't be undone.
                    </AppText>
                    <View className="flex-row gap-2 justify-end pt-1">
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setDeletingPlanId(null);
                        }}
                        className="px-3 py-1.5 border border-neutral-300 rounded-lg bg-white"
                      >
                        <AppText variant="caption" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                      </Pressable>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleDeletePlan(plan.id);
                          setDeletingPlanId(null);
                        }}
                        className="px-3 py-1.5 bg-red-600 rounded-lg"
                      >
                        <AppText variant="caption" className="text-white font-sans font-bold ">Yes, Delete</AppText>
                      </Pressable>
                    </View>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

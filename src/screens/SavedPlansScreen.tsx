import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, ChevronRight, Plus, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, PulseView } from '../components/ui';

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
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              Pacing Configurations
            </Text>
            <Text className="text-lg font-serif font-bold text-[#1A1A1A] mt-0.5">
              Saved Plans
            </Text>
            <Text className="text-[10px] text-neutral-400 leading-none mt-1">
              Select a plan to activate or edit.
            </Text>
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
          <Text className="text-xs font-sans font-extrabold text-neutral-800">
            Create New Plan
          </Text>
          <Text className="text-[10px] text-neutral-400 text-center">
            Configure custom pacing, learn days, and review caps
          </Text>
        </Pressable>

        {/* List of Saved Plans */}
        <View className="gap-3">
          <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
            MY PLANS ({savedPlans.length})
          </Text>

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
                      <Text className="text-xs font-sans font-extrabold text-neutral-900 leading-tight">
                        {plan.name}
                      </Text>
                    </View>
                    <Text className="text-[10px] font-sans text-neutral-400">
                      {plan.learningDays.length} learning days · {plan.newVersesPace} v/day
                    </Text>
                  </View>

                  <View className="flex-row items-center gap-3">
                    {plan.isActive ? (
                      <View className="bg-emerald-500/10 px-2 py-0.5 rounded-full flex-row items-center gap-1 border border-emerald-500/20">
                        <Text className="text-[8px] font-sans font-bold text-emerald-700 uppercase tracking-wider">
                          Active
                        </Text>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => handleEditPlan(plan)}
                        className="flex-row items-center gap-0.5"
                      >
                        <Text className="text-[9px] font-sans font-extrabold text-neutral-400">Edit</Text>
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
                      <Text className="text-[9px] font-sans font-extrabold text-neutral-500">Edit Settings</Text>
                      <ChevronRight size={10} color="#737373" />
                    </Pressable>
                  </View>
                )}

                {deletingPlanId === plan.id && (
                  <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
                    <Text className="text-[11px] font-sans font-bold text-red-800">Delete "{plan.name}"?</Text>
                    <Text className="text-[9px] font-sans text-red-700/80 leading-relaxed">
                      This permanently removes this plan. It can't be undone.
                    </Text>
                    <View className="flex-row gap-2 justify-end pt-1">
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setDeletingPlanId(null);
                        }}
                        className="px-3 py-1.5 border border-neutral-300 rounded-lg bg-white"
                      >
                        <Text className="text-neutral-600 font-sans font-bold text-[10px]">Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleDeletePlan(plan.id);
                          setDeletingPlanId(null);
                        }}
                        className="px-3 py-1.5 bg-red-600 rounded-lg"
                      >
                        <Text className="text-white font-sans font-bold text-[10px]">Yes, Delete</Text>
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

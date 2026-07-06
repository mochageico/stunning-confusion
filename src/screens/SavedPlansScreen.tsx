import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, PulseView } from '../components/ui';

export default function SavedPlansScreen({ state }: { state: AppState }) {
  const { handleBack, handleCreateNewPlan, handleActivatePlan, handleEditPlan, savedPlans } = state;

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
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

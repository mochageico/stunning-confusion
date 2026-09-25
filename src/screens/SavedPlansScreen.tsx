import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, ChevronRight, Plus, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, PulseView } from '../components/ui';
import { AppIconButton, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
export default function SavedPlansScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const { handleBack, handleCreateNewPlan, handleActivatePlan, handleDeletePlan, handleEditPlan, savedPlans } = state;

  // Alert.alert is a no-op on React Native Web, so deletion confirmation is
  // a plain in-app panel (like Home's "Reset Reviews" confirm) instead --
  // works identically on native and web. Keyed by plan id so only the
  // card being deleted shows its confirm panel.
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: 20 }}
      >
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface shrink-0" />
          {/* flex-1, not intrinsic width: a display-size title is wider than
              the screen minus the back button, and text in RN doesn't wrap
              unless its container is allowed to bound it. */}
          <View className="flex-1">
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-ink-2 font-sans">
              How deeply verses stick
            </AppText>
            <AppText variant="display" className="font-serif font-bold text-ink mt-0.5">
              Review Settings
            </AppText>
            <AppText variant="caption" className="text-ink-2 font-sans mt-1">
              How long a verse keeps coming back before it's yours for good. Tap one to use it, or Edit to change it.
            </AppText>
          </View>
        </View>

        {/* Create New Plan Button */}
        <Pressable
          onPress={handleCreateNewPlan}
          className="border-2 border-dashed border-line-strong rounded-2xl p-5 items-center justify-center gap-2"
        >
          <View className="w-8 h-8 rounded-full bg-surface-2 items-center justify-center">
            <Plus size={16} color={palette.ink3} />
          </View>
          <AppText variant="label" className="font-sans font-extrabold text-ink">
            Create New Settings
          </AppText>
          <AppText variant="caption" className="text-ink-2 font-sans text-center">
            Set how long a verse keeps coming back, and what happens when you miss one
          </AppText>
        </Pressable>

        {/* List of Saved Plans */}
        <View className="gap-3">
          <AppText variant="section" className="font-bold text-ink-2 tracking-wider font-sans uppercase">
            SAVED ({savedPlans.length})
          </AppText>

          <View className="gap-3">
            {savedPlans.map((plan) => (
              <Pressable
                key={plan.id}
                onPress={() => handleActivatePlan(plan.id)}
                className={`border rounded-2xl p-4 bg-surface shadow-xs relative flex flex-col justify-between gap-3 ${
                  plan.isActive ? 'border-2 border-ink' : 'border-line'
                }`}
              >
                <View className="flex-row items-start justify-between">
                  <View className="gap-1">
                    <View className="flex-row items-center gap-1.5">
                      {plan.isActive && (
                        <PulseView>
                          <View className="w-2 h-2 bg-success rounded-full" />
                        </PulseView>
                      )}
                      <AppText variant="label" className="font-sans font-extrabold text-ink leading-tight">
                        {plan.name}
                      </AppText>
                    </View>
                    {/* Retention, not pacing. Every preset used to be
                        labelled by its learning days and verses-per-day,
                        which is precisely what no longer varies between them
                        -- and was why three visibly different "plans" all
                        behaved identically once you started using them.
                        Spelled out in words rather than "7-6-5 · 3 touches",
                        which meant nothing without already knowing the
                        engine. */}
                    <AppText variant="caption" className="font-sans text-ink-3">
                      Daily for {plan.dailyPhaseWeeks} weeks, weekly for {plan.weeklyPhaseMonths} months, monthly for{' '}
                      {plan.monthlyPhaseYears} {plan.monthlyPhaseYears === 1 ? 'year' : 'years'}
                      {plan.isBuiltIn ? ' · built-in' : ''}
                    </AppText>
                  </View>

                  <View className="flex-row items-center gap-3">
                    {plan.isActive ? (
                      <View className="bg-success/10 px-2 py-0.5 rounded-full flex-row items-center gap-1 border border-success/20">
                        <AppText variant="micro" className="font-sans font-bold text-success uppercase tracking-wider">
                          Active
                        </AppText>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => handleEditPlan(plan)}
                        className="flex-row items-center gap-0.5"
                      >
                        <AppText variant="micro" className="font-sans font-extrabold text-ink-3">Edit</AppText>
                        <ChevronRight size={10} color={palette.ink3} />
                      </Pressable>
                    )}
                    {savedPlans.length > 1 && (
                      <AppIconButton Icon={Trash2} diameter={24} iconSize={13} iconColor={palette.lineStrong} onPress={(e) => { e.stopPropagation(); setDeletingPlanId(plan.id); }} className="rounded-full" hitSlop={8} />
                    )}
                  </View>
                </View>

                {plan.isActive && (
                  <View className="flex-row justify-end pt-2 border-t border-dashed border-hairline">
                    <Pressable
                      onPress={() => handleEditPlan(plan)}
                      className="flex-row items-center gap-0.5"
                    >
                      <AppText variant="micro" className="font-sans font-extrabold text-ink-3">Edit Settings</AppText>
                      <ChevronRight size={10} color={palette.ink3} />
                    </Pressable>
                  </View>
                )}

                {deletingPlanId === plan.id && (
                  <View className="bg-danger-soft border border-danger/30 rounded-xl p-3" style={{ gap: 8 }}>
                    <AppText variant="caption" className="font-sans font-bold text-danger">Delete "{plan.name}"?</AppText>
                    <AppText variant="micro" className="font-sans text-danger leading-relaxed">
                      This permanently removes this plan. It can't be undone.
                    </AppText>
                    <View className="flex-row gap-2 justify-end pt-1">
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setDeletingPlanId(null);
                        }}
                        className="px-3 py-1.5 border border-line-strong rounded-lg bg-surface"
                      >
                        <AppText variant="caption" className="text-ink-2 font-sans font-bold ">Cancel</AppText>
                      </Pressable>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleDeletePlan(plan.id);
                          setDeletingPlanId(null);
                        }}
                        className="px-3 py-1.5 bg-danger rounded-lg"
                      >
                        <AppText variant="caption" className="text-on-accent font-sans font-bold ">Yes, Delete</AppText>
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

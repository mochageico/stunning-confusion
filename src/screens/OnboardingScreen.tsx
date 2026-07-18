import { Pressable, ScrollView, Text, View } from 'react-native';
import { Check, Lock, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';

export default function OnboardingScreen({ state }: { state: AppState }) {
  const {
    navigateTo,
    selectTab,
    setCommunitySubView,
    dismissOnboarding,
    startOnboardingStep,
    onboardingStepComplete,
  } = state;

  const steps: Array<{ title: string; description: string; buttonLabel: string; onPress: () => void }> = [
    {
      title: 'Your Memory Plan',
      description:
        'You already have a starter plan active — "Example Plan," Mon/Wed/Fri, standard 7-6-5 retention. Tap in to view or customize it.',
      buttonLabel: 'View My Plan',
      onPress: () => navigateTo('planDesigner'),
    },
    {
      title: 'Add Verses to Your Queue',
      description: 'Search the Bible and add a few verses to your memory queue to get started.',
      buttonLabel: 'Browse Scripture',
      onPress: () => navigateTo('books'),
    },
    {
      title: 'Learn a Verse',
      description:
        'From Home, tap "Pull New Verses" to bring today\'s verses into Learning phase, then tap "Learn" to start practicing.',
      buttonLabel: 'Go to Home',
      onPress: () => selectTab('home'),
    },
    {
      title: 'Find a Scripture Circle',
      description: 'Join a circle to memorize scripture alongside others, in your own personalized pace.',
      buttonLabel: 'Find a Circle',
      onPress: () => {
        selectTab('community');
        setCommunitySubView('find');
      },
    },
  ];

  const allComplete = onboardingStepComplete.every(Boolean);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header */}
        <View className="flex-row items-center justify-between border-b border-neutral-100 pb-3">
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">WELCOME</Text>
            <Text className="text-lg font-serif font-black text-[#1A1A1A] leading-none mt-0.5">Getting Started</Text>
          </View>
          <Pressable
            onPress={dismissOnboarding}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <X size={14} color="#262626" />
          </Pressable>
        </View>

        {allComplete ? (
          <View className="border border-emerald-200 bg-emerald-50 rounded-xl p-5 items-center" style={{ gap: 8 }}>
            <Text className="text-2xl">🎉</Text>
            <Text className="text-sm font-serif font-black text-emerald-800">You're all set!</Text>
            <Text className="text-[11px] text-emerald-700 text-center leading-relaxed font-sans">
              You've tried everything in this guide. Come back anytime from Settings.
            </Text>
            <Pressable onPress={dismissOnboarding} className="bg-emerald-600 px-5 py-2.5 rounded-lg mt-1">
              <Text className="text-white font-sans font-bold text-xs uppercase tracking-wider">Done</Text>
            </Pressable>
          </View>
        ) : (
          <Text className="text-xs text-neutral-600 leading-relaxed font-sans">
            Four things to try, one at a time — each unlocks once you've finished the one before it. Every step takes
            you to the real screen; while you're there, look for the "Back to Guide" bar at the bottom to come back
            here.
          </Text>
        )}

        {/* STEPS */}
        <View style={{ gap: 12 }}>
          {steps.map((step, i) => {
            const isComplete = onboardingStepComplete[i];
            const isLocked = i > 0 && !onboardingStepComplete[i - 1];

            return (
              <View
                key={step.title}
                className={`border rounded-xl p-4 ${isLocked ? 'border-neutral-100 bg-neutral-50/60' : 'border-[#E5E5E5] bg-white'}`}
                style={{ gap: 10 }}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-row items-center gap-2 flex-1 pr-2">
                    <View
                      className={`w-6 h-6 rounded-full items-center justify-center border ${
                        isComplete
                          ? 'bg-emerald-600 border-emerald-600'
                          : isLocked
                            ? 'bg-neutral-100 border-neutral-200'
                            : 'bg-neutral-50 border-neutral-300'
                      }`}
                    >
                      {isComplete ? (
                        <Check size={12} color="#FFFFFF" />
                      ) : isLocked ? (
                        <Lock size={10} color="#a3a3a3" />
                      ) : (
                        <Text className="text-[10px] font-black text-neutral-400">{i + 1}</Text>
                      )}
                    </View>
                    <Text className={`text-sm font-serif font-black flex-1 ${isLocked ? 'text-neutral-400' : 'text-[#1A1A1A]'}`}>
                      {step.title}
                    </Text>
                  </View>
                </View>
                <Text className={`text-[11px] leading-relaxed font-sans ${isLocked ? 'text-neutral-400' : 'text-neutral-600'}`}>
                  {isLocked ? `Complete "${steps[i - 1].title}" first to unlock this step.` : step.description}
                </Text>
                {!isLocked && (
                  <Pressable
                    onPress={() => startOnboardingStep(i, step.onPress)}
                    className={`self-start px-3.5 py-2 rounded-lg ${isComplete ? 'bg-white border border-neutral-300' : 'bg-[#1A1A1A]'}`}
                  >
                    <Text
                      className={`font-sans font-bold text-[10px] uppercase tracking-wider ${
                        isComplete ? 'text-neutral-600' : 'text-white'
                      }`}
                    >
                      {isComplete ? 'Review Again' : step.buttonLabel}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <Pressable onPress={dismissOnboarding} className="w-full py-2.5 items-center">
          <Text className="text-neutral-400 font-sans font-bold text-[11px] underline">Skip for now</Text>
        </Pressable>
      </ScrollView>
    </FadeInView>
  );
}

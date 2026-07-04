import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';

const DAY_LABELS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

export default function AnalyzePlanScreen({ state }: { state: AppState }) {
  const { selectedUserProfile, handleBack, adoptPlanFromProfile } = state;

  if (!selectedUserProfile) return null;

  const rows: Array<{ label: string; days: string[]; activeClassName: string }> = [
    { label: 'Learning Days', days: selectedUserProfile.learningDays || [], activeClassName: 'bg-indigo-600 border-transparent' },
    { label: 'Reviewing Days', days: selectedUserProfile.reviewingDays || [], activeClassName: 'bg-emerald-600 border-transparent' },
    { label: 'Priming Days', days: selectedUserProfile.primingDays || [], activeClassName: 'bg-amber-500 border-transparent' },
  ];

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              ANALYZE PLAN
            </Text>
            <Text className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">
              Pacing & Rhythm Details
            </Text>
          </View>
        </View>

        {/* Analysis Header Card */}
        <View className="border border-neutral-200 rounded-2xl p-4 bg-white shadow-xs" style={{ gap: 12 }}>
          <View>
            <Text className="text-[8px] bg-neutral-900 text-white px-2 py-0.5 rounded font-sans font-bold uppercase tracking-wider self-start overflow-hidden">
              {(selectedUserProfile.preset?.toUpperCase() || 'CUSTOM') + ' PRESET'}
            </Text>
          </View>
          <Text className="text-base font-serif font-bold text-neutral-900">
            {selectedUserProfile.planName}
          </Text>
          <Text className="text-xs text-neutral-500 font-sans leading-relaxed">
            Analyze this pacing configuration to see if it aligns with your memorization capacity and lifestyle routine.
          </Text>

          <View className="pt-2">
            <Pressable
              onPress={() => {
                adoptPlanFromProfile({
                  planName: selectedUserProfile.planName,
                  preset: selectedUserProfile.preset,
                  learningDays: selectedUserProfile.learningDays,
                  reviewingDays: selectedUserProfile.reviewingDays,
                  primingDays: selectedUserProfile.primingDays,
                  newVersesPace: selectedUserProfile.newVersesPace,
                  maxReviewCap: selectedUserProfile.maxReviewCap,
                });
              }}
              className="w-full py-2.5 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5 shadow-sm"
            >
              <Text className="text-white text-xs font-bold font-sans">Save & Use This Plan</Text>
            </Pressable>
          </View>
        </View>

        {/* Weekly Schedule Row View */}
        <View className="border border-neutral-200 rounded-2xl p-4 bg-white text-left shadow-xs" style={{ gap: 16 }}>
          <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
            WEEKLY ROUTINE RHYTHMS
          </Text>

          <View style={{ gap: 14 }}>
            {rows.map((row) => (
              <View key={row.label} style={{ gap: 6 }}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs font-sans font-bold text-neutral-800">{row.label}</Text>
                  <Text className="text-[10px] font-mono text-neutral-400 font-bold">
                    {row.days.length} days/week
                  </Text>
                </View>
                <View className="flex-row gap-1.5">
                  {DAY_LABELS.map((d) => {
                    const active = row.days.includes(d);
                    return (
                      <View
                        key={d}
                        className={`w-6 h-6 rounded-full border items-center justify-center ${
                          active ? row.activeClassName : 'border-neutral-200 bg-white'
                        }`}
                      >
                        <Text
                          className={`text-[9px] font-sans font-bold ${active ? 'text-white' : 'text-neutral-300'}`}
                        >
                          {d[0]}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Plan Pacing Metrics */}
        <View className="flex-row gap-3">
          <View className="flex-1 border border-neutral-200 rounded-2xl p-4 bg-white text-left shadow-xs" style={{ gap: 6 }}>
            <Text className="text-[8.5px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              Pacing Pace
            </Text>
            <Text className="text-2xl font-serif font-black text-neutral-900 leading-none">
              {selectedUserProfile.newVersesPace} <Text className="text-xs font-sans font-normal text-neutral-500">v/day</Text>
            </Text>
          </View>

          <View className="flex-1 border border-neutral-200 rounded-2xl p-4 bg-white text-left shadow-xs" style={{ gap: 6 }}>
            <Text className="text-[8.5px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
              Daily Cap
            </Text>
            <Text className="text-2xl font-serif font-black text-neutral-900 leading-none">
              {selectedUserProfile.maxReviewCap} <Text className="text-xs font-sans font-normal text-neutral-500">mins</Text>
            </Text>
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

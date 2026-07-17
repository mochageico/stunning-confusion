import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip } from '../components/ui';

// Streak/memorized-count thresholds for the milestone badges section --
// purely derived from existing counts (memoryStreak/memorizedCount), no
// new persistence needed.
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
const MEMORIZED_MILESTONES = [5, 10, 25, 50, 100, 250, 500];

function formatStudyTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return '0m';
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function DashboardScreen({ state }: { state: AppState }) {
  const { handleBack, memoryQueue, memorizedCount, learningCount, memoryStreak, totalStudySeconds, activityLast90Days } = state;

  const totalReviewsCompleted = memoryQueue.reduce((sum, item) => sum + (item.totalSuccessfulReviews || 0), 0);

  const dailyCount = memoryQueue.filter((item) => item.status === 'reviewing' && item.retentionPhase === 'daily').length;
  const weeklyCount = memoryQueue.filter((item) => item.status === 'reviewing' && item.retentionPhase === 'weekly').length;
  const monthlyCount = memoryQueue.filter((item) => item.status === 'reviewing' && item.retentionPhase === 'monthly').length;

  // "Verses Memorized" means verses learned -- anything that's graduated out
  // of the initial Learning phase into spaced review (any of Daily/Weekly/
  // Monthly) or fully Completed, not just the narrower "Completed" count.
  // memorizedCount itself stays retained-only for the retention breakdown's
  // own Completed box below.
  const versesLearnedCount = dailyCount + weeklyCount + monthlyCount + memorizedCount;

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
          <View>
            <Text className="text-lg font-serif font-black text-[#1A1A1A] leading-none mt-0.5">Progress Dashboard</Text>
          </View>
        </View>

        {/* STAT GRID */}
        <View className="flex-row flex-wrap gap-2.5">
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <Text className="text-xl font-black text-[#1A1A1A] font-mono">{versesLearnedCount}</Text>
            <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide">Verses Memorized</Text>
          </View>
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <Text className="text-xl font-black text-amber-600 font-mono">{learningCount}</Text>
            <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide">Verses In Progress</Text>
          </View>
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <Text className="text-xl font-black text-emerald-600 font-mono">{memoryStreak}</Text>
            <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide">Day Streak</Text>
          </View>
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <Text className="text-xl font-black text-indigo-600 font-mono">{totalReviewsCompleted}</Text>
            <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-wide">Reviews Completed</Text>
          </View>
        </View>

        {/* TIME STUDIED */}
        <View className="bg-[#1A1A1A] rounded-2xl p-5 items-center" style={{ gap: 4 }}>
          <Text className="text-[9px] font-sans font-extrabold uppercase tracking-widest text-neutral-400">Time Studied</Text>
          <Text className="text-3xl font-black text-white font-mono">{formatStudyTime(totalStudySeconds)}</Text>
          <Text className="text-[9px] font-sans text-neutral-500 text-center leading-relaxed">
            Real time spent in practice/listen sessions, tracked live.
          </Text>
        </View>

        {/* RETENTION PHASE BREAKDOWN */}
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">Retention Breakdown</Text>
            <HelpTooltip text="Where your memorized verses sit in the spaced-repetition cycle. Daily/Weekly/Monthly recur on that cadence; Completed verses have graduated out and no longer recur." />
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1 border-l-4 border-l-violet-500 bg-white border border-neutral-200 rounded-lg p-2.5 items-center">
              <Text className="text-base font-black text-violet-600 font-mono">{learningCount}</Text>
              <Text className="text-[7.5px] font-bold text-neutral-400 uppercase">Learning</Text>
            </View>
            <View className="flex-1 border-l-4 border-l-emerald-500 bg-white border border-neutral-200 rounded-lg p-2.5 items-center">
              <Text className="text-base font-black text-emerald-600 font-mono">{dailyCount}</Text>
              <Text className="text-[7.5px] font-bold text-neutral-400 uppercase">Daily</Text>
            </View>
            <View className="flex-1 border-l-4 border-l-blue-500 bg-white border border-neutral-200 rounded-lg p-2.5 items-center">
              <Text className="text-base font-black text-blue-600 font-mono">{weeklyCount}</Text>
              <Text className="text-[7.5px] font-bold text-neutral-400 uppercase">Weekly</Text>
            </View>
            <View className="flex-1 border-l-4 border-l-amber-500 bg-white border border-neutral-200 rounded-lg p-2.5 items-center">
              <Text className="text-base font-black text-amber-600 font-mono">{monthlyCount}</Text>
              <Text className="text-[7.5px] font-bold text-neutral-400 uppercase">Monthly</Text>
            </View>
            <View className="flex-1 border-l-4 border-l-teal-500 bg-white border border-neutral-200 rounded-lg p-2.5 items-center">
              <Text className="text-base font-black text-teal-600 font-mono">{memorizedCount}</Text>
              <Text className="text-[7.5px] font-bold text-neutral-400 uppercase">Completed</Text>
            </View>
          </View>
        </View>

        {/* 90-DAY ACTIVITY HEATMAP */}
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">Past 90 Days</Text>
            <HelpTooltip text="Every day you completed a mastery-touch practice. Darker green means more repetitions that day." />
          </View>
          <View className="border border-[#E5E5E5] rounded-xl p-2.5 bg-white">
            <View className="flex-row flex-wrap gap-[3px] justify-center">
              {activityLast90Days.map((item, index) => {
                const color =
                  item.count === 0
                    ? 'bg-[#F3F2F1] border-[#E5E5E5]'
                    : item.count > 6
                      ? 'bg-emerald-600 border-emerald-700'
                      : 'bg-emerald-300 border-emerald-400';
                return <View key={index} style={{ width: '6.2%', height: 16 }} className={`border rounded-sm ${color}`} />;
              })}
            </View>
          </View>
        </View>

        {/* MILESTONE BADGES */}
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">Streak Milestones</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {STREAK_MILESTONES.map((threshold) => {
              const achieved = memoryStreak >= threshold;
              return (
                <View
                  key={threshold}
                  className={`px-3 py-2 rounded-xl border items-center ${
                    achieved ? 'bg-emerald-50 border-emerald-300' : 'bg-neutral-50 border-neutral-200'
                  }`}
                  style={{ minWidth: 78 }}
                >
                  <Text className={`text-sm font-black font-mono ${achieved ? 'text-emerald-700' : 'text-neutral-300'}`}>
                    {threshold}
                  </Text>
                  <Text className={`text-[7px] font-bold uppercase tracking-wide ${achieved ? 'text-emerald-700' : 'text-neutral-400'}`}>
                    Day{threshold === 1 ? '' : 's'}
                  </Text>
                  {!achieved && (
                    <Text className="text-[7px] font-sans text-neutral-400 mt-0.5">{threshold - memoryStreak} to go</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <View className="flex-row items-center px-1">
            <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">Memorized Milestones</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {MEMORIZED_MILESTONES.map((threshold) => {
              const achieved = versesLearnedCount >= threshold;
              return (
                <View
                  key={threshold}
                  className={`px-3 py-2 rounded-xl border items-center ${
                    achieved ? 'bg-indigo-50 border-indigo-300' : 'bg-neutral-50 border-neutral-200'
                  }`}
                  style={{ minWidth: 78 }}
                >
                  <Text className={`text-sm font-black font-mono ${achieved ? 'text-indigo-700' : 'text-neutral-300'}`}>
                    {threshold}
                  </Text>
                  <Text className={`text-[7px] font-bold uppercase tracking-wide ${achieved ? 'text-indigo-700' : 'text-neutral-400'}`}>
                    Verses
                  </Text>
                  {!achieved && (
                    <Text className="text-[7px] font-sans text-neutral-400 mt-0.5">{threshold - versesLearnedCount} to go</Text>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

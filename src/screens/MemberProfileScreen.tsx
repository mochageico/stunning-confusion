import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';

export default function MemberProfileScreen({ state }: { state: AppState }) {
  const { selectedUserProfile, handleBack } = state;

  if (!selectedUserProfile) return null;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header / Back Button */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              MEMBER PROFILE
            </Text>
            <Text className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">
              {selectedUserProfile.name}
            </Text>
          </View>
        </View>

        {/* User Identity Header */}
        <View className="flex-row items-center gap-3.5 bg-neutral-50/50 p-3 rounded-2xl border border-neutral-200">
          <View className="w-12 h-12 rounded-full border-2 border-neutral-900 bg-emerald-50 items-center justify-center shrink-0">
            <Text className="font-serif font-black text-lg text-emerald-950">{selectedUserProfile.avatar}</Text>
          </View>
          <View>
            <Text className="text-sm font-sans font-black text-neutral-900 leading-tight">
              {selectedUserProfile.name}
            </Text>
          </View>
        </View>

        {/* Calculated Metrics cards */}
        <View className="flex-row gap-2">
          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <Text className="text-xs font-bold text-neutral-900 font-mono">
              {selectedUserProfile.stats?.memorized || 0}
            </Text>
            <Text className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide">MEMORIZED</Text>
          </View>

          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <Text className="text-xs font-bold text-amber-600 font-mono">
              {selectedUserProfile.stats?.learning || 0}
            </Text>
            <Text className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide">LEARNING</Text>
          </View>

          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <Text className="text-xs font-bold text-emerald-600 font-mono">
              {selectedUserProfile.stats?.streak || 0}
            </Text>
            <Text className="text-[7.5px] font-bold text-neutral-400 uppercase tracking-wide">STREAK</Text>
          </View>
        </View>

        {/* Communities Spot */}
        <View style={{ gap: 6 }}>
          <Text className="text-[9px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
            COMMUNITIES ({selectedUserProfile.communities?.length || 0})
          </Text>
          <View style={{ gap: 6 }}>
            {(selectedUserProfile.communities || []).map((cName: string) => (
              <View key={cName} className="border border-neutral-200 rounded-xl p-2.5 bg-neutral-50/40">
                <Text className="text-xs font-sans font-bold text-neutral-800 leading-tight">{cName}</Text>
                <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">Active Scripture Circle Member</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

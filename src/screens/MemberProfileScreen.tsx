import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Bell, MessageCircle, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';

export default function MemberProfileScreen({ state }: { state: AppState }) {
  const {
    selectedUserProfile,
    handleBack,
    openDMThread,
    user,
    friends,
    canSendAccountabilityNudge,
    sendAccountabilityNudge,
    triggerToast,
  } = state;

  const [showNudgeCompose, setShowNudgeCompose] = useState(false);
  const [nudgeMessage, setNudgeMessage] = useState('');

  if (!selectedUserProfile) return null;

  const isSelf = selectedUserProfile.uid === user?.uid;
  const isFriend = friends.some((f) => f.uid === selectedUserProfile.uid);
  const canNudge = canSendAccountabilityNudge(selectedUserProfile.uid);

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

        {!isSelf && (
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => openDMThread(selectedUserProfile.uid, selectedUserProfile.name, '')}
              className="flex-1 flex-row items-center justify-center gap-1.5 py-2 bg-[#1A1A1A] rounded-xl"
            >
              <MessageCircle size={12} color="#FFFFFF" />
              <Text className="text-white font-sans font-bold text-[10px] uppercase tracking-wide">Message</Text>
            </Pressable>
            {isFriend && (
              <Pressable
                onPress={() => {
                  if (!canNudge) {
                    triggerToast('Accountability notification already sent for today -- you can send another tomorrow!');
                    return;
                  }
                  setNudgeMessage('');
                  setShowNudgeCompose(true);
                }}
                className={`flex-1 flex-row items-center justify-center gap-1.5 py-2 rounded-xl ${canNudge ? 'bg-amber-600' : 'bg-neutral-200'}`}
              >
                <Bell size={12} color={canNudge ? '#FFFFFF' : '#a3a3a3'} />
                <Text className={`font-sans font-bold text-[10px] uppercase tracking-wide ${canNudge ? 'text-white' : 'text-neutral-400'}`}>
                  Nudge
                </Text>
              </Pressable>
            )}
          </View>
        )}

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

      {showNudgeCompose && (
        <View className="absolute inset-0 bg-black/60 items-center justify-center p-4 z-50">
          <FadeInView style={{ width: '100%', maxWidth: 320 }}>
            <View className="bg-white border-2 border-[#1A1A1A] rounded-xl p-5 gap-4">
              <View className="flex-row items-start justify-between">
                <View style={{ flex: 1 }}>
                  <Text className="text-base font-serif font-bold text-[#1A1A1A]">Nudge {selectedUserProfile.name}</Text>
                  <Text className="text-xs text-neutral-500 font-sans mt-1">
                    Send a quick accountability message. You can nudge each friend once per day.
                  </Text>
                </View>
                <Pressable onPress={() => setShowNudgeCompose(false)} hitSlop={8}>
                  <X size={18} color="#a3a3a3" />
                </Pressable>
              </View>
              <TextInput
                value={nudgeMessage}
                onChangeText={setNudgeMessage}
                placeholder="Hey! Have you reviewed your verses today?"
                placeholderTextColor="#a3a3a3"
                multiline
                autoFocus
                className="border border-neutral-300 rounded-xl p-3 text-sm font-sans text-neutral-900 min-h-[80px]"
                style={{ textAlignVertical: 'top' }}
              />
              <Pressable
                onPress={async () => {
                  setShowNudgeCompose(false);
                  await sendAccountabilityNudge(
                    { uid: selectedUserProfile.uid, displayName: selectedUserProfile.name, avatarUrl: '', friendsSince: '' },
                    nudgeMessage
                  );
                }}
                className="bg-amber-600 rounded-xl py-2.5 items-center"
              >
                <Text className="text-white font-sans font-bold text-xs">Send Nudge</Text>
              </Pressable>
            </View>
          </FadeInView>
        </View>
      )}
    </FadeInView>
  );
}

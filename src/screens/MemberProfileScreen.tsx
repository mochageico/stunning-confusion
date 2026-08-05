import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Bell, MessageCircle, Trophy, UserMinus, UserPlus, X } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { ChallengeCreateSheet } from '../components/ChallengeCard';
import { AppText } from '../components/design';

export default function MemberProfileScreen({ state }: { state: AppState }) {
  const {
    selectedUserProfile,
    handleBack,
    openDMThread,
    user,
    friends,
    canSendAccountabilityNudge,
    sendAccountabilityNudge,
    removeFriend,
    saveFriendMemoryPlan,
    triggerToast,
    sendChallenge,
    incomingFriendRequests,
    outgoingFriendRequests,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
  } = state;

  const [showNudgeCompose, setShowNudgeCompose] = useState(false);
  const [nudgeMessage, setNudgeMessage] = useState('');
  const [showRemoveFriendConfirm, setShowRemoveFriendConfirm] = useState(false);
  const [showChallengeSheet, setShowChallengeSheet] = useState(false);

  if (!selectedUserProfile) return null;

  const isSelf = selectedUserProfile.uid === user?.uid;
  const isFriend = friends.some((f) => f.uid === selectedUserProfile.uid);
  const canNudge = canSendAccountabilityNudge(selectedUserProfile.uid);
  // Friending was previously only reachable from the Find Friends search
  // screen, which meant arriving at someone's profile any other way (circle
  // member list, activity feed, a DM) left no way to add them.
  const incomingFromThem = incomingFriendRequests.find((r) => r.fromUid === selectedUserProfile.uid);
  const outgoingToThem = outgoingFriendRequests.find((r) => r.toUid === selectedUserProfile.uid);

  // Friend-visible sharing: a memory plan and/or memory queue this member chose
  // to show friends (Settings → Profile Sharing). Only surfaced when the viewer
  // is actually a friend AND the owner opted in, so the snapshots are present.
  const sharedPlan =
    isFriend && selectedUserProfile.memoryPlanVisibility === 'friends' ? selectedUserProfile.sharedMemoryPlan : null;
  const queueVisible =
    isFriend &&
    selectedUserProfile.memoryQueueVisibility === 'friends' &&
    Array.isArray(selectedUserProfile.sharedMemoryQueue);

  // Group the shared queue snapshot by book+chapter for a compact reference
  // list, preserving the owner's queue order.
  const groupedQueue = queueVisible
    ? (() => {
        const items = [...selectedUserProfile.sharedMemoryQueue].sort(
          (a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
        );
        const groups: { key: string; book: string; chapter: number; count: number; statuses: Set<string> }[] = [];
        const byKey = new Map<string, (typeof groups)[number]>();
        items.forEach((it: any) => {
          const key = `${it.book} ${it.chapter}`;
          let g = byKey.get(key);
          if (!g) {
            g = { key, book: it.book, chapter: it.chapter, count: 0, statuses: new Set() };
            byKey.set(key, g);
            groups.push(g);
          }
          g.count += 1;
          if (it.status) g.statuses.add(it.status);
        });
        return groups;
      })()
    : [];

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
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              MEMBER PROFILE
            </AppText>
            <AppText variant="title" className="font-serif font-bold text-neutral-900 leading-none mt-0.5">
              {selectedUserProfile.name}
            </AppText>
          </View>
        </View>

        {/* User Identity Header */}
        <View className="flex-row items-center gap-3.5 bg-neutral-50/50 p-3 rounded-2xl border border-neutral-200">
          <View className="w-12 h-12 rounded-full border-2 border-neutral-900 bg-emerald-50 items-center justify-center shrink-0">
            <AppText variant="title" className="font-serif font-black text-emerald-950">{selectedUserProfile.avatar}</AppText>
          </View>
          <View>
            <AppText variant="body" className="font-sans font-black text-neutral-900 leading-tight">
              {selectedUserProfile.name}
            </AppText>
          </View>
        </View>

        {!isSelf && (
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => openDMThread(selectedUserProfile.uid, selectedUserProfile.name, '')}
              className="flex-1 flex-row items-center justify-center gap-1.5 py-2 bg-[#1A1A1A] rounded-xl"
            >
              <MessageCircle size={12} color="#FFFFFF" />
              <AppText variant="section" className="text-white font-sans font-bold uppercase tracking-wide">Message</AppText>
            </Pressable>
            {isFriend && (
              <Pressable
                onPress={() => {
                  if (!canNudge) {
                    triggerToast('You already nudged this friend today — you can send another tomorrow.');
                    return;
                  }
                  setNudgeMessage('');
                  setShowNudgeCompose(true);
                }}
                className={`flex-1 flex-row items-center justify-center gap-1.5 py-2 rounded-xl ${canNudge ? 'bg-amber-600' : 'bg-neutral-200'}`}
              >
                <Bell size={12} color={canNudge ? '#FFFFFF' : '#a3a3a3'} />
                <AppText variant="section" className={`font-sans font-bold uppercase tracking-wide ${canNudge ? 'text-white' : 'text-neutral-400'}`}>
                  Nudge
                </AppText>
              </Pressable>
            )}
            {isFriend && (
              <Pressable
                onPress={() => setShowChallengeSheet(true)}
                className="flex-1 flex-row items-center justify-center gap-1.5 py-2 rounded-xl bg-amber-50 border border-amber-200"
              >
                <Trophy size={12} color="#b45309" />
                <AppText variant="section" className="font-sans font-bold uppercase tracking-wide text-amber-800">Challenge</AppText>
              </Pressable>
            )}
          </View>
        )}

        {/* Friend state for a non-friend: send / cancel / accept, mirroring the
            same four states FindFriendsScreen's search results already show. */}
        {!isSelf && !isFriend && (
          <View>
            {incomingFromThem ? (
              <View className="border border-emerald-200 bg-emerald-50 rounded-xl p-3" style={{ gap: 8 }}>
                <AppText variant="caption" className="font-sans text-emerald-800">
                  {selectedUserProfile.name} sent you a friend request.
                </AppText>
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => acceptFriendRequest(incomingFromThem)}
                    className="flex-1 bg-emerald-600 py-2 rounded-lg items-center"
                  >
                    <AppText variant="micro" className="text-white font-bold uppercase tracking-wide">Accept</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => declineFriendRequest(incomingFromThem)}
                    className="flex-1 bg-white border border-neutral-300 py-2 rounded-lg items-center"
                  >
                    <AppText variant="micro" className="text-neutral-600 font-bold uppercase tracking-wide">Decline</AppText>
                  </Pressable>
                </View>
              </View>
            ) : outgoingToThem ? (
              <Pressable
                onPress={() => cancelFriendRequest(outgoingToThem)}
                className="flex-row items-center justify-center gap-1.5 py-2 rounded-xl bg-neutral-100 border border-neutral-200"
              >
                <AppText variant="section" className="text-neutral-600 font-sans font-bold uppercase tracking-wide">
                  Request Sent — Cancel
                </AppText>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => sendFriendRequest(selectedUserProfile.uid, selectedUserProfile.name)}
                className="flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600"
              >
                <UserPlus size={12} color="#FFFFFF" />
                <AppText variant="section" className="text-white font-sans font-bold uppercase tracking-wide">Add Friend</AppText>
              </Pressable>
            )}
          </View>
        )}

        {!isSelf && isFriend && (
          <ChallengeCreateSheet
            visible={showChallengeSheet}
            title={`Challenge ${selectedUserProfile.name}`}
            onClose={() => setShowChallengeSheet(false)}
            onSubmit={(range) => {
              sendChallenge(selectedUserProfile.uid, selectedUserProfile.name, '', range);
              setShowChallengeSheet(false);
            }}
          />
        )}

        {!isSelf && isFriend && (
          <Pressable
            onPress={() => setShowRemoveFriendConfirm(true)}
            className="flex-row items-center justify-center gap-1.5 py-2"
          >
            <UserMinus size={12} color="#dc2626" />
            <AppText variant="section" className="text-red-600 font-sans font-bold uppercase tracking-wide">Remove Friend</AppText>
          </Pressable>
        )}

        {/* Calculated Metrics cards */}
        <View className="flex-row gap-2">
          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <AppText variant="label" className="font-bold text-neutral-900 font-mono">
              {selectedUserProfile.stats?.memorized || 0}
            </AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">MEMORIZED</AppText>
          </View>

          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <AppText variant="label" className="font-bold text-amber-600 font-mono">
              {selectedUserProfile.stats?.learning || 0}
            </AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">LEARNING</AppText>
          </View>

          <View className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl p-2.5 items-center" style={{ gap: 2 }}>
            <AppText variant="label" className="font-bold text-emerald-600 font-mono">
              {selectedUserProfile.stats?.streak || 0}
            </AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">STREAK</AppText>
          </View>
        </View>

        {/* Shared Memory Plan (friends only) */}
        {sharedPlan && (
          <View style={{ gap: 6 }}>
            <AppText variant="micro" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">MEMORY PLAN</AppText>
            <View className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white gap-3 shadow-sm">
              <View className="flex-row justify-between items-start">
                <View className="flex-1 pr-2">
                  <AppText variant="label" className="font-sans font-black text-[#1A1A1A] leading-tight">
                    {sharedPlan.name || 'Memory Plan'}
                  </AppText>
                  <AppText variant="micro" className="font-sans text-neutral-500 mt-0.5">
                    {selectedUserProfile.name}'s retention method
                  </AppText>
                </View>
              </View>

              {/* Retention only. This used to show their pace, daily cap and
                  learning days -- none of which transfer when you save the
                  plan any more, because those are your own Rhythm. Showing
                  them here implied adopting the plan would change your
                  schedule, which it did, and shouldn't have. */}
              <View className="flex-row gap-2 py-1.5 border-y border-dashed border-neutral-100">
                <View className="flex-1">
                  <AppText variant="micro" className="text-neutral-500 uppercase">Phases</AppText>
                  <AppText variant="caption" className="font-sans font-bold text-neutral-800">
                    {sharedPlan.dailyPhaseWeeks ?? '—'}-{sharedPlan.weeklyPhaseMonths ?? '—'}-{sharedPlan.monthlyPhaseYears ?? '—'}
                  </AppText>
                </View>
                <View className="flex-1">
                  <AppText variant="micro" className="text-neutral-500 uppercase">Touches</AppText>
                  <AppText variant="caption" className="font-sans font-bold text-neutral-800">{sharedPlan.masteryTouches ?? '—'}</AppText>
                </View>
                <View className="flex-1">
                  <AppText variant="micro" className="text-neutral-500 uppercase">Misses</AppText>
                  <AppText variant="caption" className="font-sans font-bold text-neutral-800 capitalize">
                    {sharedPlan.missPolicy ?? '—'}
                  </AppText>
                </View>
              </View>

              <Pressable
                onPress={() => saveFriendMemoryPlan(sharedPlan, selectedUserProfile.name)}
                className="bg-[#1A1A1A] rounded-md py-2 items-center"
              >
                <AppText variant="section" className="text-white font-bold uppercase tracking-wider">Save Memory Plan</AppText>
              </Pressable>
              <AppText variant="micro" className="font-sans text-neutral-500 text-center leading-relaxed">
                Saves their retention method. Your own schedule and pace stay as they are.
              </AppText>
            </View>
          </View>
        )}

        {/* Shared Memory Queue (friends only) */}
        {queueVisible && (
          <View style={{ gap: 6 }}>
            <AppText variant="micro" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
              MEMORY QUEUE ({groupedQueue.length})
            </AppText>
            {groupedQueue.length === 0 ? (
              <View className="border border-dashed border-neutral-200 rounded-xl p-4 items-center">
                <AppText variant="caption" className="text-neutral-400 font-sans text-center">
                  {selectedUserProfile.name} hasn't added any verses yet.
                </AppText>
              </View>
            ) : (
              <View style={{ gap: 6 }}>
                {groupedQueue.map((g) => {
                  const retained = g.statuses.has('retained') && g.statuses.size === 1;
                  const learning = g.statuses.has('learning');
                  const badgeColor = retained
                    ? 'text-emerald-600'
                    : learning
                    ? 'text-amber-600'
                    : 'text-neutral-500';
                  const badgeLabel = retained ? 'Memorized' : learning ? 'Learning' : 'In Progress';
                  return (
                    <View
                      key={g.key}
                      className="border border-neutral-200 rounded-xl p-2.5 bg-neutral-50/40 flex-row justify-between items-center"
                    >
                      <View>
                        <AppText variant="label" className="font-sans font-bold text-neutral-800 leading-tight">
                          {g.book} {g.chapter}
                        </AppText>
                        <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">
                          {g.count} verse{g.count === 1 ? '' : 's'}
                        </AppText>
                      </View>
                      <AppText variant="micro" className={`font-bold uppercase tracking-wide ${badgeColor}`}>{badgeLabel}</AppText>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Communities Spot */}
        <View style={{ gap: 6 }}>
          <AppText variant="micro" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">
            COMMUNITIES ({selectedUserProfile.communities?.length || 0})
          </AppText>
          <View style={{ gap: 6 }}>
            {(selectedUserProfile.communities || []).map((cName: string) => (
              <View key={cName} className="border border-neutral-200 rounded-xl p-2.5 bg-neutral-50/40">
                <AppText variant="label" className="font-sans font-bold text-neutral-800 leading-tight">{cName}</AppText>
                <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">Active Scripture Circle Member</AppText>
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
                  <AppText variant="title" className="font-serif font-bold text-[#1A1A1A]">Nudge {selectedUserProfile.name}</AppText>
                  <AppText variant="label" className="text-neutral-500 font-sans mt-1">
                    Send a quick accountability message. You can nudge each friend once per day.
                  </AppText>
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
                <AppText variant="label" className="text-white font-sans font-bold ">Send Nudge</AppText>
              </Pressable>
            </View>
          </FadeInView>
        </View>
      )}

      {showRemoveFriendConfirm && (
        <View className="absolute inset-0 bg-black/60 items-center justify-center p-4 z-50">
          <FadeInView style={{ width: '100%', maxWidth: 320 }}>
            <View className="bg-white border-2 border-[#1A1A1A] rounded-xl p-5 gap-4">
              <View>
                <AppText variant="title" className="font-serif font-bold text-[#1A1A1A]">Remove {selectedUserProfile.name}?</AppText>
                <AppText variant="label" className="text-neutral-500 font-sans mt-1">
                  You'll stop seeing each other's activity and won't be able to nudge each other. They can send a new
                  friend request later if you change your mind.
                </AppText>
              </View>
              <View className="flex-row gap-2.5">
                <Pressable
                  onPress={() => setShowRemoveFriendConfirm(false)}
                  className="flex-1 py-2.5 border border-neutral-300 rounded-xl items-center"
                >
                  <AppText variant="label" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    setShowRemoveFriendConfirm(false);
                    await removeFriend({
                      uid: selectedUserProfile.uid,
                      displayName: selectedUserProfile.name,
                      avatarUrl: '',
                      friendsSince: '',
                    });
                  }}
                  className="flex-1 py-2.5 bg-red-600 rounded-xl items-center"
                >
                  <AppText variant="label" className="text-white font-sans font-bold ">Remove</AppText>
                </Pressable>
              </View>
            </View>
          </FadeInView>
        </View>
      )}
    </FadeInView>
  );
}

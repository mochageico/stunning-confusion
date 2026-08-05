import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Globe,
  Link as LinkIcon,
  Lock,
  MessageCircle,
  Plus,
  Share2,
  Sliders,
  Trash2,
  Trophy,
  X,
} from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Circle } from '../types';
import { AvatarCircle, FadeInView, ProgressBar } from '../components/ui';
import { ChallengeCreateInline } from '../components/ChallengeCard';
import { AppButton, AppIconButton, AppTextInput, AppText } from '../components/design';

export default function CommunityGroupDetailScreen({ state }: { state: AppState }) {
  const {
    user,
    activeCircle,
    activeCircleMembers,
    activeCircleGroupPlans,
    loadingActiveCircle,
    updateCircleSettings,
    createGroupPlan,
    deleteGroupPlan,
    removeCircleMember,
    leaveCircle,
    disbandCircle,
    viewMemberProfileById,
    setViewingGroupDetail,
    isEditingCircleSettings,
    setIsEditingCircleSettings,
    showCreatePlanForm,
    setShowCreatePlanForm,
    newPlanName,
    setNewPlanName,
    newPlanDesc,
    setNewPlanDesc,
    joinedGroupPlanMemberships,
    setViewingGroupPlan,
    navigateTo,
    clearGroupPlanMembershipsForCircle,
    triggerToast,
    openCircleChat,
    activeCircleChallenges,
    joinedGroupChallenges,
    createGroupChallenge,
    joinGroupChallenge,
    endGroupChallenge,
    deleteGroupChallenge,
    leaveGroupChallenge,
    openChallengeLeaderboardId,
    openChallengeLeaderboard,
    loadingChallengeLeaderboard,
    openChallengeLeaderboardModal,
    closeChallengeLeaderboard,
    clearGroupChallengeMembershipsForCircle,
    memoryQueue,
    countRangeProgress,
  } = state;

  const [showCreateChallengeForm, setShowCreateChallengeForm] = useState(false);
  // Which challenge's inline delete-confirm card is open (only one at a time).
  const [confirmDeleteChallengeId, setConfirmDeleteChallengeId] = useState<string | null>(null);

  const isLeaderOrAdmin = !!activeCircle && !!user && activeCircle.ownerId === user.uid;

  const updateActiveCircle = (fields: Partial<Pick<Circle, 'name' | 'description' | 'isPublic'>>) => {
    if (!activeCircle) return;
    updateCircleSettings(activeCircle.id, fields);
  };

  const shareUrl = activeCircle ? `https://scripturepacing.app/join?circleId=${activeCircle.id}&code=${activeCircle.inviteCode}` : '';

  const closeConsole = () => {
    setViewingGroupDetail(false);
    setIsEditingCircleSettings(false);
    setShowCreatePlanForm(false);
  };

  const handleCreatePlan = async () => {
    if (!activeCircle) return;
    await createGroupPlan(activeCircle.id, { name: newPlanName, description: newPlanDesc });
    setShowCreatePlanForm(false);
    setNewPlanName('');
    setNewPlanDesc('');
  };

  const openGroupPlan = (plan: (typeof activeCircleGroupPlans)[number]) => {
    setViewingGroupPlan(plan);
    navigateTo('groupPlanDetail');
  };

  const [showLeaveDisbandConfirm, setShowLeaveDisbandConfirm] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);

  const handleLeaveOrDisband = () => {
    if (!activeCircle) return;
    if (isLeaderOrAdmin) {
      setShowLeaveDisbandConfirm(true);
    } else {
      leaveCircle(activeCircle.id);
      clearGroupPlanMembershipsForCircle(activeCircle.id);
      clearGroupChallengeMembershipsForCircle(activeCircle.id);
    }
  };

  const confirmDisband = async () => {
    if (!activeCircle) return;
    setShowLeaveDisbandConfirm(false);
    await disbandCircle(activeCircle.id);
    clearGroupPlanMembershipsForCircle(activeCircle.id);
    clearGroupChallengeMembershipsForCircle(activeCircle.id);
  };

  if (loadingActiveCircle || !activeCircle) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center">
          <AppText variant="label" className="text-neutral-400 font-sans">Loading circle…</AppText>
        </View>
      </FadeInView>
    );
  }

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header Row: back, privacy badge, settings */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2.5">
            <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor="#262626" onPress={closeConsole} className="rounded-full border border-neutral-200 bg-white" />
            <View className="flex-row items-center gap-1 bg-neutral-100 px-2.5 py-1 rounded-full">
              {activeCircle.isPublic ? <Globe size={10} color="#525252" /> : <Lock size={10} color="#525252" />}
              <AppText variant="micro" className="font-sans font-bold text-neutral-600 uppercase tracking-wide">
                {activeCircle.isPublic ? 'Public Circle' : 'Private Circle'}
              </AppText>
            </View>
          </View>

          <View className="flex-row items-center gap-2.5">
            <AppButton size="md" onPress={() => openCircleChat(activeCircle.id)} className="rounded-xl border border-neutral-300 bg-white flex-row items-center gap-2 shadow-sm">
              <MessageCircle size={14} color="#404040" />
              <AppText variant="caption" className="font-sans font-bold text-neutral-700">Group Chat</AppText>
            </AppButton>

            {/* Settings Button for Leader/Admin */}
            {isLeaderOrAdmin && (
            <AppButton size="md" onPress={() => setIsEditingCircleSettings(!isEditingCircleSettings)} className={` rounded-xl border flex-row items-center gap-2 shadow-sm ${ isEditingCircleSettings ? 'bg-neutral-900 border-neutral-900' : 'bg-white border-neutral-300' }`}>
              <Sliders size={14} color={isEditingCircleSettings ? '#FFFFFF' : '#404040'} />
              <AppText variant="caption" className={`font-sans font-bold ${isEditingCircleSettings ? 'text-white' : 'text-neutral-700'}`}>
                {isEditingCircleSettings ? 'Close Settings' : 'Circle Settings'}
              </AppText>
            </AppButton>
            )}
          </View>
        </View>

        {/* Hero: name + description, replaces the old small header title and
            the separate "About" card below with one bigger, clearer block. */}
        <View className="border-b border-[#E5E5E5] pb-5" style={{ gap: 8 }}>
          <AppText variant="section" className="uppercase tracking-widest font-extrabold text-neutral-400 font-sans">
            Scripture Circle
          </AppText>
          <AppText variant="display" className="leading-tight font-serif font-black text-[#1A1A1A]">{activeCircle.name}</AppText>
          <AppText variant="body" className="text-neutral-600 leading-relaxed font-sans">
            {activeCircle.description || 'No description yet.'}
          </AppText>
          <View className="flex-row gap-6 pt-2 items-end">
            <View>
              <AppText variant="micro" className="text-neutral-400 uppercase tracking-wider">Owner / Sponsor</AppText>
              <AppText variant="caption" className="font-semibold text-neutral-700 font-sans mt-0.5">{activeCircle.ownerName}</AppText>
            </View>
            <View>
              <AppText variant="micro" className="text-neutral-400 uppercase tracking-wider">Your Circle Access</AppText>
              <AppText variant="caption" className="font-bold text-neutral-800 font-sans mt-0.5">{isLeaderOrAdmin ? 'Leader' : 'Member'}</AppText>
            </View>
            <Pressable onPress={() => setShowMembersModal(true)}>
              <AppText variant="micro" className="text-neutral-400 uppercase tracking-wider">
                Members ({activeCircleMembers.length})
              </AppText>
              <View className="flex-row items-center mt-1.5">
                {activeCircleMembers.slice(0, 4).map((member, idx) => (
                  <View key={member.uid} style={{ marginLeft: idx === 0 ? 0 : -10, zIndex: 4 - idx }}>
                    <AvatarCircle name={member.displayName} photoUri={member.avatarUrl} size={24} />
                  </View>
                ))}
                {activeCircleMembers.length === 0 && (
                  <AppText variant="caption" className="text-neutral-400 font-sans">No members yet</AppText>
                )}
              </View>
            </Pressable>
          </View>
        </View>

        {/* EDIT CIRCLE SETTINGS PANEL */}
        {isEditingCircleSettings && isLeaderOrAdmin && (
          <FadeInView>
            <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-4" style={{ gap: 12 }}>
              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-200">
                <View className="flex-row items-center gap-1.5">
                  <Sliders size={12} color="#4f46e5" />
                  <AppText variant="label" className="font-black font-sans text-neutral-800 uppercase tracking-wider">Leader Circle Customization</AppText>
                </View>
                <AppText variant="micro" className="uppercase tracking-widest font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">ADMIN</AppText>
              </View>

              <View style={{ gap: 12 }}>
                <View>
                  <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Circle Display Name</AppText>
                  <AppTextInput defaultValue={activeCircle.name} onEndEditing={(e) => { const val = e.nativeEvent.text.trim(); if (val && val !== activeCircle.name) { updateActiveCircle({ name: val }); triggerToast('Updated Circle Name! 🏷️'); } }} className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl font-bold text-neutral-800" placeholder="Group Name" />
                </View>

                <View>
                  <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Description / Goal</AppText>
                  <AppTextInput defaultValue={activeCircle.description} onEndEditing={(e) => { const val = e.nativeEvent.text.trim(); if (val !== activeCircle.description) { updateActiveCircle({ description: val }); triggerToast('Updated description goal! ✏️'); } }} multiline numberOfLines={2} textAlignVertical="top" className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-neutral-700 font-sans" placeholder="E.g. A community focused on scripture memory." />
                </View>

                <View className="flex-row justify-between items-center py-2 bg-white px-3 border border-neutral-200 rounded-xl">
                  <View>
                    <AppText variant="caption" className="font-bold text-neutral-800">Circle Privacy Mode</AppText>
                    <AppText variant="micro" className="text-neutral-400 font-sans">Public directory vs private invite-only code</AppText>
                  </View>
                  <Pressable
                    onPress={() => {
                      const nextPub = !activeCircle.isPublic;
                      updateActiveCircle({ isPublic: nextPub });
                      triggerToast(nextPub ? 'Circle is now Public! 🌐' : 'Circle is now Private (Invite Only)! 🔒');
                    }}
                    className={`px-3 py-1.5 rounded-lg border ${
                      activeCircle.isPublic ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                    }`}
                  >
                    <AppText variant="micro" className={`font-bold font-sans uppercase tracking-wider ${ activeCircle.isPublic ? 'text-emerald-700' : 'text-amber-700' }`} >
                      {activeCircle.isPublic ? '🌐 Public Directory' : '🔒 Private Code'}
                    </AppText>
                  </Pressable>
                </View>
              </View>
            </View>
          </FadeInView>
        )}

        {/* GROUP PLANS PANEL */}
        <View style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center px-1">
            <AppText variant="label" className="font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
              Group Plans ({activeCircleGroupPlans.length})
            </AppText>

            {/* Add Group Plan Button (Leaders/Mentors only) */}
            {isLeaderOrAdmin && (
              <AppButton size="sm" onPress={() => { setShowCreatePlanForm(!showCreatePlanForm); setNewPlanName(''); setNewPlanDesc(''); }} className="bg-indigo-50 border border-indigo-200 rounded-lg flex-row items-center gap-1">
                <Plus size={10} color="#4338ca" />
                <AppText variant="micro" className="font-bold text-indigo-600">
                  {showCreatePlanForm ? 'Hide Form' : 'New Group Plan'}
                </AppText>
              </AppButton>
            )}
          </View>

          {/* CREATE GROUP PLAN FORM -- title + description only. The actual
              verse queue and weekly pace are set up afterward from the
              plan's own landing page (GroupPlanDetailScreen). */}
          {showCreatePlanForm && isLeaderOrAdmin && (
            <FadeInView>
              <View className="bg-[#1A1A1A] border border-neutral-900 rounded-xl p-4" style={{ gap: 12 }}>
                <View className="flex-row justify-between items-center border-b border-neutral-800 pb-1.5">
                  <AppText variant="section" className="font-black uppercase tracking-wider text-neutral-300">New Group Plan</AppText>
                  <AppText variant="micro" className="bg-indigo-600 text-white px-2 py-0.5 rounded uppercase font-black">SPONSOR</AppText>
                </View>

                <View style={{ gap: 8 }}>
                  <View>
                    <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Plan Title</AppText>
                    <AppTextInput value={newPlanName} onChangeText={setNewPlanName} className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-white font-sans" placeholder="E.g. Wednesday Night Romans Study" placeholderTextColor="#737373" />
                  </View>

                  <View>
                    <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-widest mb-0.5 font-sans">Description</AppText>
                    <AppTextInput value={newPlanDesc} onChangeText={setNewPlanDesc} multiline numberOfLines={2} textAlignVertical="top" className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-white font-sans" placeholder="What is this plan for, and who's it for?" placeholderTextColor="#737373" />
                  </View>

                  {/* Actions */}
                  <View className="flex-row justify-end gap-2 pt-2 border-t border-neutral-800">
                    <Pressable
                      onPress={() => setShowCreatePlanForm(false)}
                      className="bg-neutral-800 border border-neutral-800 px-3 py-1.5 rounded-lg"
                    >
                      <AppText variant="micro" className="text-neutral-400 font-bold uppercase">Cancel</AppText>
                    </Pressable>
                    <Pressable onPress={handleCreatePlan} className="bg-indigo-600 px-4 py-1.5 rounded-lg">
                      <AppText variant="micro" className="text-white font-bold uppercase tracking-wider">Create Plan</AppText>
                    </Pressable>
                  </View>
                </View>
              </View>
            </FadeInView>
          )}

          {/* List of the circle's Group Plans -- each tap opens its own landing page */}
          <View style={{ gap: 12 }}>
            {activeCircleGroupPlans.length === 0 ? (
              <View className="p-6 border border-dashed border-neutral-200 rounded-2xl items-center">
                <AppText variant="label" className="text-center text-neutral-400 font-sans">
                  No Group Plans created for this circle yet. {isLeaderOrAdmin && 'Create one above!'}
                </AppText>
              </View>
            ) : (
              activeCircleGroupPlans.map((plan) => {
                const isJoined = joinedGroupPlanMemberships.some((m) => m.planId === plan.planId);

                return (
                  <Pressable
                    key={plan.planId}
                    onPress={() => openGroupPlan(plan)}
                    className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white shadow-sm"
                    style={{ gap: 10 }}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <AppText variant="label" className="font-sans font-black text-[#1A1A1A] leading-tight">{plan.name}</AppText>
                        <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">
                          Managed by <Text className="font-semibold text-[#1A1A1A]">{plan.managerName || 'Leader'}</Text>
                        </AppText>
                      </View>
                      <View className="flex-row items-center gap-1">
                        {isJoined && (
                          <AppText variant="micro" className="bg-emerald-50 border border-emerald-200 text-emerald-700 font-sans font-bold px-1.5 py-0.5 rounded uppercase">
                            Joined
                          </AppText>
                        )}
                        {isLeaderOrAdmin && (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              deleteGroupPlan(activeCircle.id, plan.planId);
                            }}
                            className="p-0.5"
                          >
                            <Trash2 size={11} color="#ef4444" />
                          </Pressable>
                        )}
                      </View>
                    </View>

                    {plan.description && <AppText variant="caption" className="text-neutral-500 font-sans leading-normal">{plan.description}</AppText>}

                    <View className="flex-row py-1.5 border-y border-dashed border-neutral-100 gap-2">
                      <View className="flex-1">
                        <AppText variant="micro" className="text-neutral-400 uppercase">Pace</AppText>
                        <AppText variant="caption" className="font-bold text-neutral-800 font-sans">{plan.versesPerWeek} verses/wk</AppText>
                      </View>
                      <View className="flex-1">
                        <AppText variant="micro" className="text-neutral-400 uppercase">Verses in Plan</AppText>
                        <AppText variant="caption" className="font-bold text-neutral-800 font-sans">{plan.verseIds.length}</AppText>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </View>

        {/* GROUP CHALLENGES PANEL -- open to any member, not leader-gated
            (peer competition, not curated content). The whole range
            front-loads into a joiner's queue immediately (see
            joinGroupChallenge), unlike Group Plans above which trickle
            verses in weekly. */}
        <View style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center px-1">
            <AppText variant="label" className="font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
              Challenges ({activeCircleChallenges.length})
            </AppText>
            <AppButton size="sm" onPress={() => setShowCreateChallengeForm(!showCreateChallengeForm)} className="bg-amber-50 border border-amber-200 rounded-lg flex-row items-center gap-1">
              <Trophy size={10} color="#b45309" />
              <AppText variant="micro" className="font-bold text-amber-700">
                {showCreateChallengeForm ? 'Hide Form' : 'New Challenge'}
              </AppText>
            </AppButton>
          </View>

          {/* Expands in place, exactly like the New Group Plan form above --
              it used to slide a sheet up over the whole page to collect a
              book, a chapter and two optional verse numbers. */}
          {showCreateChallengeForm && activeCircle && (
            <FadeInView>
              <ChallengeCreateInline
                onCancel={() => setShowCreateChallengeForm(false)}
                onSubmit={(range) => {
                  createGroupChallenge(activeCircle.id, `${range.book} ${range.startChapter}`, range);
                  setShowCreateChallengeForm(false);
                }}
              />
            </FadeInView>
          )}

          <View style={{ gap: 12 }}>
            {activeCircleChallenges.length === 0 ? (
              <View className="p-6 border border-dashed border-neutral-200 rounded-2xl items-center">
                <AppText variant="label" className="text-center text-neutral-400 font-sans">
                  No challenges yet. Any member can start one.
                </AppText>
              </View>
            ) : (
              activeCircleChallenges.map((challenge) => {
                const membership = joinedGroupChallenges.find((m) => m.challengeId === challenge.id);
                const myProgress = membership ? countRangeProgress(memoryQueue, membership) : 0;
                const isCreator = !!user && challenge.createdByUid === user.uid;
                const reference =
                  challenge.startVerse != null || challenge.endVerse != null
                    ? `${challenge.book} ${challenge.startChapter}:${challenge.startVerse ?? 1}-${challenge.endVerse ?? ''}`
                    : `${challenge.book} ${challenge.startChapter}`;

                return (
                  <Pressable
                    key={challenge.id}
                    onPress={() => openChallengeLeaderboardModal(challenge)}
                    className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white shadow-sm"
                    style={{ gap: 8 }}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <AppText variant="label" className="font-sans font-black text-[#1A1A1A] leading-tight">{challenge.title}</AppText>
                        <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">
                          {reference} • by {challenge.createdByName}
                        </AppText>
                      </View>
                      {challenge.status === 'completed' && (
                        <AppText variant="micro" className="bg-neutral-100 border border-neutral-200 text-neutral-500 font-sans font-bold px-1.5 py-0.5 rounded uppercase">
                          Ended
                        </AppText>
                      )}
                    </View>

                    {membership ? (
                      <View style={{ gap: 3 }}>
                        <View className="flex-row justify-between">
                          <AppText variant="micro" className="font-sans font-bold text-neutral-700">Your progress</AppText>
                          <AppText variant="micro" className="font-mono text-neutral-500">
                            {myProgress}/{challenge.totalVerses}
                          </AppText>
                        </View>
                        <ProgressBar percent={(myProgress / Math.max(1, challenge.totalVerses)) * 100} />
                      </View>
                    ) : (
                      challenge.status === 'active' && (
                        <AppButton size="md" onPress={(e) => { e.stopPropagation(); joinGroupChallenge(challenge); }} className="bg-[#1A1A1A] rounded-lg items-center">
                          <AppText variant="micro" className="text-white font-bold uppercase tracking-wide">Join Challenge</AppText>
                        </AppButton>
                      )
                    )}

                    {/* Three distinct actions, deliberately not collapsed
                        into one: "End" freezes the race but keeps the card
                        and its leaderboard; "Delete" removes it for the whole
                        circle (creator only); "Leave" drops just me out of a
                        race that stays alive for everyone else. */}
                    <View className="flex-row items-center justify-between">
                      {isCreator && challenge.status === 'active' ? (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            endGroupChallenge(challenge, 'completed');
                          }}
                        >
                          <AppText variant="micro" className="font-sans font-bold text-neutral-400 uppercase tracking-wide">End Challenge</AppText>
                        </Pressable>
                      ) : (
                        <View />
                      )}

                      <View className="flex-row items-center gap-3">
                        {membership && (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              leaveGroupChallenge(challenge);
                            }}
                          >
                            <AppText variant="micro" className="font-sans font-bold text-neutral-400 uppercase tracking-wide">Leave</AppText>
                          </Pressable>
                        )}
                        {isCreator && (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteChallengeId(challenge.id);
                            }}
                            hitSlop={8}
                            className="w-6 h-6 items-center justify-center"
                          >
                            <Trash2 size={12} color="#a3a3a3" />
                          </Pressable>
                        )}
                      </View>
                    </View>

                    {confirmDeleteChallengeId === challenge.id && (
                      <View className="border border-neutral-200 bg-neutral-50 rounded-lg p-2.5" style={{ gap: 8 }}>
                        <AppText variant="caption" className="font-sans text-neutral-600 leading-snug">
                          Delete "{challenge.title}" for the whole circle? Everyone keeps the verses already in their
                          queue — only the race and its leaderboard go away.
                        </AppText>
                        <View className="flex-row gap-2">
                          <AppButton size="md" onPress={(e) => { e.stopPropagation(); setConfirmDeleteChallengeId(null); }} className="flex-1 bg-white border border-neutral-300 rounded-lg items-center">
                            <AppText variant="micro" className="text-neutral-600 font-bold uppercase tracking-wide">Keep</AppText>
                          </AppButton>
                          <AppButton size="md" onPress={(e) => { e.stopPropagation(); setConfirmDeleteChallengeId(null); deleteGroupChallenge(challenge); }} className="flex-1 bg-red-600 rounded-lg items-center">
                            <AppText variant="micro" className="text-white font-bold uppercase tracking-wide">Delete</AppText>
                          </AppButton>
                        </View>
                      </View>
                    )}
                  </Pressable>
                );
              })
            )}
          </View>
        </View>

        {/* PORTABLE SHARE & JOIN GATEWAY — the only real way to add members;
            you can't unilaterally enroll another real account by typing their
            name, they have to join themselves via this code/link. */}
        <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-4" style={{ gap: 16 }}>
          <View>
            <AppText variant="micro" className="bg-indigo-100 text-indigo-700 font-sans font-black px-2 py-0.5 rounded-full uppercase tracking-wider self-start">
              Invite & Join Gateway
            </AppText>
            <View className="flex-row items-center gap-1.5 mt-1.5">
              <LinkIcon size={12} color="#4f46e5" />
              <AppText variant="label" className="font-black font-sans text-neutral-800 uppercase tracking-wider">Add Members</AppText>
            </View>
            <AppText variant="caption" className="text-neutral-400 leading-relaxed font-sans mt-0.5">
              Share this code or link — anyone with it can join this circle themselves from the Find Circle screen.
            </AppText>
          </View>

          {/* Code and Link Box */}
          <View style={{ gap: 8 }}>
            <View className="flex-row gap-2">
              <View className="flex-1 bg-white border border-dashed border-neutral-300 rounded-lg p-2 items-center justify-center">
                <AppText variant="micro" className="text-neutral-400 uppercase font-sans font-black">Invite Code</AppText>
                <AppText variant="label" className="font-mono font-black text-neutral-800 tracking-widest uppercase">{activeCircle.inviteCode}</AppText>
              </View>
              <View className="flex-[2] bg-white border border-neutral-200 rounded-lg p-2 justify-center">
                <AppText variant="micro" className="font-mono text-neutral-500" numberOfLines={1} ellipsizeMode="tail">
                  {shareUrl}
                </AppText>
              </View>
            </View>

            <View className="flex-row gap-2">
              <AppButton size="sm" onPress={async () => { await Clipboard.setStringAsync(shareUrl); triggerToast('Share link copied to clipboard! 📋'); }} className="flex-1 bg-white border border-neutral-300 rounded-lg flex-row items-center justify-center gap-1.5">
                <Share2 size={11} color="#262626" />
                <AppText variant="caption" className="text-neutral-800 font-sans font-bold ">Copy Share Link</AppText>
              </AppButton>
            </View>
          </View>
        </View>

        {/* LEAVE OR DISBAND ACTIONS */}
        {showLeaveDisbandConfirm ? (
          <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
            <AppText variant="caption" className="font-sans font-bold text-red-800">Disband this circle?</AppText>
            <AppText variant="micro" className="font-sans text-red-700/80 leading-relaxed">
              "{activeCircle.name}" and its shared plans will be permanently deleted for everyone. This can't be undone.
            </AppText>
            <View className="flex-row gap-2 justify-end pt-1">
              <Pressable
                onPress={() => setShowLeaveDisbandConfirm(false)}
                className="px-3 py-1.5 border border-neutral-300 rounded-lg bg-white"
              >
                <AppText variant="caption" className="text-neutral-600 font-sans font-bold ">Cancel</AppText>
              </Pressable>
              <Pressable onPress={confirmDisband} className="px-3 py-1.5 bg-red-600 rounded-lg">
                <AppText variant="caption" className="text-white font-sans font-bold ">Yes, Disband</AppText>
              </Pressable>
            </View>
          </View>
        ) : (
          <AppButton size="md" onPress={handleLeaveOrDisband} className="w-full bg-red-50 border border-red-200 rounded-xl items-center justify-center">
            <AppText variant="label" className="text-red-600 font-sans font-bold text-center">
              {isLeaderOrAdmin ? 'Disband & Delete Scripture Circle' : 'Leave Circle'}
            </AppText>
          </AppButton>
        )}
      </ScrollView>

      {/* Members popup — scrollable list, tap a member to view their profile */}
      <Modal visible={showMembersModal} animationType="slide" transparent onRequestClose={() => setShowMembersModal(false)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-3xl" style={{ height: '70%' }}>
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
              <AppText variant="title" className="font-serif font-bold text-[#1A1A1A]">
                Members ({activeCircleMembers.length})
              </AppText>
              <AppIconButton Icon={X} diameter={28} iconSize={14} iconColor="#262626" onPress={() => setShowMembersModal(false)} className="rounded-full border border-neutral-300" />
            </View>

            <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
              {activeCircleMembers.map((member) => {
                const isSelf = member.uid === user?.uid;
                return (
                  <Pressable
                    key={member.uid}
                    onPress={() => {
                      setShowMembersModal(false);
                      viewMemberProfileById(member.uid);
                    }}
                    className="flex-row items-center justify-between bg-neutral-50 px-3 py-2.5 rounded-xl border border-neutral-100 mb-2"
                  >
                    <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                      <AvatarCircle name={member.displayName} photoUri={member.avatarUrl} size={32} />
                      <AppText variant="label" className={`font-sans font-bold flex-1 ${isSelf ? 'text-indigo-800 font-extrabold' : 'text-neutral-700'}`} numberOfLines={1} ellipsizeMode="tail" >
                        {isSelf ? `${member.displayName} (Me)` : member.displayName}
                        {member.role === 'leader' ? ' 👑' : ''}
                      </AppText>
                    </View>

                    {/* Kick/Remove Option for Leaders */}
                    {isLeaderOrAdmin && !isSelf && (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          removeCircleMember(activeCircle.id, member.uid);
                        }}
                        className="w-6 h-6 items-center justify-center rounded-full"
                      >
                        <AppText variant="label" className="text-red-500 font-bold ">×</AppText>
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Challenge leaderboard -- mirrors the Members popup above, sorted by
          progress desc (highest first). */}
      <Modal visible={!!openChallengeLeaderboardId} animationType="slide" transparent onRequestClose={closeChallengeLeaderboard}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-3xl" style={{ height: '70%' }}>
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
              <AppText variant="title" className="font-serif font-bold text-[#1A1A1A]">🏆 Leaderboard</AppText>
              <AppIconButton Icon={X} diameter={28} iconSize={14} iconColor="#262626" onPress={closeChallengeLeaderboard} className="rounded-full border border-neutral-300" />
            </View>

            {loadingChallengeLeaderboard ? (
              <AppText variant="label" className="text-neutral-400 font-sans text-center mt-6">Loading…</AppText>
            ) : openChallengeLeaderboard.length === 0 ? (
              <AppText variant="label" className="text-neutral-400 font-sans text-center mt-6">No one has joined yet.</AppText>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
                {openChallengeLeaderboard.map((participant, idx) => {
                  const challenge = activeCircleChallenges.find((c) => c.id === openChallengeLeaderboardId);
                  const total = challenge?.totalVerses || 1;
                  const isSelf = participant.uid === user?.uid;
                  return (
                    <View
                      key={participant.uid}
                      className="flex-row items-center gap-2.5 bg-neutral-50 px-3 py-2.5 rounded-xl border border-neutral-100 mb-2"
                    >
                      <AppText variant="caption" className="font-mono font-bold text-neutral-400 w-4">{idx + 1}</AppText>
                      <AvatarCircle name={participant.name} photoUri={participant.avatarUrl} size={28} />
                      <View className="flex-1" style={{ gap: 3 }}>
                        <AppText variant="label" className={`font-sans font-bold ${isSelf ? 'text-indigo-800' : 'text-neutral-700'}`}>
                          {isSelf ? `${participant.name} (Me)` : participant.name}
                          {participant.progress >= total ? ' 🏁' : ''}
                        </AppText>
                        <ProgressBar percent={(participant.progress / total) * 100} />
                      </View>
                      <AppText variant="micro" className="font-mono text-neutral-500">
                        {participant.progress}/{total}
                      </AppText>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

    </FadeInView>
  );
}

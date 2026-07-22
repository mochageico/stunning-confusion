import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
  Users,
} from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Circle } from '../types';
import { FadeInView } from '../components/ui';

export default function CommunityGroupDetailScreen({ state }: { state: AppState }) {
  const {
    user,
    activeCircle,
    activeCircleMembers,
    activeCircleStudyPlans,
    loadingActiveCircle,
    updateCircleSettings,
    createStudyPlan,
    deleteStudyPlan,
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
    joinedStudyPlanMemberships,
    setViewingStudyPlan,
    navigateTo,
    clearStudyPlanMembershipsForCircle,
    triggerToast,
    openCircleChat,
  } = state;

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
    await createStudyPlan(activeCircle.id, { name: newPlanName, description: newPlanDesc });
    setShowCreatePlanForm(false);
    setNewPlanName('');
    setNewPlanDesc('');
  };

  const openStudyPlan = (plan: (typeof activeCircleStudyPlans)[number]) => {
    setViewingStudyPlan(plan);
    navigateTo('studyPlanDetail');
  };

  const [showLeaveDisbandConfirm, setShowLeaveDisbandConfirm] = useState(false);

  const handleLeaveOrDisband = () => {
    if (!activeCircle) return;
    if (isLeaderOrAdmin) {
      setShowLeaveDisbandConfirm(true);
    } else {
      leaveCircle(activeCircle.id);
      clearStudyPlanMembershipsForCircle(activeCircle.id);
    }
  };

  const confirmDisband = async () => {
    if (!activeCircle) return;
    setShowLeaveDisbandConfirm(false);
    await disbandCircle(activeCircle.id);
    clearStudyPlanMembershipsForCircle(activeCircle.id);
  };

  if (loadingActiveCircle || !activeCircle) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center">
          <Text className="text-xs text-neutral-400 font-sans">Loading circle…</Text>
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
            <Pressable onPress={closeConsole} className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white">
              <ArrowLeft size={14} color="#262626" />
            </Pressable>
            <View className="flex-row items-center gap-1 bg-neutral-100 px-2.5 py-1 rounded-full">
              {activeCircle.isPublic ? <Globe size={10} color="#525252" /> : <Lock size={10} color="#525252" />}
              <Text className="text-[9px] font-sans font-bold text-neutral-600 uppercase tracking-wide">
                {activeCircle.isPublic ? 'Public Circle' : 'Private Circle'}
              </Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => openCircleChat(activeCircle.id)}
              className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white flex-row items-center gap-1.5"
            >
              <MessageCircle size={12} color="#404040" />
              <Text className="text-[10px] font-sans font-bold text-neutral-700">Group Chat</Text>
            </Pressable>

            {/* Settings Button for Leader/Admin */}
            {isLeaderOrAdmin && (
            <Pressable
              onPress={() => setIsEditingCircleSettings(!isEditingCircleSettings)}
              className={`px-2.5 py-1.5 rounded-lg border flex-row items-center gap-1.5 ${
                isEditingCircleSettings ? 'bg-neutral-900 border-neutral-900' : 'bg-white border-neutral-300'
              }`}
            >
              <Sliders size={12} color={isEditingCircleSettings ? '#FFFFFF' : '#404040'} />
              <Text className={`text-[10px] font-sans font-bold ${isEditingCircleSettings ? 'text-white' : 'text-neutral-700'}`}>
                {isEditingCircleSettings ? 'Close Settings' : 'Circle Settings'}
              </Text>
            </Pressable>
            )}
          </View>
        </View>

        {/* Hero: name + description, replaces the old small header title and
            the separate "About" card below with one bigger, clearer block. */}
        <View className="border-b border-[#E5E5E5] pb-5" style={{ gap: 8 }}>
          <Text className="text-[10px] uppercase tracking-widest font-extrabold text-neutral-400 font-sans">
            Scripture Circle
          </Text>
          <Text className="text-[26px] leading-tight font-serif font-black text-[#1A1A1A]">{activeCircle.name}</Text>
          <Text className="text-sm text-neutral-600 leading-relaxed font-sans">
            {activeCircle.description || 'No description yet.'}
          </Text>
          <View className="flex-row gap-6 pt-2">
            <View>
              <Text className="text-[8px] text-neutral-400 uppercase tracking-wider">Owner / Sponsor</Text>
              <Text className="font-semibold text-neutral-700 text-[11px] font-sans mt-0.5">{activeCircle.ownerName}</Text>
            </View>
            <View>
              <Text className="text-[8px] text-neutral-400 uppercase tracking-wider">Your Circle Access</Text>
              <Text className="font-bold text-neutral-800 text-[11px] font-sans mt-0.5">{isLeaderOrAdmin ? 'Leader' : 'Member'}</Text>
            </View>
          </View>
        </View>

        {/* EDIT CIRCLE SETTINGS PANEL */}
        {isEditingCircleSettings && isLeaderOrAdmin && (
          <FadeInView>
            <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-4" style={{ gap: 12 }}>
              <View className="flex-row justify-between items-center pb-2 border-b border-neutral-200">
                <View className="flex-row items-center gap-1.5">
                  <Sliders size={12} color="#4f46e5" />
                  <Text className="text-xs font-black font-sans text-neutral-800 uppercase tracking-wider">Leader Circle Customization</Text>
                </View>
                <Text className="text-[8px] uppercase tracking-widest font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">ADMIN</Text>
              </View>

              <View style={{ gap: 12 }}>
                <View>
                  <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Circle Display Name</Text>
                  <TextInput
                    defaultValue={activeCircle.name}
                    onEndEditing={(e) => {
                      const val = e.nativeEvent.text.trim();
                      if (val && val !== activeCircle.name) {
                        updateActiveCircle({ name: val });
                        triggerToast('Updated Circle Name! 🏷️');
                      }
                    }}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-bold text-neutral-800"
                    placeholder="Group Name"
                  />
                </View>

                <View>
                  <Text className="text-[9px] font-extrabold uppercase tracking-wider text-neutral-400 mb-1">Description / Goal</Text>
                  <TextInput
                    defaultValue={activeCircle.description}
                    onEndEditing={(e) => {
                      const val = e.nativeEvent.text.trim();
                      if (val !== activeCircle.description) {
                        updateActiveCircle({ description: val });
                        triggerToast('Updated description goal! ✏️');
                      }
                    }}
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs text-neutral-700 font-sans"
                    placeholder="E.g. A community focused on scripture memory."
                  />
                </View>

                <View className="flex-row justify-between items-center py-2 bg-white px-3 border border-neutral-200 rounded-xl">
                  <View>
                    <Text className="text-[10px] font-bold text-neutral-800">Circle Privacy Mode</Text>
                    <Text className="text-[9px] text-neutral-400 font-sans">Public directory vs private invite-only code</Text>
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
                    <Text
                      className={`text-[9px] font-bold font-sans uppercase tracking-wider ${
                        activeCircle.isPublic ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {activeCircle.isPublic ? '🌐 Public Directory' : '🔒 Private Code'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </FadeInView>
        )}

        {/* STUDY PLANS PANEL */}
        <View style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center px-1">
            <Text className="text-xs font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
              Study Plans ({activeCircleStudyPlans.length})
            </Text>

            {/* Add Study Plan Button (Leaders/Mentors only) */}
            {isLeaderOrAdmin && (
              <Pressable
                onPress={() => {
                  setShowCreatePlanForm(!showCreatePlanForm);
                  setNewPlanName('');
                  setNewPlanDesc('');
                }}
                className="bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg flex-row items-center gap-1"
              >
                <Plus size={10} color="#4338ca" />
                <Text className="text-[9px] font-bold text-indigo-600">{showCreatePlanForm ? 'Hide Form' : 'New Plan'}</Text>
              </Pressable>
            )}
          </View>

          {/* CREATE STUDY PLAN FORM -- title + description only. The actual
              verse queue and weekly pace are set up afterward from the
              plan's own landing page (StudyPlanDetailScreen). */}
          {showCreatePlanForm && isLeaderOrAdmin && (
            <FadeInView>
              <View className="bg-[#1A1A1A] border border-neutral-900 rounded-xl p-4" style={{ gap: 12 }}>
                <View className="flex-row justify-between items-center border-b border-neutral-800 pb-1.5">
                  <Text className="text-[10px] font-black uppercase tracking-wider text-neutral-300">New Study Plan</Text>
                  <Text className="text-[7px] bg-indigo-600 text-white px-2 py-0.5 rounded uppercase font-black">SPONSOR</Text>
                </View>

                <View style={{ gap: 8 }}>
                  <View>
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Plan Title</Text>
                    <TextInput
                      value={newPlanName}
                      onChangeText={setNewPlanName}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-sans"
                      placeholder="E.g. Wednesday Night Romans Study"
                      placeholderTextColor="#737373"
                    />
                  </View>

                  <View>
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5 font-sans">Description</Text>
                    <TextInput
                      value={newPlanDesc}
                      onChangeText={setNewPlanDesc}
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-sans"
                      placeholder="What is this plan for, and who's it for?"
                      placeholderTextColor="#737373"
                    />
                  </View>

                  {/* Actions */}
                  <View className="flex-row justify-end gap-2 pt-2 border-t border-neutral-800">
                    <Pressable
                      onPress={() => setShowCreatePlanForm(false)}
                      className="bg-neutral-800 border border-neutral-800 px-3 py-1.5 rounded-lg"
                    >
                      <Text className="text-neutral-400 text-[9px] font-bold uppercase">Cancel</Text>
                    </Pressable>
                    <Pressable onPress={handleCreatePlan} className="bg-indigo-600 px-4 py-1.5 rounded-lg">
                      <Text className="text-white font-bold text-[9px] uppercase tracking-wider">Create Plan</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </FadeInView>
          )}

          {/* List of the circle's Study Plans -- each tap opens its own landing page */}
          <View style={{ gap: 12 }}>
            {activeCircleStudyPlans.length === 0 ? (
              <View className="p-6 border border-dashed border-neutral-200 rounded-2xl items-center">
                <Text className="text-center text-xs text-neutral-400 font-sans">
                  No Study Plans created for this circle yet. {isLeaderOrAdmin && 'Create one above!'}
                </Text>
              </View>
            ) : (
              activeCircleStudyPlans.map((plan) => {
                const isJoined = joinedStudyPlanMemberships.some((m) => m.planId === plan.planId);

                return (
                  <Pressable
                    key={plan.planId}
                    onPress={() => openStudyPlan(plan)}
                    className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white shadow-sm"
                    style={{ gap: 10 }}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <Text className="text-xs font-sans font-black text-[#1A1A1A] leading-tight">{plan.name}</Text>
                        <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">
                          Managed by <Text className="font-semibold text-[#1A1A1A]">{plan.managerName || 'Leader'}</Text>
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1">
                        {isJoined && (
                          <Text className="text-[8px] bg-emerald-50 border border-emerald-200 text-emerald-700 font-sans font-bold px-1.5 py-0.5 rounded uppercase">
                            Joined
                          </Text>
                        )}
                        {isLeaderOrAdmin && (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              deleteStudyPlan(activeCircle.id, plan.planId);
                            }}
                            className="p-0.5"
                          >
                            <Trash2 size={11} color="#ef4444" />
                          </Pressable>
                        )}
                      </View>
                    </View>

                    {plan.description && <Text className="text-[10px] text-neutral-500 font-sans leading-normal">{plan.description}</Text>}

                    <View className="flex-row py-1.5 border-y border-dashed border-neutral-100 gap-2">
                      <View className="flex-1">
                        <Text className="text-[8px] text-neutral-400 uppercase">Pace</Text>
                        <Text className="font-bold text-neutral-800 text-[10px] font-sans">{plan.versesPerWeek} verses/wk</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-[8px] text-neutral-400 uppercase">Verses in Plan</Text>
                        <Text className="font-bold text-neutral-800 text-[10px] font-sans">{plan.verseIds.length}</Text>
                      </View>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </View>

        {/* MEMBERS LIST CARD (WITH REMOVE OPTION FOR ADMINS) */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4 shadow-sm" style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center border-b border-neutral-100 pb-1.5">
            <Text className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Members ({activeCircleMembers.length})</Text>
            <Text className="text-[8px] text-neutral-400 font-sans">Tap a member to view their profile</Text>
          </View>

          {/* Member grid */}
          <ScrollView style={{ maxHeight: 144 }}>
            <View className="flex-row flex-wrap gap-2">
              {activeCircleMembers.map((member) => {
                const isSelf = member.uid === user?.uid;
                return (
                  <Pressable
                    key={member.uid}
                    onPress={() => viewMemberProfileById(member.uid)}
                    className="w-[48.5%] flex-row items-center justify-between bg-neutral-50 px-2.5 py-1.5 rounded-lg border border-neutral-100"
                  >
                    <View className="flex-row items-center gap-2 flex-1">
                      <View className={`w-5 h-5 rounded-full items-center justify-center ${isSelf ? 'bg-indigo-600' : 'bg-[#1A1A1A]'}`}>
                        <Text className="text-white text-[9px] font-sans font-bold">{member.displayName.substring(0, 2).toUpperCase()}</Text>
                      </View>
                      <Text
                        className={`text-[11px] font-sans font-bold flex-1 ${isSelf ? 'text-indigo-800 font-extrabold' : 'text-neutral-700'}`}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {isSelf ? `${member.displayName} (Me)` : member.displayName}
                        {member.role === 'leader' ? ' 👑' : ''}
                      </Text>
                    </View>

                    {/* Kick/Remove Option for Leaders */}
                    {isLeaderOrAdmin && !isSelf && (
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          removeCircleMember(activeCircle.id, member.uid);
                        }}
                        className="w-4 h-4 items-center justify-center rounded-full border border-transparent"
                      >
                        <Text className="text-red-500 font-bold text-[10px]">×</Text>
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* PORTABLE SHARE & JOIN GATEWAY — the only real way to add members;
            you can't unilaterally enroll another real account by typing their
            name, they have to join themselves via this code/link. */}
        <View className="bg-neutral-50 border border-neutral-200 rounded-xl p-4" style={{ gap: 16 }}>
          <View>
            <Text className="text-[8px] bg-indigo-100 text-indigo-700 font-sans font-black px-2 py-0.5 rounded-full uppercase tracking-wider self-start">
              Invite & Join Gateway
            </Text>
            <View className="flex-row items-center gap-1.5 mt-1.5">
              <LinkIcon size={12} color="#4f46e5" />
              <Text className="text-xs font-black font-sans text-neutral-800 uppercase tracking-wider">Add Members</Text>
            </View>
            <Text className="text-[10px] text-neutral-400 leading-relaxed font-sans mt-0.5">
              Share this code or link — anyone with it can join this circle themselves from the Find Circle screen.
            </Text>
          </View>

          {/* Code and Link Box */}
          <View style={{ gap: 8 }}>
            <View className="flex-row gap-2">
              <View className="flex-1 bg-white border border-dashed border-neutral-300 rounded-lg p-2 items-center justify-center">
                <Text className="text-[7px] text-neutral-400 uppercase font-sans font-black">Invite Code</Text>
                <Text className="text-xs font-mono font-black text-neutral-800 tracking-widest uppercase">{activeCircle.inviteCode}</Text>
              </View>
              <View className="flex-[2] bg-white border border-neutral-200 rounded-lg p-2 justify-center">
                <Text className="text-[9px] font-mono text-neutral-500" numberOfLines={1} ellipsizeMode="tail">
                  {shareUrl}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-2">
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(shareUrl);
                  triggerToast('Share link copied to clipboard! 📋');
                }}
                className="flex-1 py-1.5 bg-white border border-neutral-300 rounded-lg flex-row items-center justify-center gap-1.5"
              >
                <Share2 size={11} color="#262626" />
                <Text className="text-neutral-800 font-sans font-bold text-[10px]">Copy Share Link</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* LEAVE OR DISBAND ACTIONS */}
        {showLeaveDisbandConfirm ? (
          <View className="bg-red-50 border border-red-200 rounded-xl p-3" style={{ gap: 8 }}>
            <Text className="text-[11px] font-sans font-bold text-red-800">Disband this circle?</Text>
            <Text className="text-[9px] font-sans text-red-700/80 leading-relaxed">
              "{activeCircle.name}" and its shared plans will be permanently deleted for everyone. This can't be undone.
            </Text>
            <View className="flex-row gap-2 justify-end pt-1">
              <Pressable
                onPress={() => setShowLeaveDisbandConfirm(false)}
                className="px-3 py-1.5 border border-neutral-300 rounded-lg bg-white"
              >
                <Text className="text-neutral-600 font-sans font-bold text-[10px]">Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmDisband} className="px-3 py-1.5 bg-red-600 rounded-lg">
                <Text className="text-white font-sans font-bold text-[10px]">Yes, Disband</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable onPress={handleLeaveOrDisband} className="w-full py-2.5 bg-red-50 border border-red-200 rounded-xl items-center justify-center">
            <Text className="text-red-600 font-sans font-bold text-xs text-center">
              {isLeaderOrAdmin ? 'Disband & Delete Scripture Circle' : 'Leave Circle'}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </FadeInView>
  );
}

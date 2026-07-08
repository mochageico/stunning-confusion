import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Check,
  Globe,
  Link as LinkIcon,
  Lock,
  Megaphone,
  Plus,
  Share2,
  Sliders,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Circle } from '../types';
import { FadeInView, useClampedNumberField } from '../components/ui';
import { BookPicker } from '../components/BookPicker';

export default function CommunityGroupDetailScreen({ state }: { state: AppState }) {
  const {
    user,
    activeCircle,
    activeCircleMembers,
    activeCircleGroupPlans,
    loadingActiveCircle,
    updateCircleSettings,
    pinCircleAnnouncement,
    deployGroupPlan,
    advanceGroupPlanPointer,
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
    showAppStorePreview,
    setShowAppStorePreview,
    newPlanName,
    setNewPlanName,
    newPlanDesc,
    setNewPlanDesc,
    newPlanBook,
    setNewPlanBook,
    newPlanPacing,
    setNewPlanPacing,
    setActiveGroupPlan,
    memoryQueue,
    activeGroupPlan,
    joinGroupPlan,
    triggerToast,
  } = state;

  // Local, ephemeral inline-form state for the announcement-pin text input —
  // an uncontrolled web <form> input in the original with no equivalent
  // global state field.
  const [announcementDraft, setAnnouncementDraft] = useState('');

  const newPlanPacingField = useClampedNumberField(newPlanPacing, setNewPlanPacing, (n) => Math.max(1, Math.min(10, n)));

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
    setShowAppStorePreview(false);
  };

  const handlePinAnnouncement = () => {
    if (!activeCircle) return;
    pinCircleAnnouncement(activeCircle.id, announcementDraft);
    setAnnouncementDraft('');
  };

  const handleDeployPlan = async () => {
    if (!activeCircle) return;
    await deployGroupPlan(activeCircle.id, {
      name: newPlanName,
      book: newPlanBook,
      pacingPerWeek: newPlanPacing,
      description: newPlanDesc,
    });
    setShowCreatePlanForm(false);
    setNewPlanName('');
    setNewPlanDesc('');
  };

  const handleLeaveOrDisband = () => {
    if (!activeCircle) return;
    if (isLeaderOrAdmin) {
      Alert.alert(
        'Disband Scripture Circle',
        `Are you absolutely sure you want to permanently disband and delete the "${activeCircle.name}" Scripture Circle?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disband',
            style: 'destructive',
            onPress: async () => {
              await disbandCircle(activeCircle.id);
              setActiveGroupPlan(null);
            },
          },
        ]
      );
    } else {
      leaveCircle(activeCircle.id);
      setActiveGroupPlan(null);
    }
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
        {/* Header Row */}
        <View className="flex-row items-center justify-between border-b border-[#E5E5E5] pb-3">
          <View className="flex-row items-center gap-3">
            <Pressable onPress={closeConsole} className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white">
              <ArrowLeft size={14} color="#262626" />
            </Pressable>
            <View>
              <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">CIRCLE CONSOLE</Text>
              <Text className="text-base font-serif font-bold text-[#1A1A1A]">{activeCircle.name}</Text>
            </View>
          </View>

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

        {/* PINNED CIRCLE ANNOUNCEMENTS BILLBOARD — moved to the top of the screen */}
        <View className="bg-amber-50 border border-amber-200 rounded-xl p-4" style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center">
            <View className="flex-row items-center gap-1.5">
              <Megaphone size={13} color="#d97706" />
              <Text className="text-xs font-sans font-black text-amber-800 uppercase tracking-wider">Pinned Announcement</Text>
            </View>
          </View>

          <Text className="text-xs text-amber-900 font-sans font-medium leading-relaxed">
            {activeCircle.pinnedAnnouncement || 'No current announcements. Encourage your members with a welcome message or meeting updates!'}
          </Text>

          {isLeaderOrAdmin && (
            <View className="pt-2 border-t border-amber-200 flex-row gap-1.5">
              <TextInput
                value={announcementDraft}
                onChangeText={setAnnouncementDraft}
                placeholder="Pin new leader announcement..."
                placeholderTextColor="#fcd34d"
                className="flex-1 bg-white border border-amber-200 rounded-lg px-2 py-1 text-xs font-sans text-amber-900"
              />
              <Pressable onPress={handlePinAnnouncement} className="bg-amber-600 px-2.5 py-1 rounded-lg items-center justify-center">
                <Text className="text-white font-bold text-[9px] uppercase tracking-wider">Pin</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Public/Private indicator — right below the announcement */}
        <View className="flex-row items-center gap-1.5 px-1">
          {activeCircle.isPublic ? <Globe size={11} color="#a3a3a3" /> : <Lock size={11} color="#a3a3a3" />}
          <Text className="capitalize text-neutral-400 text-[10px] font-sans">{activeCircle.isPublic ? 'Public Circle' : 'Private Circle'}</Text>
        </View>

        {/* About Pacing Circle Card — no "Focus" badge; scripture range now lives on
            individual shared plans within the circle instead of the circle itself */}
        <View className="bg-white border border-[#E5E5E5] rounded-xl p-4" style={{ gap: 12 }}>
          <Text className="text-xs text-neutral-700 leading-relaxed font-sans">{activeCircle.description}</Text>

          <View className="pt-2.5 border-t border-neutral-100 flex-row flex-wrap gap-2">
            <View className="w-1/2">
              <Text className="text-[8px] text-neutral-400 uppercase">Owner / Sponsor</Text>
              <Text className="font-semibold text-neutral-700 text-[10px] font-sans">{activeCircle.ownerName}</Text>
            </View>
            <View className="w-1/2">
              <Text className="text-[8px] text-neutral-400 uppercase">Your Circle Access</Text>
              <Text className="font-bold text-neutral-800 text-[10px] font-sans">{isLeaderOrAdmin ? 'Leader' : 'Member'}</Text>
            </View>
          </View>
        </View>

        {/* ACTIVE PACING PLANS PANEL */}
        <View style={{ gap: 12 }}>
          <View className="flex-row justify-between items-center px-1">
            <Text className="text-xs font-sans font-extrabold text-neutral-400 tracking-wider uppercase">
              Shared Circle Plans ({activeCircleGroupPlans.length})
            </Text>

            {/* Add Group Plan Button (Leaders/Mentors only) */}
            {isLeaderOrAdmin && (
              <Pressable
                onPress={() => {
                  setShowCreatePlanForm(!showCreatePlanForm);
                  setNewPlanName('New Circle Plan');
                  setNewPlanBook('Romans');
                }}
                className="bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg flex-row items-center gap-1"
              >
                <Plus size={10} color="#4338ca" />
                <Text className="text-[9px] font-bold text-indigo-600">{showCreatePlanForm ? 'Hide Form' : 'New Plan'}</Text>
              </Pressable>
            )}
          </View>

          {/* CREATE PACING PLAN FORM */}
          {showCreatePlanForm && isLeaderOrAdmin && (
            <FadeInView>
              <View className="bg-[#1A1A1A] border border-neutral-900 rounded-xl p-4" style={{ gap: 12 }}>
                <View className="flex-row justify-between items-center border-b border-neutral-800 pb-1.5">
                  <Text className="text-[10px] font-black uppercase tracking-wider text-neutral-300">Deploy New Circle Plan</Text>
                  <Text className="text-[7px] bg-indigo-600 text-white px-2 py-0.5 rounded uppercase font-black">SPONSOR</Text>
                </View>

                <View style={{ gap: 8 }}>
                  <View>
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Plan Title</Text>
                    <TextInput
                      value={newPlanName}
                      onChangeText={setNewPlanName}
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-sans"
                      placeholder="E.g. Romans 8 Pacing Study"
                      placeholderTextColor="#737373"
                    />
                  </View>

                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Scripture Book</Text>
                      <BookPicker value={newPlanBook} onChange={setNewPlanBook} />
                    </View>

                    <View className="flex-1">
                      <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5">Speed (verses/wk)</Text>
                      <TextInput
                        {...newPlanPacingField}
                        keyboardType="numeric"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1 text-xs text-white"
                      />
                    </View>
                  </View>

                  <View>
                    <Text className="text-[8px] font-bold text-neutral-400 uppercase tracking-widest mb-0.5 font-sans">Description / Study Memo</Text>
                    <TextInput
                      value={newPlanDesc}
                      onChangeText={setNewPlanDesc}
                      multiline
                      numberOfLines={2}
                      textAlignVertical="top"
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-sans"
                      placeholder="Explain pacing goals, recital times, etc."
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
                    <Pressable onPress={handleDeployPlan} className="bg-indigo-600 px-4 py-1.5 rounded-lg">
                      <Text className="text-white font-bold text-[9px] uppercase tracking-wider">Deploy & Pave Plan</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </FadeInView>
          )}

          {/* List of Circle pacing plans */}
          <View style={{ gap: 12 }}>
            {activeCircleGroupPlans.length === 0 ? (
              <View className="p-6 border border-dashed border-neutral-200 rounded-2xl items-center">
                <Text className="text-center text-xs text-neutral-400 font-sans">
                  No active pacing plans created for this circle yet. {isLeaderOrAdmin && 'Launch a new plan above!'}
                </Text>
              </View>
            ) : (
              activeCircleGroupPlans.map((plan) => {
                const isJoined = activeGroupPlan?.planId === plan.planId;

                // Compute percent complete
                const groupPlanVersesInQueue = memoryQueue.filter((item) => plan.scriptureRange.includes(item.verseId));
                const retainedCount = groupPlanVersesInQueue.filter((item) => item.status === 'retained').length;
                const percentComplete = plan.scriptureRange.length > 0 ? Math.round((retainedCount / plan.scriptureRange.length) * 100) : 0;

                return (
                  <View key={plan.planId} className="border border-[#E5E5E5] rounded-xl p-3.5 bg-white shadow-sm" style={{ gap: 12 }}>
                    <View className="flex-row justify-between items-start">
                      <View>
                        <Text className="text-xs font-sans font-black text-[#1A1A1A] leading-tight">{plan.name}</Text>
                        <Text className="text-[9px] font-sans text-neutral-400 mt-0.5">
                          Managed by <Text className="font-semibold text-[#1A1A1A]">{plan.managerName || 'Leader'}</Text>
                        </Text>
                      </View>
                      <View className="flex-row gap-1">
                        <Text className="text-[8px] bg-indigo-50 border border-indigo-200 text-indigo-700 font-sans font-bold px-1.5 py-0.5 rounded uppercase">
                          Group Plan
                        </Text>
                        {isLeaderOrAdmin && (
                          <Pressable onPress={() => deleteGroupPlan(activeCircle.id, plan.planId)} className="p-0.5">
                            <Trash2 size={11} color="#ef4444" />
                          </Pressable>
                        )}
                      </View>
                    </View>

                    {/* Plan details info */}
                    {plan.description && <Text className="text-[10px] text-neutral-500 font-sans leading-normal">{plan.description}</Text>}

                    {/* Pacing Details */}
                    <View className="flex-row py-1.5 border-y border-dashed border-neutral-100 gap-2">
                      <View className="flex-1">
                        <Text className="text-[8px] text-neutral-400 uppercase">Pacing</Text>
                        <Text className="font-bold text-neutral-800 text-[10px] font-sans">{plan.pacingPerWeek} verses/wk</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-[8px] text-neutral-400 uppercase">Pacing Code</Text>
                        <Text className="font-bold text-neutral-800 uppercase font-mono text-[9px]">{activeCircle.inviteCode}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-[8px] text-neutral-400 uppercase">Active Pointer</Text>
                        <Text className="font-bold text-indigo-600 font-mono text-[9px]">
                          {plan.scriptureRange[plan.currentGroupVerseIndex] || plan.scriptureRange[0]}
                        </Text>
                      </View>
                    </View>

                    {/* PROGRESS & LEADERSHIP ACTION ROW */}
                    <View className="flex-row justify-between items-center pt-1.5">
                      <View className="flex-1" style={{ gap: 4 }}>
                        <View className="flex-row justify-between" style={{ maxWidth: 120 }}>
                          <Text className="text-[8px] font-mono font-bold text-neutral-400">Personal Progress</Text>
                          <Text className="text-[8px] font-mono font-bold text-neutral-400">{percentComplete}%</Text>
                        </View>
                        <View className="w-28 h-1 bg-neutral-100 rounded-full overflow-hidden">
                          <View className="h-full bg-emerald-500" style={{ width: `${percentComplete}%` }} />
                        </View>
                      </View>

                      <View className="flex-row items-center gap-1.5">
                        {/* ADVANCE POINTER (Only visible to Leader/Mentor) */}
                        {isLeaderOrAdmin && (
                          <Pressable
                            onPress={() => {
                              const nextIdx = plan.currentGroupVerseIndex + 1;
                              if (nextIdx < plan.scriptureRange.length) {
                                advanceGroupPlanPointer(activeCircle.id, plan.planId, nextIdx);
                                triggerToast(`Advanced pacing pointer to ${plan.scriptureRange[nextIdx]}! 🚀`);
                              } else {
                                triggerToast('Already reached the end of this pacing range! 🎉');
                              }
                            }}
                            className="bg-[#1A1A1A] px-2.5 py-1.5 rounded flex-row items-center gap-1"
                          >
                            <Text className="text-white text-[8px] font-bold uppercase tracking-wider">Advance Pacing 🚀</Text>
                          </Pressable>
                        )}

                        {isJoined ? (
                          <Text className="text-[9px] font-sans font-extrabold uppercase tracking-wide text-emerald-600 bg-emerald-50 px-2 py-1.5 rounded">
                            Active ✓
                          </Text>
                        ) : (
                          <Pressable onPress={() => joinGroupPlan(plan)} className="bg-[#1A1A1A] px-3 py-1.5 rounded-md">
                            <Text className="text-white text-[9px] font-bold uppercase tracking-wider">Join Plan</Text>
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
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

              <Pressable
                onPress={() => setShowAppStorePreview(!showAppStorePreview)}
                className={`flex-1 py-1.5 border rounded-lg flex-row items-center justify-center gap-1.5 ${
                  showAppStorePreview ? 'bg-indigo-600 border-indigo-600' : 'bg-indigo-50 border-indigo-200'
                }`}
              >
                <Sparkles size={11} color={showAppStorePreview ? '#FFFFFF' : '#4338ca'} />
                <Text className={`font-sans font-bold text-[10px] ${showAppStorePreview ? 'text-white' : 'text-indigo-700'}`}>
                  {showAppStorePreview ? 'Hide App Store' : 'App Store Preview'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* SIMULATED APP STORE MOBILE PREVIEW */}
          {showAppStorePreview && (
            <FadeInView>
              <View className="border border-neutral-300 rounded-3xl bg-neutral-900 p-3">
                {/* Internal Screen */}
                <View className="bg-neutral-50 rounded-2xl overflow-hidden border border-neutral-800">
                  {/* App Store Page Header */}
                  <View className="bg-white border-b border-neutral-100 px-4 py-2.5 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <View className="w-10 h-10 bg-indigo-900 items-center justify-center rounded-xl border border-indigo-800">
                        <Text className="text-white font-serif font-black text-sm">SP</Text>
                      </View>
                      <View>
                        <Text className="text-xs font-black text-[#1A1A1A] leading-tight">Scripture Pacing</Text>
                        <Text className="text-[8px] text-neutral-400">Memory Circles & Pacing</Text>
                      </View>
                    </View>
                    <View className="bg-indigo-600 px-3 py-1 rounded-full">
                      <Text className="text-white font-black text-[9px] uppercase tracking-wider">GET</Text>
                    </View>
                  </View>

                  {/* Invitation Body inside App Store view */}
                  <View className="p-4" style={{ gap: 16 }}>
                    <View className="bg-white border border-neutral-200 rounded-xl p-3 items-center" style={{ gap: 8 }}>
                      <View className="w-8 h-8 bg-neutral-100 rounded-full items-center justify-center">
                        <Users size={14} color="#737373" />
                      </View>
                      <View className="items-center">
                        <Text className="text-[7px] uppercase font-bold text-neutral-400 tracking-wider">INVITATION PASS</Text>
                        <Text className="text-xs font-serif font-bold text-neutral-800 leading-snug text-center">
                          Join "{activeCircle.name}"
                        </Text>
                        <Text className="text-[9px] text-neutral-400 mt-1 font-sans text-center">
                          Invited by <Text className="text-neutral-700 font-bold">{activeCircle.ownerName}</Text>
                        </Text>
                      </View>
                      <Text className="text-[9.5px] text-neutral-500 leading-normal bg-neutral-50 px-2 py-1.5 rounded-lg font-sans border border-neutral-100 text-center">
                        "{activeCircle.description}"
                      </Text>
                    </View>

                    <View style={{ gap: 6 }}>
                      <View className="flex-row justify-between">
                        <Text className="text-[9px] font-sans text-neutral-400">Active Members:</Text>
                        <Text className="text-[9px] font-sans font-bold text-neutral-800">{activeCircleMembers.length} Members</Text>
                      </View>
                      <View className="flex-row justify-between">
                        <Text className="text-[9px] font-sans text-neutral-400">Invite Code:</Text>
                        <Text className="text-[9px] font-mono font-bold text-indigo-600 tracking-wider uppercase">{activeCircle.inviteCode}</Text>
                      </View>
                    </View>

                    <View className="pt-2 border-t border-dashed border-neutral-200" style={{ gap: 8 }}>
                      <Text className="text-center text-[8px] font-bold text-neutral-400 uppercase tracking-widest font-sans">
                        👇 STEP 1: DOWNLOAD APP
                      </Text>

                      <Pressable
                        onPress={() => triggerToast('Downloaded Scripture Pacing App! (Simulation) 📥')}
                        className="w-full bg-[#1A1A1A] py-2 rounded-xl flex-row items-center justify-center gap-1.5"
                      >
                        <Check size={10} color="#FFFFFF" />
                        <Text className="text-white text-[9px] font-bold uppercase tracking-wider">Download on the App Store</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => triggerToast('Downloaded on Google Play! (Simulation) 📥')}
                        className="w-full bg-white border border-neutral-300 py-2 rounded-xl flex-row items-center justify-center gap-1.5"
                      >
                        <Text className="text-neutral-800 text-[9px] font-bold uppercase tracking-wider">Download on Google Play</Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Fake Home Indicator Bar */}
                  <View className="bg-white py-2 items-center justify-center">
                    <View className="w-20 h-1 bg-neutral-300 rounded-full" />
                  </View>
                </View>
              </View>
            </FadeInView>
          )}
        </View>

        {/* LEAVE OR DISBAND ACTIONS */}
        <Pressable onPress={handleLeaveOrDisband} className="w-full py-2.5 bg-red-50 border border-red-200 rounded-xl items-center justify-center">
          <Text className="text-red-600 font-sans font-bold text-xs text-center">
            {isLeaderOrAdmin ? 'Disband & Delete Scripture Circle' : 'Leave Circle'}
          </Text>
        </Pressable>
      </ScrollView>
    </FadeInView>
  );
}

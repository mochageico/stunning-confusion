import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
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

import { useThemeColors } from '../components/theme';
export default function CommunityGroupDetailScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
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
  // The invite code + share link used to sit permanently in the page. It's a
  // once-in-a-while action, so it now lives behind the share button in the
  // header rather than taking up a card on every visit.
  const [showInvite, setShowInvite] = useState(false);

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
          <AppText variant="label" className="text-ink-3 font-sans">Loading circle…</AppText>
        </View>
      </FadeInView>
    );
  }

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header Row: back, privacy badge, settings */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2.5">
            <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={closeConsole} className="rounded-full border border-line bg-surface" />
            <View className="flex-row items-center gap-1 bg-surface-2 px-2.5 py-1 rounded-full">
              {activeCircle.isPublic ? <Globe size={10} color={palette.ink2} /> : <Lock size={10} color={palette.ink2} />}
              <AppText variant="micro" className="font-sans font-bold text-ink-2 uppercase tracking-wide">
                {activeCircle.isPublic ? 'Public' : 'Private'}
              </AppText>
            </View>
          </View>

          {/* Icon-only. As labelled buttons these two ran past the edge of a
              375pt row that also holds a back button and a privacy badge --
              and "Group Chat" next to a speech bubble was saying it twice. */}
          <View className="flex-row items-center gap-2">
            <AppIconButton
              Icon={MessageCircle}
              diameter={32}
              iconSize={15}
              iconColor={palette.ink2}
              onPress={() => openCircleChat(activeCircle.id)}
              accessibilityLabel="Group chat"
              className="rounded-full border border-line-strong bg-surface"
            />
            {isLeaderOrAdmin && (
              <AppIconButton
                Icon={Sliders}
                diameter={32}
                iconSize={15}
                iconColor={isEditingCircleSettings ? palette.onAccent : palette.ink2}
                onPress={() => setIsEditingCircleSettings(!isEditingCircleSettings)}
                accessibilityLabel={isEditingCircleSettings ? 'Close circle settings' : 'Circle settings'}
                className={`rounded-full border ${isEditingCircleSettings ? 'bg-accent border-accent' : 'bg-surface border-line-strong'}`}
              />
            )}
            <AppIconButton
              Icon={Share2}
              diameter={32}
              iconSize={15}
              iconColor={showInvite ? palette.onAccent : palette.ink2}
              onPress={() => setShowInvite((v) => !v)}
              accessibilityLabel="Share invite"
              className={`rounded-full border ${showInvite ? 'bg-accent border-accent' : 'bg-surface border-line-strong'}`}
            />
          </View>
        </View>

        {/* Hero: name + description. The "Scripture Circle" eyebrow above the
            name is gone -- you just tapped a circle to get here, so the label
            was restating the screen you are already on. */}
        <View className="border-b border-line pb-4" style={{ gap: 6 }}>
          <AppText variant="title" className="leading-tight font-serif font-black text-ink">{activeCircle.name}</AppText>
          {!!activeCircle.description && (
            <AppText variant="caption" className="text-ink-2 leading-relaxed font-sans">
              {activeCircle.description}
            </AppText>
          )}
          <View className="flex-row gap-5 pt-1 items-end">
            <View>
              <AppText variant="micro" className="text-ink-3 uppercase tracking-wider">Owner</AppText>
              <AppText variant="caption" className="font-semibold text-ink-2 font-sans mt-0.5">{activeCircle.ownerName}</AppText>
            </View>
            <View>
              <AppText variant="micro" className="text-ink-3 uppercase tracking-wider">Role</AppText>
              <AppText variant="caption" className="font-bold text-ink font-sans mt-0.5">{isLeaderOrAdmin ? 'Leader' : 'Member'}</AppText>
            </View>
            <Pressable onPress={() => setShowMembersModal(true)}>
              <AppText variant="micro" className="text-ink-3 uppercase tracking-wider">
                Members ({activeCircleMembers.length})
              </AppText>
              <View className="flex-row items-center mt-1.5">
                {activeCircleMembers.slice(0, 4).map((member, idx) => (
                  <View key={member.uid} style={{ marginLeft: idx === 0 ? 0 : -10, zIndex: 4 - idx }}>
                    <AvatarCircle name={member.displayName} photoUri={member.avatarUrl} size={24} />
                  </View>
                ))}
                {activeCircleMembers.length === 0 && (
                  <AppText variant="caption" className="text-ink-3 font-sans">No members yet</AppText>
                )}
              </View>
            </Pressable>
          </View>
        </View>

        {/* EDIT CIRCLE SETTINGS PANEL */}
        {isEditingCircleSettings && isLeaderOrAdmin && (
          <FadeInView>
            <View className="bg-surface-2 border border-line rounded-xl p-4" style={{ gap: 12 }}>
              <View className="flex-row justify-between items-center pb-2 border-b border-line">
                <View className="flex-row items-center gap-1.5">
                  <Sliders size={12} color={palette.accent} />
                  <AppText variant="label" className="font-black font-sans text-ink uppercase tracking-wider">Leader Circle Customization</AppText>
                </View>
                <AppText variant="micro" className="uppercase tracking-widest font-black text-accent bg-accent-soft px-2 py-0.5 rounded-full">ADMIN</AppText>
              </View>

              <View style={{ gap: 12 }}>
                <View>
                  <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3 mb-1">Circle Display Name</AppText>
                  <AppTextInput defaultValue={activeCircle.name} onEndEditing={(e) => { const val = e.nativeEvent.text.trim(); if (val && val !== activeCircle.name) { updateActiveCircle({ name: val }); triggerToast('Updated Circle Name! 🏷️'); } }} className="w-full px-3 py-2 bg-surface border border-line-strong rounded-xl font-bold text-ink" placeholder="Group Name" />
                </View>

                <View>
                  <AppText variant="micro" className="font-extrabold uppercase tracking-wider text-ink-3 mb-1">Description / Goal</AppText>
                  <AppTextInput defaultValue={activeCircle.description} onEndEditing={(e) => { const val = e.nativeEvent.text.trim(); if (val !== activeCircle.description) { updateActiveCircle({ description: val }); triggerToast('Updated description goal! ✏️'); } }} multiline numberOfLines={2} textAlignVertical="top" className="w-full px-3 py-2 bg-surface border border-line-strong rounded-xl text-ink-2 font-sans" placeholder="E.g. A community focused on scripture memory." />
                </View>

                <View className="flex-row justify-between items-center gap-3 py-2 bg-surface px-3 border border-line rounded-xl">
                  {/* The button is one word now. "Public Directory" in
                      tracked uppercase could not fit beside a two-line label
                      on a 375pt row, so it ran off the card. */}
                  <View className="flex-1">
                    <AppText variant="caption" className="font-bold text-ink">Privacy</AppText>
                    <AppText variant="micro" className="text-ink-3 font-sans">Listed in the directory, or invite-only</AppText>
                  </View>
                  <Pressable
                    onPress={() => {
                      const nextPub = !activeCircle.isPublic;
                      updateActiveCircle({ isPublic: nextPub });
                      triggerToast(nextPub ? 'Circle is now Public! 🌐' : 'Circle is now Private (Invite Only)! 🔒');
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded-lg border ${
                      activeCircle.isPublic ? 'bg-success-soft border-success/30' : 'bg-warning-soft border-warning/30'
                    }`}
                  >
                    <AppText variant="micro" numberOfLines={1} className={`font-bold font-sans uppercase tracking-wider ${ activeCircle.isPublic ? 'text-success' : 'text-warning' }`} >
                      {activeCircle.isPublic ? 'Public' : 'Private'}
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
            <AppText variant="label" className="font-sans font-extrabold text-ink-3 tracking-wider uppercase">
              Group Plans ({activeCircleGroupPlans.length})
            </AppText>

            {/* Add Group Plan Button (Leaders/Mentors only) */}
            {isLeaderOrAdmin && (
              <AppButton size="sm" onPress={() => { setShowCreatePlanForm(!showCreatePlanForm); setNewPlanName(''); setNewPlanDesc(''); }} className="bg-accent-soft border border-accent/30 rounded-lg flex-row items-center gap-1">
                <Plus size={10} color={palette.accent} />
                <AppText variant="micro" className="font-bold text-accent">
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
              <View className="bg-surface-2 border border-line rounded-xl p-4" style={{ gap: 12 }}>
                <View className="flex-row justify-between items-center border-b border-hairline pb-1.5">
                  <AppText variant="section" className="font-black uppercase tracking-wider text-ink-3">New Group Plan</AppText>
                  <AppText variant="micro" className="bg-accent-soft text-accent px-2 py-0.5 rounded uppercase font-black">SPONSOR</AppText>
                </View>

                <View style={{ gap: 8 }}>
                  <View>
                    <AppText variant="micro" className="font-bold text-ink-3 uppercase tracking-widest mb-0.5">Plan Title</AppText>
                    <AppTextInput value={newPlanName} onChangeText={setNewPlanName} className="w-full bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-ink font-sans" placeholder="E.g. Wednesday Night Romans Study" placeholderTextColor={palette.ink3} />
                  </View>

                  <View>
                    <AppText variant="micro" className="font-bold text-ink-3 uppercase tracking-widest mb-0.5 font-sans">Description</AppText>
                    <AppTextInput value={newPlanDesc} onChangeText={setNewPlanDesc} multiline numberOfLines={2} textAlignVertical="top" className="w-full bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-ink font-sans" placeholder="What is this plan for, and who's it for?" placeholderTextColor={palette.ink3} />
                  </View>

                  {/* Actions */}
                  <View className="flex-row justify-end gap-2 pt-2 border-t border-hairline">
                    <Pressable
                      onPress={() => setShowCreatePlanForm(false)}
                      className="bg-surface border border-line-strong px-3 py-1.5 rounded-lg"
                    >
                      <AppText variant="micro" className="text-ink-2 font-bold uppercase">Cancel</AppText>
                    </Pressable>
                    <Pressable onPress={handleCreatePlan} className="bg-accent px-4 py-1.5 rounded-lg">
                      <AppText variant="micro" className="text-on-accent font-bold uppercase tracking-wider">Create Plan</AppText>
                    </Pressable>
                  </View>
                </View>
              </View>
            </FadeInView>
          )}

          {/* List of the circle's Group Plans -- each tap opens its own landing page */}
          <View style={{ gap: 12 }}>
            {activeCircleGroupPlans.length === 0 ? (
              <View className="p-4 border border-dashed border-line rounded-2xl items-center">
                <AppText variant="micro" className="text-center text-ink-3 font-sans">
                  No group plans yet. {isLeaderOrAdmin && 'Create one above.'}
                </AppText>
              </View>
            ) : (
              activeCircleGroupPlans.map((plan) => {
                const isJoined = joinedGroupPlanMemberships.some((m) => m.planId === plan.planId);

                return (
                  <Pressable
                    key={plan.planId}
                    onPress={() => openGroupPlan(plan)}
                    className="border border-line rounded-xl p-3.5 bg-surface shadow-sm"
                    style={{ gap: 10 }}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <AppText variant="label" className="font-sans font-black text-ink leading-tight">{plan.name}</AppText>
                        <AppText variant="micro" className="font-sans text-ink-3 mt-0.5">
                          Managed by <AppText variant="inherit" className="font-semibold text-ink">{plan.managerName || 'Leader'}</AppText>
                        </AppText>
                      </View>
                      <View className="flex-row items-center gap-1">
                        {isJoined && (
                          <AppText variant="micro" className="bg-success-soft border border-success/30 text-success font-sans font-bold px-1.5 py-0.5 rounded uppercase">
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
                            <Trash2 size={11} color={palette.danger} />
                          </Pressable>
                        )}
                      </View>
                    </View>

                    {plan.description && <AppText variant="caption" className="text-ink-3 font-sans leading-normal">{plan.description}</AppText>}

                    <View className="flex-row py-1.5 border-y border-dashed border-hairline gap-2">
                      <View className="flex-1">
                        <AppText variant="micro" className="text-ink-3 uppercase">Pace</AppText>
                        <AppText variant="caption" className="font-bold text-ink font-sans">{plan.versesPerWeek} verses/wk</AppText>
                      </View>
                      <View className="flex-1">
                        <AppText variant="micro" className="text-ink-3 uppercase">Verses in Plan</AppText>
                        <AppText variant="caption" className="font-bold text-ink font-sans">{plan.verseIds.length}</AppText>
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
            <AppText variant="label" className="font-sans font-extrabold text-ink-3 tracking-wider uppercase">
              Challenges ({activeCircleChallenges.length})
            </AppText>
            <AppButton size="sm" onPress={() => setShowCreateChallengeForm(!showCreateChallengeForm)} className="bg-warning-soft border border-warning/30 rounded-lg flex-row items-center gap-1">
              <Trophy size={10} color={palette.warning} />
              <AppText variant="micro" className="font-bold text-warning">
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
              <View className="p-6 border border-dashed border-line rounded-2xl items-center">
                <AppText variant="label" className="text-center text-ink-3 font-sans">
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
                    className="border border-line rounded-xl p-3.5 bg-surface shadow-sm"
                    style={{ gap: 8 }}
                  >
                    <View className="flex-row justify-between items-start">
                      <View className="flex-1 pr-2">
                        <AppText variant="label" className="font-sans font-black text-ink leading-tight">{challenge.title}</AppText>
                        <AppText variant="micro" className="font-sans text-ink-3 mt-0.5">
                          {reference} • by {challenge.createdByName}
                        </AppText>
                      </View>
                      {challenge.status === 'completed' && (
                        <AppText variant="micro" className="bg-surface-2 border border-line text-ink-3 font-sans font-bold px-1.5 py-0.5 rounded uppercase">
                          Ended
                        </AppText>
                      )}
                    </View>

                    {membership ? (
                      <View style={{ gap: 3 }}>
                        <View className="flex-row justify-between">
                          <AppText variant="micro" className="font-sans font-bold text-ink-2">Your progress</AppText>
                          <AppText variant="micro" className="font-mono text-ink-3">
                            {myProgress}/{challenge.totalVerses}
                          </AppText>
                        </View>
                        <ProgressBar percent={(myProgress / Math.max(1, challenge.totalVerses)) * 100} />
                      </View>
                    ) : (
                      challenge.status === 'active' && (
                        <AppButton size="md" onPress={(e) => { e.stopPropagation(); joinGroupChallenge(challenge); }} className="bg-accent rounded-lg items-center">
                          <AppText variant="micro" className="text-on-accent font-bold uppercase tracking-wide">Join Challenge</AppText>
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
                          <AppText variant="micro" className="font-sans font-bold text-ink-3 uppercase tracking-wide">End Challenge</AppText>
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
                            <AppText variant="micro" className="font-sans font-bold text-ink-3 uppercase tracking-wide">Leave</AppText>
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
                            <Trash2 size={12} color={palette.ink3} />
                          </Pressable>
                        )}
                      </View>
                    </View>

                    {confirmDeleteChallengeId === challenge.id && (
                      <View className="border border-line bg-surface-2 rounded-lg p-2.5" style={{ gap: 8 }}>
                        <AppText variant="caption" className="font-sans text-ink-2 leading-snug">
                          Delete "{challenge.title}" for the whole circle? Everyone keeps the verses already in their
                          queue — only the race and its leaderboard go away.
                        </AppText>
                        <View className="flex-row gap-2">
                          <AppButton size="md" onPress={(e) => { e.stopPropagation(); setConfirmDeleteChallengeId(null); }} className="flex-1 bg-surface border border-line-strong rounded-lg items-center">
                            <AppText variant="micro" className="text-ink-2 font-bold uppercase tracking-wide">Keep</AppText>
                          </AppButton>
                          <AppButton size="md" onPress={(e) => { e.stopPropagation(); setConfirmDeleteChallengeId(null); deleteGroupChallenge(challenge); }} className="flex-1 bg-danger rounded-lg items-center">
                            <AppText variant="micro" className="text-on-accent font-bold uppercase tracking-wide">Delete</AppText>
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
        {showInvite && (
        <View className="bg-surface-2 border border-line rounded-xl p-3.5" style={{ gap: 10 }}>
          {/* Three stacked labels ("Invite & Join Gateway" / "Add Members" /
              a sentence) all said the same thing. The share button that opens
              this panel already establishes what it is. */}
          <AppText variant="caption" className="text-ink-3 leading-relaxed font-sans">
            Anyone with this code or link can join from the Find Circle screen.
          </AppText>

          {/* Code and Link Box */}
          <View style={{ gap: 8 }}>
            <View className="flex-row gap-2">
              <View className="flex-1 bg-surface border border-dashed border-line-strong rounded-lg p-2 items-center justify-center">
                <AppText variant="micro" className="text-ink-3 uppercase font-sans font-black">Invite Code</AppText>
                <AppText variant="label" className="font-mono font-black text-ink tracking-widest uppercase">{activeCircle.inviteCode}</AppText>
              </View>
              <View className="flex-[2] bg-surface border border-line rounded-lg p-2 justify-center">
                <AppText variant="micro" className="font-mono text-ink-3" numberOfLines={1} ellipsizeMode="tail">
                  {shareUrl}
                </AppText>
              </View>
            </View>

            <View className="flex-row gap-2">
              <AppButton size="sm" onPress={async () => { await Clipboard.setStringAsync(shareUrl); triggerToast('Share link copied to clipboard! 📋'); }} className="flex-1 bg-surface border border-line-strong rounded-lg flex-row items-center justify-center gap-1.5">
                <Share2 size={11} color={palette.ink} />
                <AppText variant="caption" className="text-ink font-sans font-bold ">Copy Share Link</AppText>
              </AppButton>
            </View>
          </View>
        </View>
        )}

        {/* LEAVE OR DISBAND ACTIONS */}
        {showLeaveDisbandConfirm ? (
          <View className="bg-danger-soft border border-danger/30 rounded-xl p-3" style={{ gap: 8 }}>
            <AppText variant="caption" className="font-sans font-bold text-danger">Disband this circle?</AppText>
            <AppText variant="micro" className="font-sans text-danger leading-relaxed">
              "{activeCircle.name}" and its shared plans will be permanently deleted for everyone. This can't be undone.
            </AppText>
            <View className="flex-row gap-2 justify-end pt-1">
              <Pressable
                onPress={() => setShowLeaveDisbandConfirm(false)}
                className="px-3 py-1.5 border border-line-strong rounded-lg bg-surface"
              >
                <AppText variant="caption" className="text-ink-2 font-sans font-bold ">Cancel</AppText>
              </Pressable>
              <Pressable onPress={confirmDisband} className="px-3 py-1.5 bg-danger rounded-lg">
                <AppText variant="caption" className="text-on-accent font-sans font-bold ">Yes, Disband</AppText>
              </Pressable>
            </View>
          </View>
        ) : (
          <AppButton size="md" onPress={handleLeaveOrDisband} className="w-full bg-danger-soft border border-danger/30 rounded-xl items-center justify-center">
            <AppText variant="label" className="text-danger font-sans font-bold text-center">
              {isLeaderOrAdmin ? 'Disband & Delete Scripture Circle' : 'Leave Circle'}
            </AppText>
          </AppButton>
        )}
      </ScrollView>

      {/* Members popup — scrollable list, tap a member to view their profile */}
      <Modal visible={showMembersModal} animationType="slide" transparent onRequestClose={() => setShowMembersModal(false)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-surface rounded-t-3xl" style={{ height: '70%' }}>
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-hairline">
              <AppText variant="title" className="font-serif font-bold text-ink">
                Members ({activeCircleMembers.length})
              </AppText>
              <AppIconButton Icon={X} diameter={28} iconSize={14} iconColor={palette.ink} onPress={() => setShowMembersModal(false)} className="rounded-full border border-line-strong" />
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
                    className="flex-row items-center justify-between bg-surface-2 px-3 py-2.5 rounded-xl border border-hairline mb-2"
                  >
                    <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                      <AvatarCircle name={member.displayName} photoUri={member.avatarUrl} size={32} />
                      <AppText variant="label" className={`font-sans font-bold flex-1 ${isSelf ? 'text-accent font-extrabold' : 'text-ink-2'}`} numberOfLines={1} ellipsizeMode="tail" >
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
                        <AppText variant="label" className="text-danger font-bold ">×</AppText>
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
          <View className="bg-surface rounded-t-3xl" style={{ height: '70%' }}>
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-hairline">
              <AppText variant="title" className="font-serif font-bold text-ink">🏆 Leaderboard</AppText>
              <AppIconButton Icon={X} diameter={28} iconSize={14} iconColor={palette.ink} onPress={closeChallengeLeaderboard} className="rounded-full border border-line-strong" />
            </View>

            {loadingChallengeLeaderboard ? (
              <AppText variant="label" className="text-ink-3 font-sans text-center mt-6">Loading…</AppText>
            ) : openChallengeLeaderboard.length === 0 ? (
              <AppText variant="label" className="text-ink-3 font-sans text-center mt-6">No one has joined yet.</AppText>
            ) : (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
                {openChallengeLeaderboard.map((participant, idx) => {
                  const challenge = activeCircleChallenges.find((c) => c.id === openChallengeLeaderboardId);
                  const total = challenge?.totalVerses || 1;
                  const isSelf = participant.uid === user?.uid;
                  return (
                    <View
                      key={participant.uid}
                      className="flex-row items-center gap-2.5 bg-surface-2 px-3 py-2.5 rounded-xl border border-hairline mb-2"
                    >
                      <AppText variant="caption" className="font-mono font-bold text-ink-3 w-4">{idx + 1}</AppText>
                      <AvatarCircle name={participant.name} photoUri={participant.avatarUrl} size={28} />
                      <View className="flex-1" style={{ gap: 3 }}>
                        <AppText variant="label" className={`font-sans font-bold ${isSelf ? 'text-accent' : 'text-ink-2'}`}>
                          {isSelf ? `${participant.name} (Me)` : participant.name}
                          {participant.progress >= total ? ' 🏁' : ''}
                        </AppText>
                        <ProgressBar percent={(participant.progress / total) * 100} />
                      </View>
                      <AppText variant="micro" className="font-mono text-ink-3">
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

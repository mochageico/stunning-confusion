import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { BookOpen, ChevronRight, Link as LinkIcon, LogOut, MessageCircle, Share2, Sliders, Trash2, Trophy } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Circle, CircleMember, GroupChallenge, GroupPlan } from '../types';
import { FadeInView, ProgressBar } from '../components/ui';
import { ChallengeCreateInline } from '../components/ChallengeCard';
import { AppButton, AppIconButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { Avatar, Badge, CollapsibleSection, Dialog, EmptyState, GroupedList, ListRow, ScreenHeader, SegmentedControl } from '../components/blocks';
import { useThemeColors } from '../components/theme';
import { buildInviteUrl } from '../lib/invites';
import { combineCircle, weekBounds } from '../lib/circleTotals';
import { CircleTotalsCard } from '../components/CircleTotalsCard';

const PRIVACY_OPTIONS = [
  { id: 'public' as const, label: 'Public' },
  { id: 'private' as const, label: 'Private' },
];

export default function CommunityGroupDetailScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const {
    user,
    activeCircle,
    activeCircleMembers,
    activeCircleGroupPlans,
    loadingActiveCircle,
    updateCircleSettings,
    createGroupPlan,
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
    circleStats,
    loadCircleStats,
    dayStartHour,
  } = state;

  const [showCreateChallengeForm, setShowCreateChallengeForm] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showLeaveDisbandConfirm, setShowLeaveDisbandConfirm] = useState(false);
  // The dialogs below each keep the thing they're about after they close, on
  // a separate flag, so their title doesn't blank out during the fade.
  const [removeTarget, setRemoveTarget] = useState<CircleMember | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GroupChallenge | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftPublic, setDraftPublic] = useState(true);

  const isLeaderOrAdmin = !!activeCircle && !!user && activeCircle.ownerId === user.uid;

  // This week together: everyone's stats docs, added up over the current
  // member list only (someone who left drops out; no doc yet = zero).
  const circleId = activeCircle?.id;
  useEffect(() => {
    if (circleId) loadCircleStats(circleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId]);
  const loadedStats = circleId ? circleStats[circleId] : undefined;
  const totals = useMemo(
    () =>
      loadedStats && !loadedStats.loading
        ? combineCircle(activeCircleMembers, loadedStats.stats, loadedStats.sharedThisWeek, weekBounds(new Date(), dayStartHour))
        : null,
    [loadedStats, activeCircleMembers, dayStartHour]
  );

  // The settings dialog edits a copy and applies it on Save, so a half-typed
  // name is never written to the circle.
  useEffect(() => {
    if (isEditingCircleSettings && activeCircle) {
      setDraftName(activeCircle.name);
      setDraftDesc(activeCircle.description || '');
      setDraftPublic(activeCircle.isPublic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditingCircleSettings]);

  const saveSettings = () => {
    if (!activeCircle) return;
    const name = draftName.trim();
    if (!name) {
      triggerToast('A circle needs a name.');
      return;
    }
    const fields: Partial<Pick<Circle, 'name' | 'description' | 'isPublic'>> = {};
    if (name !== activeCircle.name) fields.name = name;
    if (draftDesc.trim() !== (activeCircle.description || '')) fields.description = draftDesc.trim();
    if (draftPublic !== activeCircle.isPublic) fields.isPublic = draftPublic;
    if (Object.keys(fields).length > 0) {
      updateCircleSettings(activeCircle.id, fields);
      triggerToast('Circle updated.');
    }
    setIsEditingCircleSettings(false);
  };

  const shareUrl = activeCircle ? buildInviteUrl(activeCircle.inviteCode) : '';

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

  const openGroupPlan = (plan: GroupPlan) => {
    setViewingGroupPlan(plan);
    navigateTo('groupPlanDetail');
  };

  const confirmLeaveOrDisband = async () => {
    if (!activeCircle) return;
    setShowLeaveDisbandConfirm(false);
    if (isLeaderOrAdmin) {
      await disbandCircle(activeCircle.id);
    } else {
      leaveCircle(activeCircle.id);
    }
    clearGroupPlanMembershipsForCircle(activeCircle.id);
    clearGroupChallengeMembershipsForCircle(activeCircle.id);
  };

  const fieldLabel = (text: string) => (
    <AppText variant="caption" className="font-sans font-medium text-ink-2">
      {text}
    </AppText>
  );
  const inputBox = 'bg-surface border border-line rounded-btn text-ink font-sans';
  const inputStyle = { paddingHorizontal: space(12), paddingVertical: space(10) };

  if (loadingActiveCircle || !activeCircle) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center">
          <AppText variant="label" className="text-ink-3 font-sans">Loading circle…</AppText>
        </View>
      </FadeInView>
    );
  }

  const leaderboardChallenge = activeCircleChallenges.find((c) => c.id === openChallengeLeaderboardId);
  const leaderboardTotal = leaderboardChallenge?.totalVerses || 1;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title={activeCircle.name}
          eyebrow={activeCircle.isPublic ? 'Public circle' : 'Private circle'}
          subtitle={activeCircle.description || undefined}
          onBack={closeConsole}
          backLabel="Community"
          actions={
            <>
              <AppIconButton Icon={Share2} variant="outline" diameter={36} accessibilityLabel="Invite people" onPress={() => setShowInvite(true)} />
              {isLeaderOrAdmin && (
                <AppIconButton
                  Icon={Sliders}
                  variant="outline"
                  diameter={36}
                  accessibilityLabel="Circle settings"
                  onPress={() => setIsEditingCircleSettings(true)}
                />
              )}
            </>
          }
        />

        {/* Who's here, at a glance -- the way a group page in a messaging or
            club app leads with its people. Tap for the full list. The avatars
            carry a ring in the card's own color so the overlap doesn't cut
            an initial. */}
        <Pressable
          onPress={() => setShowMembers(true)}
          accessibilityRole="button"
          accessibilityLabel={`Members, ${activeCircleMembers.length}`}
          className="flex-row items-center bg-surface border border-line rounded-card active:bg-surface-2"
          style={{ padding: space(14), gap: space(12) }}
        >
          <View className="flex-row items-center shrink-0">
            {activeCircleMembers.slice(0, 4).map((member, idx) => (
              <View key={member.uid} style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: 4 - idx }}>
                <Avatar name={member.displayName} photoUri={member.avatarUrl} size={36} ring />
              </View>
            ))}
          </View>
          <AppText variant="body" className="font-sans font-semibold text-ink flex-1">
            {activeCircleMembers.length} {activeCircleMembers.length === 1 ? 'member' : 'members'}
          </AppText>
          <ChevronRight size={18} color={palette.ink3} strokeWidth={2.4} />
        </Pressable>

        {totals && <CircleTotalsCard circleName={activeCircle.name} totals={totals} myUid={user?.uid} />}

        <AppButton
          size="lg"
          variant="secondary"
          Icon={MessageCircle}
          label={state.isCircleChatUnread(activeCircle.id) ? 'Open group chat · new messages' : 'Open group chat'}
          onPress={() => openCircleChat(activeCircle.id)}
        />

        {/* GROUP PLANS */}
        <CollapsibleSection
          storageKey="circle.plans"
          title={`Group plans · ${activeCircleGroupPlans.length}`}
          actionLabel={isLeaderOrAdmin ? (showCreatePlanForm ? 'Cancel' : 'New plan') : undefined}
          onAction={() => {
            setShowCreatePlanForm(!showCreatePlanForm);
            setNewPlanName('');
            setNewPlanDesc('');
          }}
        >

          {/* Title and description only. The verses and weekly pace are set
              up afterward, on the plan's own page. */}
          {showCreatePlanForm && isLeaderOrAdmin && (
            <FadeInView>
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
                <View style={{ gap: space(4) }}>
                  {fieldLabel('Plan name')}
                  <AppTextInput
                    value={newPlanName}
                    onChangeText={setNewPlanName}
                    placeholder="e.g. Romans 8 together"
                    accessibilityLabel="Plan name"
                    variant="body"
                    className={inputBox}
                    style={inputStyle}
                  />
                </View>
                <View style={{ gap: space(4) }}>
                  {fieldLabel('Description (optional)')}
                  <AppTextInput
                    value={newPlanDesc}
                    onChangeText={setNewPlanDesc}
                    placeholder="What is this plan for?"
                    accessibilityLabel="Plan description"
                    multiline
                    numberOfLines={2}
                    textAlignVertical="top"
                    variant="body"
                    className={inputBox}
                    style={{ ...inputStyle, minHeight: space(72) }}
                  />
                </View>
                <View className="flex-row flex-wrap justify-end" style={{ gap: space(8) }}>
                  <AppButton variant="quiet" label="Cancel" onPress={() => setShowCreatePlanForm(false)} />
                  <AppButton variant="primary" label="Create plan" onPress={handleCreatePlan} />
                </View>
              </View>
            </FadeInView>
          )}

          {activeCircleGroupPlans.length === 0 ? (
            <View className="bg-surface border border-line rounded-card">
              <EmptyState
                Icon={BookOpen}
                title="No group plans yet"
                message={isLeaderOrAdmin ? 'A plan gives everyone in the circle the same verses to work on.' : "The leader hasn't set one up yet."}
                actionLabel={isLeaderOrAdmin && !showCreatePlanForm ? 'New plan' : undefined}
                onAction={() => setShowCreatePlanForm(true)}
              />
            </View>
          ) : (
            <GroupedList>
              {activeCircleGroupPlans.map((plan) => {
                const isJoined = joinedGroupPlanMemberships.some((m) => m.planId === plan.planId);
                return (
                  <ListRow
                    key={plan.planId}
                    Icon={BookOpen}
                    title={plan.name}
                    subtitle={`${isJoined && scale >= 1.3 ? 'Joined · ' : ''}${plan.versesPerWeek} verses a week · ${plan.verseIds.length} in the plan`}
                    onPress={() => openGroupPlan(plan)}
                    accessory={
                      <View className="flex-row items-center" style={{ gap: space(6) }}>
                        {isJoined && scale < 1.3 && <Badge label="Joined" tone="success" />}
                        <ChevronRight size={18} color={palette.ink3} strokeWidth={2.4} />
                      </View>
                    }
                  />
                );
              })}
            </GroupedList>
          )}
        </CollapsibleSection>

        {/* CHALLENGES -- open to any member, not leader-gated (peer
            competition, not curated content). The whole range front-loads
            into a joiner's queue at once, unlike a group plan, which
            trickles verses in weekly. */}
        <CollapsibleSection
          storageKey="circle.challenges"
          title={`Challenges · ${activeCircleChallenges.length}`}
          actionLabel={showCreateChallengeForm ? 'Cancel' : 'New challenge'}
          onAction={() => setShowCreateChallengeForm(!showCreateChallengeForm)}
        >

          {showCreateChallengeForm && (
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

          {activeCircleChallenges.length === 0 ? (
            <View className="bg-surface border border-line rounded-card">
              <EmptyState
                Icon={Trophy}
                title="No challenges yet"
                message="A challenge is a race through a chapter. Any member can start one."
                actionLabel={showCreateChallengeForm ? undefined : 'New challenge'}
                onAction={() => setShowCreateChallengeForm(true)}
              />
            </View>
          ) : (
            <View style={{ gap: space(10) }}>
              {activeCircleChallenges.map((challenge) => {
                const membership = joinedGroupChallenges.find((m) => m.challengeId === challenge.id);
                const myProgress = membership ? countRangeProgress(memoryQueue, membership) : 0;
                const isCreator = !!user && challenge.createdByUid === user.uid;
                const reference =
                  challenge.startVerse != null || challenge.endVerse != null
                    ? `${challenge.book} ${challenge.startChapter}:${challenge.startVerse ?? 1}-${challenge.endVerse ?? ''}`
                    : `${challenge.book} ${challenge.startChapter}`;
                const canEnd = isCreator && challenge.status === 'active';

                return (
                  <Pressable
                    key={challenge.id}
                    onPress={() => openChallengeLeaderboardModal(challenge)}
                    accessibilityRole="button"
                    accessibilityLabel={`${challenge.title} leaderboard`}
                    className="bg-surface border border-line rounded-card active:bg-surface-2"
                    style={{ padding: space(14), gap: space(10) }}
                  >
                    <View className="flex-row items-start justify-between" style={{ gap: space(8) }}>
                      <View className="flex-1" style={{ gap: space(1) }}>
                        <AppText variant="body" className="font-sans font-semibold text-ink">{challenge.title}</AppText>
                        <AppText variant="caption" className="font-sans text-ink-3">
                          {reference} · started by {challenge.createdByName}
                        </AppText>
                      </View>
                      {challenge.status === 'completed' && <Badge label="Ended" />}
                    </View>

                    {membership ? (
                      <View style={{ gap: space(4) }}>
                        <View className="flex-row justify-between" style={{ gap: space(8) }}>
                          <AppText variant="caption" className="font-sans text-ink-2">Your progress</AppText>
                          <AppText variant="caption" className="font-sans text-ink-3">
                            {myProgress} of {challenge.totalVerses}
                          </AppText>
                        </View>
                        <ProgressBar percent={(myProgress / Math.max(1, challenge.totalVerses)) * 100} />
                      </View>
                    ) : (
                      challenge.status === 'active' && (
                        <AppButton
                          variant="secondary"
                          label="Join challenge"
                          onPress={(e) => {
                            e.stopPropagation();
                            joinGroupChallenge(challenge);
                          }}
                        />
                      )
                    )}

                    {/* Three different things, so three buttons: End freezes
                        the race but keeps the card and its leaderboard; Leave
                        drops just you out of a race that stays alive; Delete
                        removes it for the whole circle. */}
                    {(canEnd || membership || isCreator) && (
                      <View className="flex-row flex-wrap items-center" style={{ gap: space(8) }}>
                        {canEnd && (
                          <AppButton
                            size="sm"
                            variant="quiet"
                            label="End challenge"
                            onPress={(e) => {
                              e.stopPropagation();
                              endGroupChallenge(challenge, 'completed');
                            }}
                          />
                        )}
                        {membership && (
                          <AppButton
                            size="sm"
                            variant="quiet"
                            label="Leave"
                            onPress={(e) => {
                              e.stopPropagation();
                              leaveGroupChallenge(challenge);
                            }}
                          />
                        )}
                        {isCreator && (
                          <AppButton
                            size="sm"
                            variant="destructive"
                            label="Delete"
                            Icon={Trash2}
                            onPress={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(challenge);
                              setConfirmingDelete(true);
                            }}
                          />
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </CollapsibleSection>

        <GroupedList>
          <ListRow
            Icon={isLeaderOrAdmin ? Trash2 : LogOut}
            title={isLeaderOrAdmin ? 'Disband circle' : 'Leave circle'}
            destructive
            accessory="none"
            onPress={() => setShowLeaveDisbandConfirm(true)}
          />
        </GroupedList>
      </ScrollView>

      {/* Members */}
      <Dialog visible={showMembers} onClose={() => setShowMembers(false)} placement="sheet" title={`Members · ${activeCircleMembers.length}`}>
        <GroupedList>
          {activeCircleMembers.map((member) => {
            const isSelf = member.uid === user?.uid;
            return (
              <ListRow
                key={member.uid}
                leading={<Avatar name={member.displayName} photoUri={member.avatarUrl} size={36} />}
                title={isSelf ? `${member.displayName} (you)` : member.displayName}
                subtitle={member.role === 'leader' ? 'Leader' : undefined}
                onPress={() => {
                  setShowMembers(false);
                  viewMemberProfileById(member.uid);
                }}
                accessory={
                  isLeaderOrAdmin && !isSelf ? (
                    <AppButton
                      size="sm"
                      variant="destructive"
                      label="Remove"
                      accessibilityLabel={`Remove ${member.displayName}`}
                      onPress={() => {
                        setShowMembers(false);
                        setRemoveTarget(member);
                        setConfirmingRemove(true);
                      }}
                    />
                  ) : (
                    'none'
                  )
                }
              />
            );
          })}
        </GroupedList>
      </Dialog>

      <Dialog
        visible={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title={`Remove ${removeTarget?.displayName ?? 'this member'}?`}
        message="They'll lose access to the circle. They can rejoin with the invite code, or from Find a circle if it's public."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirmingRemove(false)} />
            <AppButton
              variant="destructive"
              label="Remove"
              onPress={() => {
                setConfirmingRemove(false);
                if (removeTarget) removeCircleMember(activeCircle.id, removeTarget.uid);
              }}
            />
          </>
        }
      />

      {/* Invite: the link (to text or email), a QR code (to show someone
          in person -- their camera opens the invite page), and the code. */}
      <Dialog
        visible={showInvite}
        onClose={() => setShowInvite(false)}
        placement="sheet"
        title="Invite people"
        message="Send the link, or let someone scan the code with their phone's camera. Either one brings them straight into this circle."
        actions={
          <>
            <AppButton
              variant="secondary"
              label="Copy link"
              Icon={LinkIcon}
              onPress={async () => {
                await Clipboard.setStringAsync(shareUrl);
                triggerToast('Link copied.');
              }}
            />
            <AppButton
              variant="primary"
              label="Share"
              Icon={Share2}
              onPress={() =>
                Share.share({
                  message: `Join "${activeCircle.name}" on Scripture Memory, so we can memorize together: ${shareUrl}

Or enter code ${activeCircle.inviteCode} under Community > Find a circle.`,
                }).catch(() => undefined)
              }
            />
          </>
        }
      >
        <View className="items-center" style={{ gap: space(12) }}>
          {/* White behind the code whatever the theme: scanners need contrast. theme-ok */}
          <View className="rounded-card border border-line" style={{ padding: space(14), backgroundColor: '#FFFFFF' }}>
            {/* Near-black on white, fixed for the same reason. theme-ok */}
            <QRCode value={shareUrl} size={space(180)} color="#111111" backgroundColor="#FFFFFF" />
          </View>
          <View className="bg-surface-2 border border-line rounded-card items-center self-stretch" style={{ padding: space(12), gap: space(2) }}>
            <AppText variant="caption" className="font-sans text-ink-3">Invite code</AppText>
            <AppText variant="title" className="font-sans font-bold text-ink" style={{ letterSpacing: 3 }} selectable>
              {activeCircle.inviteCode}
            </AppText>
          </View>
        </View>
      </Dialog>

      {/* Circle settings (leader) */}
      <Dialog
        visible={isEditingCircleSettings && isLeaderOrAdmin}
        onClose={() => setIsEditingCircleSettings(false)}
        placement="sheet"
        title="Circle settings"
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setIsEditingCircleSettings(false)} />
            <AppButton variant="primary" label="Save" onPress={saveSettings} />
          </>
        }
      >
        <View style={{ gap: space(4) }}>
          {fieldLabel('Name')}
          <AppTextInput
            value={draftName}
            onChangeText={setDraftName}
            accessibilityLabel="Circle name"
            variant="body"
            className={inputBox}
            style={inputStyle}
          />
        </View>
        <View style={{ gap: space(4) }}>
          {fieldLabel('Description')}
          <AppTextInput
            value={draftDesc}
            onChangeText={setDraftDesc}
            placeholder="What is this circle about?"
            accessibilityLabel="Circle description"
            multiline
            numberOfLines={2}
            textAlignVertical="top"
            variant="body"
            className={inputBox}
            style={{ ...inputStyle, minHeight: space(72) }}
          />
        </View>
        <View style={{ gap: space(6) }}>
          {fieldLabel('Who can join')}
          <SegmentedControl
            value={draftPublic ? 'public' : 'private'}
            onChange={(id) => setDraftPublic(id === 'public')}
            accessibilityLabel="Who can join"
            options={PRIVACY_OPTIONS}
          />
          <AppText variant="caption" className="font-sans text-ink-3">
            {draftPublic ? 'Listed in Find a circle. Anyone can join.' : 'Hidden from search. People join with the invite code.'}
          </AppText>
        </View>
      </Dialog>

      {/* Leave or disband */}
      <Dialog
        visible={showLeaveDisbandConfirm}
        onClose={() => setShowLeaveDisbandConfirm(false)}
        title={isLeaderOrAdmin ? 'Disband this circle?' : 'Leave this circle?'}
        message={
          isLeaderOrAdmin
            ? `"${activeCircle.name}" and its group plans will be deleted for everyone. This can't be undone.`
            : "You'll stop seeing its plans, challenges and chat."
        }
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowLeaveDisbandConfirm(false)} />
            <AppButton variant="destructive" label={isLeaderOrAdmin ? 'Disband' : 'Leave'} onPress={confirmLeaveOrDisband} />
          </>
        }
      />

      {/* Delete a challenge */}
      <Dialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete "${deleteTarget?.title ?? 'this challenge'}"?`}
        message="It's removed for the whole circle. Everyone keeps the verses already in their queue; only the race and its leaderboard go away."
        actions={
          <>
            <AppButton variant="quiet" label="Keep it" onPress={() => setConfirmingDelete(false)} />
            <AppButton
              variant="destructive"
              label="Delete"
              onPress={() => {
                setConfirmingDelete(false);
                if (deleteTarget) deleteGroupChallenge(deleteTarget);
              }}
            />
          </>
        }
      />

      {/* Challenge leaderboard, highest progress first */}
      <Dialog visible={!!openChallengeLeaderboardId} onClose={closeChallengeLeaderboard} placement="sheet" title="Leaderboard">
        {loadingChallengeLeaderboard ? (
          <AppText variant="label" className="font-sans text-ink-3 text-center">Loading…</AppText>
        ) : openChallengeLeaderboard.length === 0 ? (
          <AppText variant="label" className="font-sans text-ink-3 text-center">No one has joined yet.</AppText>
        ) : (
          <GroupedList>
            {openChallengeLeaderboard.map((participant, idx) => {
              const isSelf = participant.uid === user?.uid;
              const done = participant.progress >= leaderboardTotal;
              return (
                <ListRow
                  key={participant.uid}
                  leading={<Avatar name={participant.name} photoUri={participant.avatarUrl} size={36} />}
                  title={`${idx + 1}. ${isSelf ? `${participant.name} (you)` : participant.name}`}
                  subtitle={`${participant.progress} of ${leaderboardTotal} verses`}
                  accessory={done ? <Badge label="Finished" tone="success" /> : 'none'}
                />
              );
            })}
          </GroupedList>
        )}
      </Dialog>
    </FadeInView>
  );
}

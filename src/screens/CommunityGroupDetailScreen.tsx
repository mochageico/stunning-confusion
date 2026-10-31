import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { BookOpen, ChevronRight, Link as LinkIcon, LogOut, MessageCircle, Share2, Sliders, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { Circle, CircleMember, GroupPlan } from '../types';
import { FadeInView, ProgressBar } from '../components/ui';
import { groupPlanProgress } from '../lib/groupPlanProgress';
import { AppButton, AppIconButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { Avatar, Badge, Dialog, EmptyState, GroupedList, ListRow, ScreenHeader, SegmentedControl } from '../components/blocks';
import { useThemeColors } from '../components/theme';
import { buildInviteUrl } from '../lib/invites';
import { combineCircle, weekBounds } from '../lib/circleTotals';
import { CircleTotalsCard } from '../components/CircleTotalsCard';

const PRIVACY_OPTIONS = [
  { id: 'public' as const, label: 'Public' },
  { id: 'private' as const, label: 'Private' },
];

// The line above a tab's list: how many there are, and the one action for it.
function PanelHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  const space = useScaledSpace();
  return (
    <View className="flex-row items-center justify-between" style={{ paddingHorizontal: space(4), gap: space(8) }}>
      <AppText variant="section" className="font-sans font-semibold text-ink-3 shrink">
        {title}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" className="active:opacity-60 shrink-0">
          <AppText variant="section" className="font-sans font-semibold text-accent">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function CommunityGroupDetailScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const [refreshing, setRefreshing] = useState(false);
  const {
    user,
    activeCircle,
    activeCircleMembers,
    activeCircleGroupPlans,
    loadingActiveCircle,
    refreshCommunity,
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
    memoryQueue,
    circleStats,
    loadCircleStats,
    dayStartHour,
  } = state;

  const [showMembers, setShowMembers] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showLeaveDisbandConfirm, setShowLeaveDisbandConfirm] = useState(false);
  // The dialogs below each keep the thing they're about after they close, on
  // a separate flag, so their title doesn't blank out during the fade.
  const [removeTarget, setRemoveTarget] = useState<CircleMember | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftPublic, setDraftPublic] = useState(true);

  const isLeaderOrAdmin = !!activeCircle && !!user && activeCircle.ownerId === user.uid;

  const [tab, setTab] = useState<'week' | 'chat' | 'plans'>('week');
  useEffect(() => {
    setTab('week');
  }, [activeCircle?.id]);
  const chatUnread = !!activeCircle && state.isCircleChatUnread(activeCircle.id);
  // What this person is in the middle of, for "Up next" on This week.
  const myPlans = activeCircleGroupPlans.filter((p) => joinedGroupPlanMemberships.some((m) => m.planId === p.planId));

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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerClassName="p-5 pb-12"
        contentContainerStyle={{ gap: space(20) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={palette.ink3}
            onRefresh={() => {
              setRefreshing(true);
              refreshCommunity().finally(() => setRefreshing(false));
            }}
          />
        }
      >
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
          className="flex-row items-center active:opacity-60"
          style={{ gap: space(12) }}
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

        {/* One topic at a time, so the page is a short header and a tab
            instead of a long scroll. */}
        <SegmentedControl
          accessibilityLabel="Circle sections"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'week', label: 'This week' },
            { id: 'chat', label: chatUnread ? 'Chat •' : 'Chat' },
            { id: 'plans', label: 'Plans' },
          ]}
          wrap
        />

        {tab === 'week' && (
          <View style={{ gap: space(20) }}>
            {totals ? (
              <CircleTotalsCard circleName={activeCircle.name} totals={totals} myUid={user?.uid} />
            ) : (
              <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(24) }}>
                Loading this week…
              </AppText>
            )}

            {myPlans.length > 0 && (
              <GroupedList header="Up next">
                {myPlans.map((plan) => (
                  <ListRow
                    key={plan.planId}
                    Icon={BookOpen}
                    title={plan.name}
                    subtitle={`${plan.versesPerWeek} verses a week`}
                    onPress={() => openGroupPlan(plan)}
                  />
                ))}
              </GroupedList>
            )}

            <GroupedList>
              <ListRow
                Icon={isLeaderOrAdmin ? Trash2 : LogOut}
                title={isLeaderOrAdmin ? 'Disband circle' : 'Leave circle'}
                destructive
                accessory="none"
                onPress={() => setShowLeaveDisbandConfirm(true)}
              />
            </GroupedList>
          </View>
        )}

        {tab === 'chat' && (
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(12) }}>
            <View className="flex-row items-center" style={{ gap: space(10) }}>
              <MessageCircle size={22} color={palette.accent} strokeWidth={2.2} />
              <View className="flex-1">
                <AppText variant="body" className="font-sans font-semibold text-ink">Group chat</AppText>
                <AppText variant="caption" className="font-sans text-ink-3">
                  {chatUnread ? 'You have new messages.' : "You're all caught up."}
                </AppText>
              </View>
            </View>
            <AppButton size="lg" variant="primary" label="Open chat" onPress={() => openCircleChat(activeCircle.id)} />
          </View>
        )}

        {/* GROUP PLANS */}
        {tab === 'plans' && (
        <View style={{ gap: space(10) }}>
        <PanelHeader
          title={`${activeCircleGroupPlans.length} ${activeCircleGroupPlans.length === 1 ? 'plan' : 'plans'}`}
          actionLabel={isLeaderOrAdmin ? (showCreatePlanForm ? 'Cancel' : 'New plan') : undefined}
          onAction={() => {
            setShowCreatePlanForm(!showCreatePlanForm);
            setNewPlanName('');
            setNewPlanDesc('');
          }}
        />

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
            <View style={{ gap: space(10) }}>
              {activeCircleGroupPlans.map((plan) => {
                const isJoined = joinedGroupPlanMemberships.some((m) => m.planId === plan.planId);
                const p = groupPlanProgress(memoryQueue, plan);
                const subtitle = isJoined
                  ? `${p.learned} of ${p.total} learned${p.leftThisWeek > 0 ? ` · ${p.leftThisWeek} to start this week` : ''}`
                  : `${plan.versesPerWeek} verses a week · ${plan.verseIds.length} verses`;
                return (
                  <Pressable
                    key={plan.planId}
                    onPress={() => openGroupPlan(plan)}
                    accessibilityRole="button"
                    accessibilityLabel={`${plan.name}. ${subtitle}`}
                    className="bg-surface border border-line rounded-card active:bg-surface-2"
                    style={{ padding: space(14), gap: space(10) }}
                  >
                    <View className="flex-row items-center" style={{ gap: space(10) }}>
                      <BookOpen size={20} color={palette.accent} strokeWidth={2.2} />
                      <View className="flex-1" style={{ gap: space(1) }}>
                        <AppText variant="body" className="font-sans font-semibold text-ink">{plan.name}</AppText>
                        <AppText variant="caption" className="font-sans text-ink-3">{subtitle}</AppText>
                      </View>
                      {isJoined ? <Badge label="Joined" tone="success" /> : <Badge label="Join" tone="accent" />}
                    </View>
                    {isJoined && <ProgressBar percent={(p.learned / Math.max(1, p.total)) * 100} />}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
        )}
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
        message="They'll lose access to the circle. They can rejoin with the invite code, or from Find circles if it's public."
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

Or enter code ${activeCircle.inviteCode} under Community > Find circles.`,
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
            {draftPublic ? 'Listed in Find circles. Anyone can join.' : 'Hidden from search. People join with the invite code.'}
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
            : "You'll stop seeing its plans and chat."
        }
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowLeaveDisbandConfirm(false)} />
            <AppButton variant="destructive" label={isLeaderOrAdmin ? 'Disband' : 'Leave'} onPress={confirmLeaveOrDisband} />
          </>
        }
      />
    </FadeInView>
  );
}

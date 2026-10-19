import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ban, Bell, Flag, MessageCircle, Trophy, UserMinus, UserPlus, Users } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { ChallengeCreateSheet } from '../components/ChallengeCard';
import { BlockConfirmDialog, ReportSheet } from '../components/chat/ReportSheet';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { Avatar, Badge, Dialog, GroupedList, ListRow, ScreenHeader, SectionHeader, StatRow } from '../components/blocks';

// Reachable from a friends list, a circle's members, a milestone, a search and
// a chat; the back link names whichever it was.
const BACK_LABELS: Partial<Record<string, string>> = {
  community: 'Community',
  findFriends: 'Find friends',
  messages: 'Messages',
  dmThread: 'Messages',
  profile: 'Profile',
};

export default function MemberProfileScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const {
    selectedUserProfile,
    handleBack,
    backHistory,
    openDMThread,
    user,
    friends,
    canSendAccountabilityNudge,
    sendAccountabilityNudge,
    removeFriend,
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
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);

  if (!selectedUserProfile) return null;
  const blocked = state.blockedUids.has(selectedUserProfile.uid);

  const prevScreen = backHistory[backHistory.length - 1]?.screen;
  const isSelf = selectedUserProfile.uid === user?.uid;
  const isFriend = friends.some((f) => f.uid === selectedUserProfile.uid);
  const canNudge = canSendAccountabilityNudge(selectedUserProfile.uid);
  // Friending was previously only reachable from the Find Friends search
  // screen, which meant arriving at someone's profile any other way (circle
  // member list, activity feed, a DM) left no way to add them.
  const incomingFromThem = incomingFriendRequests.find((r) => r.fromUid === selectedUserProfile.uid);
  const outgoingToThem = outgoingFriendRequests.find((r) => r.toUid === selectedUserProfile.uid);
  const asFriend = { uid: selectedUserProfile.uid, displayName: selectedUserProfile.name, avatarUrl: '', friendsSince: '' };

  // Friend-visible sharing: the verse list this member chose to show friends
  // (Settings → Profile Sharing). Only surfaced when the viewer is actually a
  // friend AND the owner opted in, so the snapshot is present.
  //
  // Their Review Settings are deliberately NOT shown or adoptable here -- that
  // whole sharing surface was removed; a retention method is a personal
  // calibration, not something to hand around.
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

  const openNudge = () => {
    if (!canNudge) {
      triggerToast('You already nudged this friend today. You can send another tomorrow.');
      return;
    }
    setNudgeMessage('');
    setShowNudgeCompose(true);
  };

  const communities: string[] = selectedUserProfile.communities || [];

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* The name once, as the title (it used to be here and again in a
            card under the header). */}
        <ScreenHeader title={selectedUserProfile.name} onBack={handleBack} backLabel={(prevScreen && BACK_LABELS[prevScreen]) || 'Back'} />

        <View className="flex-row items-center" style={{ gap: space(14) }}>
          <Avatar name={selectedUserProfile.name} size={56} />
          <AppText variant="label" className="font-sans text-ink-2 flex-1">
            {isSelf ? 'This is you.' : isFriend ? 'Friend' : 'Not friends yet'}
          </AppText>
        </View>

        {!isSelf && (
          <View style={{ gap: space(10) }}>
            <AppButton
              variant="primary"
              Icon={MessageCircle}
              label="Message"
              onPress={() => openDMThread(selectedUserProfile.uid, selectedUserProfile.name, '')}
            />
            {isFriend && (
              // Side by side until the text is big, then stacked.
              <View className={scale >= 1.3 ? '' : 'flex-row'} style={{ gap: space(10) }}>
                <AppButton
                  variant="secondary"
                  Icon={Bell}
                  label="Nudge"
                  style={{ flex: scale >= 1.3 ? undefined : 1, opacity: canNudge ? 1 : 0.55 }}
                  onPress={openNudge}
                />
                <AppButton
                  variant="secondary"
                  Icon={Trophy}
                  label="Challenge"
                  style={{ flex: scale >= 1.3 ? undefined : 1 }}
                  onPress={() => setShowChallengeSheet(true)}
                />
              </View>
            )}
          </View>
        )}

        {/* Friend state for a non-friend: send / cancel / accept, mirroring the
            same four states Find friends already shows. */}
        {!isSelf && !isFriend && (
          <View>
            {incomingFromThem ? (
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
                <AppText variant="label" className="font-sans text-ink-2">
                  {selectedUserProfile.name} sent you a friend request.
                </AppText>
                <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
                  <AppButton variant="primary" label="Accept" onPress={() => acceptFriendRequest(incomingFromThem)} />
                  <AppButton variant="quiet" label="Decline" onPress={() => declineFriendRequest(incomingFromThem)} />
                </View>
              </View>
            ) : outgoingToThem ? (
              <AppButton variant="quiet" label="Request sent. Tap to cancel" onPress={() => cancelFriendRequest(outgoingToThem)} />
            ) : (
              <AppButton
                variant="secondary"
                Icon={UserPlus}
                label="Add friend"
                onPress={() => sendFriendRequest(selectedUserProfile.uid, selectedUserProfile.name)}
              />
            )}
          </View>
        )}

        <StatRow
          stats={[
            { label: 'Memorized', value: selectedUserProfile.stats?.memorized || 0 },
            { label: 'Learning', value: selectedUserProfile.stats?.learning || 0 },
            { label: 'Streak', value: selectedUserProfile.stats?.streak || 0 },
          ]}
        />

        {/* Their verses (friends only) */}
        {queueVisible && (
          <View style={{ gap: space(6) }}>
            <SectionHeader title={`Their verses · ${groupedQueue.length}`} />
            {groupedQueue.length === 0 ? (
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(16) }}>
                <AppText variant="label" className="font-sans text-ink-3 text-center">
                  {selectedUserProfile.name} hasn't added any verses yet.
                </AppText>
              </View>
            ) : (
              <GroupedList>
                {groupedQueue.map((g) => {
                  const retained = g.statuses.has('retained') && g.statuses.size === 1;
                  const learning = g.statuses.has('learning');
                  return (
                    <ListRow
                      key={g.key}
                      title={`${g.book} ${g.chapter}`}
                      subtitle={`${g.count} verse${g.count === 1 ? '' : 's'}`}
                      accessory={
                        <Badge
                          label={retained ? 'Memorized' : learning ? 'Learning' : 'In progress'}
                          tone={retained ? 'success' : learning ? 'warning' : 'neutral'}
                        />
                      }
                    />
                  );
                })}
              </GroupedList>
            )}
          </View>
        )}

        {communities.length > 0 && (
          <GroupedList header={`Circles you share · ${communities.length}`}>
            {communities.map((cName) => (
              <ListRow key={cName} Icon={Users} title={cName} />
            ))}
          </GroupedList>
        )}

        {/* Removing a friend sits on its own at the foot, well away from the
            buttons you use on a friend. */}
        {!isSelf && (
          <GroupedList>
            {isFriend ? (
              <ListRow Icon={UserMinus} title="Remove friend" destructive accessory="none" onPress={() => setShowRemoveFriendConfirm(true)} />
            ) : null}
            <ListRow Icon={Flag} title={`Report ${selectedUserProfile.name.split(' ')[0]}`} accessory="none" onPress={() => setShowReport(true)} />
            {blocked ? (
              <ListRow Icon={Ban} title="Unblock" accessory="none" onPress={() => state.unblockUser(selectedUserProfile.uid)} />
            ) : (
              <ListRow Icon={Ban} title={`Block ${selectedUserProfile.name.split(' ')[0]}`} destructive accessory="none" onPress={() => setShowBlock(true)} />
            )}
          </GroupedList>
        )}
      </ScrollView>

      <ReportSheet
        visible={showReport}
        title={`Report ${selectedUserProfile.name}`}
        subjectName={blocked ? undefined : selectedUserProfile.name.split(' ')[0]}
        onClose={() => setShowReport(false)}
        onSubmit={async ({ reason, note, alsoBlock }) => {
          await state.reportContent({
            kind: 'user',
            targetUid: selectedUserProfile.uid,
            targetPath: `profiles/${selectedUserProfile.uid}`,
            contentSnapshot: selectedUserProfile.name,
            reason,
            note,
          });
          if (alsoBlock) await state.blockUser(selectedUserProfile.uid, selectedUserProfile.name);
        }}
      />
      <BlockConfirmDialog
        visible={showBlock}
        name={selectedUserProfile.name.split(' ')[0]}
        onClose={() => setShowBlock(false)}
        onConfirm={() => state.blockUser(selectedUserProfile.uid, selectedUserProfile.name)}
      />

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

      <Dialog
        visible={showNudgeCompose}
        onClose={() => setShowNudgeCompose(false)}
        title={`Nudge ${selectedUserProfile.name}`}
        message="Send a quick note to keep them going. You can nudge each friend once a day."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowNudgeCompose(false)} />
            <AppButton
              variant="primary"
              label="Send nudge"
              onPress={async () => {
                setShowNudgeCompose(false);
                await sendAccountabilityNudge(asFriend, nudgeMessage);
              }}
            />
          </>
        }
      >
        <AppTextInput
          variant="body"
          value={nudgeMessage}
          onChangeText={setNudgeMessage}
          placeholder="Have you reviewed your verses today?"
          accessibilityLabel="Nudge message"
          multiline
          autoFocus
          className="bg-surface border border-line rounded-btn text-ink font-sans"
          style={{ paddingHorizontal: space(12), paddingVertical: space(10), minHeight: space(88), textAlignVertical: 'top' }}
        />
      </Dialog>

      <Dialog
        visible={showRemoveFriendConfirm}
        onClose={() => setShowRemoveFriendConfirm(false)}
        title={`Remove ${selectedUserProfile.name}?`}
        message="You'll stop seeing each other's activity and won't be able to nudge each other. They can send a new friend request later."
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setShowRemoveFriendConfirm(false)} />
            <AppButton
              variant="destructive"
              label="Remove"
              onPress={async () => {
                setShowRemoveFriendConfirm(false);
                await removeFriend(asFriend);
              }}
            />
          </>
        }
      />
    </FadeInView>
  );
}

import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, MoreHorizontal, UserPlus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, useKeyboardHeight } from '../components/ui';
import { ChallengeCard, ChallengeCreateSheet } from '../components/ChallengeCard';
import { ChatView } from '../components/chat/ChatView';
import { BlockConfirmDialog, ReportSheet } from '../components/chat/ReportSheet';
import { AppButton, AppIconButton, AppText, useScaledSpace } from '../components/design';
import { Dialog, ScreenHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';

export default function DMThreadScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const {
    user,
    activeDMThread,
    activeDMMessages,
    loadingActiveDMMessages,
    activeDMThreadActive,
    closeDMThread,
    handleBack,
    sendFriendRequest,
    outgoingFriendRequests,
    activeChallenges,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    deleteChallenge,
    blockedUids,
  } = state;

  const [showChallengeSheet, setShowChallengeSheet] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showBlock, setShowBlock] = useState(false);

  if (!activeDMThread) return null;
  const other = activeDMThread;
  const first = other.otherName.split(' ')[0];
  const iBlockedThem = blockedUids.has(other.otherUid);
  const requestAlreadySent = outgoingFriendRequests.some((r) => r.toUid === other.otherUid);

  const goBack = () => {
    closeDMThread();
    handleBack();
  };

  const bottomPad = Math.max(keyboardHeight > 0 ? keyboardHeight : insets.bottom, 16);

  // A thread goes read-only when the two are no longer friends or in a
  // circle together -- or when I've blocked them (unblocking is in Settings,
  // not here, so a block can't be undone by a stray tap mid-conversation).
  const readOnly = !activeDMThreadActive ? (
    <View className="bg-surface border-t border-hairline" style={{ gap: space(10), paddingHorizontal: space(16), paddingTop: space(14), paddingBottom: bottomPad }}>
      <View className="flex-row items-center" style={{ gap: space(6) }}>
        <Lock size={14} color={palette.ink3} />
        <AppText variant="label" className="font-sans font-semibold text-ink">
          {iBlockedThem ? `You blocked ${first}` : 'This conversation is read-only'}
        </AppText>
      </View>
      <AppText variant="caption" className="font-sans text-ink-2">
        {iBlockedThem
          ? 'Neither of you can send new messages. You can unblock them in Settings.'
          : `You and ${first} are no longer friends or in a circle together, so new messages are off. Your history is kept. Send a friend request to keep talking.`}
      </AppText>
      {!iBlockedThem ? (
        <AppButton
          variant={requestAlreadySent ? 'quiet' : 'primary'}
          Icon={UserPlus}
          label={requestAlreadySent ? 'Friend request sent' : 'Send friend request'}
          disabled={requestAlreadySent}
          onPress={() => !requestAlreadySent && sendFriendRequest(other.otherUid, other.otherName)}
        />
      ) : null}
    </View>
  ) : undefined;

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-row items-center border-b border-hairline" style={{ paddingHorizontal: 20, paddingVertical: 8, gap: space(8) }}>
        <View className="flex-1">
          <ScreenHeader inline title={other.otherName} onBack={goBack} backLabel="Messages" />
        </View>
        <AppIconButton Icon={MoreHorizontal} variant="bare" diameter={36} accessibilityLabel={`More about ${first}`} onPress={() => setShowMenu(true)} />
      </View>

      <ChatView
        state={state}
        scope="dm"
        containerId={other.id}
        messages={activeDMMessages}
        loading={loadingActiveDMMessages}
        emptyText="No messages yet. Say hello."
        placeholder="Message"
        composerReplacement={readOnly}
        onChallenge={() => setShowChallengeSheet(true)}
        above={
          // No status filter: declined/cancelled challenges render as a
          // compact row (see ChallengeCard) so they can actually be deleted.
          activeChallenges.length > 0 ? (
            <View style={{ paddingHorizontal: space(16), paddingTop: space(12) }}>
              {activeChallenges.map((challenge) => (
                <ChallengeCard
                  key={challenge.id}
                  challenge={challenge}
                  myUid={user?.uid}
                  onAccept={() => acceptChallenge(challenge)}
                  onDecline={() => declineChallenge(challenge)}
                  onDelete={() => deleteChallenge(challenge)}
                />
              ))}
            </View>
          ) : null
        }
      />

      <Dialog visible={showMenu} onClose={() => setShowMenu(false)} placement="sheet" title={other.otherName}>
        <View style={{ gap: space(8) }}>
          <AppButton
            variant="secondary"
            label="View profile"
            onPress={() => {
              setShowMenu(false);
              state.viewMemberProfileById(other.otherUid);
            }}
          />
          <AppButton
            variant="secondary"
            label={`Report ${first}`}
            onPress={() => {
              setShowMenu(false);
              setShowReport(true);
            }}
          />
          {!iBlockedThem ? (
            <AppButton
              variant="destructive"
              label={`Block ${first}`}
              onPress={() => {
                setShowMenu(false);
                setShowBlock(true);
              }}
            />
          ) : null}
        </View>
      </Dialog>

      <ReportSheet
        visible={showReport}
        title={`Report ${first}`}
        subjectName={iBlockedThem ? undefined : first}
        onClose={() => setShowReport(false)}
        onSubmit={async ({ reason, note, alsoBlock }) => {
          await state.reportContent({
            kind: 'user',
            targetUid: other.otherUid,
            targetPath: `dmThreads/${other.id}`,
            contentSnapshot: activeDMMessages
              .filter((m) => m.fromUid === other.otherUid)
              .slice(-5)
              .map((m) => m.text)
              .join('\n'),
            reason,
            note,
          });
          if (alsoBlock) await state.blockUser(other.otherUid, other.otherName);
        }}
      />

      <BlockConfirmDialog visible={showBlock} name={first} onClose={() => setShowBlock(false)} onConfirm={() => state.blockUser(other.otherUid, other.otherName)} />

      <ChallengeCreateSheet
        visible={showChallengeSheet}
        title={`Challenge ${other.otherName}`}
        onClose={() => setShowChallengeSheet(false)}
        onSubmit={(range) => {
          sendChallenge(other.otherUid, other.otherName, other.otherAvatarUrl, range);
          setShowChallengeSheet(false);
        }}
      />
    </FadeInView>
  );
}

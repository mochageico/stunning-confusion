import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Lock, Send, Trophy, UserPlus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, useKeyboardHeight } from '../components/ui';
import { ReactionBar } from '../components/ReactionBar';
import { ChallengeCard, ChallengeCreateSheet } from '../components/ChallengeCard';
import { AppButton, AppIconButton, AppTextInput, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
export default function DMThreadScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const {
    user,
    activeDMThread,
    activeDMMessages,
    loadingActiveDMMessages,
    activeDMThreadActive,
    sendDMMessage,
    closeDMThread,
    handleBack,
    sendFriendRequest,
    outgoingFriendRequests,
    reactionsByMessageId,
    toggleReaction,
    activeChallenges,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    deleteChallenge,
  } = state;

  const [draft, setDraft] = useState('');
  const [showChallengeSheet, setShowChallengeSheet] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();

  if (!activeDMThread) return null;

  const requestAlreadySent = outgoingFriendRequests.some((r) => r.toUid === activeDMThread.otherUid);

  const goBack = () => {
    closeDMThread();
    handleBack();
  };

  const handleSend = () => {
    if (!draft.trim()) return;
    sendDMMessage(draft);
    setDraft('');
  };

  // Bottom padding on the composer/banner itself: the exact reported
  // keyboard height while it's up, or the safe-area inset (home indicator)
  // while it's down -- see useKeyboardHeight's comment for why this
  // replaced KeyboardAvoidingView.
  const bottomPad = keyboardHeight > 0 ? keyboardHeight : insets.bottom;

  return (
    <FadeInView style={{ flex: 1 }}>
        <View className="flex-row items-center gap-3 border-b border-hairline p-4">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor={palette.ink} onPress={goBack} className="rounded-full border border-line bg-surface" />
          <AvatarCircle name={activeDMThread.otherName} photoUri={activeDMThread.otherAvatarUrl || null} size={30} />
          <AppText variant="body" className="font-serif font-bold text-ink">{activeDMThread.otherName}</AppText>
        </View>

        {/* No status filter: declined/cancelled challenges render as a compact
            dismissible row (see ChallengeCard) so they can actually be deleted
            rather than lingering invisibly in Firestore. */}
        {activeChallenges.length > 0 && (
          <View className="px-3 pt-3">
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
        )}

        <ScrollView
          ref={scrollRef}
          className="flex-1 bg-canvas"
          contentContainerClassName="p-4"
          contentContainerStyle={{ gap: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingActiveDMMessages ? (
            <AppText variant="label" className="text-ink-3 font-sans text-center mt-4">Loading…</AppText>
          ) : activeDMMessages.length === 0 ? (
            <AppText variant="label" className="text-ink-3 font-sans text-center mt-4">
              No messages yet. Say hello 👋
            </AppText>
          ) : (
            activeDMMessages.map((msg) => {
              const isMine = msg.fromUid === user?.uid;
              return (
                <View key={msg.id}>
                  <View className={`flex-row ${isMine ? 'justify-end' : 'justify-start'}`}>
                    <View
                      className={`max-w-[78%] px-3 py-2 rounded-2xl ${
                        isMine ? 'bg-accent rounded-br-sm' : 'bg-surface-2 rounded-bl-sm'
                      }`}
                    >
                      <AppText variant="label" className={`font-sans ${isMine ? 'text-on-accent' : 'text-ink'}`}>{msg.text}</AppText>
                    </View>
                  </View>
                  <ReactionBar
                    reactions={reactionsByMessageId[msg.id] || []}
                    myUid={user?.uid}
                    align={isMine ? 'right' : 'left'}
                    onToggle={(emoji) => activeDMThread && toggleReaction('dm', activeDMThread.id, msg.id, emoji)}
                  />
                </View>
              );
            })
          )}
        </ScrollView>

        {activeDMThreadActive ? (
          <View
            className="flex-row items-center gap-2 px-3 pt-3 border-t border-hairline bg-surface"
            style={{ paddingBottom: Math.max(bottomPad, 12) }}
          >
            <AppTextInput value={draft} onChangeText={setDraft} placeholder="Type a message…" placeholderTextColor={palette.ink3} multiline className="flex-1 bg-surface-2 border border-line rounded-xl px-3 py-2 text-ink font-sans max-h-24" />
            <AppIconButton Icon={Trophy} diameter={36} iconSize={14} iconColor={palette.warning} onPress={() => setShowChallengeSheet(true)} className="rounded-full border border-warning/30 bg-warning-soft" />
            <AppIconButton Icon={Send} diameter={36} iconSize={14} iconColor={palette.onAccent} onPress={handleSend} disabled={!draft.trim()} className={` rounded-full ${draft.trim() ? 'bg-accent' : 'bg-fill'}`} />
          </View>
        ) : (
          <View
            className="px-4 pt-4 border-t border-warning/30 bg-warning-soft"
            style={{ gap: 8, paddingBottom: Math.max(bottomPad, 16) }}
          >
            <View className="flex-row items-center gap-1.5">
              <Lock size={12} color={palette.warning} />
              <AppText variant="section" className="font-sans font-bold text-warning uppercase tracking-wide">
                Read-only conversation
              </AppText>
            </View>
            <AppText variant="caption" className="text-warning font-sans leading-relaxed">
              You and {activeDMThread.otherName} are no longer friends or sharing a community, so new messages are
              disabled. History is kept. Send a friend request to keep the conversation going.
            </AppText>
            <AppButton size="md" onPress={() => !requestAlreadySent && sendFriendRequest(activeDMThread.otherUid, activeDMThread.otherName)} disabled={requestAlreadySent} className={`flex-row items-center justify-center gap-1.5 rounded-xl ${ requestAlreadySent ? 'bg-fill' : 'bg-accent' }`}>
              <UserPlus size={12} color={requestAlreadySent ? palette.ink3 : palette.onAccent} />
              <AppText variant="section" className={`font-sans font-bold uppercase tracking-wide ${requestAlreadySent ? 'text-ink-3' : 'text-on-accent'}`}>
                {requestAlreadySent ? 'Friend Request Sent' : 'Send Friend Request'}
              </AppText>
            </AppButton>
          </View>
        )}

        <ChallengeCreateSheet
          visible={showChallengeSheet}
          title={`Challenge ${activeDMThread.otherName}`}
          onClose={() => setShowChallengeSheet(false)}
          onSubmit={(range) => {
            sendChallenge(activeDMThread.otherUid, activeDMThread.otherName, activeDMThread.otherAvatarUrl, range);
            setShowChallengeSheet(false);
          }}
        />
      </FadeInView>
  );
}

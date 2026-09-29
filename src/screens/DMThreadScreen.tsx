import { useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Lock, Send, Trophy, UserPlus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, useKeyboardHeight } from '../components/ui';
import { ReactionBar } from '../components/ReactionBar';
import { ChallengeCard, ChallengeCreateSheet } from '../components/ChallengeCard';
import { AppButton, AppIconButton, AppTextInput, AppText, useScaledSpace } from '../components/design';
import { ScreenHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';

export default function DMThreadScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
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
  // The message whose emoji picker is open. Tap a bubble to open it.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
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
      <View className="border-b border-hairline" style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
        <ScreenHeader inline title={activeDMThread.otherName} onBack={goBack} backLabel="Messages" />
      </View>

      {/* No status filter: declined/cancelled challenges render as a compact
          row (see ChallengeCard) so they can actually be deleted rather than
          lingering invisibly in Firestore. */}
      {activeChallenges.length > 0 && (
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
      )}

      <ScrollView
        ref={scrollRef}
        className="flex-1 bg-canvas"
        contentContainerStyle={{ padding: space(16), gap: space(10) }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {loadingActiveDMMessages ? (
          <AppText variant="label" className="text-ink-3 font-sans text-center" style={{ marginTop: space(16) }}>Loading…</AppText>
        ) : activeDMMessages.length === 0 ? (
          <AppText variant="label" className="text-ink-3 font-sans text-center" style={{ marginTop: space(16) }}>
            No messages yet. Say hello.
          </AppText>
        ) : (
          activeDMMessages.map((msg) => {
            const isMine = msg.fromUid === user?.uid;
            return (
              <View key={msg.id}>
                <View className={`flex-row ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <Pressable
                    onPress={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Message: ${msg.text}. Tap to react.`}
                    className={`rounded-card ${isMine ? 'bg-accent rounded-br-sm' : 'bg-surface border border-line rounded-bl-sm'}`}
                    style={{ maxWidth: '78%', paddingHorizontal: space(12), paddingVertical: space(8) }}
                  >
                    <AppText variant="label" className={`font-sans ${isMine ? 'text-on-accent' : 'text-ink'}`}>{msg.text}</AppText>
                  </Pressable>
                </View>
                <ReactionBar
                  reactions={reactionsByMessageId[msg.id] || []}
                  myUid={user?.uid}
                  align={isMine ? 'right' : 'left'}
                  pickerOpen={pickerFor === msg.id}
                  onPickerDone={() => setPickerFor(null)}
                  onToggle={(emoji) => activeDMThread && toggleReaction('dm', activeDMThread.id, msg.id, emoji)}
                />
              </View>
            );
          })
        )}
      </ScrollView>

      {activeDMThreadActive ? (
        <View
          className="flex-row items-center border-t border-hairline bg-surface"
          style={{ gap: space(8), paddingHorizontal: space(12), paddingTop: space(10), paddingBottom: Math.max(bottomPad, 12) }}
        >
          <AppTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            accessibilityLabel="Message"
            variant="body"
            multiline
            numberOfLines={1}
            className="flex-1 bg-surface-2 border border-line rounded-btn text-ink font-sans"
            style={{ paddingHorizontal: space(12), paddingVertical: space(8), minHeight: space(40), maxHeight: 120 }}
          />
          <AppIconButton Icon={Trophy} variant="outline" diameter={36} accessibilityLabel="Challenge" onPress={() => setShowChallengeSheet(true)} />
          <AppIconButton Icon={Send} variant="filled" diameter={36} onPress={handleSend} disabled={!draft.trim()} accessibilityLabel="Send" />
        </View>
      ) : (
        <View
          className="bg-surface border-t border-hairline"
          style={{ gap: space(10), paddingHorizontal: space(16), paddingTop: space(14), paddingBottom: Math.max(bottomPad, 16) }}
        >
          <View className="flex-row items-center" style={{ gap: space(6) }}>
            <Lock size={14} color={palette.ink3} />
            <AppText variant="label" className="font-sans font-semibold text-ink">
              This conversation is read-only
            </AppText>
          </View>
          <AppText variant="caption" className="font-sans text-ink-2">
            You and {activeDMThread.otherName} are no longer friends or in a circle together, so new messages are off. Your history is kept. Send a friend request to keep talking.
          </AppText>
          <AppButton
            variant={requestAlreadySent ? 'quiet' : 'primary'}
            Icon={UserPlus}
            label={requestAlreadySent ? 'Friend request sent' : 'Send friend request'}
            disabled={requestAlreadySent}
            onPress={() => !requestAlreadySent && sendFriendRequest(activeDMThread.otherUid, activeDMThread.otherName)}
          />
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

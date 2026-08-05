import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Lock, Send, Trophy, UserPlus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, useKeyboardHeight } from '../components/ui';
import { ReactionBar } from '../components/ReactionBar';
import { ChallengeCard, ChallengeCreateSheet } from '../components/ChallengeCard';
import { AppTextInput, AppText } from '../components/design';

export default function DMThreadScreen({ state }: { state: AppState }) {
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
        <View className="flex-row items-center gap-3 border-b border-neutral-100 p-4">
          <Pressable
            onPress={goBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <AvatarCircle name={activeDMThread.otherName} photoUri={activeDMThread.otherAvatarUrl || null} size={30} />
          <AppText variant="body" className="font-serif font-bold text-neutral-900">{activeDMThread.otherName}</AppText>
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
          className="flex-1 bg-white"
          contentContainerClassName="p-4"
          contentContainerStyle={{ gap: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingActiveDMMessages ? (
            <AppText variant="label" className="text-neutral-400 font-sans text-center mt-4">Loading…</AppText>
          ) : activeDMMessages.length === 0 ? (
            <AppText variant="label" className="text-neutral-400 font-sans text-center mt-4">
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
                        isMine ? 'bg-[#1A1A1A] rounded-br-sm' : 'bg-neutral-100 rounded-bl-sm'
                      }`}
                    >
                      <AppText variant="label" className={`font-sans ${isMine ? 'text-white' : 'text-neutral-800'}`}>{msg.text}</AppText>
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
            className="flex-row items-center gap-2 px-3 pt-3 border-t border-neutral-100 bg-white"
            style={{ paddingBottom: Math.max(bottomPad, 12) }}
          >
            <AppTextInput value={draft} onChangeText={setDraft} placeholder="Type a message…" placeholderTextColor="#a3a3a3" multiline className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-neutral-800 font-sans max-h-24" />
            <Pressable
              onPress={() => setShowChallengeSheet(true)}
              className="w-9 h-9 rounded-full items-center justify-center border border-amber-200 bg-amber-50"
            >
              <Trophy size={14} color="#b45309" />
            </Pressable>
            <Pressable
              onPress={handleSend}
              disabled={!draft.trim()}
              className={`w-9 h-9 rounded-full items-center justify-center ${draft.trim() ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
            >
              <Send size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <View
            className="px-4 pt-4 border-t border-amber-200 bg-amber-50"
            style={{ gap: 8, paddingBottom: Math.max(bottomPad, 16) }}
          >
            <View className="flex-row items-center gap-1.5">
              <Lock size={12} color="#b45309" />
              <AppText variant="section" className="font-sans font-bold text-amber-800 uppercase tracking-wide">
                Read-only conversation
              </AppText>
            </View>
            <AppText variant="caption" className="text-amber-700/90 font-sans leading-relaxed">
              You and {activeDMThread.otherName} are no longer friends or sharing a community, so new messages are
              disabled. History is kept. Send a friend request to keep the conversation going.
            </AppText>
            <Pressable
              onPress={() => !requestAlreadySent && sendFriendRequest(activeDMThread.otherUid, activeDMThread.otherName)}
              disabled={requestAlreadySent}
              className={`flex-row items-center justify-center gap-1.5 py-2 rounded-xl ${
                requestAlreadySent ? 'bg-neutral-200' : 'bg-[#1A1A1A]'
              }`}
            >
              <UserPlus size={12} color={requestAlreadySent ? '#737373' : '#FFFFFF'} />
              <AppText variant="section" className={`font-sans font-bold uppercase tracking-wide ${requestAlreadySent ? 'text-neutral-500' : 'text-white'}`}>
                {requestAlreadySent ? 'Friend Request Sent' : 'Send Friend Request'}
              </AppText>
            </Pressable>
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

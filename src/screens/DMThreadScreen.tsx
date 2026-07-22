import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Lock, Send, UserPlus } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, useKeyboardHeight } from '../components/ui';

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
  } = state;

  const [draft, setDraft] = useState('');
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
          <Text className="text-sm font-serif font-bold text-neutral-900">{activeDMThread.otherName}</Text>
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1 bg-white"
          contentContainerClassName="p-4"
          contentContainerStyle={{ gap: 8 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingActiveDMMessages ? (
            <Text className="text-xs text-neutral-400 font-sans text-center mt-4">Loading…</Text>
          ) : activeDMMessages.length === 0 ? (
            <Text className="text-xs text-neutral-400 font-sans text-center mt-4">
              No messages yet. Say hello 👋
            </Text>
          ) : (
            activeDMMessages.map((msg) => {
              const isMine = msg.fromUid === user?.uid;
              return (
                <View key={msg.id} className={`flex-row ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <View
                    className={`max-w-[78%] px-3 py-2 rounded-2xl ${
                      isMine ? 'bg-[#1A1A1A] rounded-br-sm' : 'bg-neutral-100 rounded-bl-sm'
                    }`}
                  >
                    <Text className={`text-xs font-sans ${isMine ? 'text-white' : 'text-neutral-800'}`}>{msg.text}</Text>
                  </View>
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
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message…"
              placeholderTextColor="#a3a3a3"
              multiline
              className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-xs text-neutral-800 font-sans max-h-24"
            />
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
              <Text className="text-[10px] font-sans font-bold text-amber-800 uppercase tracking-wide">
                Read-only conversation
              </Text>
            </View>
            <Text className="text-[10px] text-amber-700/90 font-sans leading-relaxed">
              You and {activeDMThread.otherName} are no longer friends or sharing a community, so new messages are
              disabled. History is kept. Send a friend request to keep the conversation going.
            </Text>
            <Pressable
              onPress={() => !requestAlreadySent && sendFriendRequest(activeDMThread.otherUid, activeDMThread.otherName)}
              disabled={requestAlreadySent}
              className={`flex-row items-center justify-center gap-1.5 py-2 rounded-xl ${
                requestAlreadySent ? 'bg-neutral-200' : 'bg-[#1A1A1A]'
              }`}
            >
              <UserPlus size={12} color={requestAlreadySent ? '#737373' : '#FFFFFF'} />
              <Text className={`text-[10px] font-sans font-bold uppercase tracking-wide ${requestAlreadySent ? 'text-neutral-500' : 'text-white'}`}>
                {requestAlreadySent ? 'Friend Request Sent' : 'Send Friend Request'}
              </Text>
            </Pressable>
          </View>
        )}
      </FadeInView>
  );
}

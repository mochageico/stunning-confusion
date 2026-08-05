import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Send } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, useKeyboardHeight } from '../components/ui';
import { ReactionBar } from '../components/ReactionBar';
import { AppIconButton, AppTextInput, AppText } from '../components/design';

export default function CircleChatScreen({ state }: { state: AppState }) {
  const {
    user,
    activeCircle,
    activeCircleChatId,
    activeCircleMessages,
    loadingActiveCircleMessages,
    sendCircleMessage,
    closeCircleChat,
    handleBack,
    reactionsByMessageId,
    toggleReaction,
  } = state;

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const keyboardHeight = useKeyboardHeight();
  const insets = useSafeAreaInsets();

  if (!activeCircle) return null;

  const goBack = () => {
    closeCircleChat();
    handleBack();
  };

  const handleSend = () => {
    if (!draft.trim()) return;
    sendCircleMessage(draft);
    setDraft('');
  };

  // See useKeyboardHeight's comment -- replaces KeyboardAvoidingView, which
  // kept undershooting on iOS even on a full-screen chat layout.
  const bottomPad = keyboardHeight > 0 ? keyboardHeight : insets.bottom;

  return (
    <FadeInView style={{ flex: 1 }}>
        <View className="flex-row items-center gap-3 border-b border-neutral-100 p-4">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor="#262626" onPress={goBack} className="rounded-full border border-neutral-200 bg-white" />
          <View>
            <AppText variant="micro" className="uppercase tracking-wider font-extrabold text-neutral-400 font-sans">Group Chat</AppText>
            <AppText variant="body" className="font-serif font-bold text-neutral-900 leading-none mt-0.5">{activeCircle.name}</AppText>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1 bg-white"
          contentContainerClassName="p-4"
          contentContainerStyle={{ gap: 10 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingActiveCircleMessages ? (
            <AppText variant="label" className="text-neutral-400 font-sans text-center mt-4">Loading…</AppText>
          ) : activeCircleMessages.length === 0 ? (
            <AppText variant="label" className="text-neutral-400 font-sans text-center mt-4">
              No messages yet. Kick off the conversation 👋
            </AppText>
          ) : (
            activeCircleMessages.map((msg) => {
              const isMine = msg.fromUid === user?.uid;
              return (
                <View key={msg.id} style={{ gap: 2 }}>
                  <View className={`flex-row gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                    <AvatarCircle name={msg.fromName} photoUri={msg.fromAvatarUrl || null} size={24} />
                    <View className={`max-w-[74%] px-3 py-2 rounded-2xl ${isMine ? 'bg-[#1A1A1A] rounded-br-sm' : 'bg-neutral-100 rounded-bl-sm'}`}>
                      {!isMine && <AppText variant="micro" className="font-sans font-bold text-neutral-500 mb-0.5">{msg.fromName}</AppText>}
                      <AppText variant="label" className={`font-sans ${isMine ? 'text-white' : 'text-neutral-800'}`}>{msg.text}</AppText>
                    </View>
                  </View>
                  <ReactionBar
                    reactions={reactionsByMessageId[msg.id] || []}
                    myUid={user?.uid}
                    align={isMine ? 'right' : 'left'}
                    onToggle={(emoji) => activeCircleChatId && toggleReaction('circle', activeCircleChatId, msg.id, emoji)}
                  />
                </View>
              );
            })
          )}
        </ScrollView>

        <View
          className="flex-row items-center gap-2 px-3 pt-3 border-t border-neutral-100 bg-white"
          style={{ paddingBottom: Math.max(bottomPad, 12) }}
        >
          <AppTextInput value={draft} onChangeText={setDraft} placeholder="Message the circle…" placeholderTextColor="#a3a3a3" multiline className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 text-neutral-800 font-sans max-h-24" />
          <AppIconButton Icon={Send} diameter={36} iconSize={14} iconColor="#FFFFFF" onPress={handleSend} disabled={!draft.trim()} className={` rounded-full ${draft.trim() ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`} />
        </View>
      </FadeInView>
  );
}

import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, useKeyboardHeight } from '../components/ui';
import { ReactionBar } from '../components/ReactionBar';
import { AppIconButton, AppTextInput, AppText } from '../components/design';
import { ScreenHeader } from '../components/blocks';

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
        <View className="border-b border-hairline" style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
          <ScreenHeader inline title={activeCircle.name} eyebrow="Group chat" onBack={goBack} backLabel="Circle" />
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1 bg-canvas"
          contentContainerClassName="p-4"
          contentContainerStyle={{ gap: 10 }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {loadingActiveCircleMessages ? (
            <AppText variant="label" className="text-ink-3 font-sans text-center mt-4">Loading…</AppText>
          ) : activeCircleMessages.length === 0 ? (
            <AppText variant="label" className="text-ink-3 font-sans text-center mt-4">
              No messages yet. Say hello to the circle.
            </AppText>
          ) : (
            activeCircleMessages.map((msg) => {
              const isMine = msg.fromUid === user?.uid;
              return (
                <View key={msg.id} style={{ gap: 2 }}>
                  <View className={`flex-row gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                    <AvatarCircle name={msg.fromName} photoUri={msg.fromAvatarUrl || null} size={24} />
                    <View className={`max-w-[74%] px-3 py-2 rounded-2xl ${isMine ? 'bg-accent rounded-br-sm' : 'bg-surface-2 rounded-bl-sm'}`}>
                      {!isMine && <AppText variant="micro" className="font-sans font-bold text-ink-3 mb-0.5">{msg.fromName}</AppText>}
                      <AppText variant="label" className={`font-sans ${isMine ? 'text-on-accent' : 'text-ink'}`}>{msg.text}</AppText>
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
          className="flex-row items-center gap-2 px-3 pt-3 border-t border-hairline bg-surface"
          style={{ paddingBottom: Math.max(bottomPad, 12) }}
        >
          <AppTextInput value={draft} onChangeText={setDraft} placeholder="Message the circle…" accessibilityLabel="Message" multiline className="flex-1 bg-surface-2 border border-line rounded-xl px-3 py-2 text-ink font-sans max-h-24" />
          <AppIconButton Icon={Send} variant="filled" diameter={36} onPress={handleSend} disabled={!draft.trim()} accessibilityLabel="Send" />
        </View>
      </FadeInView>
  );
}

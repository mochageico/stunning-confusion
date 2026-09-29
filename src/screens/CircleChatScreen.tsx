import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView, useKeyboardHeight } from '../components/ui';
import { ReactionBar } from '../components/ReactionBar';
import { AppIconButton, AppTextInput, AppText, useScaledSpace } from '../components/design';
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
  // The message whose emoji picker is open. Tap a bubble to open it.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const space = useScaledSpace();
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
                    <Pressable
                      onPress={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Message from ${msg.fromName}: ${msg.text}. Tap to react.`}
                      className={`rounded-card ${isMine ? 'bg-accent rounded-br-sm' : 'bg-surface border border-line rounded-bl-sm'}`}
                      style={{ maxWidth: '74%', paddingHorizontal: space(12), paddingVertical: space(8) }}
                    >
                      {!isMine && <AppText variant="caption" className="font-sans font-semibold text-ink-3">{msg.fromName}</AppText>}
                      <AppText variant="label" className={`font-sans ${isMine ? 'text-on-accent' : 'text-ink'}`}>{msg.text}</AppText>
                    </Pressable>
                  </View>
                  <ReactionBar
                    reactions={reactionsByMessageId[msg.id] || []}
                    myUid={user?.uid}
                    align={isMine ? 'right' : 'left'}
                    pickerOpen={pickerFor === msg.id}
                    onPickerDone={() => setPickerFor(null)}
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
          <AppTextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the circle"
            accessibilityLabel="Message"
            variant="body"
            multiline
            numberOfLines={1}
            className="flex-1 bg-surface-2 border border-line rounded-btn text-ink font-sans"
            style={{ paddingHorizontal: space(12), paddingVertical: space(8), minHeight: space(40), maxHeight: 120 }}
          />
          <AppIconButton Icon={Send} variant="filled" diameter={36} onPress={handleSend} disabled={!draft.trim()} accessibilityLabel="Send" />
        </View>
      </FadeInView>
  );
}

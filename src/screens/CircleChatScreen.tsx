import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Send } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { AvatarCircle, FadeInView } from '../components/ui';

export default function CircleChatScreen({ state }: { state: AppState }) {
  const {
    user,
    activeCircle,
    activeCircleMessages,
    loadingActiveCircleMessages,
    sendCircleMessage,
    closeCircleChat,
    handleBack,
  } = state;

  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

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

  return (
    <FadeInView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View className="flex-row items-center gap-3 border-b border-neutral-100 p-4">
          <Pressable
            onPress={goBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">Group Chat</Text>
            <Text className="text-sm font-serif font-bold text-neutral-900 leading-none mt-0.5">{activeCircle.name}</Text>
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
            <Text className="text-xs text-neutral-400 font-sans text-center mt-4">Loading…</Text>
          ) : activeCircleMessages.length === 0 ? (
            <Text className="text-xs text-neutral-400 font-sans text-center mt-4">
              No messages yet. Kick off the conversation 👋
            </Text>
          ) : (
            activeCircleMessages.map((msg) => {
              const isMine = msg.fromUid === user?.uid;
              return (
                <View key={msg.id} className={`flex-row gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                  <AvatarCircle name={msg.fromName} photoUri={msg.fromAvatarUrl || null} size={24} />
                  <View className={`max-w-[74%] px-3 py-2 rounded-2xl ${isMine ? 'bg-[#1A1A1A] rounded-br-sm' : 'bg-neutral-100 rounded-bl-sm'}`}>
                    {!isMine && <Text className="text-[8px] font-sans font-bold text-neutral-500 mb-0.5">{msg.fromName}</Text>}
                    <Text className={`text-xs font-sans ${isMine ? 'text-white' : 'text-neutral-800'}`}>{msg.text}</Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        <View className="flex-row items-center gap-2 p-3 border-t border-neutral-100 bg-white">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the circle…"
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
      </KeyboardAvoidingView>
    </FadeInView>
  );
}

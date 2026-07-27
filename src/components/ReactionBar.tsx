import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { REACTION_EMOJIS } from '../data';
import { MessageReaction } from '../types';

// Shared by DMThreadScreen and CircleChatScreen -- renders under a message
// bubble. Grouped pills (one per emoji actually used, with a count) plus a
// small "+" that reveals the fixed 5-emoji picker row. One reaction per user
// per message is enforced by toggleReaction (useAppState.ts), not here --
// this component just reflects whatever reactions/{messageId} currently has.
export function ReactionBar({
  reactions,
  myUid,
  onToggle,
  align = 'left',
}: {
  reactions: MessageReaction[];
  myUid: string | undefined;
  onToggle: (emoji: string) => void;
  align?: 'left' | 'right';
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const grouped = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    reactors: reactions.filter((r) => r.emoji === emoji),
  })).filter((g) => g.reactors.length > 0);

  if (grouped.length === 0 && !pickerOpen) {
    return (
      <View className={`mt-1 flex-row ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
        <Pressable
          onPress={() => setPickerOpen(true)}
          className="w-5 h-5 rounded-full border border-neutral-200 items-center justify-center bg-white"
        >
          <Text className="text-[10px] text-neutral-400">+</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className={`mt-1 flex-row flex-wrap items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      {grouped.map(({ emoji, reactors }) => {
        const mine = reactors.some((r) => r.uid === myUid);
        return (
          <Pressable
            key={emoji}
            onPress={() => onToggle(emoji)}
            className={`flex-row items-center gap-1 px-1.5 py-0.5 rounded-full border ${
              mine ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-neutral-50 border-neutral-200'
            }`}
          >
            <Text className="text-[10px]">{emoji}</Text>
            <Text className={`text-[8px] font-sans font-bold ${mine ? 'text-white' : 'text-neutral-500'}`}>
              {reactors.length}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => setPickerOpen((v) => !v)}
        className="w-5 h-5 rounded-full border border-neutral-200 items-center justify-center bg-white"
      >
        <Text className="text-[10px] text-neutral-400">+</Text>
      </Pressable>
      {pickerOpen && (
        <View className="flex-row items-center gap-2 bg-white border border-neutral-200 rounded-full px-2.5 py-1">
          {REACTION_EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                onToggle(emoji);
                setPickerOpen(false);
              }}
            >
              <Text className="text-sm">{emoji}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

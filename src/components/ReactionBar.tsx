import { Pressable, View } from 'react-native';

import { REACTION_EMOJIS } from '../data';
import { MessageReaction } from '../types';
import { AppText, useScaledSpace } from './design';

// Shared by DMThreadScreen and CircleChatScreen -- renders under a message
// bubble. One pill per emoji actually used, with a count. Nothing shows under
// a message nobody has reacted to: tapping the bubble opens the picker (the
// fixed 5 emoji) in its place. One reaction per user per message is enforced
// by toggleReaction (useAppState.ts), not here.
export function ReactionBar({
  reactions,
  myUid,
  onToggle,
  align = 'left',
  pickerOpen = false,
  onPickerDone,
}: {
  reactions: MessageReaction[];
  myUid: string | undefined;
  onToggle: (emoji: string) => void;
  align?: 'left' | 'right';
  /** The parent opens this when the bubble is tapped. */
  pickerOpen?: boolean;
  /** Called after an emoji is picked, so the parent can close the picker. */
  onPickerDone?: () => void;
}) {
  const space = useScaledSpace();

  const grouped = REACTION_EMOJIS.map((emoji) => ({
    emoji,
    reactors: reactions.filter((r) => r.emoji === emoji),
  })).filter((g) => g.reactors.length > 0);

  if (grouped.length === 0 && !pickerOpen) return null;

  return (
    <View
      className={`flex-row flex-wrap items-center ${align === 'right' ? 'justify-end' : 'justify-start'}`}
      style={{ marginTop: space(4), gap: space(6) }}
    >
      {grouped.map(({ emoji, reactors }) => {
        const mine = reactors.some((r) => r.uid === myUid);
        return (
          <Pressable
            key={emoji}
            onPress={() => onToggle(emoji)}
            accessibilityRole="button"
            accessibilityLabel={`${emoji} ${reactors.length}${mine ? ', yours' : ''}`}
            className={`flex-row items-center rounded-full border ${mine ? 'bg-accent-soft border-accent' : 'bg-surface border-line'}`}
            style={{ paddingHorizontal: space(8), paddingVertical: space(3), gap: space(4) }}
          >
            <AppText variant="caption">{emoji}</AppText>
            <AppText variant="caption" className={`font-sans font-semibold ${mine ? 'text-accent' : 'text-ink-3'}`}>
              {reactors.length}
            </AppText>
          </Pressable>
        );
      })}
      {pickerOpen && (
        <View
          className="flex-row items-center bg-surface border border-line rounded-full"
          style={{ paddingHorizontal: space(10), paddingVertical: space(4), gap: space(12) }}
        >
          {REACTION_EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`React ${emoji}`}
              onPress={() => {
                onToggle(emoji);
                onPickerDone?.();
              }}
            >
              <AppText variant="body">{emoji}</AppText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

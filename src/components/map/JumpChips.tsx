import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText, useScaledSpace } from '../design';

// One chip per constellation plus Whole map. Tapping one glides the map to
// it. Big, plain targets: this row is the easy way around the map for anyone
// who'd rather not pinch.

export interface JumpChip {
  id: string;
  label: string;
}

export function JumpChips({ chips, value, onPick }: { chips: JumpChip[]; value: string; onPick: (id: string) => void }) {
  const space = useScaledSpace();
  // Keep the chosen chip in view (the map can pick one on its own when it opens).
  const scroller = useRef<ScrollView>(null);
  const spots = useRef<Record<string, number>>({});
  useEffect(() => {
    const x = spots.current[value];
    if (x !== undefined) scroller.current?.scrollTo({ x: Math.max(0, x - space(24)), animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel="Go to a constellation"
      contentContainerStyle={{ gap: space(8), paddingRight: space(4) }}
      style={{ flexGrow: 0 }}
    >
      {chips.map((c) => {
        const on = c.id === value;
        return (
          <Pressable
            key={c.id}
            onPress={() => onPick(c.id)}
            onLayout={(e) => {
              spots.current[c.id] = e.nativeEvent.layout.x;
              if (on) scroller.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - space(24)), animated: false });
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            className={`rounded-full border justify-center ${on ? 'bg-accent-soft border-accent' : 'bg-surface border-line-strong'} active:opacity-70`}
            style={{ minHeight: 40, paddingHorizontal: space(14) }}
          >
            <View>
              <AppText variant="label" className={`font-sans font-semibold ${on ? 'text-accent' : 'text-ink-2'}`} numberOfLines={1}>
                {c.label}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

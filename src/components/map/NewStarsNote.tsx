import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight, Sparkles } from 'lucide-react-native';

import type { QueueItem, SkyState } from '../../types';
import { AppText, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';
import { CONSTELLATIONS } from '../../content/constellations';
import { skyNewStars } from '../../lib/constellations';
import { setSkyFocus } from '../../lib/skyFocus';

// ============================================================================
// "1 new star appeared in The Shepherd" (CONSTELLATION_SKY_PLAN.md, stage 4)
// ----------------------------------------------------------------------------
// One quiet line for the end of a review or learning session: a verse learned
// uncovers the stars joined to it, and this says so. Tap opens My sky zoomed
// into that constellation, where the reveal plays. Shows nothing when nothing
// new has appeared (stars the user already looked at in My sky don't count),
// and never says "Settling": the feature says "learn".
//
//   <NewStarsNote sky={state.sky} queue={state.memoryQueue} navigateTo={state.navigateTo} />
// ============================================================================

export function NewStarsNote({ sky, queue, navigateTo }: { sky: SkyState; queue: QueueItem[]; navigateTo: (screen: 'mySky') => void }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const news = useMemo(() => skyNewStars(sky, CONSTELLATIONS, queue), [sky, queue]);
  if (news.length === 0) return null;
  return (
    <View style={{ gap: space(8) }}>
      {news.map((n) => {
        const text = `${n.starIds.length === 1 ? '1 new star' : `${n.starIds.length} new stars`} appeared in ${n.title}`;
        return (
          <Pressable
            key={n.id}
            onPress={() => {
              setSkyFocus(n.id);
              navigateTo('mySky');
            }}
            accessibilityRole="button"
            accessibilityLabel={`${text}. Open My sky.`}
            className="flex-row items-center bg-fill rounded-card active:opacity-70"
            style={{ padding: space(14), gap: space(10) }}
          >
            <Sparkles size={18} color={palette.accent} />
            <AppText variant="label" className="font-sans text-ink flex-1">
              {text}
            </AppText>
            <ChevronRight size={18} color={palette.ink3} />
          </Pressable>
        );
      })}
    </View>
  );
}

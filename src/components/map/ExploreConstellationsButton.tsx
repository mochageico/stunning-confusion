import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import Svg, { Circle, Line } from 'react-native-svg';

import { AppText, useFontScale, useScaledSpace } from '../design';
import { SKY } from './skyPalette';

// Today's one constellation button (CONSTELLATION_SKY_PLAN.md, stage 2): a tiny
// four-star zigzag on a dark tile, "Explore scripture constellations", and
// "See how verses connect" under it. It opens the browse page.

const ZIGZAG: [number, number][] = [
  [14, 66],
  [38, 28],
  [62, 62],
  [86, 24],
];

export function ExploreConstellationsButton({ onPress }: { onPress: () => void }) {
  const scale = useFontScale();
  const space = useScaledSpace();
  const tile = Math.round(48 * scale);
  return (
    // button-ok: a two-line card button with a drawn tile; AppButton is one line of label.
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Explore scripture constellations. See how verses connect."
      className="flex-row items-center rounded-card active:opacity-70"
      // The whole button is the night (always, in light mode too), with gold
      // stars drawn straight on it: no separate tile.
      style={{ padding: space(12), gap: space(12), backgroundColor: SKY.bg, borderWidth: 1, borderColor: SKY.edge }}
    >
      {/* layout-ok: a drawing, no text */}
      <View className="items-center justify-center" style={{ width: tile, height: tile }}>
        <Svg width={tile} height={tile} viewBox="0 0 100 100">
          {ZIGZAG.slice(1).map((p, i) => (
            <Line key={i} x1={ZIGZAG[i][0]} y1={ZIGZAG[i][1]} x2={p[0]} y2={p[1]} stroke={SKY.ink3} strokeWidth={4} strokeLinecap="round" />
          ))}
          {ZIGZAG.map((p, i) => (
            <Circle key={i} cx={p[0]} cy={p[1]} r={8} fill={SKY.star} />
          ))}
        </Svg>
      </View>
      <View className="flex-1" style={{ gap: space(2) }}>
        <AppText variant="body" className="font-sans font-semibold" style={{ color: SKY.ink }}>
          Explore scripture constellations
        </AppText>
        <AppText variant="caption" className="font-sans" style={{ color: SKY.ink3 }}>
          See how verses connect
        </AppText>
      </View>
      <ChevronRight size={Math.round(20 * scale)} color={SKY.ink3} />
    </Pressable>
  );
}

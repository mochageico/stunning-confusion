import { View, ViewStyle } from 'react-native';
import { Lightbulb } from 'lucide-react-native';

import { AppButton, AppText, useFontScale, useScaledSpace } from './design';
import { useThemeColors } from './theme';
import { dismissTip, TipId, useTipVisible } from '../lib/tips';

/**
 * A hint shown the first time someone reaches a spot, in that spot. "Got it"
 * retires it for good (Settings' "Show tips again" brings them all back), so
 * no hint ever becomes permanent clutter. Renders nothing once seen.
 *
 * Keep the text to two short sentences: it sits above the thing it explains
 * and pushes that thing down while it's there. `style` is for spacing around
 * it, so a seen tip leaves no gap behind.
 */
export function OneTimeTip({ id, text, style }: { id: TipId; text: string; style?: ViewStyle }) {
  const visible = useTipVisible(id);
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  if (!visible) return null;
  return (
    <View
      accessibilityRole="summary"
      className="rounded-card bg-accent-soft flex-row"
      style={[{ padding: space(12), gap: space(10) }, style]}
    >
      <Lightbulb size={Math.round(18 * scale)} color={palette.accent} strokeWidth={2} />
      <View className="flex-1" style={{ gap: space(8) }}>
        <AppText variant="label" className="font-sans text-ink">
          {text}
        </AppText>
        <View style={{ alignSelf: 'flex-end' }}>
          <AppButton size="sm" variant="primary" label="Got it" onPress={() => void dismissTip(id)} />
        </View>
      </View>
    </View>
  );
}

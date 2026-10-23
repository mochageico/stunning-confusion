import { View } from 'react-native';

import { AppText, useScaledSpace } from './design';
import { bracketColor, useThemeColors } from './theme';
import { CircleTotals, togetherLine, weeklyLine } from '../lib/circleTotals';

// ============================================================================
// The circle page's "this week together" card: one weekly line, a bar of
// everyone's share of this week's reviews, and one quiet landmark line. No
// ranking anywhere: the bar and its names keep the circle's fixed member
// order (join date, from combineCircle), never sorted by amount, and no
// one's own number is shown. The bar uses the bracket colors (by member
// position) so neighbours stay apart; it never uses the stage colors.
// ============================================================================

interface Props {
  circleName: string;
  totals: CircleTotals;
  myUid: string | null | undefined;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'Someone';

export function CircleTotalsCard({ circleName, totals, myUid }: Props) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  // Colors follow each member's place in the circle, so they don't shift when someone has a quiet week.
  const shown = totals.parts.map((p, i) => ({ ...p, color: bracketColor(palette, i) })).filter((p) => p.reviewed > 0);
  const landmark = togetherLine(totals.held);
  const names = shown.map((p) => (p.uid === myUid ? 'You' : firstName(p.name)));

  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
      <AppText variant="body" className="font-sans text-ink">
        {weeklyLine(circleName, totals)}
      </AppText>

      {shown.length > 0 && (
        <View style={{ gap: space(8) }}>
          <View
            accessible
            accessibilityLabel={`Everyone's share of this week's reviews: ${names.join(', ')}`}
            className="flex-row rounded-full overflow-hidden"
            style={{ height: space(10), gap: 2 }}
          >
            {shown.map((p) => (
              <View key={p.uid} style={{ flex: p.fraction, backgroundColor: p.color }} />
            ))}
          </View>
          <View className="flex-row flex-wrap" style={{ columnGap: space(12), rowGap: space(4) }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {shown.map((p, i) => (
              <View key={p.uid} className="flex-row items-center" style={{ gap: space(5) }}>
                <View style={{ width: space(8), height: space(8), borderRadius: 999, backgroundColor: p.color }} />
                <AppText variant="caption" className="font-sans text-ink-2">
                  {names[i]}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      )}

      {landmark ? (
        <AppText variant="caption" className="font-sans text-ink-3">
          {landmark}
        </AppText>
      ) : null}
    </View>
  );
}

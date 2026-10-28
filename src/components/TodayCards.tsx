import { View } from 'react-native';

import type { QueueItem } from '../types';
import type { FirmUpItem, WelcomeBack } from '../lib/todayCards';
import { AppButton, AppText, useScaledSpace } from './design';

// ============================================================================
// TODAY'S LADDER CARDS (REVIEW_LADDER_PLAN.md stage 7)
// ----------------------------------------------------------------------------
// "Welcome back" after time away, and the Firm-up item that wins back a review
// after a slip. Plain props, so the demo harness can drive them.
// ============================================================================

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function WelcomeBackCard({ data, onDismiss }: { data: WelcomeBack; onDismiss: () => void }) {
  const space = useScaledSpace();
  const spreadOver = data.days.length;
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
      <View style={{ gap: space(4) }}>
        <AppText variant="title" className="font-sans font-bold text-ink">
          Welcome back
        </AppText>
        <AppText variant="label" className="font-sans text-ink-2">
          {`Some reviews piled up while you were away. We've spread ${plural(data.verses, 'verse')} over ${spreadOver === 1 ? 'today' : `the next ${spreadOver} days`} so no day is too much. The ones you review most often come first.`}
        </AppText>
      </View>
      <View style={{ gap: space(6) }}>
        {data.days.map((d) => (
          <View key={d.day} className="flex-row flex-wrap items-baseline justify-between" style={{ columnGap: space(8), rowGap: space(2) }}>
            <AppText variant="label" className="font-sans font-medium text-ink">
              {d.label}
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {`${plural(d.passages, 'passage')} · ${plural(d.verses, 'verse')}`}
            </AppText>
          </View>
        ))}
      </View>
      <AppButton size="md" variant="quiet" label="Got it" onPress={onDismiss} />
    </View>
  );
}

export function FirmUpCard({
  items,
  onStart,
}: {
  items: FirmUpItem[];
  /** Practice these verses; saying them all clean wins the review back. */
  onStart: (verses: QueueItem[]) => void;
}) {
  const space = useScaledSpace();
  if (items.length === 0) return null;
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
      <View style={{ gap: space(2) }}>
        <AppText variant="title" className="font-sans font-bold text-ink">
          Win back a review
        </AppText>
        <AppText variant="label" className="font-sans text-ink-2">
          A short second try at what slipped last time.
        </AppText>
      </View>
      {items.map((item, i) => (
        <View key={item.title} className={i === 0 ? '' : 'border-t border-hairline'} style={{ paddingTop: i === 0 ? 0 : space(10), gap: space(8) }}>
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {item.title}
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            {item.line}
          </AppText>
          <AppButton size="sm" variant="secondary" label="Firm up" onPress={() => onStart(item.verses)} />
        </View>
      ))}
    </View>
  );
}

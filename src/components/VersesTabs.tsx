import { View } from 'react-native';

import { SegmentedControl } from './blocks';

// The Verses tab's three siblings: the list, the Memory Plan Designer and the
// calendar. Switching between them is a swap, not a step forward, so none of
// them draws a back link (AppState.switchVersesTab adds no history).

export type VersesTabId = 'activePlan' | 'memoryPlan' | 'memoryCalendar';

const OPTIONS: { id: VersesTabId; label: string }[] = [
  { id: 'activePlan', label: 'My Verses' },
  { id: 'memoryPlan', label: 'Plan' },
  { id: 'memoryCalendar', label: 'Calendar' },
];

export function VersesTabs({ value, onChange }: { value: VersesTabId; onChange: (tab: VersesTabId) => void }) {
  return (
    <View>
      <SegmentedControl<VersesTabId> value={value} onChange={onChange} options={OPTIONS} accessibilityLabel="Verses section" />
    </View>
  );
}

import { View } from 'react-native';

import {
  AppText,
  CollapsibleCard,
  OptionCards,
  RangeCaption,
  SettingRow,
  ToggleRow,
  useScaledSpace,
} from './design';
import { StepperRow } from './ui';
import type { OptionCardItem } from './design';

export type MissPolicy = 'lenient' | 'standard' | 'graceDiscretion' | 'custom';

// Preset numbers, unchanged from the original screen. `graceDiscretion` is a
// distinct mode rather than just looser numbers -- see applyMissToItem's freeze
// branch in useAppState.
const MISS_POLICY_TIERS: {
  key: Exclude<MissPolicy, 'custom'>;
  grace: number;
  dailyRefresher: number;
  weeklyRefresher: number;
}[] = [
  { key: 'lenient', grace: 2, dailyRefresher: 4, weeklyRefresher: 2 },
  { key: 'standard', grace: 1, dailyRefresher: 7, weeklyRefresher: 4 },
  { key: 'graceDiscretion', grace: 1, dailyRefresher: 7, weeklyRefresher: 4 },
];

// Copy lives beside the presets. Descriptions are full sentences on purpose:
// they're what makes this setting comprehensible, and in the old four-across
// layout they were the part being clipped away.
const MISS_POLICY_OPTIONS: OptionCardItem<MissPolicy>[] = [
  {
    id: 'lenient',
    title: 'Lenient',
    desc: 'More free misses before anything changes, and shorter refreshers when it does.',
  },
  {
    id: 'standard',
    title: 'Standard',
    desc: 'The default. One free miss, then a short refresher stint before the verse returns to its phase.',
  },
  {
    id: 'graceDiscretion',
    title: 'Grace at Your Discretion',
    desc: "Nothing ever escalates on its own — missed time simply doesn't count, and you pick up exactly where you left off.",
  },
  {
    id: 'custom',
    title: 'Custom',
    desc: 'Set the free-miss count and refresher lengths yourself.',
  },
];

export interface MissPolicySectionProps {
  missPolicy: MissPolicy;
  setMissPolicy: (p: MissPolicy) => void;
  missPolicyAskEveryTime: boolean;
  setMissPolicyAskEveryTime: (v: boolean) => void;
  graceCount: number;
  setGraceCount: (n: number) => void;
  refresherDailyDays: number;
  setRefresherDailyDays: (n: number) => void;
  refresherWeeklyWeeks: number;
  setRefresherWeeklyWeeks: (n: number) => void;
  onToast?: (message: string) => void;
}

/**
 * Missed Review Handling.
 *
 * Takes plain values and setters rather than the whole AppState object, so the
 * dev layout lab can drive it with local state and render it at every font
 * scale without a signed-in user or a real plan.
 */
export function MissPolicySection({
  missPolicy,
  setMissPolicy,
  missPolicyAskEveryTime,
  setMissPolicyAskEveryTime,
  graceCount,
  setGraceCount,
  refresherDailyDays,
  setRefresherDailyDays,
  refresherWeeklyWeeks,
  setRefresherWeeklyWeeks,
  onToast,
}: MissPolicySectionProps) {
  const space = useScaledSpace();

  const selectPolicy = (next: MissPolicy) => {
    setMissPolicy(next);
    if (next === 'custom') return;
    const cfg = MISS_POLICY_TIERS.find((t) => t.key === next)!;
    setGraceCount(cfg.grace);
    setRefresherDailyDays(cfg.dailyRefresher);
    setRefresherWeeklyWeeks(cfg.weeklyRefresher);
    const label = MISS_POLICY_OPTIONS.find((o) => o.id === next)?.title ?? next;
    onToast?.(`Missed-review handling set to ${label}! 🎯`);
  };

  const currentTitle = MISS_POLICY_OPTIONS.find((o) => o.id === missPolicy)?.title ?? 'Standard';

  return (
    <CollapsibleCard
      storageKey="planDesigner.missPolicy"
      title="Missed Review Handling"
      summary={currentTitle}
    >
      <AppText variant="caption" className="font-sans text-neutral-600">
        What happens when reviews come due and you're not around — vacations, busy weeks, sick days.
      </AppText>

      <OptionCards options={MISS_POLICY_OPTIONS} value={missPolicy} onChange={selectPolicy} />

      {missPolicy === 'custom' && (
        <View
          className="border-t border-[#F3F2F1]"
          style={{ gap: space(16), paddingTop: space(8) }}
        >
          <View style={{ gap: space(6) }}>
            <SettingRow label="Free Misses Before Escalating" value={graceCount} />
            <StepperRow min={0} max={5} value={graceCount} onChange={setGraceCount} />
            <RangeCaption min="0 (none)" max="5" />
          </View>

          <View style={{ gap: space(6) }}>
            <SettingRow label="Weekly → Daily Refresher" value={`${refresherDailyDays} days`} />
            <StepperRow min={2} max={21} value={refresherDailyDays} onChange={setRefresherDailyDays} />
            <RangeCaption min="2 days" max="21 days" />
          </View>

          <View style={{ gap: space(6) }}>
            <SettingRow label="Monthly → Weekly Refresher" value={`${refresherWeeklyWeeks} weeks`} />
            <StepperRow min={1} max={8} value={refresherWeeklyWeeks} onChange={setRefresherWeeklyWeeks} />
            <RangeCaption min="1 week" max="8 weeks" />
          </View>
        </View>
      )}

      <View className="border-t border-[#F3F2F1]" style={{ paddingTop: space(8) }}>
        <ToggleRow
          label="When I miss reviews"
          hint={
            missPolicyAskEveryTime
              ? 'Ask me each time, with a chance to customize per verse.'
              : 'Apply the setting above automatically, no prompt.'
          }
          value={missPolicyAskEveryTime}
          onChange={setMissPolicyAskEveryTime}
        />
      </View>
    </CollapsibleCard>
  );
}

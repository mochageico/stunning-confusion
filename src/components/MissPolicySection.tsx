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
// layout they were the part being clipped away. "Catch-up" is the user-facing
// word for what the engine calls a refresher.
const MISS_POLICY_OPTIONS: OptionCardItem<MissPolicy>[] = [
  {
    id: 'lenient',
    title: 'Lenient',
    desc: 'More free misses before anything changes, and a shorter catch-up when it does.',
  },
  {
    id: 'standard',
    title: 'Standard',
    desc: 'The default. One free miss, then a short catch-up of more frequent reviews before the verse goes back to its usual pace.',
  },
  {
    id: 'graceDiscretion',
    title: 'Grace at your discretion',
    desc: "Nothing ever changes on its own. Missed time simply doesn't count, and you pick up exactly where you left off.",
  },
  {
    id: 'custom',
    title: 'Custom',
    desc: 'Set the free misses and catch-up lengths yourself.',
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
}

/**
 * What happens when you miss reviews.
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
}: MissPolicySectionProps) {
  const space = useScaledSpace();

  // No toast on a pick: the checked card already says what changed.
  const selectPolicy = (next: MissPolicy) => {
    setMissPolicy(next);
    if (next === 'custom') return;
    const cfg = MISS_POLICY_TIERS.find((t) => t.key === next)!;
    setGraceCount(cfg.grace);
    setRefresherDailyDays(cfg.dailyRefresher);
    setRefresherWeeklyWeeks(cfg.weeklyRefresher);
  };

  const currentTitle = MISS_POLICY_OPTIONS.find((o) => o.id === missPolicy)?.title ?? 'Standard';

  return (
    <CollapsibleCard storageKey="planDesigner.missPolicy" title="Missed reviews" summary={currentTitle}>
      <AppText variant="caption" className="font-sans text-ink-2">
        What happens when reviews come due and you're not around: vacations, busy weeks, sick days.
      </AppText>

      <OptionCards options={MISS_POLICY_OPTIONS} value={missPolicy} onChange={selectPolicy} />

      {missPolicy === 'custom' && (
        <View className="border-t border-hairline" style={{ gap: space(16), paddingTop: space(8) }}>
          <View style={{ gap: space(6) }}>
            <SettingRow label="Free misses before anything changes" value={graceCount} />
            <StepperRow min={0} max={5} value={graceCount} onChange={setGraceCount} />
            <RangeCaption min="None" max="5" />
          </View>

          <View style={{ gap: space(6) }}>
            <SettingRow
              label="Catch-up for a weekly verse"
              hint="Reviewed daily for this long, then weekly again."
              value={`${refresherDailyDays} days`}
            />
            <StepperRow min={2} max={21} value={refresherDailyDays} onChange={setRefresherDailyDays} />
            <RangeCaption min="2 days" max="21 days" />
          </View>

          <View style={{ gap: space(6) }}>
            <SettingRow
              label="Catch-up for a monthly verse"
              hint="Reviewed weekly for this long, then monthly again."
              value={`${refresherWeeklyWeeks} weeks`}
            />
            <StepperRow min={1} max={8} value={refresherWeeklyWeeks} onChange={setRefresherWeeklyWeeks} />
            <RangeCaption min="1 week" max="8 weeks" />
          </View>
        </View>
      )}

      <View className="border-t border-hairline" style={{ paddingTop: space(8) }}>
        <ToggleRow
          label="Ask me each time"
          hint={
            missPolicyAskEveryTime
              ? 'When you miss reviews, you choose what happens, verse by verse if you like.'
              : 'The choice above happens on its own, with no question.'
          }
          value={missPolicyAskEveryTime}
          onChange={setMissPolicyAskEveryTime}
        />
      </View>
    </CollapsibleCard>
  );
}

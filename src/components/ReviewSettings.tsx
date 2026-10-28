import { View } from 'react-native';

import { AppText, ToggleRow, useScaledSpace } from './design';
import { SectionHeader, SegmentedControl } from './blocks';
import { LADDER, LADDER_GROUPS, THOROUGHNESS_PRESETS, daysToTop, stepReviewCount, type Thoroughness } from '../lib/ladder';
import { CLEAN_PCT_OPTIONS } from '../lib/grading';
import type { LadderPrefs } from '../lib/ladderEngine';

// ============================================================================
// REVIEWS -- how fast verses climb the ladder, and what counts as clean
// (REVIEW_LADDER_PLAN.md decision 5). Commits live like Rhythm, so there is no
// Save. Takes plain values + onChange, not AppState, so the demo harness and
// the layout lab can drive it with no signed-in user.
// ============================================================================

/** "About 28 months" / "about 3½ years": a span of days for a sentence. */
export const spanWords = (days: number): string => {
  const months = days / 30.4;
  if (months < 36) return `${Math.round(months)} months`;
  const years = Math.round((months / 12) * 2) / 2;
  return `${Number.isInteger(years) ? years : `${Math.floor(years)}½`} years`;
};

const TOUGHNESS_ORDER = THOROUGHNESS_PRESETS.map((p) => p.value);

const Caption = ({ children }: { children: React.ReactNode }) => {
  const space = useScaledSpace();
  return (
    <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
      {children}
    </AppText>
  );
};

/** Every step with the reviews it takes at a thoroughness, grouped like My Verses. */
export function StepTable({ thoroughness }: { thoroughness: Thoroughness }) {
  const space = useScaledSpace();
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
      {LADDER.map((s, step) => {
        const n = stepReviewCount(step, thoroughness);
        const first = step === 0 || LADDER[step - 1].group !== s.group;
        return (
          <View key={s.label} style={{ gap: space(8) }}>
            {first ? (
              <AppText variant="micro" className="font-sans font-medium text-ink-3" style={{ paddingTop: step === 0 ? 0 : space(4) }}>
                {LADDER_GROUPS[s.group].name.toUpperCase()}
              </AppText>
            ) : null}
            <View className="flex-row flex-wrap items-baseline justify-between" style={{ columnGap: space(8), rowGap: space(2) }}>
              <AppText variant="body" className="font-sans text-ink">
                {s.label}
              </AppText>
              <AppText variant="body" className="font-sans text-ink-2">
                {n === null ? 'for good' : `${n} reviews`}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function ReviewSettings({
  prefs,
  onChange,
}: {
  prefs: LadderPrefs;
  onChange: (patch: Partial<LadderPrefs>) => void;
}) {
  const space = useScaledSpace();
  const pick = THOROUGHNESS_PRESETS.find((p) => p.value === prefs.thoroughness) ?? THOROUGHNESS_PRESETS[1];
  return (
    <View style={{ gap: space(20) }}>
      <View style={{ gap: space(6) }}>
        <SectionHeader title="How thorough" />
        <SegmentedControl
          value={prefs.thoroughness}
          onChange={(v) => onChange({ thoroughness: v })}
          options={TOUGHNESS_ORDER.map((v) => ({ id: v, label: THOROUGHNESS_PRESETS.find((p) => p.value === v)!.label }))}
          accessibilityLabel="How thorough"
          wrap
        />
        <Caption>
          {pick.label}: about {spanWords(daysToTop(prefs.thoroughness))} to reach Every 6 months, with no slips. More reviews at each step
          means a surer hold and a slower climb.
        </Caption>
      </View>

      <View style={{ gap: space(6) }}>
        <SectionHeader title="Reviews at each step" />
        <StepTable thoroughness={prefs.thoroughness} />
        <Caption>A passage moves up after this many counted reviews. Every step needs at least 2.</Caption>
      </View>

      <View style={{ gap: space(6) }}>
        <SectionHeader title="Accuracy needed for clean" />
        <SegmentedControl
          value={prefs.cleanPct}
          onChange={(v) => onChange({ cleanPct: v })}
          options={CLEAN_PCT_OPTIONS.map((n) => ({ id: n, label: `${n}%` }))}
          accessibilityLabel="Accuracy needed for clean"
        />
        <Caption>
          A verse said at or above this is clean. Below it is a stumble, and under 50% is a blank. A hint counts as a stumble.
        </Caption>
      </View>

      <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(16) }}>
        <ToggleRow
          label="Late reviews move you back"
          hint="Each full interval a passage is overdue moves it back one review, never below the start of its step. Off: a late passage waits where it was."
          value={prefs.lateMovesBack}
          onChange={(on) => onChange({ lateMovesBack: on })}
        />
        <ToggleRow
          label="Find the wrong word can count as a clean review"
          hint="Off: Find the wrong word is practice only and never moves a passage."
          value={prefs.swapCanBeClean}
          onChange={(on) => onChange({ swapCanBeClean: on })}
        />
      </View>
    </View>
  );
}

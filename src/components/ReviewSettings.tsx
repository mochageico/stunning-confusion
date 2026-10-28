import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';

import { AppText, Switch, useFontScale, useScaledSpace } from './design';
import { SegmentedControl } from './blocks';
import { StageDot } from './VerseStages';
import { StepperRow } from './ui';
import { useThemeColors } from './theme';
import { LADDER, LADDER_GROUPS, THOROUGHNESS_PRESETS, daysToTop, stepReviewCount, type Thoroughness } from '../lib/ladder';
import { CLEAN_PCT_OPTIONS } from '../lib/grading';
import type { LadderPrefs } from '../lib/ladderEngine';

// ============================================================================
// REVIEW SETTINGS -- the second half of the Memory Plan Designer
// (REVIEW_LADDER_PLAN.md decision 5). Retention Level, perfect recalls, the
// accuracy a verse needs to count as clean, and what a late review does. Tap a
// setting to change it: its preview opens right under it and shows what the
// choice does. Everything commits live, so there is no Save. Takes plain values
// and onChange, not AppState, so the demo harness and the layout lab can drive
// it with no signed-in user.
// ============================================================================

/** "About 28 months" / "about 3½ years": a span of days for a sentence. */
export const spanWords = (days: number): string => {
  const months = days / 30.4;
  if (months < 36) return `${Math.round(months)} months`;
  const years = Math.round((months / 12) * 2) / 2;
  return `${Number.isInteger(years) ? years : `${Math.floor(years)}½`} years`;
};

const TOUGHNESS_ORDER = THOROUGHNESS_PRESETS.map((p) => p.value);
const presetLabel = (t: Thoroughness) => THOROUGHNESS_PRESETS.find((p) => p.value === t)?.label ?? 'Standard';

export type ReviewSettingKey = 'level' | 'recalls' | 'accuracy' | 'late';

/** The accuracy the example recital reached, in the Accuracy preview. */
const EXAMPLE_PCT = 88;

/** Every step with the reviews it takes at a Retention Level, grouped like My Verses. */
export function StepTable({ thoroughness }: { thoroughness: Thoroughness }) {
  const space = useScaledSpace();
  return (
    <View style={{ gap: space(8) }}>
      {LADDER.map((s, step) => {
        const n = stepReviewCount(step, thoroughness);
        const first = step === 0 || LADDER[step - 1].group !== s.group;
        return (
          <View key={s.label} style={{ gap: space(6) }}>
            {first ? (
              <AppText variant="micro" className="font-sans font-medium text-ink-3" style={{ paddingTop: step === 0 ? 0 : space(4) }}>
                {LADDER_GROUPS[s.group].name.toUpperCase()}
              </AppText>
            ) : null}
            <View className="flex-row items-center" style={{ columnGap: space(8) }}>
              <StageDot stage={s.group} size={9} />
              <AppText variant="body" className="font-sans text-ink flex-1">
                {s.label}
              </AppText>
              <AppText variant="body" className="font-sans font-semibold text-ink">
                {n === null ? 'for good' : `${n} reviews`}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A row that opens its own preview underneath. One is open at a time. */
function SettingRow({
  title,
  value,
  open,
  onPress,
  first,
  children,
}: {
  title: string;
  value: string;
  open: boolean;
  onPress: () => void;
  first?: boolean;
  children: React.ReactNode;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();
  return (
    <View className={first ? '' : 'border-t border-hairline'}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${title}, ${value}`}
        className={`flex-row items-center active:opacity-70 ${open ? 'bg-accent-soft' : ''}`}
        style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(10), minHeight: 56 }}
      >
        <View className="flex-1" style={{ gap: space(1) }}>
          <AppText variant="body" className="font-sans font-semibold text-ink">
            {title}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-2">
            {value}
          </AppText>
        </View>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown size={Math.round(20 * scale)} color={palette.ink3} strokeWidth={2.2} />
        </View>
      </Pressable>
      {open ? (
        <View className="bg-surface-2 rounded-card" style={{ marginHorizontal: space(10), marginBottom: space(12), padding: space(12), gap: space(12) }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

/** The dots of a step's reviews: filled up to `done`. */
function ReviewDots({ total, done }: { total: number; done: number }) {
  const space = useScaledSpace();
  return (
    <View className="flex-row" style={{ gap: space(4) }}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          className={`rounded-sm ${i < done ? 'bg-stage-daily' : 'bg-hairline'}`}
          // layout-ok: a progress pip holds no text.
          style={{ width: 22, height: 12 }}
        />
      ))}
    </View>
  );
}

export function ReviewSettings({
  prefs,
  masteryTouches,
  onChange,
  onMasteryChange,
  initialOpen = 'level',
}: {
  prefs: Pick<LadderPrefs, 'thoroughness' | 'cleanPct' | 'lateMovesBack'>;
  masteryTouches: number;
  onChange: (patch: Partial<LadderPrefs>) => void;
  onMasteryChange: (n: number) => void;
  /** Which setting starts open ('' for none). */
  initialOpen?: ReviewSettingKey | '';
}) {
  const space = useScaledSpace();
  const [open, setOpen] = useState<ReviewSettingKey | ''>(initialOpen);
  const toggle = (key: ReviewSettingKey) => setOpen((cur) => (cur === key ? '' : key));
  const clean = EXAMPLE_PCT >= prefs.cleanPct;

  return (
    <View className="bg-surface border border-line rounded-card overflow-hidden">
      <SettingRow
        first
        title="Retention Level"
        value={`${presetLabel(prefs.thoroughness)} · about ${spanWords(daysToTop(prefs.thoroughness))} to Secure`}
        open={open === 'level'}
        onPress={() => toggle('level')}
      >
        <SegmentedControl
          value={prefs.thoroughness}
          onChange={(v) => onChange({ thoroughness: v })}
          options={TOUGHNESS_ORDER.map((v) => ({ id: v, label: presetLabel(v) }))}
          accessibilityLabel="Retention Level"
          wrap
        />
        <StepTable thoroughness={prefs.thoroughness} />
        <AppText variant="caption" className="font-sans text-ink-2">
          A passage that is never late reaches Secure after about {spanWords(daysToTop(prefs.thoroughness))}. More reviews at each step
          means a surer hold and a slower climb. Every step needs at least 2.
        </AppText>
      </SettingRow>

      <SettingRow
        title="Perfect recalls to learn a verse"
        value={`${masteryTouches} in a row`}
        open={open === 'recalls'}
        onPress={() => toggle('recalls')}
      >
        <StepperRow value={masteryTouches} min={1} max={6} onChange={onMasteryChange} />
        <View className="flex-row flex-wrap justify-center" style={{ gap: space(6) }}>
          {Array.from({ length: masteryTouches }, (_, i) => (
            <StageDot key={i} stage="settling" size={14} />
          ))}
        </View>
        <View className="flex-row items-center justify-center" style={{ gap: space(8) }}>
          <StageDot stage="learning" />
          <AppText variant="label" className="font-sans text-ink">
            Learning
          </AppText>
          <AppText variant="label" className="font-sans text-ink-3">
            ›
          </AppText>
          <StageDot stage="settling" />
          <AppText variant="label" className="font-sans text-ink">
            Settling
          </AppText>
        </View>
        <AppText variant="caption" className="font-sans text-ink-2 text-center">
          After {masteryTouches} perfect {masteryTouches === 1 ? 'recall' : 'recalls'}, at least an hour apart, a verse is learned and
          starts coming back on the ladder.
        </AppText>
      </SettingRow>

      <SettingRow
        title="Accuracy needed for clean"
        value={`${prefs.cleanPct}% of the words`}
        open={open === 'accuracy'}
        onPress={() => toggle('accuracy')}
      >
        <SegmentedControl
          value={prefs.cleanPct}
          onChange={(v) => onChange({ cleanPct: v })}
          options={CLEAN_PCT_OPTIONS.map((n) => ({ id: n, label: `${n}%` }))}
          accessibilityLabel="Accuracy needed for clean"
        />
        <AppText variant="label" className="font-sans text-ink">
          Say a verse and get {EXAMPLE_PCT}% of the words right:
        </AppText>
        <View style={{ gap: space(6) }}>
          {/* layout-ok: the bar holds no text. */}
          <View className="bg-hairline rounded-full" style={{ height: 14, position: 'relative' }}>
            <View className="bg-accent rounded-full" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${EXAMPLE_PCT}%` }} />
            <View className="bg-ink rounded-full" style={{ position: 'absolute', top: -4, bottom: -4, width: 3, left: `${prefs.cleanPct}%` }} />
          </View>
          <View className="flex-row justify-between">
            <AppText variant="micro" className="font-sans text-ink-3">
              0%
            </AppText>
            <AppText variant="micro" className="font-sans text-ink-3">
              needs {prefs.cleanPct}%
            </AppText>
            <AppText variant="micro" className="font-sans text-ink-3">
              100%
            </AppText>
          </View>
        </View>
        <View className={`rounded-btn ${clean ? 'bg-success-soft' : 'bg-warning-soft'}`} style={{ padding: space(10) }}>
          <AppText variant="label" className={`font-sans font-semibold ${clean ? 'text-success' : 'text-warning'}`}>
            {clean ? 'Clean: this review counts' : 'Stumble: this review does not count as clean'}
          </AppText>
        </View>
        <AppText variant="caption" className="font-sans text-ink-2">
          Below the line is a stumble, and under 50% is a blank. A hint counts as a stumble.
        </AppText>
      </SettingRow>

      <SettingRow
        title="Late reviews move you back"
        value={prefs.lateMovesBack ? 'On' : 'Off'}
        open={open === 'late'}
        onPress={() => toggle('late')}
      >
        <View className="flex-row items-center" style={{ gap: space(10) }}>
          <AppText variant="body" className="font-sans text-ink flex-1">
            Move me back when I'm late
          </AppText>
          <Switch value={prefs.lateMovesBack} onChange={(on) => onChange({ lateMovesBack: on })} accessibilityLabel="Late reviews move you back" />
        </View>
        <View className="bg-surface border border-line rounded-btn" style={{ padding: space(10), gap: space(4) }}>
          <AppText variant="label" className="font-sans text-ink">
            <AppText variant="label" className="font-sans font-semibold text-ink">
              Example.{' '}
            </AppText>
            A passage is on Every 2 days, at review 3 of 4. It was due Wed 4 Nov. You open the app Wed 11 Nov.
          </AppText>
          <AppText variant="label" className="font-sans text-ink">
            That is 7 days late. 7 days ÷ 2 days = 3 missed reviews.
          </AppText>
        </View>
        <View className="flex-row items-center" style={{ gap: space(10) }}>
          <AppText variant="caption" className="font-sans text-ink-2" style={{ width: space(52) }}>
            Before
          </AppText>
          <ReviewDots total={4} done={3} />
          <AppText variant="caption" className="font-sans text-ink-2">
            review 3 of 4
          </AppText>
        </View>
        <View className="flex-row items-center" style={{ gap: space(10) }}>
          <AppText variant="caption" className="font-sans text-ink-2" style={{ width: space(52) }}>
            After
          </AppText>
          <ReviewDots total={4} done={prefs.lateMovesBack ? 1 : 3} />
          <AppText variant="caption" className="font-sans text-ink-2">
            {prefs.lateMovesBack ? 'review 1 of 4' : 'review 3 of 4, waiting'}
          </AppText>
        </View>
        <AppText variant="caption" className="font-sans text-ink-2">
          {prefs.lateMovesBack
            ? 'On: the 3 missed reviews move it back 3 reviews, but never below review 1 of its step. Today’s review is then graded on top.'
            : 'Off: it stays at review 3 of 4 and waits. Being late never moves it back.'}
        </AppText>
      </SettingRow>
    </View>
  );
}

import { Pressable, View } from 'react-native';

import { Rhythm } from '../types';
import { AppText, MIN_TOUCH, Switch, useFontScale, useScaledSpace } from './design';
import { SegmentedControl } from './blocks';
import { StepperRow } from './ui';

const WEEK_DAYS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

const LOAD_TIERS: { key: Rhythm['cognitiveLoadSensitivity']; label: string }[] = [
  { key: 'low', label: 'Quick' },
  { key: 'medium', label: 'Average' },
  { key: 'high', label: 'Slower' },
];

/**
 * Your personal cadence: which days you take on new verses, how many, and how
 * long a day's reviews may run.
 *
 * Commits LIVE -- there is no Save button and no dirty state, because the
 * engine reads these values the moment they change. The old queue-screen
 * version had a "Save Rhythm to <plan>" button that only controlled whether
 * the change survived a reload, while implying it controlled whether the
 * change applied at all.
 *
 * Takes a plain value + onChange rather than AppState, same as
 * MissPolicySection, so DevLayoutLab can drive it with no signed-in user.
 */
export function RhythmEditor({
  rhythm,
  onChange,
}: {
  rhythm: Rhythm;
  onChange: (patch: Partial<Rhythm>) => void;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  // Seven day pills plus a label is the row that breaks first: past 1.3x the
  // label moves above the pills instead of sharing the row with them.
  const stacked = scale >= 1.3;
  const pill = Math.max(MIN_TOUCH * 0.62, space(30));

  const toggleDay = (day: string) => {
    const next = rhythm.learningDays.includes(day)
      ? rhythm.learningDays.filter((d) => d !== day)
      : [...rhythm.learningDays, day];
    onChange({ learningDays: next });
  };

  const versesPerWeek = rhythm.newVersesPace * rhythm.learningDays.length;

  return (
    <View style={{ gap: space(16) }}>
      {/* Learning days */}
      <View style={{ gap: space(8) }}>
        <View
          className={stacked ? '' : 'flex-row items-center justify-between'}
          style={{ gap: space(stacked ? 6 : 8) }}
        >
          <AppText variant="label" className="font-sans font-medium text-ink">
            Learning days
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            {rhythm.learningDays.length}/7
          </AppText>
        </View>
        <View className="flex-row" style={{ gap: space(6) }}>
          {WEEK_DAYS.map((d) => {
            const isActive = rhythm.learningDays.includes(d);
            const isSabbath = rhythm.sabbathEnabled && d === rhythm.sabbathDay;
            return (
              <Pressable
                key={d}
                onPress={() => {
                  if (isSabbath) return;
                  toggleDay(d);
                }}
                disabled={isSabbath}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isActive, disabled: isSabbath }}
                aria-checked={isActive}
                className={`flex-1 items-center justify-center rounded-full border ${
                  isActive
                    ? 'bg-accent border-accent'
                    : isSabbath
                      ? 'bg-surface-2 border-line'
                      : 'bg-surface border-line-strong'
                }`}
                style={{ minHeight: pill, paddingVertical: space(4) }}
              >
                <AppText
                  variant="caption"
                  className={`font-sans font-semibold ${
                    isActive ? 'text-on-accent' : isSabbath ? 'text-ink-3' : 'text-ink-2'
                  }`}
                >
                  {d}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* New verses per learning day */}
      <View style={{ gap: space(6) }}>
        <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
          <AppText variant="label" className="font-sans font-medium text-ink flex-1">
            New verses per learning day
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2 shrink-0">
            {rhythm.newVersesPace}
          </AppText>
        </View>
        <StepperRow
          value={rhythm.newVersesPace}
          min={1}
          max={10}
          onChange={(v) => onChange({ newVersesPace: v })}
        />
      </View>

      {/* Daily review time limit */}
      <View style={{ gap: space(6) }}>
        <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
          <AppText variant="label" className="font-sans font-medium text-ink flex-1">
            Daily review time limit
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2 shrink-0">
            {rhythm.maxReviewCap} min
          </AppText>
        </View>
        <StepperRow
          value={rhythm.maxReviewCap}
          min={5}
          max={60}
          step={5}
          onChange={(v) => onChange({ maxReviewCap: v })}
        />
      </View>

      {/* Sabbath. Lives here rather than in the plan designer because it's a
          statement about your week, exactly like learning days -- and it
          directly constrains them (the pills above grey out the Sabbath). */}
      <View className="border-t border-hairline" style={{ paddingTop: space(12), gap: space(8) }}>
        <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
          <View className="flex-1" style={{ gap: space(2) }}>
            <AppText variant="label" className="font-sans font-medium text-ink">
              Sabbath day
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-3">
              A day fully free from learning and reviewing.
            </AppText>
          </View>
          <Switch
            value={rhythm.sabbathEnabled}
            accessibilityLabel="Sabbath day"
            onChange={(turningOn) => {
              // A day can't be both a learning day and the Sabbath at once --
              // turning Sabbath on immediately frees up its day.
              onChange({
                sabbathEnabled: turningOn,
                ...(turningOn && rhythm.learningDays.includes(rhythm.sabbathDay)
                  ? { learningDays: rhythm.learningDays.filter((d) => d !== rhythm.sabbathDay) }
                  : {}),
              });
            }}
          />
        </View>

        {rhythm.sabbathEnabled && (
          <View className="flex-row" style={{ gap: space(6) }}>
            {WEEK_DAYS.map((d) => {
              const isActive = rhythm.sabbathDay === d;
              return (
                <Pressable
                  key={`sabbath-${d}`}
                  onPress={() =>
                    onChange({
                      sabbathDay: d,
                      ...(rhythm.learningDays.includes(d)
                        ? { learningDays: rhythm.learningDays.filter((x) => x !== d) }
                        : {}),
                    })
                  }
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isActive }}
                  aria-checked={isActive}
                  className={`flex-1 items-center justify-center rounded-full border ${
                    isActive ? 'bg-accent border-accent' : 'bg-surface border-line-strong'
                  }`}
                  style={{ minHeight: pill, paddingVertical: space(4) }}
                >
                  <AppText
                    variant="caption"
                    className={`font-sans font-semibold ${isActive ? 'text-on-accent' : 'text-ink-2'}`}
                  >
                    {d}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* Effort sensitivity: scales the daily time ESTIMATE, which is what
          the review cap above is compared against. Another statement about
          you, not about a memorization method. */}
      <View className="border-t border-hairline" style={{ paddingTop: space(12), gap: space(8) }}>
        <AppText variant="label" className="font-sans font-medium text-ink">
          How long verses take you
        </AppText>
        <SegmentedControl
          value={rhythm.cognitiveLoadSensitivity}
          onChange={(key) => onChange({ cognitiveLoadSensitivity: key })}
          accessibilityLabel="How long verses take you"
          options={LOAD_TIERS.map((tier) => ({ id: tier.key, label: tier.label }))}
        />
      </View>

      {/* The consequence, in one line. This is the whole reason the dials sit
          on the queue page rather than in Settings -- you can see what they do
          to your week without leaving the screen. */}
      <View className="border-t border-hairline" style={{ paddingTop: space(10) }}>
        <AppText variant="caption" className="font-sans text-ink-2">
          {rhythm.learningDays.length === 0
            ? 'No learning days selected — no new verses will start until you pick at least one.'
            : `About ${versesPerWeek} new ${versesPerWeek === 1 ? 'verse' : 'verses'} a week, up to ${rhythm.maxReviewCap} min of review a day.`}
        </AppText>
      </View>
    </View>
  );
}

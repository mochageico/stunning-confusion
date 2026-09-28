import { ScrollView, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, StepperRow } from '../components/ui';
import { MissPolicySection } from '../components/MissPolicySection';
import {
  AppButton,
  AppTextInput,
  AppText,
  CollapsibleCard,
  MIN_TOUCH,
  OptionCards,
  RangeCaption,
  SettingRow,
  useScaledSpace,
  type OptionCardItem,
} from '../components/design';
import { ScreenHeader, SectionHeader } from '../components/blocks';
// The Daily Drip / Weekend Warrior pacing presets were deleted with the
// plan/rhythm split: they set learning days, pace and review cap, all of
// which are Rhythm now and live on the queue screen. They were also the
// reason the three shipped "plans" were indistinguishable -- see
// DEFAULT_PLANS in data.ts.

type RigorKey = 'light' | 'standard' | 'deep';
/** What the retention cards can be set to. 'custom' is a real, selectable
 *  choice now, not just a state the plan silently fell into. */
type RetentionChoice = RigorKey | 'custom';

const RIGOR_TIERS: { key: RigorKey; label: string; weeks: number; months: number; years: number; touches: number }[] = [
  { key: 'light', label: 'Light', weeks: 5, months: 4, years: 3, touches: 3 },
  { key: 'standard', label: 'Standard', weeks: 7, months: 6, years: 5, touches: 3 },
  { key: 'deep', label: 'Deep', weeks: 9, months: 8, years: 7, touches: 4 },
];

// The three presets, plus Custom. Custom used to be invisible here: a plan
// that had been fine-tuned still rendered with Standard checked (the value
// was mapped 'custom' -> 'standard' on the way in), so the cards actively
// lied about what the plan was doing. Its description is built from the live
// numbers rather than hardcoded, since that IS what Custom means.
// Descriptions are in plain English on purpose. These used to read "5-4-3
// phases, 3 touches to graduate" -- perfectly precise, and meaningless unless
// you already knew what a phase and a touch were, which is exactly the
// knowledge a first-time reader doesn't have.
const rigorOptions = (
  summary: string
): OptionCardItem<RetentionChoice>[] => [
  { id: 'light', title: 'Light', desc: 'Verses come back for about 3 years, then stop. Least work, and the easiest to forget later.' },
  { id: 'standard', title: 'Standard', desc: 'Verses come back for about 5 years, then stop. A good balance for most people.' },
  { id: 'deep', title: 'Deep', desc: 'Verses come back for about 7 years, then stop. The most work, and the hardest to forget.' },
  { id: 'custom', title: 'Custom', desc: `${summary}. Your own numbers — set them under "Change the details" below.` },
];

export default function PlanDesignerScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    masteryTouches,
    setMasteryTouches,
    reviewsRequired,
    setReviewsRequired,
    isEditingBuiltInPlan,
    retentionRigor,
    setRetentionRigor,
    dailyPhaseWeeks,
    setDailyPhaseWeeks,
    weeklyPhaseMonths,
    setWeeklyPhaseMonths,
    monthlyPhaseYears,
    setMonthlyPhaseYears,
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
    customPlanName,
    setCustomPlanName,
    handleSavePlan,
  } = state;

  const applyRigorPreset = (tier: RigorKey) => {
    const cfg = RIGOR_TIERS.find((t) => t.key === tier)!;
    setRetentionRigor(tier);
    setDailyPhaseWeeks(cfg.weeks);
    setWeeklyPhaseMonths(cfg.months);
    setMonthlyPhaseYears(cfg.years);
    setMasteryTouches(cfg.touches);
  };

  const chooseRetention = (choice: RetentionChoice) => {
    if (choice === 'custom') {
      // Deliberately changes no numbers. Picking Custom is a statement that
      // the plan is yours to tune, not a preset of its own -- so it keeps
      // whatever tier you were on as the starting point to edit from.
      setRetentionRigor('custom');
      return;
    }
    applyRigorPreset(choice);
  };

  // Every hand-edit below moves the plan off its preset. Light/Standard/Deep
  // are exact number sets, so the moment one of those numbers changes, the
  // card claiming to be checked is no longer telling the truth. Touches and
  // Reviews already did this; the three phase lengths -- the settings the
  // tiers are actually NAMED for -- did not, so editing 7-6-5 into 9-8-7 by
  // hand left the plan still labelled Standard.
  const tune = <V,>(setter: (value: V) => void) => (value: V) => {
    setter(value);
    setRetentionRigor('custom');
  };

  const totalRigorDays = dailyPhaseWeeks * 7 + weeklyPhaseMonths * 30 + monthlyPhaseYears * 365;
  const totalRigorLabel =
    totalRigorDays >= 365 ? `${(totalRigorDays / 365).toFixed(1)} years` : `${Math.round(totalRigorDays)} days`;
  const rigorSummary = `Daily for ${dailyPhaseWeeks} weeks, weekly for ${weeklyPhaseMonths} months, monthly for ${monthlyPhaseYears} ${monthlyPhaseYears === 1 ? 'year' : 'years'}`;

  // Copy-on-write: the shipped Standard plan is the baseline every account
  // starts from, so it can't be edited in place. Renaming is what turns an
  // edit into your own plan, and the Save button stays disabled until you do.
  const nameChangedFromBuiltIn = customPlanName.trim().length > 0 && customPlanName.trim() !== 'Standard';
  const canSave = !isEditingBuiltInPlan || nameChangedFromBuiltIn;

  const space = useScaledSpace();

  return (
    <FadeInView style={{ flex: 1 }}>
      {/* pb-4 rather than pb-12: Save lives in the pinned footer below, so
          the scroll content doesn't need to clear it. */}
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-4" contentContainerStyle={{ gap: space(20) }}>
        {/* Titled with the set being edited rather than "Review Settings",
            the title of the list you arrive from: two screens with the same
            header gave no sign that Edit had gone anywhere. */}
        <ScreenHeader
          title={customPlanName.trim() || 'New settings'}
          subtitle="How long a verse keeps coming back, and what happens when you miss one. Which days you learn is set in My Schedule."
          onBack={handleBack}
          backLabel="Review Settings"
        />

        {/* The name. Unnamed settings are indistinguishable from any other set
            in the saved list, and naming is what forks the built-in, which is
            why the copy-on-write note sits right under the field. */}
        <View style={{ gap: space(6) }}>
          <SectionHeader title="Name" />
          <AppTextInput
            placeholder="e.g. My settings"
            value={customPlanName}
            onChangeText={setCustomPlanName}
            variant="body"
            accessibilityLabel="Name"
            className="w-full border border-line rounded-btn font-sans bg-surface text-ink"
            style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(12), paddingVertical: space(10) }}
          />
          {isEditingBuiltInPlan && (
            <AppText
              variant="caption"
              className={`font-sans ${canSave ? 'text-ink-3' : 'text-warning'}`}
              style={{ paddingHorizontal: space(4) }}
            >
              Standard is built in and always stays as it is. Give these a new name to save your own copy.
            </AppText>
          )}
        </View>

        {/* Retention tier -- the primary choice on this screen. */}
        <View style={{ gap: space(8) }}>
          <SectionHeader title="How long verses keep coming back" />
          <OptionCards options={rigorOptions(rigorSummary)} value={retentionRigor} onChange={chooseRetention} />
        </View>

        {/* Fine-tuning: the exact lengths and mastery gates behind the three
            tiers above. Collapsed by default -- picking a tier is enough for
            most people, and touching anything here moves the plan to
            'custom'. */}
        <CollapsibleCard
          storageKey="planDesigner.retentionRigor"
          title="Change the details"
          summary={`${dailyPhaseWeeks} wks · ${weeklyPhaseMonths} mo · ${monthlyPhaseYears} yr`}
          defaultCollapsed
        >
          <AppText variant="caption" className="text-ink-2 font-sans">
            After you learn a verse, it comes back every day for a while, then once a week, then once a month, and
            then it stops, because you know it. These set how long each of those stretches lasts. Bigger numbers mean
            more practice and a verse that's harder to forget. Changing anything here makes these settings Custom.
          </AppText>

          <View style={{ gap: space(16) }}>
            <View style={{ gap: space(6) }}>
              <SettingRow label="Comes back daily for" value={`${dailyPhaseWeeks} weeks`} />
              <StepperRow min={3} max={14} value={dailyPhaseWeeks} onChange={tune(setDailyPhaseWeeks)} />
              <RangeCaption min="3 weeks" max="14 weeks" />
            </View>

            <View style={{ gap: space(6) }}>
              <SettingRow label="Then weekly for" value={`${weeklyPhaseMonths} months`} />
              <StepperRow min={2} max={12} value={weeklyPhaseMonths} onChange={tune(setWeeklyPhaseMonths)} />
              <RangeCaption min="2 months" max="12 months" />
            </View>

            <View style={{ gap: space(6) }}>
              <SettingRow label="Then monthly for" value={`${monthlyPhaseYears} years`} />
              <StepperRow min={1} max={10} value={monthlyPhaseYears} onChange={tune(setMonthlyPhaseYears)} />
              <RangeCaption min="1 year" max="10 years" />
            </View>

            {/* Mastery gates. These moved here from the deleted "Pacing &
                Limits" section -- they were never pacing: they decide when
                a verse moves on, which is retention. */}
            <View style={{ gap: space(6), paddingTop: space(8) }} className="border-t border-hairline">
              <SettingRow label="Perfect recalls before a verse counts as learned" value={masteryTouches} />
              <StepperRow min={1} max={6} value={masteryTouches} onChange={tune(setMasteryTouches)} />
            </View>

            <View style={{ gap: space(6) }}>
              <SettingRow label="Times to review it each time it comes back" value={reviewsRequired} />
              <StepperRow min={1} max={5} value={reviewsRequired} onChange={tune(setReviewsRequired)} />
            </View>
          </View>
        </CollapsibleCard>

        {/* Missed reviews. Its own component so the dev layout lab can render
            it at every font scale without a signed-in user. */}
        <MissPolicySection
          missPolicy={missPolicy}
          setMissPolicy={setMissPolicy}
          missPolicyAskEveryTime={missPolicyAskEveryTime}
          setMissPolicyAskEveryTime={setMissPolicyAskEveryTime}
          graceCount={graceCount}
          setGraceCount={setGraceCount}
          refresherDailyDays={refresherDailyDays}
          setRefresherDailyDays={setRefresherDailyDays}
          refresherWeeklyWeeks={refresherWeeklyWeeks}
          setRefresherWeeklyWeeks={setRefresherWeeklyWeeks}
        />
      </ScrollView>

      {/* Pinned footer: the one-line consequence and Save, outside the
          ScrollView so the primary action is always in reach without
          scrolling (a long way down at 1.5x). Kept to a caption and a button
          so it stays small at every text size. A hairline, not a heavy rule:
          it's a tray, not a warning. */}
      <View
        className="border-t border-line bg-surface"
        style={{ paddingHorizontal: space(20), paddingTop: space(10), paddingBottom: space(14), gap: space(8) }}
      >
        <AppText variant="caption" className="font-sans text-ink-2 text-center">
          Verses stop coming back after about {totalRigorLabel}.
        </AppText>
        {/* Disabled until a built-in is renamed; the note under the name
            field says why, in warning color while it's blocking. */}
        <AppButton
          size="lg"
          variant="primary"
          Icon={Check}
          label={isEditingBuiltInPlan ? 'Save as my own' : 'Save'}
          disabled={!canSave}
          onPress={handleSavePlan}
        />
      </View>
    </FadeInView>
  );
}

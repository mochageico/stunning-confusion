import { Pressable, ScrollView, View } from 'react-native';
import { ArrowLeft, Check, TrendingUp } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, StepperRow } from '../components/ui';
import { MissPolicySection } from '../components/MissPolicySection';
import { AppIconButton, AppTextInput,
  AppText,
  CollapsibleCard,
  MIN_TOUCH,
  OptionCards,
  RangeCaption,
  SettingRow,
  useFontScale,
  useScaledSpace,
  type OptionCardItem,
} from '../components/design';

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
    triggerToast,
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
    triggerToast(`Retention set to ${cfg.label} (${cfg.weeks}-${cfg.months}-${cfg.years}, ${cfg.touches} touches). 🎯`);
  };

  const chooseRetention = (choice: RetentionChoice) => {
    if (choice === 'custom') {
      // Deliberately changes no numbers. Picking Custom is a statement that
      // the plan is yours to tune, not a preset of its own -- so it keeps
      // whatever tier you were on as the starting point to edit from.
      setRetentionRigor('custom');
      triggerToast('Retention set to Custom — fine-tune the numbers below. 🎛️');
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
  const scale = useFontScale();
  const iconSize = Math.round(14 * scale);

  return (
    <FadeInView style={{ flex: 1 }}>
      {/* pb-4 rather than pb-12: the Save action now lives in the pinned footer
          below, so the scroll content no longer needs to clear it. */}
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-4" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={15} iconColor="#1A1A1A" onPress={handleBack} className="rounded-full border border-[#E5E5E5] bg-white shrink-0" />
          <View className="flex-1">
            {/* Names the set being edited rather than repeating "Review
                Settings", which is the title of the LIST screen you arrive
                from -- two screens with an identical header gave no signal
                that Edit had gone anywhere. */}
            <AppText variant="section" className="uppercase tracking-wider font-bold text-neutral-700 font-sans">
              Review settings
            </AppText>
            <AppText variant="display" className="font-serif font-bold text-[#1A1A1A]">
              {customPlanName.trim() || 'New settings'}
            </AppText>
          </View>
        </View>
        <AppText variant="body" className="text-neutral-700 font-sans -mt-1">
          How long a verse keeps coming back before it's yours for good, and what happens when you miss one. How many
          days a week you memorize is a separate thing — that's on My Verses, under My Schedule.
        </AppText>

        {/* The Basic/Advanced toggle was removed along with the pacing
            sections. It existed to hide the tuning knobs from a newer user
            while leaving presets and pacing visible -- but retention IS the
            screen now, so Advanced would have hidden the entire point of it. */}

        {/* Copy-on-write notice. The shipped plan is the baseline every
            account starts from, so the only way to "edit" it is to make it
            yours first. */}
        {isEditingBuiltInPlan && (
          <View className="rounded-xl border-2 border-amber-300 bg-amber-50" style={{ padding: space(12), gap: space(4) }}>
            <AppText variant="label" className="font-sans font-bold text-amber-900">
              Standard is the built-in one
            </AppText>
            <AppText variant="micro" className="font-sans text-amber-800 leading-relaxed">
              Give it a new name below to make your own copy. Standard itself stays exactly as it is, so you can always
              come back to it.
            </AppText>
          </View>
        )}

        {/* The name. Unnamed settings are indistinguishable from any other set
            in the saved list, and naming is what forks the built-in. */}
        <View style={{ gap: space(6) }}>
          <AppText variant="section" className="uppercase tracking-wider font-bold text-neutral-700 font-sans">
            Name
          </AppText>
          {/* The name is the one thing on this screen you write rather than
              pick, and it was set in 12pt -- smaller than the labels around
              it. Sized off the scale directly (not a className) so it grows
              with the OS font setting like every AppText does. */}
          <AppTextInput
            placeholder="e.g. My Settings"
            placeholderTextColor="#a3a3a3"
            value={customPlanName}
            onChangeText={setCustomPlanName}
            allowFontScaling={false}
            className="w-full border-2 border-[#1A1A1A] rounded-xl font-sans font-bold bg-white text-[#1A1A1A]"
            style={{
              fontSize: 16 * scale,
              minHeight: MIN_TOUCH,
              paddingHorizontal: space(12),
              paddingVertical: space(10),
            }} />
        </View>

        {/* Retention tier -- the primary choice on this screen. */}
        <View style={{ gap: space(8) }}>
          <AppText variant="section" className="uppercase tracking-wider font-bold text-neutral-700 font-sans">
            How long verses keep coming back
          </AppText>
          <OptionCards options={rigorOptions(rigorSummary)} value={retentionRigor} onChange={chooseRetention} />
        </View>

        {/* Fine-tuning: the exact phase lengths and mastery gates behind the
            three tiers above. Collapsed by default -- picking a tier is
            enough for most people, and touching anything here moves the plan
            to 'custom'. */}
        <CollapsibleCard
          storageKey="planDesigner.retentionRigor"
          title="Change the details"
          summary={`${dailyPhaseWeeks} wks · ${weeklyPhaseMonths} mo · ${monthlyPhaseYears} yr`}
          defaultCollapsed
        >
          <AppText variant="caption" className="text-neutral-700 font-sans">
            After you learn a verse, it comes back every day for a while, then once a week, then once a month — and
            then it stops, because you know it. These set how long each of those stretches lasts. Bigger numbers mean
            more practice and a verse that's harder to forget. Changing anything here makes these settings Custom.
          </AppText>

          <View style={{ gap: space(16) }}>
            {/* Daily Phase Length */}
            <View style={{ gap: space(6) }}>
              <SettingRow label="Comes back daily for" value={`${dailyPhaseWeeks} weeks`} />
              <StepperRow min={3} max={14} value={dailyPhaseWeeks} onChange={tune(setDailyPhaseWeeks)} />
              <RangeCaption min="3 weeks" max="14 weeks" />
            </View>

            {/* Weekly Phase Length */}
            <View style={{ gap: space(6) }}>
              <SettingRow label="Then weekly for" value={`${weeklyPhaseMonths} months`} />
              <StepperRow min={2} max={12} value={weeklyPhaseMonths} onChange={tune(setWeeklyPhaseMonths)} />
              <RangeCaption min="2 months" max="12 months" />
            </View>

            {/* Monthly Phase Length */}
            <View style={{ gap: space(6) }}>
              <SettingRow label="Then monthly for" value={`${monthlyPhaseYears} years`} />
              <StepperRow min={1} max={10} value={monthlyPhaseYears} onChange={tune(setMonthlyPhaseYears)} />
              <RangeCaption min="1 year" max="10 years" />
            </View>

            {/* Mastery gates. These moved here from the deleted "Pacing &
                Limits" section -- they were never pacing: they decide when
                a verse graduates, which is retention. */}
            <View style={{ gap: space(6) }} className="pt-2 border-t border-[#F3F2F1]">
              <SettingRow label="Perfect recalls before a verse counts as learned" value={masteryTouches} />
              <StepperRow min={1} max={6} value={masteryTouches} onChange={tune(setMasteryTouches)} />
            </View>

            <View style={{ gap: space(6) }}>
              <SettingRow label="Times to review it each time it comes back" value={reviewsRequired} />
              <StepperRow min={1} max={5} value={reviewsRequired} onChange={tune(setReviewsRequired)} />
            </View>
          </View>

          <AppText variant="caption" className="text-neutral-700 font-sans pt-2 border-t border-[#F3F2F1]">
            With these numbers, a verse stops coming back after about{' '}
            <AppText variant="caption" className="font-sans font-bold text-[#1A1A1A]">{totalRigorLabel}</AppText>.
          </AppText>
        </CollapsibleCard>

        {/* Missed Review Handling. Extracted into its own component so the
            dev layout lab can render it at every supported font scale
            without a signed-in user. No longer Advanced-gated: what happens
            when you miss a review is half of what a plan even is. */}
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
          onToast={triggerToast}
        />

      </ScrollView>

      {/* Sticky footer -- the forecast summary and Save, pinned outside the
          ScrollView. Two reasons: the primary action is always reachable
          without scrolling to the bottom (which at 1.5x was a long way down),
          and the scroll content sheds ~150pt of chrome, which is what kept the
          collapsed plan from fitting a screen.

          Condensed to a single wrapping summary line rather than the old
          two label/value rows -- a footer has to stay small at every font
          scale, or it eats the screen it's pinned to. */}
      <View
        className="border-t-2 border-[#1A1A1A] bg-[#FBF9F6]"
        style={{
          paddingHorizontal: space(20),
          paddingTop: space(10),
          paddingBottom: space(14),
          gap: space(8),
        }}
      >
        <View className="flex-row items-center" style={{ gap: space(6) }}>
          <View className="shrink-0">
            <TrendingUp size={iconSize} color="#1A1A1A" />
          </View>
          <AppText variant="micro" className="font-sans text-neutral-600 flex-1">
            Verses stop coming back after about {totalRigorLabel}
          </AppText>
        </View>

        <Pressable
          onPress={() => {
            if (!canSave) {
              triggerToast('Give these settings a new name first — Standard is the built-in one.');
              return;
            }
            handleSavePlan();
          }}
          accessibilityState={{ disabled: !canSave }}
          className={`w-full rounded-xl flex-row items-center justify-center shadow-sm ${
            canSave ? 'bg-[#1A1A1A]' : 'bg-neutral-300'
          }`}
          style={{ minHeight: MIN_TOUCH, paddingVertical: space(10), gap: space(6) }}
        >
          <Check size={iconSize} color="#FFFFFF" />
          <AppText variant="label" className="text-white font-sans font-bold uppercase tracking-widest">
            {isEditingBuiltInPlan ? 'Save as my own' : 'Save'}
          </AppText>
        </Pressable>
      </View>
    </FadeInView>
  );
}

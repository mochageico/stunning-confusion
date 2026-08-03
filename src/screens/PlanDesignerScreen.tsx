import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, TrendingUp } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { ChipRow, FadeInView, HelpTooltip, StepperRow } from '../components/ui';
import { MissPolicySection } from '../components/MissPolicySection';
import {
  AppText,
  CollapsibleCard,
  MIN_TOUCH,
  OptionCards,
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

// The three retention tiers, and the only preset system left on this screen.
// Touches: Light and Standard both graduate at 3, Deep at 4.
const RIGOR_OPTIONS: OptionCardItem<RigorKey>[] = [
  { id: 'light', title: 'Light', desc: '5-4-3 phases, 3 touches to graduate. Quicker to finish, less durable.' },
  { id: 'standard', title: 'Standard', desc: '7-6-5 phases, 3 touches to graduate. The default balance.' },
  { id: 'deep', title: 'Deep', desc: '9-8-7 phases, 4 touches to graduate. Slowest, and the stickiest.' },
];

const RIGOR_TIERS: { key: RigorKey; label: string; weeks: number; months: number; years: number; touches: number }[] = [
  { key: 'light', label: 'Light', weeks: 5, months: 4, years: 3, touches: 3 },
  { key: 'standard', label: 'Standard', weeks: 7, months: 6, years: 5, touches: 3 },
  { key: 'deep', label: 'Deep', weeks: 9, months: 8, years: 7, touches: 4 },
];

export default function PlanDesignerScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    navigateTo,
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

  const totalRigorDays = dailyPhaseWeeks * 7 + weeklyPhaseMonths * 30 + monthlyPhaseYears * 365;
  const totalRigorLabel =
    totalRigorDays >= 365 ? `${(totalRigorDays / 365).toFixed(1)} years` : `${Math.round(totalRigorDays)} days`;

  // Copy-on-write: the shipped Standard plan is the baseline every account
  // starts from, so it can't be edited in place. Renaming is what turns an
  // edit into your own plan, and the Save button stays disabled until you do.
  const nameChangedFromBuiltIn = customPlanName.trim().length > 0 && customPlanName.trim() !== 'Standard';
  const canSave = !isEditingBuiltInPlan || nameChangedFromBuiltIn;

  const space = useScaledSpace();
  const iconSize = Math.round(14 * useFontScale());

  return (
    <FadeInView style={{ flex: 1 }}>
      {/* pb-4 rather than pb-12: the Save action now lives in the pinned footer
          below, so the scroll content no longer needs to clear it. */}
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-4" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          {state.onboardingStepInProgress === null && (
            <Pressable
              onPress={handleBack}
              className="w-8 h-8 rounded-full border border-[#E5E5E5] items-center justify-center bg-white"
            >
              <ArrowLeft size={15} color="#1A1A1A" />
            </Pressable>
          )}
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Settings</Text>
            <Text className="text-xl font-serif font-bold text-[#1A1A1A]">Memory Plan</Text>
          </View>
        </View>
        <Text className="text-xs text-neutral-500 font-sans -mt-1 leading-relaxed">
          How a verse graduates, and what happens when you miss one. Your schedule and speed live on the Memory Queue
          screen, under Your Rhythm.
        </Text>

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
              Standard is the built-in plan
            </AppText>
            <AppText variant="micro" className="font-sans text-amber-800 leading-relaxed">
              Give it a new name below to make your own copy. Standard itself stays as it is, so you can always come
              back to it.
            </AppText>
          </View>
        )}

        {/* Plan Name. An unnamed plan is indistinguishable from any other in
            Saved Plans/Community, and renaming is what forks the built-in. */}
        <View style={{ gap: 6 }}>
          <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Plan Name</Text>
          <TextInput
            placeholder="My Custom Scripture Plan"
            value={customPlanName}
            onChangeText={setCustomPlanName}
            className="w-full px-3 py-2.5 text-xs border-2 border-[#1A1A1A] rounded-xl font-sans bg-white text-[#1A1A1A]"
          />
        </View>

        {/* Retention tier -- the primary choice on this screen. */}
        <View style={{ gap: 8 }}>
          <AppText variant="micro" className="uppercase tracking-wider font-bold text-[#888] font-sans">
            Retention
          </AppText>
          <OptionCards
            options={RIGOR_OPTIONS}
            value={(retentionRigor === 'custom' ? 'standard' : retentionRigor) as RigorKey}
            onChange={applyRigorPreset}
          />
        </View>

        {/* Fine-tuning: the exact phase lengths and mastery gates behind the
            three tiers above. Collapsed by default -- picking a tier is
            enough for most people, and touching anything here moves the plan
            to 'custom'. */}
        <CollapsibleCard
          storageKey="planDesigner.retentionRigor"
          title="Fine-tune retention"
          summary={`${dailyPhaseWeeks}-${weeklyPhaseMonths}-${monthlyPhaseYears} · ${masteryTouches} touches`}
          defaultCollapsed
        >
          <Text className="text-[10px] text-neutral-500 font-sans leading-relaxed">
            How long a verse stays in Daily, then Weekly, then Monthly review before it's retained for good. Higher
            numbers mean deeper, more permanent memorization.
          </Text>

          <View style={{ gap: 16 }}>
            <View style={{ gap: 16 }}>
              {/* Daily Phase Length */}
              <View style={{ gap: 6 }}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Daily Phase Length</Text>
                  <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                    {dailyPhaseWeeks} weeks
                  </Text>
                </View>
                <StepperRow min={3} max={14} value={dailyPhaseWeeks} onChange={setDailyPhaseWeeks} />
                <View className="flex-row justify-between">
                  <Text className="text-[8px] text-neutral-400 font-mono">3 weeks</Text>
                  <Text className="text-[8px] text-neutral-400 font-mono">14 weeks</Text>
                </View>
              </View>

              {/* Weekly Phase Length */}
              <View style={{ gap: 6 }}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Weekly Phase Length</Text>
                  <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                    {weeklyPhaseMonths} months
                  </Text>
                </View>
                <StepperRow min={2} max={12} value={weeklyPhaseMonths} onChange={setWeeklyPhaseMonths} />
                <View className="flex-row justify-between">
                  <Text className="text-[8px] text-neutral-400 font-mono">2 months</Text>
                  <Text className="text-[8px] text-neutral-400 font-mono">12 months</Text>
                </View>
              </View>

              {/* Monthly Phase Length */}
              <View style={{ gap: 6 }}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Monthly Phase Length</Text>
                  <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                    {monthlyPhaseYears} years
                  </Text>
                </View>
                <StepperRow min={1} max={10} value={monthlyPhaseYears} onChange={setMonthlyPhaseYears} />
                <View className="flex-row justify-between">
                  <Text className="text-[8px] text-neutral-400 font-mono">1 year</Text>
                  <Text className="text-[8px] text-neutral-400 font-mono">10 years</Text>
                </View>
              </View>

              {/* Mastery gates. These moved here from the deleted "Pacing &
                  Limits" section -- they were never pacing: they decide when
                  a verse graduates, which is retention. */}
              <View style={{ gap: 6 }} className="pt-2 border-t border-[#F3F2F1]">
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Touches to Graduate</Text>
                  <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                    {masteryTouches}
                  </Text>
                </View>
                <StepperRow
                  min={1}
                  max={6}
                  value={masteryTouches}
                  onChange={(v) => {
                    setMasteryTouches(v);
                    setRetentionRigor('custom');
                  }}
                />
              </View>

              <View style={{ gap: 6 }}>
                <View className="flex-row justify-between items-center">
                  <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Reviews Required per Cycle</Text>
                  <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                    {reviewsRequired}
                  </Text>
                </View>
                <StepperRow
                  min={1}
                  max={5}
                  value={reviewsRequired}
                  onChange={(v) => {
                    setReviewsRequired(v);
                    setRetentionRigor('custom');
                  }}
                />
              </View>
            </View>
          </View>

          <Text className="text-[10px] text-neutral-500 font-sans pt-2 border-t border-[#F3F2F1] leading-relaxed">
            At this rigor, a verse is fully retained for good after about <Text className="font-bold text-[#1A1A1A]">{totalRigorLabel}</Text>.
          </Text>
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
            {dailyPhaseWeeks}-{weeklyPhaseMonths}-{monthlyPhaseYears} · {masteryTouches} touches · retained after about{' '}
            {totalRigorLabel}
          </AppText>
        </View>

        <Pressable
          onPress={() => {
            if (!canSave) {
              triggerToast('Give your plan a new name first — Standard is the built-in one.');
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
            {isEditingBuiltInPlan ? 'Save as My Plan' : 'Save Plan'}
          </AppText>
        </Pressable>
      </View>
    </FadeInView>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, Share2, TrendingUp } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip, PulseView, StepperRow } from '../components/ui';

const DAYS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

const RIGOR_TIERS: { key: 'light' | 'standard' | 'deep'; label: string; weeks: number; months: number; years: number }[] = [
  { key: 'light', label: 'Light', weeks: 5, months: 4, years: 3 },
  { key: 'standard', label: 'Standard', weeks: 7, months: 6, years: 5 },
  { key: 'deep', label: 'Deep', weeks: 9, months: 8, years: 7 },
];

const COGNITIVE_LOAD_TIERS: { key: 'low' | 'medium' | 'high'; label: string }[] = [
  { key: 'low', label: 'Relaxed' },
  { key: 'medium', label: 'Balanced' },
  { key: 'high', label: 'Intense' },
];

export default function PlanDesignerScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    triggerToast,
    preset,
    setPreset,
    learningDays,
    setLearningDays,
    newVersesPace,
    setNewVersesPace,
    maxReviewCap,
    setMaxReviewCap,
    masteryTouches,
    setMasteryTouches,
    reviewsRequired,
    setReviewsRequired,
    sabbathEnabled,
    setSabbathEnabled,
    sabbathDay,
    setSabbathDay,
    cognitiveLoadSensitivity,
    setCognitiveLoadSensitivity,
    retentionRigor,
    setRetentionRigor,
    dailyPhaseWeeks,
    setDailyPhaseWeeks,
    weeklyPhaseMonths,
    setWeeklyPhaseMonths,
    monthlyPhaseYears,
    setMonthlyPhaseYears,
    customPlanName,
    setCustomPlanName,
    shareWithCommunity,
    setShareWithCommunity,
    handleSavePlan,
    publishSharedPlan,
  } = state;

  const applyRigorPreset = (tier: 'light' | 'standard' | 'deep') => {
    const cfg = RIGOR_TIERS.find((t) => t.key === tier)!;
    setRetentionRigor(tier);
    setDailyPhaseWeeks(cfg.weeks);
    setWeeklyPhaseMonths(cfg.months);
    setMonthlyPhaseYears(cfg.years);
    triggerToast(`Retention rigor set to ${cfg.label} (${cfg.weeks}-${cfg.months}-${cfg.years})! 🎯`);
  };

  const totalRigorDays = dailyPhaseWeeks * 7 + weeklyPhaseMonths * 30 + monthlyPhaseYears * 365;
  const totalRigorLabel =
    totalRigorDays >= 365 ? `${(totalRigorDays / 365).toFixed(1)} years` : `${Math.round(totalRigorDays)} days`;

  const toggleDay = (day: string, list: string[], setList: (v: string[]) => void) => {
    if (list.includes(day)) {
      setList(list.filter((d) => d !== day));
    } else {
      setList([...list, day]);
    }
    setPreset('custom');
  };

  // Defaults to Basic -- a newer/less technical user opening this screen
  // sees just the essentials (presets, weekly rhythm, sabbath, new-verse
  // pace) instead of the full set of tuning knobs. Purely a display
  // toggle, session-local: every underlying setting still has its real
  // saved value regardless of which mode is showing.
  const [isAdvanced, setIsAdvanced] = useState(false);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
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
            <Text className="text-xl font-serif font-bold text-[#1A1A1A]">Memory Plan Designer</Text>
          </View>
        </View>
        <Text className="text-xs text-neutral-500 font-sans -mt-1 leading-relaxed">
          Customize your pacing and daily routine.
        </Text>

        {/* Basic / Advanced toggle */}
        <View className="flex-row gap-2 -mt-1">
          <Pressable
            onPress={() => setIsAdvanced(false)}
            className={`flex-1 py-2 rounded-xl border-2 items-center ${
              !isAdvanced ? 'border-[#1A1A1A] bg-[#1A1A1A]' : 'border-[#E5E5E5] bg-white'
            }`}
          >
            <Text className={`text-[10px] font-sans font-bold uppercase tracking-wider ${!isAdvanced ? 'text-white' : 'text-neutral-500'}`}>
              Basic
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setIsAdvanced(true)}
            className={`flex-1 py-2 rounded-xl border-2 items-center ${
              isAdvanced ? 'border-[#1A1A1A] bg-[#1A1A1A]' : 'border-[#E5E5E5] bg-white'
            }`}
          >
            <Text className={`text-[10px] font-sans font-bold uppercase tracking-wider ${isAdvanced ? 'text-white' : 'text-neutral-500'}`}>
              Advanced
            </Text>
          </Pressable>
        </View>

        {/* Plan Name -- not gated behind Advanced. An unnamed plan is
            indistinguishable from any other in Saved Plans/Community, so
            this is essential regardless of how much other tuning a user
            wants to see. */}
        <View style={{ gap: 6 }}>
          <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Plan Name</Text>
          <TextInput
            placeholder="My Custom Scripture Plan"
            value={customPlanName}
            onChangeText={setCustomPlanName}
            className="w-full px-3 py-2.5 text-xs border-2 border-[#1A1A1A] rounded-xl font-sans bg-white text-[#1A1A1A]"
          />
        </View>

        {/* Quick Presets Section */}
        <View style={{ gap: 8 }}>
          <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Quick Presets</Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => {
                setPreset('drip');
                setLearningDays(['M', 'T', 'W', 'Th', 'F']);
                setNewVersesPace(2);
                setMaxReviewCap(10);
                triggerToast("Loaded 'The Daily Drip' preset! \u{1F4A7}");
              }}
              className={`flex-1 border-2 rounded-xl p-2.5 justify-between shadow-sm ${
                preset === 'drip' ? 'border-[#1A1A1A] bg-[#1A1A1A]' : 'border-[#E5E5E5] bg-white'
              }`}
              style={{ height: 100 }}
            >
              <View>
                <Text
                  className={`text-[8px] font-sans font-bold uppercase tracking-wider ${
                    preset === 'drip' ? 'text-neutral-300' : 'text-neutral-400'
                  }`}
                >
                  Pacing
                </Text>
                <Text
                  className={`text-[11px] font-serif font-black leading-tight mt-0.5 ${
                    preset === 'drip' ? 'text-white' : 'text-[#1A1A1A]'
                  }`}
                >
                  The Daily Drip
                </Text>
              </View>
              <Text className={`text-[8px] font-sans leading-tight ${preset === 'drip' ? 'text-neutral-200' : 'text-neutral-500'}`}>
                2 v/day • M-F
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setPreset('warrior');
                setLearningDays(['S', 'Su']);
                setNewVersesPace(5);
                setMaxReviewCap(20);
                triggerToast("Loaded 'Weekend Warrior' preset! ⚔️");
              }}
              className={`flex-1 border-2 rounded-xl p-2.5 justify-between shadow-sm ${
                preset === 'warrior' ? 'border-[#1A1A1A] bg-[#1A1A1A]' : 'border-[#E5E5E5] bg-white'
              }`}
              style={{ height: 100 }}
            >
              <View>
                <Text
                  className={`text-[8px] font-sans font-bold uppercase tracking-wider ${
                    preset === 'warrior' ? 'text-neutral-300' : 'text-neutral-400'
                  }`}
                >
                  Intense
                </Text>
                <Text
                  className={`text-[11px] font-serif font-black leading-tight mt-0.5 ${
                    preset === 'warrior' ? 'text-white' : 'text-[#1A1A1A]'
                  }`}
                >
                  Weekend Warrior
                </Text>
              </View>
              <Text className={`text-[8px] font-sans leading-tight ${preset === 'warrior' ? 'text-neutral-200' : 'text-neutral-500'}`}>
                5 v/day • S-Su
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setPreset('custom');
                triggerToast('Switched to Custom configuration.');
              }}
              className={`flex-1 rounded-xl p-2.5 justify-between ${
                // No conditional shadow-* classes anywhere in this file: toggling
                // iOS shadow props on 2+ views in one Fabric commit deadlocks the
                // JS thread on real devices (bisected on-device, 2026-07-16).
                preset === 'custom' ? 'border-2 border-[#1A1A1A] bg-[#FBF9F6]' : 'border-2 border-[#E5E5E5] bg-white'
              }`}
              style={{ height: 100 }}
            >
              <View>
                <View className="flex-row justify-between items-center">
                  <Text className="text-[8px] font-sans font-bold uppercase tracking-wider text-neutral-400">Flex</Text>
                  {preset === 'custom' && <View className="w-1.5 h-1.5 bg-amber-500 rounded-full" />}
                </View>
                <Text className="text-[11px] font-serif font-black leading-tight mt-0.5 text-[#1A1A1A]">Custom</Text>
              </View>
              <Text className="text-[8px] font-sans text-neutral-500 leading-tight">Your custom rhythm</Text>
            </Pressable>
          </View>
        </View>

        {/* Weekly Rhythm section */}
        <View className="border-2 border-[#1A1A1A] rounded-xl p-3.5 bg-white shadow-sm" style={{ gap: 16 }}>
          <View className="flex-row items-center justify-between border-b border-neutral-100 pb-2">
            <Text className="text-xs font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A]">Weekly Rhythm</Text>
            <Text className="text-[8px] bg-neutral-100 text-[#1A1A1A] border border-neutral-300 px-1.5 py-0.5 rounded font-mono font-bold uppercase">
              {preset === 'drip' ? 'The Daily Drip' : preset === 'warrior' ? 'Weekend Warrior' : 'Custom'}
            </Text>
          </View>

          <View style={{ gap: 16 }}>
            {/* Learning Days */}
            <View style={{ gap: 6 }}>
              <View className="flex-row justify-between items-center">
                <Text className="text-xs font-serif font-bold text-[#1A1A1A]">Learning Days</Text>
                <Text className="text-[9px] font-mono font-bold text-neutral-400 bg-neutral-50 border border-neutral-200 px-1 rounded">
                  {learningDays.length}/7 active
                </Text>
              </View>
              <View className="flex-row justify-between">
                {DAYS.map((day) => {
                  const isActive = learningDays.includes(day);
                  const isSabbath = sabbathEnabled && day === sabbathDay;
                  return (
                    <Pressable
                      key={`learn-${day}`}
                      onPress={() => {
                        if (!isActive && isSabbath) {
                          triggerToast(`${day} is your Sabbath day -- change that first to use it for learning. 🕊️`);
                          return;
                        }
                        toggleDay(day, learningDays, setLearningDays);
                      }}
                      className={`w-7 h-7 rounded-full border items-center justify-center ${
                        isActive ? 'bg-[#1A1A1A] border-[#1A1A1A]' : isSabbath ? 'bg-neutral-100 border-neutral-200' : 'bg-white border-neutral-200'
                      }`}
                    >
                      <Text className={`font-sans font-bold text-[10px] ${isActive ? 'text-white' : isSabbath ? 'text-neutral-300' : 'text-neutral-500'}`}>{day}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Sabbath Day (optional, off by default) */}
            <View style={{ gap: 6 }} className="pt-2 border-t border-[#F3F2F1]">
              <View className="flex-row items-center justify-between">
                <View style={{ gap: 2 }} className="flex-1 pr-2">
                  <Text className="text-xs font-serif font-bold text-[#1A1A1A]">Sabbath Day</Text>
                  <Text className="text-[9px] text-neutral-400 font-sans leading-tight">
                    A day fully free from learning and reviewing. The engine treats it as if it doesn't exist.
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    const turningOn = !sabbathEnabled;
                    setSabbathEnabled(turningOn);
                    // A day can't be both a learning day and the Sabbath at
                    // once -- turning Sabbath on immediately frees up its day.
                    if (turningOn && learningDays.includes(sabbathDay)) {
                      setLearningDays(learningDays.filter((d) => d !== sabbathDay));
                    }
                  }}
                  className={`w-10 h-6 rounded-full justify-center px-0.5 ${sabbathEnabled ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
                >
                  <View
                    className="w-5 h-5 rounded-full bg-white shadow"
                    style={{ transform: [{ translateX: sabbathEnabled ? 16 : 0 }] }}
                  />
                </Pressable>
              </View>

              {sabbathEnabled && (
                <View className="flex-row justify-between pt-2">
                  {DAYS.map((day) => {
                    const isActive = sabbathDay === day;
                    return (
                      <Pressable
                        key={`sabbath-${day}`}
                        onPress={() => {
                          setSabbathDay(day);
                          if (learningDays.includes(day)) {
                            setLearningDays(learningDays.filter((d) => d !== day));
                          }
                        }}
                        className={`w-7 h-7 rounded-full border items-center justify-center ${
                          isActive ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-white border-neutral-200'
                        }`}
                      >
                        <Text className={`font-sans font-bold text-[10px] ${isActive ? 'text-white' : 'text-neutral-500'}`}>
                          {day}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

          </View>
        </View>

        {/* Pacing & Limits */}
        <View className="border-2 border-[#1A1A1A] rounded-xl p-3.5 bg-white shadow-sm" style={{ gap: 16 }}>
          {/* New Verses Slider */}
          <View style={{ gap: 6 }}>
            <View className="flex-row justify-between items-center">
              <Text className="text-xs font-sans font-bold text-[#1A1A1A]">New Verses per Learning Day</Text>
              <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                {newVersesPace}
              </Text>
            </View>
            <StepperRow
              min={1}
              max={10}
              value={newVersesPace}
              onChange={(v) => {
                setNewVersesPace(v);
                setPreset('custom');
              }}
            />
            <View className="flex-row justify-between">
              <Text className="text-[8px] text-neutral-400 font-mono">1 verse (Gentle)</Text>
              <Text className="text-[8px] text-neutral-400 font-mono">10 verses (Extreme)</Text>
            </View>
          </View>

          {isAdvanced && (
          <>
          {/* Review Cap Slider */}
          <View style={{ gap: 6 }}>
            <View className="flex-row justify-between items-center">
              <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Daily Review Time Limit</Text>
              <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                {maxReviewCap} mins
              </Text>
            </View>
            <StepperRow
              min={5}
              max={30}
              step={5}
              value={maxReviewCap}
              onChange={(v) => {
                setMaxReviewCap(v);
                setPreset('custom');
              }}
            />
            <View className="flex-row justify-between">
              <Text className="text-[8px] text-neutral-400 font-mono">5 mins (Sprint)</Text>
              <Text className="text-[8px] text-neutral-400 font-mono">30 mins (Marathon)</Text>
            </View>
            <Text className="text-[10px] text-neutral-500 font-sans leading-normal pt-2 border-t border-[#F3F2F1]">
              If your queue exceeds this, easier verses will defer to tomorrow.
            </Text>
          </View>

          {/* 3-Touch Mastery Gate setting */}
          <View style={{ gap: 6 }} className="pt-4 border-t border-[#F3F2F1]">
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center">
                <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Touches to Graduate a Verse</Text>
                <HelpTooltip text="How many times you have to successfully recall a verse -- at least an hour apart each time -- before it can graduate out of Learning and into spaced review. Spacing the touches out like this stops cramming from counting as real mastery. Once a verse hits this count, it's 'banked' and will graduate automatically as soon as your other due reviews for the day are cleared." />
              </View>
              <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                {masteryTouches} touches
              </Text>
            </View>
            <StepperRow min={3} max={10} value={masteryTouches} onChange={setMasteryTouches} />
            <View className="flex-row justify-between">
              <Text className="text-[8px] text-neutral-400 font-mono">3 touches</Text>
              <Text className="text-[8px] text-neutral-400 font-mono">10 touches</Text>
            </View>
          </View>

          {/* Standard Reviews Required setting */}
          <View style={{ gap: 6 }} className="pt-4 border-t border-[#F3F2F1]">
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center">
                <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Reviews Needed Per Day to Advance</Text>
                <HelpTooltip text="Once a verse is in spaced review (Daily/Weekly/Monthly), this is how many times you must successfully review it on the SAME day before that day counts toward its streak. Raising this means more repetition per sitting -- it doesn't add extra days between reviews." />
              </View>
              <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                {reviewsRequired} reps
              </Text>
            </View>
            <StepperRow min={1} max={3} value={reviewsRequired} onChange={setReviewsRequired} />
            <View className="flex-row justify-between">
              <Text className="text-[8px] text-neutral-400 font-mono">1 review</Text>
              <Text className="text-[8px] text-neutral-400 font-mono">3 reviews</Text>
            </View>
          </View>

          {/* Time Estimate Buffer (cognitiveLoadSensitivity) */}
          <View style={{ gap: 6 }} className="pt-4 border-t border-[#F3F2F1]">
            <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Time Estimate Buffer</Text>
            <Text className="text-[9px] text-neutral-400 font-sans leading-relaxed">
              How much extra time to build into your daily estimate, in case reviews take you longer than average.
            </Text>
            <View className="flex-row gap-2 pt-1">
              {COGNITIVE_LOAD_TIERS.map((tier) => {
                const isActive = cognitiveLoadSensitivity === tier.key;
                return (
                  <Pressable
                    key={tier.key}
                    onPress={() => setCognitiveLoadSensitivity(tier.key)}
                    className={`flex-1 border-2 rounded-xl p-2 items-center ${
                      isActive ? 'border-[#1A1A1A] bg-[#1A1A1A]' : 'border-[#E5E5E5] bg-white'
                    }`}
                  >
                    <Text className={`text-[11px] font-serif font-black ${isActive ? 'text-white' : 'text-[#1A1A1A]'}`}>
                      {tier.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          </>
          )}
        </View>

        {/* Retention Rigor -- advanced only */}
        {isAdvanced && (
        <View className="border-2 border-[#1A1A1A] rounded-xl p-3.5 bg-white shadow-sm" style={{ gap: 16 }}>
          <View className="flex-row items-center justify-between border-b border-neutral-100 pb-2">
            <Text className="text-xs font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A]">Retention Rigor</Text>
            <Text className="text-[8px] bg-neutral-100 text-[#1A1A1A] border border-neutral-300 px-1.5 py-0.5 rounded font-mono font-bold uppercase">
              {dailyPhaseWeeks}-{weeklyPhaseMonths}-{monthlyPhaseYears}
            </Text>
          </View>

          <Text className="text-[10px] text-neutral-500 font-sans -mt-2 leading-relaxed">
            How long a verse stays in Daily, then Weekly, then Monthly review before it's retained for good. Higher
            numbers mean deeper, more permanent memorization.
          </Text>

          <View className="flex-row gap-2">
            {RIGOR_TIERS.map((tier) => {
              const isActive = retentionRigor === tier.key;
              return (
                <Pressable
                  key={tier.key}
                  onPress={() => applyRigorPreset(tier.key)}
                  className={`flex-1 border-2 rounded-xl p-2.5 justify-between shadow-sm ${
                    isActive ? 'border-[#1A1A1A] bg-[#1A1A1A]' : 'border-[#E5E5E5] bg-white'
                  }`}
                  style={{ height: 76 }}
                >
                  <Text className={`text-[11px] font-serif font-black leading-tight ${isActive ? 'text-white' : 'text-[#1A1A1A]'}`}>
                    {tier.label}
                  </Text>
                  <Text className={`text-[8px] font-mono leading-tight ${isActive ? 'text-neutral-200' : 'text-neutral-500'}`}>
                    {tier.weeks}-{tier.months}-{tier.years}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setRetentionRigor('custom')}
              className={`flex-1 rounded-xl p-2.5 justify-between ${
                retentionRigor === 'custom' ? 'border-2 border-[#1A1A1A] bg-[#FBF9F6]' : 'border-2 border-[#E5E5E5] bg-white'
              }`}
              style={{ height: 76 }}
            >
              <View className="flex-row justify-between items-center">
                <Text className="text-[11px] font-serif font-black leading-tight text-[#1A1A1A]">Custom</Text>
                {retentionRigor === 'custom' && <View className="w-1.5 h-1.5 bg-amber-500 rounded-full" />}
              </View>
              <Text className="text-[8px] font-mono leading-tight text-neutral-500">Fine-tune</Text>
            </Pressable>
          </View>

          {retentionRigor === 'custom' && (
            <View style={{ gap: 16 }} className="pt-2 border-t border-[#F3F2F1]">
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
            </View>
          )}

          <Text className="text-[10px] text-neutral-500 font-sans pt-2 border-t border-[#F3F2F1] leading-relaxed">
            At this rigor, a verse is fully retained for good after about <Text className="font-bold text-[#1A1A1A]">{totalRigorLabel}</Text>.
          </Text>
        </View>
        )}

        {/* Community sharing options -- advanced only */}
        {isAdvanced && (
        <View className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm mt-1" style={{ gap: 12 }}>
          <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Sharing Options</Text>
          <View className="flex-row items-center justify-between">
            <View style={{ gap: 2 }} className="flex-1 pr-2">
              <View className="flex-row items-center gap-1.5">
                <Share2 size={12} color="#737373" />
                <Text className="text-[10px] font-sans font-bold text-neutral-800">Publish to Community Circles</Text>
              </View>
              <Text className="text-[9px] text-neutral-400 font-sans leading-tight">
                Make this pacing pattern joinable for others.
              </Text>
            </View>
            <Pressable
              onPress={() => setShareWithCommunity(!shareWithCommunity)}
              className={`w-10 h-6 rounded-full justify-center px-0.5 ${shareWithCommunity ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
            >
              <View
                className="w-5 h-5 rounded-full bg-white shadow"
                style={{ transform: [{ translateX: shareWithCommunity ? 16 : 0 }] }}
              />
            </Pressable>
          </View>
        </View>
        )}

        {/* Workload Forecast Sticky Bottom Card */}
        <View className="bg-[#FBF9F6] border-2 border-[#1A1A1A] rounded-xl p-3.5 shadow-md" style={{ gap: 12 }}>
          <View className="flex-row items-center justify-between pb-1.5 border-b border-neutral-200">
            <View className="flex-row items-center gap-1.5">
              <TrendingUp size={14} color="#1A1A1A" />
              <Text className="text-[11px] font-sans font-bold uppercase tracking-wider text-[#1A1A1A]">Weekly Forecast</Text>
            </View>
            <Text className="text-[8px] font-mono text-neutral-400 font-bold uppercase">Projections</Text>
          </View>

          <View style={{ gap: 8 }}>
            <View className="flex-row justify-between py-1 border-b border-dashed border-neutral-200">
              <Text className="text-neutral-500 font-sans text-xs">Total New Verses This Week:</Text>
              <Text className="font-mono font-bold text-[#1A1A1A] text-xs">{newVersesPace * learningDays.length}</Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="text-neutral-500 font-sans text-xs">Estimated Max Daily Time:</Text>
              <Text className="font-mono font-bold text-[#1A1A1A] text-xs">{maxReviewCap} mins</Text>
            </View>
          </View>

          <PulseView>
            <Pressable
              onPress={async () => {
                if (shareWithCommunity) {
                  await publishSharedPlan();
                } else {
                  await handleSavePlan();
                }
              }}
              className="w-full py-3 bg-[#1A1A1A] rounded-xl flex-row items-center justify-center gap-1.5 shadow-sm mt-1"
            >
              <Check size={14} color="#FFFFFF" />
              <Text className="text-white font-sans font-bold text-xs uppercase tracking-widest">
                {shareWithCommunity ? 'Save & Share with Community' : 'Save Plan'}
              </Text>
            </Pressable>
          </PulseView>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

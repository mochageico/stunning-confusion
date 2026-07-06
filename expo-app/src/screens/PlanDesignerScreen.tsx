import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { ArrowLeft, Check, Share2, TrendingUp } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, PulseView } from '../components/ui';

const DAYS = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'];

const RIGOR_TIERS: { key: 'light' | 'standard' | 'deep'; label: string; weeks: number; months: number; years: number }[] = [
  { key: 'light', label: 'Light', weeks: 5, months: 4, years: 3 },
  { key: 'standard', label: 'Standard', weeks: 7, months: 6, years: 5 },
  { key: 'deep', label: 'Deep', weeks: 9, months: 8, years: 7 },
];

export default function PlanDesignerScreen({ state }: { state: AppState }) {
  const {
    handleBack,
    triggerToast,
    preset,
    setPreset,
    learningDays,
    setLearningDays,
    reviewingDays,
    setReviewingDays,
    primingDays,
    setPrimingDays,
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

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-[#E5E5E5] items-center justify-center bg-white"
          >
            <ArrowLeft size={15} color="#1A1A1A" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Settings</Text>
            <Text className="text-xl font-serif font-bold text-[#1A1A1A]">Memory Plan Designer</Text>
          </View>
        </View>
        <Text className="text-xs text-neutral-500 font-sans -mt-1 leading-relaxed">
          Customize your pacing and daily routine.
        </Text>

        {/* Quick Presets Section */}
        <View style={{ gap: 8 }}>
          <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Quick Presets</Text>
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => {
                setPreset('drip');
                setLearningDays(['M', 'T', 'W', 'Th', 'F']);
                setReviewingDays(['M', 'T', 'W', 'Th', 'F', 'S', 'Su']);
                setPrimingDays(['M', 'T', 'W', 'Th', 'F']);
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
                setReviewingDays(['M', 'T', 'W', 'Th', 'F', 'S', 'Su']);
                setPrimingDays(['M', 'T', 'W', 'Th', 'F']);
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
                preset === 'custom' ? 'border-2 border-[#1A1A1A] bg-[#FBF9F6] shadow-md' : 'border-2 border-[#E5E5E5] bg-white'
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
                  return (
                    <Pressable
                      key={`learn-${day}`}
                      onPress={() => toggleDay(day, learningDays, setLearningDays)}
                      className={`w-7 h-7 rounded-full border items-center justify-center ${
                        isActive ? 'bg-[#1A1A1A] border-[#1A1A1A] shadow-sm' : 'bg-white border-neutral-200'
                      }`}
                    >
                      <Text className={`font-sans font-bold text-[10px] ${isActive ? 'text-white' : 'text-neutral-500'}`}>{day}</Text>
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
                  onPress={() => setSabbathEnabled(!sabbathEnabled)}
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
                        onPress={() => setSabbathDay(day)}
                        className={`w-7 h-7 rounded-full border items-center justify-center ${
                          isActive ? 'bg-[#1A1A1A] border-[#1A1A1A] shadow-sm' : 'bg-white border-neutral-200'
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

            {/* Reviewing Days */}
            <View style={{ gap: 6 }}>
              <View className="flex-row justify-between items-center">
                <Text className="text-xs font-serif font-bold text-[#1A1A1A]">Reviewing Days</Text>
                <Text className="text-[9px] font-mono font-bold text-neutral-400 bg-neutral-50 border border-neutral-200 px-1 rounded">
                  {reviewingDays.length}/7 active
                </Text>
              </View>
              <View className="flex-row justify-between">
                {DAYS.map((day) => {
                  const isActive = reviewingDays.includes(day);
                  return (
                    <Pressable
                      key={`review-${day}`}
                      onPress={() => toggleDay(day, reviewingDays, setReviewingDays)}
                      className={`w-7 h-7 rounded-full border items-center justify-center ${
                        isActive ? 'bg-[#1A1A1A] border-[#1A1A1A] shadow-sm' : 'bg-white border-neutral-200'
                      }`}
                    >
                      <Text className={`font-sans font-bold text-[10px] ${isActive ? 'text-white' : 'text-neutral-500'}`}>{day}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Priming Days */}
            <View style={{ gap: 6 }}>
              <View className="flex-row justify-between items-center">
                <Text className="text-xs font-serif font-bold text-[#1A1A1A]">Priming Days</Text>
                <Text className="text-[9px] font-mono font-bold text-neutral-400 bg-neutral-50 border border-neutral-200 px-1 rounded">
                  {primingDays.length}/7 active
                </Text>
              </View>
              <View className="flex-row justify-between">
                {DAYS.map((day) => {
                  const isActive = primingDays.includes(day);
                  return (
                    <Pressable
                      key={`prime-${day}`}
                      onPress={() => toggleDay(day, primingDays, setPrimingDays)}
                      className={`w-7 h-7 rounded-full border items-center justify-center ${
                        isActive ? 'bg-[#1A1A1A] border-[#1A1A1A] shadow-sm' : 'bg-white border-neutral-200'
                      }`}
                    >
                      <Text className={`font-sans font-bold text-[10px] ${isActive ? 'text-white' : 'text-neutral-500'}`}>{day}</Text>
                    </Pressable>
                  );
                })}
              </View>
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
            <Slider
              style={{ width: '100%', height: 32 }}
              minimumValue={1}
              maximumValue={10}
              step={1}
              value={newVersesPace}
              onValueChange={(v: number) => {
                setNewVersesPace(v);
                setPreset('custom');
              }}
              minimumTrackTintColor="#1A1A1A"
              maximumTrackTintColor="#d4d4d4"
            />
            <View className="flex-row justify-between">
              <Text className="text-[8px] text-neutral-400 font-mono">1 verse (Gentle)</Text>
              <Text className="text-[8px] text-neutral-400 font-mono">10 verses (Extreme)</Text>
            </View>
          </View>

          {/* Review Cap Slider */}
          <View style={{ gap: 6 }}>
            <View className="flex-row justify-between items-center">
              <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Daily Review Time Limit</Text>
              <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                {maxReviewCap} mins
              </Text>
            </View>
            <Slider
              style={{ width: '100%', height: 32 }}
              minimumValue={5}
              maximumValue={30}
              step={1}
              value={maxReviewCap}
              onValueChange={(v: number) => {
                setMaxReviewCap(v);
                setPreset('custom');
              }}
              minimumTrackTintColor="#1A1A1A"
              maximumTrackTintColor="#d4d4d4"
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
              <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Mastery Touch Gate Requirement</Text>
              <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                {masteryTouches} touches
              </Text>
            </View>
            <Slider
              style={{ width: '100%', height: 32 }}
              minimumValue={3}
              maximumValue={10}
              step={1}
              value={masteryTouches}
              onValueChange={(v: number) => setMasteryTouches(v)}
              minimumTrackTintColor="#1A1A1A"
              maximumTrackTintColor="#d4d4d4"
            />
            <View className="flex-row justify-between">
              <Text className="text-[8px] text-neutral-400 font-mono">3 touches</Text>
              <Text className="text-[8px] text-neutral-400 font-mono">10 touches</Text>
            </View>
          </View>

          {/* Standard Reviews Required setting */}
          <View style={{ gap: 6 }} className="pt-4 border-t border-[#F3F2F1]">
            <View className="flex-row justify-between items-center">
              <Text className="text-xs font-sans font-bold text-[#1A1A1A]">Standard Reviews Required per Day</Text>
              <Text className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-xs text-[#1A1A1A]">
                {reviewsRequired} reps
              </Text>
            </View>
            <Slider
              style={{ width: '100%', height: 32 }}
              minimumValue={1}
              maximumValue={3}
              step={1}
              value={reviewsRequired}
              onValueChange={(v: number) => setReviewsRequired(v)}
              minimumTrackTintColor="#1A1A1A"
              maximumTrackTintColor="#d4d4d4"
            />
            <View className="flex-row justify-between">
              <Text className="text-[8px] text-neutral-400 font-mono">1 review</Text>
              <Text className="text-[8px] text-neutral-400 font-mono">3 reviews</Text>
            </View>
          </View>
        </View>

        {/* Retention Rigor */}
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
                retentionRigor === 'custom' ? 'border-2 border-[#1A1A1A] bg-[#FBF9F6] shadow-md' : 'border-2 border-[#E5E5E5] bg-white'
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
                <Slider
                  style={{ width: '100%', height: 32 }}
                  minimumValue={3}
                  maximumValue={14}
                  step={1}
                  value={dailyPhaseWeeks}
                  onValueChange={(v: number) => setDailyPhaseWeeks(v)}
                  minimumTrackTintColor="#1A1A1A"
                  maximumTrackTintColor="#d4d4d4"
                />
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
                <Slider
                  style={{ width: '100%', height: 32 }}
                  minimumValue={2}
                  maximumValue={12}
                  step={1}
                  value={weeklyPhaseMonths}
                  onValueChange={(v: number) => setWeeklyPhaseMonths(v)}
                  minimumTrackTintColor="#1A1A1A"
                  maximumTrackTintColor="#d4d4d4"
                />
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
                <Slider
                  style={{ width: '100%', height: 32 }}
                  minimumValue={1}
                  maximumValue={10}
                  step={1}
                  value={monthlyPhaseYears}
                  onValueChange={(v: number) => setMonthlyPhaseYears(v)}
                  minimumTrackTintColor="#1A1A1A"
                  maximumTrackTintColor="#d4d4d4"
                />
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

        {/* Custom naming & community sharing options */}
        <View className="border border-neutral-200 rounded-xl p-4 bg-white shadow-sm mt-1" style={{ gap: 12 }}>
          <Text className="text-[9px] uppercase tracking-wider font-bold text-[#888] font-sans">Custom Plan & Sharing Options</Text>
          <View style={{ gap: 6 }}>
            <Text className="text-[10px] font-sans font-bold text-neutral-600">Custom Memory Plan Name</Text>
            <TextInput
              placeholder="My Custom Scripture Plan"
              value={customPlanName}
              onChangeText={setCustomPlanName}
              className="w-full px-3 py-2 text-xs border border-neutral-300 rounded-lg font-sans bg-white text-[#1A1A1A]"
            />
          </View>

          <View className="flex-row items-center justify-between pt-2 border-t border-neutral-100">
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

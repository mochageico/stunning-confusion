import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AppText, CollapsibleCard, FontScaleOverrideProvider } from '../components/design';
import { MissPolicySection, type MissPolicy } from '../components/MissPolicySection';
import PlanDesignerScreen from './PlanDesignerScreen';
import HomeScreen from './HomeScreen';
import type { AppState } from '../state/useAppState';

// ============================================================================
// DEV LAYOUT LAB — not reachable in the shipped app.
//
// Renders layout specimens at the real content width of the smallest supported
// device, across every font scale we promise to support, all at once. Flip
// DEV_LAYOUT_LAB in App.tsx to mount it; it needs no signed-in user and no
// saved plan, so it bypasses the auth gate entirely.
//
// Why this exists: nothing else in the project catches text leakage before it
// reaches a physical phone. Three columns side by side makes a clipped card
// obvious in one glance.
// ============================================================================

/**
 * iPhone SE (2nd/3rd gen) is 375pt wide. The settings screens wrap their
 * content in `p-5`, so 335pt is the width a section actually gets -- that's the
 * number worth testing against, not 375.
 */
const SE_WIDTH = 375;
const SCREEN_PADDING = 20;

/** 1.0 is the baseline; 1.5 is the ceiling we committed to supporting. */
const SCALES = [1, 1.3, 1.5];

export default function DevLayoutLab() {
  return (
    <View className="flex-1 bg-neutral-100">
      <View className="px-4 py-2 border-b border-neutral-300 bg-white">
        <Text style={{ fontSize: 13, fontWeight: '700' }}>Layout Lab — iPhone SE (375pt) × font scale</Text>
        <Text style={{ fontSize: 11, color: '#666' }}>Scroll sideways. Each column is a real SE content width.</Text>
      </View>
      <ScrollView horizontal>
        {SCALES.map((scale) => (
          <View
            key={scale}
            style={{ width: SE_WIDTH, borderRightWidth: 1, borderRightColor: '#CCC' }}
            className="bg-white"
          >
            <View className="bg-[#1A1A1A] px-3 py-1.5">
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFF' }}>{scale.toFixed(1)}× font scale</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: SCREEN_PADDING, gap: 20, paddingBottom: 60 }}>
              <SpecimenLabel text="BEFORE — 4-across, height: 92" />
              <BeforeMissPolicy scale={scale} />

              <SpecimenLabel text="AFTER — stacked OptionCards" />
              <FontScaleOverrideProvider scale={scale}>
                <LiveMissPolicy />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="CollapsibleCard — open as many as you like" />
              <FontScaleOverrideProvider scale={scale}>
                <CollapseSpecimen scale={scale} />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="Home — whole screen" />
              <FontScaleOverrideProvider scale={scale}>
                <LiveHome />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="Plan Designer — whole screen" />
              <FontScaleOverrideProvider scale={scale}>
                <LivePlanDesigner />
              </FontScaleOverrideProvider>
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function SpecimenLabel({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '800', color: '#999', letterSpacing: 1, textTransform: 'uppercase' }}>
      {text}
    </Text>
  );
}

/** The new component, driven by local state so the lab is fully interactive. */
function LiveMissPolicy() {
  const [missPolicy, setMissPolicy] = useState<MissPolicy>('standard');
  const [askEveryTime, setAskEveryTime] = useState(true);
  const [graceCount, setGraceCount] = useState(1);
  const [dailyDays, setDailyDays] = useState(7);
  const [weeklyWeeks, setWeeklyWeeks] = useState(4);
  return (
    <MissPolicySection
      missPolicy={missPolicy}
      setMissPolicy={setMissPolicy}
      missPolicyAskEveryTime={askEveryTime}
      setMissPolicyAskEveryTime={setAskEveryTime}
      graceCount={graceCount}
      setGraceCount={setGraceCount}
      refresherDailyDays={dailyDays}
      setRefresherDailyDays={setDailyDays}
      refresherWeeklyWeeks={weeklyWeeks}
      setRefresherWeeklyWeeks={setWeeklyWeeks}
    />
  );
}

/**
 * Enough of AppState for PlanDesignerScreen to render standalone — no signed-in
 * user, no saved plan, no Firebase. Cast at the call site rather than stubbing
 * the full (very large) AppState type: this is a harness, and TypeScript
 * checking the real screen against the real type is what matters, not this mock.
 */
function useMockPlanState() {
  const [s, setS] = useState({
    preset: 'drip',
    learningDays: ['M', 'T', 'W', 'Th', 'F'],
    newVersesPace: 2,
    maxReviewCap: 10,
    masteryTouches: 3,
    reviewsRequired: 2,
    sabbathEnabled: false,
    sabbathDay: 'Su',
    dayStartHour: 0,
    cognitiveLoadSensitivity: 'medium',
    retentionRigor: 'standard',
    dailyPhaseWeeks: 7,
    weeklyPhaseMonths: 6,
    monthlyPhaseYears: 5,
    missPolicy: 'standard',
    missPolicyAskEveryTime: true,
    graceCount: 1,
    refresherDailyDays: 7,
    refresherWeeklyWeeks: 4,
    customPlanName: '',
  });
  const set = (key: string) => (value: unknown) => setS((prev) => ({ ...prev, [key]: value }));
  const noop = () => {};
  return {
    ...s,
    setPreset: set('preset'),
    setLearningDays: set('learningDays'),
    setNewVersesPace: set('newVersesPace'),
    setMaxReviewCap: set('maxReviewCap'),
    setMasteryTouches: set('masteryTouches'),
    setReviewsRequired: set('reviewsRequired'),
    setSabbathEnabled: set('sabbathEnabled'),
    setSabbathDay: set('sabbathDay'),
    setDayStartHour: set('dayStartHour'),
    setCognitiveLoadSensitivity: set('cognitiveLoadSensitivity'),
    setRetentionRigor: set('retentionRigor'),
    setDailyPhaseWeeks: set('dailyPhaseWeeks'),
    setWeeklyPhaseMonths: set('weeklyPhaseMonths'),
    setMonthlyPhaseYears: set('monthlyPhaseYears'),
    setMissPolicy: set('missPolicy'),
    setMissPolicyAskEveryTime: set('missPolicyAskEveryTime'),
    setGraceCount: set('graceCount'),
    setRefresherDailyDays: set('refresherDailyDays'),
    setRefresherWeeklyWeeks: set('refresherWeeklyWeeks'),
    setCustomPlanName: set('customPlanName'),
    onboardingStepInProgress: null,
    handleBack: noop,
    handleSavePlan: noop,
    triggerToast: noop,
  };
}

/**
 * Enough of AppState for HomeScreen, with a small fake queue so the Learning,
 * Due reviews and Priming sections all have content to render.
 */
function useMockHomeState() {
  const mkItem = (n: number, status: string) => ({
    verseId: `ESV-John-3-${n}`,
    book: 'John',
    chapter: 3,
    verseNumber: n,
    translationId: 'ESV',
    status,
    nextReviewDueDate: '2020-01-01',
    reviewPhase: 'daily',
    touchLogs: [],
  });
  const memoryQueue = [
    mkItem(16, 'learning'),
    mkItem(17, 'learning'),
    mkItem(1, 'reviewing'),
    mkItem(2, 'reviewing'),
    mkItem(30, 'queued'),
    mkItem(31, 'queued'),
  ];
  const noop = () => {};
  return {
    user: { displayName: 'Micah Example' },
    memoryQueue,
    primingLookahead: 10,
    setPrimingLookahead: noop,
    cognitiveLoadSensitivity: 'medium',
    maxReviewCap: 10,
    getEstimatedReviewTime: () => 14,
    isTodayLearningDay: () => true,
    getTodayDateString: () => 'Thursday, July 30',
    getGreeting: () => 'Good morning',
    navigateTo: noop,
    triggerToast: noop,
    triggerMockDueReviews: noop,
    masteryTouches: 3,
    startPractice: noop,
    startReviewSession: noop,
    handleUpdateVerseStatus: noop,
    triggerDailyPull: noop,
    isReviewDue: () => true,
    pausedAt: null,
    pausedUntil: null,
  };
}

/**
 * Full-bleed phone frame for whole-screen specimens.
 *
 * Negative horizontal margin cancels the lab's own SCREEN_PADDING so the screen
 * gets the true 375pt device width. Without this the screen renders ~73pt
 * narrower than reality (the lab's padding plus the screen's own p-5 applied
 * twice), which is a stricter test but makes every height measurement
 * meaningless for a real device.
 */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        width: SE_WIDTH,
        height: 620,
        marginHorizontal: -SCREEN_PADDING,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: '#DDD',
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

/** The real Home screen at true device width. */
function LiveHome() {
  const mock = useMockHomeState();
  return (
    <PhoneFrame>
      <HomeScreen state={mock as unknown as AppState} />
    </PhoneFrame>
  );
}

/** The real Plan Designer at true device width. */
function LivePlanDesigner() {
  const mock = useMockPlanState();
  return (
    <PhoneFrame>
      <PlanDesignerScreen state={mock as unknown as AppState} />
    </PhoneFrame>
  );
}

/**
 * Three CollapsibleCards to prove independence: opening one must never close
 * another, and each card's choice must persist across a reload. Storage keys
 * are namespaced per scale column so the three columns don't fight each other.
 */
function CollapseSpecimen({ scale }: { scale: number }) {
  return (
    <View style={{ gap: 8 }}>
      <CollapsibleCard storageKey={`lab.${scale}.weekly`} title="Weekly rhythm" summary="5 days">
        <AppText variant="body" className="font-sans text-neutral-600">
          Body content for the first section. Any number of these can be open at the same time.
        </AppText>
      </CollapsibleCard>
      <CollapsibleCard storageKey={`lab.${scale}.pace`} title="New verses per learning day" summary="2 verses">
        <AppText variant="body" className="font-sans text-neutral-600">
          Body content for the second section.
        </AppText>
      </CollapsibleCard>
      <CollapsibleCard storageKey={`lab.${scale}.rigor`} title="Retention rigor" summary="7-6-5" defaultCollapsed>
        <AppText variant="body" className="font-sans text-neutral-600">
          This one starts collapsed, to check that a per-card default works.
        </AppText>
      </CollapsibleCard>
    </View>
  );
}

// ============================================================
// The original markup, frozen for comparison.
//
// Font sizes are multiplied by `scale` inline rather than left to
// `allowFontScaling`, because React Native Web ignores the OS font setting
// entirely. Multiplying by hand reproduces what iOS actually does to this
// markup -- the fixed `height: 92` stays fixed, which is the whole point.
// ============================================================
const BEFORE_TIERS = [
  { key: 'lenient', label: 'Lenient', desc: 'More free misses before anything changes, and shorter refreshers when it does.' },
  { key: 'standard', label: 'Standard', desc: 'The default. One free miss, then a short refresher stint before the verse returns to its phase.' },
  {
    key: 'graceDiscretion',
    label: 'Grace at Your Discretion',
    desc: "Nothing ever escalates on its own — missed time simply doesn't count, and you pick up exactly where you left off.",
  },
];

function BeforeMissPolicy({ scale }: { scale: number }) {
  const active = 'standard';
  return (
    <View className="border-2 border-[#1A1A1A] rounded-xl p-3.5 bg-white shadow-sm" style={{ gap: 16 }}>
      <View className="flex-row items-center justify-between border-b border-neutral-100 pb-2">
        <Text
          className="font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A]"
          style={{ fontSize: 12 * scale }}
        >
          Missed Review Handling
        </Text>
      </View>

      <View className="flex-row gap-2">
        {BEFORE_TIERS.map((tier) => {
          const isActive = tier.key === active;
          return (
            <View
              key={tier.key}
              className={`flex-1 border-2 rounded-xl p-2.5 justify-between shadow-sm ${
                isActive ? 'border-[#1A1A1A] bg-[#1A1A1A]' : 'border-[#E5E5E5] bg-white'
              }`}
              style={{ height: 92 }}
            >
              <Text
                className={`font-serif font-black leading-tight ${isActive ? 'text-white' : 'text-[#1A1A1A]'}`}
                style={{ fontSize: 11 * scale }}
              >
                {tier.label}
              </Text>
              <Text
                className={`font-sans leading-tight ${isActive ? 'text-neutral-200' : 'text-neutral-500'}`}
                style={{ fontSize: 8 * scale }}
              >
                {tier.desc}
              </Text>
            </View>
          );
        })}
        <View className="flex-1 rounded-xl p-2.5 justify-between border-2 border-[#E5E5E5] bg-white" style={{ height: 92 }}>
          <Text className="font-serif font-black leading-tight text-[#1A1A1A]" style={{ fontSize: 11 * scale }}>
            Custom
          </Text>
          <Text className="font-mono leading-tight text-neutral-500" style={{ fontSize: 8 * scale }}>
            Fine-tune
          </Text>
        </View>
      </View>

      {/* One of the three label+badge rows that push their value off-screen. */}
      <View className="flex-row justify-between items-center">
        <Text className="font-sans font-bold text-[#1A1A1A]" style={{ fontSize: 12 * scale }}>
          Weekly -&gt; Daily Refresher
        </Text>
        <Text
          className="bg-[#F3F2F1] border border-neutral-300 px-2 py-0.5 rounded font-mono text-[#1A1A1A]"
          style={{ fontSize: 12 * scale }}
        >
          7 days
        </Text>
      </View>
    </View>
  );
}

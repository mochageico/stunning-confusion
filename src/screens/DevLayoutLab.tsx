import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AppText, CollapsibleCard, FontScaleOverrideProvider } from '../components/design';
import { Dropdown } from '../components/Dropdown';
import { ReviewSettings } from '../components/ReviewSettings';
import { RhythmEditor } from '../components/RhythmEditor';
import { QueueSources } from '../components/QueueSources';
import HomeScreen from './HomeScreen';
import type { AppState } from '../state/useAppState';
import type { Rhythm, GroupPlan, GroupPlanMembership } from '../types';

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
              <SpecimenLabel text="Review Settings — Retention Level open" />
              <FontScaleOverrideProvider scale={scale}>
                <LiveReviewSettings />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="CollapsibleCard — open as many as you like" />
              <FontScaleOverrideProvider scale={scale}>
                <CollapseSpecimen scale={scale} />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="Dropdown — anchored menu, short + long list" />
              <FontScaleOverrideProvider scale={scale}>
                <LiveDropdowns />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="Home — whole screen" />
              <FontScaleOverrideProvider scale={scale}>
                <LiveHome />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="Rhythm editor — day pills + steppers" />
              <FontScaleOverrideProvider scale={scale}>
                <LiveRhythmEditor />
              </FontScaleOverrideProvider>

              <SpecimenLabel text="Queue sources — group plan priority" />
              <FontScaleOverrideProvider scale={scale}>
                <LiveQueueSources />
              </FontScaleOverrideProvider>
            </ScrollView>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The Rhythm editor, driven by local state. Seven day pills in one row is the
 * densest thing on the queue screen and the most likely to overflow at 1.5x,
 * so it gets its own specimen rather than only being checked inside the whole
 * screen.
 */
function LiveRhythmEditor() {
  const [rhythm, setRhythm] = useState<Rhythm>({
    learningDays: ['M', 'W', 'F'],
    newVersesPace: 3,
    maxReviewCap: 15,
    sabbathEnabled: true,
    sabbathDay: 'Su',
    dayStartHour: 0,
    cognitiveLoadSensitivity: 'medium',
    pausedAt: null,
    pausedUntil: null,
  });
  return (
    <View className="border-2 border-[#1A1A1A] rounded-xl bg-white p-4">
      <RhythmEditor rhythm={rhythm} onChange={(patch) => setRhythm((prev) => ({ ...prev, ...patch }))} />
    </View>
  );
}

/** Two sources competing, with the three priority pills in one row. */
function LiveQueueSources() {
  const [priority, setPriority] = useState<GroupPlanMembership['priority']>('group');
  const plan: GroupPlan = {
    planId: 'p1',
    circleId: 'c1',
    name: 'Romans Challenge',
    description: '',
    managerId: 'u1',
    versesPerWeek: 5,
    verseIds: [],
    createdAt: '',
    updatedAt: '',
  };
  return (
    <View className="border-2 border-[#1A1A1A] rounded-xl bg-white p-4">
      <QueueSources
        individualQueuedCount={12}
        joinedPlans={[plan]}
        memberships={[{ planId: 'p1', circleId: 'c1', priority, joinedAt: '' }]}
        previewFromPlans={{ p1: ['a', 'b'] }}
        previewFromIndividual={['c']}
        onChangePriority={(_, p) => setPriority(p)}
      />
    </View>
  );
}

/**
 * Two Dropdowns side by side: a short list (no search) and a long one (search
 * appears past 10 options). The menu is anchored to its trigger, so the thing
 * to check here is that it lands under the button in the column it belongs to
 * -- not centred, not clipped by the column edge -- and that a trigger low in
 * the scroll flips the menu upward instead of opening into nothing.
 */
function LiveDropdowns() {
  const [short, setShort] = useState('verses');
  const [long, setLong] = useState('3');
  return (
    <View className="flex-row" style={{ gap: 8 }}>
      <View className="flex-1">
        <Dropdown
          value={short}
          onChange={setShort}
          options={[
            { id: 'verses', label: 'Verse List' },
            { id: 'memoryGrid', label: 'Memory Grid' },
          ]}
          title="Display"
          placeholder="View"
          staticLabel
          searchable={false}
        />
      </View>
      <View className="flex-1">
        <Dropdown
          value={long}
          onChange={setLong}
          options={Array.from({ length: 28 }, (_, i) => ({ id: String(i + 1), label: `Chapter ${i + 1}` }))}
          title="Select a Chapter"
        />
      </View>
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
    reviewsPaused: false,
    pausedUntil: null,
    resumeReviews: noop,
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

/** The Review Settings accordion, driven by local state. */
function LiveReviewSettings() {
  const [prefs, setPrefs] = useState({ thoroughness: 1 as 0.5 | 1 | 1.5 | 2, cleanPct: 90, lateMovesBack: true, balanceDays: true });
  const [masteryTouches, setMasteryTouches] = useState(3);
  return (
    <ReviewSettings
      prefs={prefs}
      masteryTouches={masteryTouches}
      onChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))}
      onMasteryChange={setMasteryTouches}
    />
  );
}

import { ScrollView, View } from 'react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppText, Card, useScaledSpace } from '../components/design';
import { ScreenHeader, SectionHeader } from '../components/blocks';
import { RhythmEditor } from '../components/RhythmEditor';
import { ReviewSettings } from '../components/ReviewSettings';
import { VersesTabs } from '../components/VersesTabs';

// MEMORY PLAN DESIGNER -- the Verses tab's Plan section. One plan per account:
// My Schedule (which days you take on new verses, how many, how long reviews
// may take) and Review Settings (how fast verses climb the ladder, what counts
// as clean, what lateness does). Everything commits live, so there is no Save.
// It used to be four screens: My Schedule, a list of saved plans, a plan
// editor and a missed-review policy.
export default function MemoryPlanScreen({ state }: { state: AppState }) {
  const {
    switchVersesTab,
    learningDays,
    newVersesPace,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    dayStartHour,
    cognitiveLoadSensitivity,
    pausedAt,
    pausedUntil,
    updateRhythm,
    thoroughness,
    cleanPct,
    lateMovesBack,
    masteryTouches,
    updateLadderSettings,
    updateMasteryTouches,
  } = state;
  const space = useScaledSpace();

  const rhythm = {
    learningDays,
    newVersesPace,
    maxReviewCap,
    sabbathEnabled,
    sabbathDay,
    dayStartHour,
    cognitiveLoadSensitivity,
    pausedAt,
    pausedUntil,
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* A tab of the Verses section, so no back link. */}
        <ScreenHeader title="Verses" />
        <VersesTabs value="memoryPlan" onChange={switchVersesTab} />

        <View style={{ gap: space(4) }}>
          <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
            Memory Plan Designer
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            When you learn new verses, and how they come back after that. One plan for all your verses.
          </AppText>
        </View>

        <View style={{ gap: space(8) }}>
          <SectionHeader title="My Schedule" />
          <Card>
            <RhythmEditor rhythm={rhythm} onChange={updateRhythm} />
          </Card>
        </View>

        <View style={{ gap: space(8) }}>
          <SectionHeader title="Review Settings" />
          <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
            Tap a setting to change it and see what it does.
          </AppText>
          <ReviewSettings
            prefs={{ thoroughness, cleanPct, lateMovesBack }}
            masteryTouches={masteryTouches}
            onChange={updateLadderSettings}
            onMasteryChange={updateMasteryTouches}
          />
        </View>
      </ScrollView>
    </FadeInView>
  );
}

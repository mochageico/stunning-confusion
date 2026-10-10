import { ScrollView } from 'react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { Card, useScaledSpace } from '../components/design';
import { ScreenHeader } from '../components/blocks';
import { RhythmEditor } from '../components/RhythmEditor';

// MY SCHEDULE -- user-level pacing, commits live, so there is no Save. It was
// a card at the top of My Verses, which pushed the verses themselves (and the
// Add button) two screens down at large text; now it's a row under the list.
export default function MyScheduleScreen({ state }: { state: AppState }) {
  const {
    handleBack,
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
        <ScreenHeader
          title="My Schedule"
          subtitle="Which days you take on new verses, how many, and how long reviews may take."
          onBack={handleBack}
          backLabel="My Verses"
        />
        <Card>
          <RhythmEditor rhythm={rhythm} onChange={updateRhythm} />
        </Card>
      </ScrollView>
    </FadeInView>
  );
}

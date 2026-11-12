import { ScrollView, View } from 'react-native';

import { FadeInView } from '../components/ui';
import { AppText, useFontScale, useScaledSpace } from '../components/design';
import { ScreenHeader, SectionHeader } from '../components/blocks';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { LADDER_GROUPS } from '../lib/ladder';
import { STAGE_LABEL, verseStage } from '../lib/stageProgress';
import { useAppFields } from '../state/appStore';

// Opens from Profile (and Today's streak); the back link names which.
const BACK_LABELS: Partial<Record<string, string>> = {
  profile: 'Me',
  home: 'Today',
};

// Streak/memorized-count thresholds for the milestone badges section --
// purely derived from existing counts (memoryStreak/memorizedCount), no
// new persistence needed.
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
const MEMORIZED_MILESTONES = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

// A whole memorized chapter is 20-odd chips saying almost the same thing.
function formatStudyTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return '0 min';
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${minutes} min`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

// A grid of milestone tiles. Rows fill with equal-width tiles and a short last
// row keeps its tiles the same width (spacers), instead of stretching or
// packing to the left.
function MilestoneGrid({
  thresholds,
  value,
  unit,
  achievedBox,
  achievedText,
}: {
  thresholds: number[];
  value: number;
  unit: string;
  achievedBox: string;
  achievedText: string;
}) {
  const scale = useFontScale();
  const space = useScaledSpace();
  const perRow = scale >= 1.3 ? 2 : 4;
  return (
    <View style={{ gap: space(8) }}>
      {chunk(thresholds, perRow).map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row" style={{ gap: space(8) }}>
          {row.map((threshold) => {
            const achieved = value >= threshold;
            return (
              <View
                key={threshold}
                className={`flex-1 items-center rounded-btn border ${achieved ? achievedBox : 'bg-surface border-line'}`}
                style={{ paddingVertical: space(10), paddingHorizontal: space(4), gap: space(1) }}
              >
                <AppText variant="body" className={`font-sans font-bold ${achieved ? achievedText : 'text-ink-3'}`}>
                  {threshold}
                </AppText>
                <AppText variant="caption" className={`font-sans ${achieved ? achievedText : 'text-ink-3'}`}>
                  {unit}
                </AppText>
                {!achieved && (
                  <AppText variant="caption" className="font-sans text-ink-3 text-center">
                    {threshold - value} to go
                  </AppText>
                )}
              </View>
            );
          })}
          {Array.from({ length: perRow - row.length }).map((_, i) => (
            <View key={`spacer-${i}`} className="flex-1" />
          ))}
        </View>
      ))}
    </View>
  );
}


export default function DashboardScreen() {
  const state = useAppFields(
    'activityLast90Days', 'backHistory', 'handleBack', 'learningCount', 'memoryQueue',
    'memoryStreak', 'navigateTo', 'totalStudySeconds',
  );
  const space = useScaledSpace();
  const {
    handleBack,
    backHistory,
    navigateTo,
    memoryQueue,
    learningCount,
    memoryStreak,
    totalStudySeconds,
    activityLast90Days,
  } = state;
  const prevScreen = backHistory[backHistory.length - 1]?.screen;

  const totalReviewsCompleted = memoryQueue.reduce((sum, item) => sum + (item.totalSuccessfulReviews || 0), 0);

  // Each retention row carries the verses themselves, not just a tally -- the
  // count answers "how many?" and the strip under it answers "which ones?"
  // without leaving the screen.
  const retentionRows = (['learning', 'settling', 'steady', 'kept', 'secure'] as const).map((key) => ({
    key,
    label: STAGE_LABEL[key],
    note: key === 'learning' ? '' : LADDER_GROUPS[key].description,
    items: memoryQueue.filter((item) => verseStage(item) === key),
  }));

  // "Verses memorized" means verses learned -- anything past Learning, in any
  // of Settling, Steady, Kept or Secure.
  const versesLearnedCount = retentionRows.slice(1).reduce((n, row) => n + row.items.length, 0);

  const tiles = [
    { label: 'Verses memorized', value: versesLearnedCount },
    { label: 'Verses in progress', value: learningCount },
    { label: 'Day streak', value: memoryStreak },
    { label: 'Reviews done', value: totalReviewsCompleted },
    { label: 'Time studied', value: formatStudyTime(totalStudySeconds) },
  ];

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* "Progress Dashboard" was jargon standing in front of a plain
            idea. This screen is the answer to "how am I doing?". */}
        <ScreenHeader title="Milestones" onBack={handleBack} backLabel={(prevScreen && BACK_LABELS[prevScreen]) || 'Back'} />

        <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
          {tiles.map((tile) => (
            <View
              key={tile.label}
              className="bg-surface border border-line rounded-card items-center"
              style={{ flexGrow: 1, flexBasis: space(140), padding: space(14), gap: space(2) }}
            >
              <AppText variant="display" className="font-sans font-bold text-ink">
                {tile.value}
              </AppText>
              <AppText variant="caption" className="font-sans text-ink-3 text-center">
                {tile.label}
              </AppText>
            </View>
          ))}
        </View>

        {/* Past 90 days. Profile once carried its own 15-day strip of this
            same data above the button that led here -- a worse view of a
            thing this screen shows better -- so it was deleted there. */}
        <View style={{ gap: space(6) }}>
          <SectionHeader title="Past 90 days" actionLabel="Full history" onAction={() => navigateTo('fullHistory')} />
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(12) }}>
            <ActivityHeatmap days={activityLast90Days} />
          </View>
        </View>

        <View style={{ gap: space(6) }}>
          <SectionHeader title="Streak milestones" />
          <MilestoneGrid thresholds={STREAK_MILESTONES} value={memoryStreak} unit="days" achievedBox="bg-success-soft border-success/30" achievedText="text-success" />
        </View>

        <View style={{ gap: space(6) }}>
          <SectionHeader title="Memorized milestones" />
          <MilestoneGrid thresholds={MEMORIZED_MILESTONES} value={versesLearnedCount} unit="verses" achievedBox="bg-accent-soft border-accent/30" achievedText="text-accent" />
        </View>
      </ScrollView>
    </FadeInView>
  );
}

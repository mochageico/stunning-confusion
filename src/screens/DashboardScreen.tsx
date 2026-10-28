import { ScrollView, View } from 'react-native';
import { Clock } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppText, useFontScale, useScaledSpace } from '../components/design';
import { GroupedList, ListRow, ScreenHeader, SectionHeader } from '../components/blocks';
import { ActivityHeatmap } from '../components/ActivityHeatmap';
import { StageDot } from '../components/VerseStages';
import { LADDER_GROUPS } from '../lib/ladder';
import { STAGE_LABEL, verseStage } from '../lib/stageProgress';

// Opens from Profile (and Today's streak); the back link names which.
const BACK_LABELS: Partial<Record<string, string>> = {
  profile: 'Profile',
  home: 'Today',
};

// Streak/memorized-count thresholds for the milestone badges section --
// purely derived from existing counts (memoryStreak/memorizedCount), no
// new persistence needed.
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
const MEMORIZED_MILESTONES = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

// A whole memorized chapter is 20-odd chips saying almost the same thing.
// Collapse each book+chapter into one chip, with its verse numbers folded
// into runs: "Ephesians 1:1-23", "Psalm 23:1-3, 6". Groups keep the order
// they first appear in the queue; duplicate references across translations
// collapse into one, since the chip shows a reference, not a text.
function summarizeReferences(items: { book: string; chapter: number; verseNumber: number }[]) {
  const groups: { key: string; book: string; chapter: number; verses: Set<number> }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();

  for (const item of items) {
    const key = `${item.book}|${item.chapter}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, book: item.book, chapter: item.chapter, verses: new Set<number>() };
      byKey.set(key, group);
      groups.push(group);
    }
    group.verses.add(item.verseNumber);
  }

  return groups.map((group) => {
    const verses = [...group.verses].sort((a, b) => a - b);
    const runs: string[] = [];
    let start = verses[0];
    let prev = verses[0];

    for (let i = 1; i <= verses.length; i += 1) {
      const current = verses[i];
      if (current === prev + 1) {
        prev = current;
        continue;
      }
      runs.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = current;
      prev = current;
    }

    return { key: group.key, label: `${group.book} ${group.chapter}:${runs.join(', ')}` };
  });
}

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


export default function DashboardScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const {
    handleBack,
    backHistory,
    navigateTo,
    memoryQueue,
    memorizedCount,
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
  ];

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        {/* "Progress Dashboard" was jargon standing in front of a plain
            idea. This screen is the answer to "how am I doing?". */}
        <ScreenHeader title="My progress" onBack={handleBack} backLabel={(prevScreen && BACK_LABELS[prevScreen]) || 'Back'} />

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

        <GroupedList footer="Total time with a practice or listen session open.">
          <ListRow Icon={Clock} title="Time studied" value={formatStudyTime(totalStudySeconds)} />
        </GroupedList>

        {/* One row per phase, stacked -- five columns squeezed the numbers
            into a strip too narrow to say anything else. The stage colour is
            only the dot; the verses in each phase scroll sideways beneath it. */}
        <View style={{ gap: space(6) }}>
          <SectionHeader title="Where your verses are" />
          <View className="bg-surface border border-line rounded-card overflow-hidden">
            {retentionRows.map((row, i) => {
              const references = summarizeReferences(row.items);
              return (
                <View
                  key={row.key}
                  className={i > 0 ? 'border-t border-hairline' : ''}
                  style={{ paddingVertical: space(12), gap: space(8) }}
                >
                  <View className="flex-row items-center" style={{ paddingHorizontal: space(14), gap: space(8) }}>
                    <StageDot stage={row.key} />
                    <AppText variant="body" className="font-sans text-ink flex-1">
                      {row.label}
                    </AppText>
                    <AppText variant="body" className="font-sans font-semibold text-ink">
                      {row.items.length}
                    </AppText>
                  </View>
                  {row.note ? (
                    <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(14) }}>
                      {row.note}
                    </AppText>
                  ) : null}
                  {row.items.length === 0 ? (
                    <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(14) }}>
                      No verses here yet
                    </AppText>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: space(6), paddingHorizontal: space(14), alignItems: 'center' }}
                    >
                      {references.map((reference) => (
                        <View
                          key={reference.key}
                          className={`bg-surface-2 rounded-btn ${row.key === 'secure' ? 'border-[1.5px] border-stage-top-edge' : 'border border-line'}`}
                          style={{ paddingHorizontal: space(8), paddingVertical: space(3) }}
                        >
                          <AppText variant="caption" className="font-sans font-medium text-ink-2">
                            {reference.label}
                          </AppText>
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Past 90 days. Profile once carried its own 15-day strip of this
            same data above the button that led here -- a worse view of a
            thing this screen shows better -- so it was deleted there. */}
        <View style={{ gap: space(6) }}>
          <SectionHeader title="Past 90 days" actionLabel="Full history" onAction={() => navigateTo('fullHistory')} />
          <View className="bg-surface border border-line rounded-card" style={{ padding: space(12) }}>
            <ActivityHeatmap days={activityLast90Days} />
          </View>
          <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
            Each square is a day. It fills in when you review a verse or practice one you're learning; darker means more that day. Tap a square to see its count.
          </AppText>
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

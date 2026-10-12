import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppText, useFontScale, useScaledSpace } from '../components/design';
import { Badge, ScreenHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';
import { CompleteChips, STAGE_FILL, dayWord, stageCaption } from '../components/VerseStages';
import { STAGE_LABEL, StageGroup, VerseStage, groupByStage, referenceFor, stageCounts } from '../lib/stageProgress';

// ============================================================================
// The road: every verse drawn as a climb from Learning (bottom) to Complete
// (top). Within each stretch the verse closest to its next stop sits highest,
// so you can see what's about to move up. The stretches are not to scale --
// Monthly lasts years and Daily weeks; drawn to scale, Daily would vanish.
// ============================================================================

/** The stretch between two stops, in the color of the stage being travelled. */
const LINE: Record<VerseStage, string> = {
  waiting: 'bg-line-strong',
  learning: 'bg-stage-learning',
  daily: 'bg-stage-daily',
  weekly: 'bg-stage-weekly',
  monthly: 'bg-stage-monthly',
  complete: 'bg-ink',
};

const NEXT: Partial<Record<VerseStage, VerseStage>> = { learning: 'daily', daily: 'weekly', weekly: 'monthly', monthly: 'complete' };

export default function VerseRoadScreen({ state }: { state: AppState }) {
  const { memoryQueue, handleBack, openVersePage, navigateTo, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches } = state;
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();

  const plan = { dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches };
  const now = new Date();
  const byStage = useMemo(
    () => groupByStage(memoryQueue, plan, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memoryQueue, dailyPhaseWeeks, weeklyPhaseMonths, monthlyPhaseYears, masteryTouches]
  );
  const counts = useMemo(() => stageCounts(memoryQueue), [memoryQueue]);

  const open = (g: StageGroup) => openVersePage({ book: g.book, chapter: g.chapter, verses: g.verses, translationId: g.translationId });
  const rail = space(40);
  const lineW = 3;

  /** The rail for one row: the line runs through it, optionally with a marker on it. */
  const Rail = ({ line, marker, half }: { line?: VerseStage; marker?: React.ReactNode; half?: 'top' | 'bottom' }) => (
    <View style={{ width: rail, alignItems: 'center', justifyContent: 'center' }}>
      {line && (
        <View
          className={LINE[line]}
          // layout-ok: the road's line.
          style={{
            position: 'absolute',
            width: lineW,
            left: rail / 2 - lineW / 2,
            top: half === 'bottom' ? '50%' : 0,
            bottom: half === 'top' ? '50%' : 0,
          }}
        />
      )}
      {marker}
    </View>
  );

  const stopSize = Math.round(26 * Math.min(scale, 1.3));
  const Stop = ({ stage, above, below }: { stage: VerseStage; above?: VerseStage; below?: VerseStage }) => (
    <View className="flex-row items-stretch">
      <View style={{ width: rail, alignItems: 'center', justifyContent: 'center' }}>
        {above && (
          // layout-ok: the road's line above the stop.
          <View className={LINE[above]} style={{ position: 'absolute', width: lineW, left: rail / 2 - lineW / 2, top: 0, bottom: '50%' }} />
        )}
        {below && (
          // layout-ok: the road's line below the stop.
          <View className={LINE[below]} style={{ position: 'absolute', width: lineW, left: rail / 2 - lineW / 2, top: '50%', bottom: 0 }} />
        )}
        <View
          className={`rounded-full items-center justify-center border-4 border-canvas ${STAGE_FILL[stage]}`}
          // layout-ok: a stop marker holds only an icon.
          style={{ width: stopSize + 8, height: stopSize + 8 }}
        >
          {stage === 'complete' && <Check size={Math.round(14 * scale)} color={palette.onAccent} strokeWidth={3} />}
        </View>
      </View>
      <View className="flex-1" style={{ paddingVertical: space(12), paddingLeft: space(10), gap: space(2) }}>
        <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
          {STAGE_LABEL[stage]} · {counts[stage]}
        </AppText>
        <AppText variant="caption" className="font-sans text-ink-2">
          {stage === 'complete' ? 'Made it all the way' : stageCaption(stage, plan)}
        </AppText>
      </View>
    </View>
  );

  const note = (g: StageGroup): React.ReactNode => {
    const p = g.progress;
    if (p.refresher) {
      const n = p.refresher.remaining;
      return <Badge label={`Refresher, ${n} ${p.refresher.unit}${n === 1 ? '' : 's'}`} tone="warning" />;
    }
    const next = NEXT[p.stage];
    if (p.stage === 'learning') {
      return (
        <AppText variant="caption" className="font-sans text-ink-2 text-right">
          {p.remaining > 0 ? `${p.remaining} ${p.remaining === 1 ? 'recall' : 'recalls'} to go` : 'Ready to move up'}
        </AppText>
      );
    }
    if (next && p.movesUpOn && p.movesUpOn.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
      return (
        <AppText variant="caption" className="font-sans font-semibold text-success text-right">
          {STAGE_LABEL[next]} {dayWord(p.movesUpOn, now)}
        </AppText>
      );
    }
    if (p.justMovedUp) return <Badge label="Just arrived" tone="accent" />;
    return (
      <AppText variant="caption" className="font-sans text-ink-2 text-right">
        {p.position}
      </AppText>
    );
  };

  const Stretch = ({ stage }: { stage: VerseStage }) => (
    <>
      {byStage[stage].map((g) => {
        const reference = referenceFor(g.book, g.chapter, g.verses);
        return (
          <View key={g.key} className="flex-row items-stretch">
            <Rail
              line={stage}
              marker={
                <View
                  className={`rounded-full bg-surface border-2 ${stage === 'learning' ? 'border-stage-learning' : stage === 'daily' ? 'border-stage-daily' : stage === 'weekly' ? 'border-stage-weekly' : 'border-stage-monthly'}`}
                  // layout-ok: a tick on the road.
                  style={{ width: 10, height: 10 }}
                />
              }
            />
            <Pressable
              onPress={() => open(g)}
              accessibilityRole="button"
              accessibilityLabel={`${reference}, ${STAGE_LABEL[stage]}, ${g.progress.position}`}
              className="flex-1 flex-row items-center bg-surface border border-line rounded-btn active:opacity-70"
              style={{ marginVertical: space(4), paddingVertical: space(10), paddingHorizontal: space(12), gap: space(8) }}
            >
              <AppText variant="label" className="font-sans font-semibold text-ink flex-1">
                {reference}
              </AppText>
              {note(g)}
            </Pressable>
          </View>
        );
      })}
      {byStage[stage].length === 0 && (
        <View className="flex-row items-stretch">
          <Rail line={stage} />
          <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingVertical: space(10), paddingLeft: space(10) }}>
            None here right now
          </AppText>
        </View>
      )}
    </>
  );

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }}>
        <ScreenHeader
          title="The road"
          onBack={handleBack}
          backLabel="My Verses"
          subtitle="Every verse climbs from Learning to Complete. The closer a verse is to its next stop, the higher it sits."
        />

        <View>
          {/* Summit */}
          <Stop stage="complete" below="monthly" />
          {counts.complete > 0 && (
            <View className="flex-row items-stretch">
              <Rail line="monthly" />
              <View className="flex-1" style={{ paddingLeft: space(6), paddingBottom: space(8) }}>
                <CompleteChips groups={byStage.complete} onPress={open} />
              </View>
            </View>
          )}

          <Stretch stage="monthly" />
          <Stop stage="monthly" above="monthly" below="weekly" />
          <Stretch stage="weekly" />
          <Stop stage="weekly" above="weekly" below="daily" />
          <Stretch stage="daily" />
          <Stop stage="daily" above="daily" below="learning" />
          <Stretch stage="learning" />
          <Stop stage="learning" above="learning" />

          {/* Base camp */}
          <View className="flex-row items-stretch" style={{ marginTop: space(6) }}>
            <View style={{ width: rail, alignItems: 'center', justifyContent: 'center' }}>
              <View
                className="rounded-full border-2 border-dashed border-ink-3"
                // layout-ok: the empty start marker.
                style={{ width: 22, height: 22 }}
              />
            </View>
            <Pressable
              onPress={() => navigateTo('activePlan')}
              accessibilityRole="button"
              className="flex-1 flex-row items-center border border-dashed border-line-strong rounded-btn active:opacity-70"
              style={{ paddingVertical: space(12), paddingHorizontal: space(12), gap: space(8) }}
            >
              <AppText variant="label" className="font-sans font-medium text-ink flex-1">
                {counts.waiting} {counts.waiting === 1 ? 'verse' : 'verses'} waiting to start
              </AppText>
              <ChevronRight size={Math.round(18 * scale)} color={palette.ink3} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

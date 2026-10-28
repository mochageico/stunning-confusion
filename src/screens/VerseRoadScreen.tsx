import React, { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppText, useFontScale, useScaledSpace } from '../components/design';
import { Badge, ScreenHeader } from '../components/blocks';
import { useThemeColors } from '../components/theme';
import { TopChips, fillFor, dayWord, stageCaption } from '../components/VerseStages';
import { STAGE_LABEL, StageGroup, VerseStage, groupByStage, referenceFor, stageCounts } from '../lib/stageProgress';
import { LADDER } from '../lib/ladder';

// ============================================================================
// The road: every passage drawn as a climb from Learning (bottom) to the top
// step, Every 6 months (summit). Within each stretch the passage closest to
// its next step sits highest, so you can see what's about to move up. The
// stretches are not to scale -- Kept lasts years and Settling weeks; drawn to
// scale, Settling would vanish.
// ============================================================================

/** The stretch between two stops, in the color of the group being travelled. */
const LINE: Record<VerseStage | 'top', string> = {
  waiting: 'bg-line-strong',
  learning: 'bg-stage-learning',
  settling: 'bg-stage-daily',
  steady: 'bg-stage-weekly',
  kept: 'bg-stage-complete',
  secure: 'bg-stage-top',
  top: 'bg-stage-top',
};

/** Ring on a passage's tick, by group. */
const TICK: Record<VerseStage, string> = {
  waiting: 'border-ink-3',
  learning: 'border-stage-learning',
  settling: 'border-stage-daily',
  steady: 'border-stage-weekly',
  kept: 'border-stage-complete',
  secure: 'border-stage-top',
};

type Segment = VerseStage | 'top';

export default function VerseRoadScreen({ state }: { state: AppState }) {
  const { memoryQueue, handleBack, openVersePage, navigateTo, masteryTouches } = state;
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();

  const plan = { masteryTouches };
  const now = new Date();
  const byStage = useMemo(
    () => groupByStage(memoryQueue, plan, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memoryQueue, masteryTouches]
  );
  const counts = useMemo(() => stageCounts(memoryQueue), [memoryQueue]);

  const open = (g: StageGroup) => openVersePage({ book: g.book, chapter: g.chapter, verses: g.verses, translationId: g.translationId });
  const rail = space(40);
  const lineW = 3;

  /** The rail for one row: the line runs through it, optionally with a marker on it. */
  const Rail = ({ line, marker, half }: { line?: Segment; marker?: React.ReactNode; half?: 'top' | 'bottom' }) => (
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
  const topGroups = byStage.secure;
  const keptGroups = byStage.kept;
  const topCount = topGroups.reduce((n, g) => n + g.verses.length, 0);
  const Stop = ({ stage, top, above, below }: { stage: VerseStage; top?: boolean; above?: Segment; below?: Segment }) => (
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
          className={`rounded-full items-center justify-center border-4 border-canvas ${fillFor(stage, top)}`}
          // layout-ok: a stop marker holds only an icon.
          style={{ width: stopSize + 8, height: stopSize + 8 }}
        >
          {top && <Check size={Math.round(14 * scale)} color={palette.ink} strokeWidth={3} />}
        </View>
      </View>
      <View className="flex-1" style={{ paddingVertical: space(12), paddingLeft: space(10), gap: space(2) }}>
        <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
          {top ? `${STAGE_LABEL.secure} · ${topCount}` : `${STAGE_LABEL[stage]} · ${counts[stage]}`}
        </AppText>
        <AppText variant="caption" className="font-sans text-ink-2">
          {top ? stageCaption('secure', plan) : stageCaption(stage, plan)}
        </AppText>
      </View>
    </View>
  );

  const note = (g: StageGroup): React.ReactNode => {
    const p = g.progress;
    if (p.stage === 'learning') {
      return (
        <AppText variant="caption" className="font-sans text-ink-2 text-right">
          {p.remaining > 0 ? `${p.remaining} ${p.remaining === 1 ? 'recall' : 'recalls'} to go` : 'Ready to move up'}
        </AppText>
      );
    }
    if (p.step !== null && !p.top && p.movesUpOn && p.movesUpOn.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
      return (
        <AppText variant="caption" className="font-sans font-semibold text-success text-right">
          {LADDER[p.step + 1].label} {dayWord(p.movesUpOn, now)}
        </AppText>
      );
    }
    if (p.catchUp) return <Badge label="Catching up" tone="accent" />;
    if (p.justMovedUp) return <Badge label="Just arrived" tone="accent" />;
    return (
      <AppText variant="caption" className="font-sans text-ink-2 text-right">
        {p.position}
      </AppText>
    );
  };

  const Stretch = ({ stage }: { stage: VerseStage }) => (
    <>
      {(stage === 'kept' ? keptGroups : byStage[stage]).map((g) => {
        const reference = referenceFor(g.book, g.chapter, g.verses);
        return (
          <View key={g.key} className="flex-row items-stretch">
            <Rail
              line={stage}
              marker={
                <View
                  className={`rounded-full bg-surface border-2 ${TICK[stage]}`}
                  // layout-ok: a tick on the road.
                  style={{ width: 10, height: 10 }}
                />
              }
            />
            <Pressable
              onPress={() => open(g)}
              accessibilityRole="button"
              accessibilityLabel={`${reference}, ${STAGE_LABEL[stage]}, ${g.progress.position}${g.items.some((i) => i.slipped) ? ', slipped last time' : ''}`}
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
      {(stage === 'kept' ? keptGroups : byStage[stage]).length === 0 && (
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
          subtitle="Every passage climbs from Learning to Secure. The closer one is to its next step, the higher it sits."
        />

        <View>
          {/* Summit: the top step, every 6 months, for good */}
          <Stop stage="secure" top below="top" />
          {topGroups.length > 0 && (
            <View className="flex-row items-stretch">
              <Rail line="top" />
              <View className="flex-1" style={{ paddingLeft: space(6), paddingBottom: space(8) }}>
                <TopChips groups={topGroups} onPress={open} />
              </View>
            </View>
          )}

          <Stretch stage="kept" />
          <Stop stage="kept" above="kept" below="steady" />
          <Stretch stage="steady" />
          <Stop stage="steady" above="steady" below="settling" />
          <Stretch stage="settling" />
          <Stop stage="settling" above="settling" below="learning" />
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

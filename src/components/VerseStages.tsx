import React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { AppText, useFontScale, useScaledSpace } from './design';
import { Badge } from './blocks';
import { useThemeColors } from './theme';
import { translationLabel } from '../data';
import { STAGE_LABEL, STAGE_ORDER, StageGroup, StagePlan, VerseStage, referenceFor } from '../lib/stageProgress';

// ============================================================================
// The pieces My Verses, the road and the verse page share: a stage's dot, the
// strip of every stage with its count, the bar for how far through a stage a
// verse is, and one verse row. Stage colors are dots and bars only (theme
// rules: Daily and Monthly fail contrast as text), so every label is ink.
// ============================================================================

/** Fill for a stage's dot. Waiting is an empty ring: nothing has started. Complete is gold. */
export const STAGE_FILL: Record<VerseStage, string> = {
  waiting: 'bg-surface border-2 border-ink-3',
  learning: 'bg-stage-learning',
  daily: 'bg-stage-daily',
  weekly: 'bg-stage-weekly',
  monthly: 'bg-stage-monthly',
  complete: 'bg-stage-complete',
};

export function stageCaption(stage: VerseStage, plan: StagePlan): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  switch (stage) {
    case 'waiting':
      return "In the order you'll learn them. Press and hold one to move it.";
    case 'learning':
      return `${plural(plan.masteryTouches, 'perfect recall')}, at least an hour apart, and it moves up to Daily.`;
    case 'daily':
      return `Every day for ${plural(plan.dailyPhaseWeeks, 'week')}.`;
    case 'weekly':
      return `Once a week for ${plural(plan.weeklyPhaseMonths, 'month')}.`;
    case 'monthly':
      return `Once a month for ${plural(plan.monthlyPhaseYears, 'year')}.`;
    case 'complete':
      return 'Done with scheduled reviews. Practice them any time.';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayDiff = (d: Date, now: Date) => {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / DAY_MS);
};

/** "today", "tomorrow", "Thursday" within the week, else "Oct 28". Overdue reads as today. */
export function dayWord(date: Date, now: Date = new Date()): string {
  const diff = dayDiff(date, now);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? null : { year: 'numeric' }),
  });
}

export function StageDot({ stage, size = 10 }: { stage: VerseStage; size?: number }) {
  const scale = useFontScale();
  const d = Math.round(size * Math.min(scale, 1.3));
  // layout-ok: a dot holds no text.
  return <View className={`rounded-full ${STAGE_FILL[stage]}`} style={{ width: d, height: d }} />;
}

/** How far through its stage a verse is. Faded while a refresher has it on hold. */
export function StageBar({ stage, fraction, faded = false, thick = false }: { stage: VerseStage; fraction: number; faded?: boolean; thick?: boolean }) {
  const h = thick ? 8 : 6;
  return (
    // layout-ok: a progress track holds no text.
    <View className="bg-hairline rounded-full overflow-hidden" style={{ height: h }}>
      <View
        className={`rounded-full ${STAGE_FILL[stage]} ${faded ? 'opacity-40' : ''}`}
        // layout-ok: the filled part of the track.
        style={{ height: h, width: `${Math.max(3, Math.round(fraction * 100))}%` }}
      />
    </View>
  );
}

/**
 * Every stage with its count, in road order. A single row with a line through
 * the dots; at large text sizes the six labels can't share one row, so it
 * becomes two rows of three and drops the line.
 */
export function StageStrip({
  counts,
  onPressStage,
  deltas,
}: {
  counts: Record<VerseStage, number>;
  onPressStage?: (stage: VerseStage) => void;
  /** Looking ahead: the change from today under each count ("+25", "−24"). */
  deltas?: Record<VerseStage, number>;
}) {
  const scale = useFontScale();
  const space = useScaledSpace();
  const oneRow = scale <= 1.15;
  const dot = Math.round(14 * Math.min(scale, 1.3));
  return (
    <View style={{ position: 'relative' }}>
      {oneRow && (
        <View
          className="bg-line"
          // layout-ok: the connecting line behind the dots.
          style={{ position: 'absolute', left: '8%', right: '8%', top: dot / 2 - 1, height: 2 }}
        />
      )}
      <View className="flex-row flex-wrap" style={{ rowGap: space(12) }}>
        {STAGE_ORDER.map((stage) => {
          const n = counts[stage];
          return (
            <Pressable
              key={stage}
              onPress={onPressStage ? () => onPressStage(stage) : undefined}
              disabled={!onPressStage}
              accessibilityRole={onPressStage ? 'button' : undefined}
              accessibilityLabel={`${STAGE_LABEL[stage]}: ${n} ${n === 1 ? 'verse' : 'verses'}${deltas && deltas[stage] ? `, ${deltas[stage] > 0 ? 'up' : 'down'} ${Math.abs(deltas[stage])} from today` : ''}`}
              className="items-center active:opacity-60"
              style={{ width: oneRow ? `${100 / 6}%` : `${100 / 3}%`, gap: space(4) }}
            >
              <View
                className={`rounded-full ${STAGE_FILL[stage]} ${stage === 'waiting' ? '' : 'border-[3px] border-surface'}`}
                // layout-ok: a dot holds no text.
                style={{ width: dot, height: dot }}
              />
              <AppText variant="title" className={`font-sans font-bold ${n === 0 ? 'text-ink-3' : 'text-ink'}`}>
                {n}
              </AppText>
              {/* Six labels share a phone's width; on a narrow one the longest
                  ("Complete") shrinks a little rather than being cut off. */}
              <AppText variant="micro" className="font-sans font-medium text-ink-2" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {STAGE_LABEL[stage]}
              </AppText>
              {deltas && (
                // Gains in green; a shrinking count (Waiting emptying out) is
                // progress too, so it's grey rather than red.
                <AppText variant="micro" className={`font-sans font-semibold ${deltas[stage] > 0 ? 'text-success' : 'text-ink-3'}`}>
                  {deltas[stage] === 0 ? ' ' : deltas[stage] > 0 ? `+${deltas[stage]}` : `−${Math.abs(deltas[stage])}`}
                </AppText>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The badges a row can carry, most useful first. */
function rowBadges(group: StageGroup, now: Date): { label: string; tone: 'success' | 'accent' | 'warning' }[] {
  const p = group.progress;
  if (p.refresher) {
    const n = p.refresher.remaining;
    const unit = `${p.refresher.unit}${n === 1 ? '' : 's'}`;
    return [{ label: `Refresher: ${p.refresher.via}, ${n} more ${unit}`, tone: 'warning' }];
  }
  const out: { label: string; tone: 'success' | 'accent' | 'warning' }[] = [];
  if (p.movesUpOn && dayDiff(p.movesUpOn, now) < 7) out.push({ label: `Moves up ${dayWord(p.movesUpOn, now)}`, tone: 'success' });
  else if (p.justMovedUp) out.push({ label: 'Just moved up', tone: 'accent' });
  return out;
}

/**
 * One row on My Verses for a Learning, Daily, Weekly or Monthly verse (or a
 * run of neighbours at the same point). Tapping opens the verse page.
 */
export const VerseStageRow = React.memo(function VerseStageRow({
  group,
  onOpen,
  now,
}: {
  group: StageGroup;
  onOpen: (group: StageGroup) => void;
  now: Date;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const p = group.progress;
  const reference = referenceFor(group.book, group.chapter, group.verses);
  const first = group.items[0];
  const next = first.nextReviewDueDate ? new Date(first.nextReviewDueDate) : null;
  const nextLabel = p.stage !== 'learning' && next ? `Next: ${dayWord(next, now)}` : null;
  const meta = `${translationLabel(group.translationId)}${group.verses.length > 1 ? ` · ${group.verses.length} verses` : ''}`;
  const position = p.refresher ? `${p.position}, on hold` : p.position;
  const badges = rowBadges(group, now);

  return (
    <Pressable
      onPress={() => onOpen(group)}
      accessibilityRole="button"
      accessibilityLabel={[reference, STAGE_LABEL[p.stage], position, nextLabel, ...badges.map((b) => b.label)].filter(Boolean).join('. ')}
      className="flex-row items-center bg-surface border border-line rounded-card active:opacity-70"
      style={{ paddingVertical: space(12), paddingLeft: space(14), paddingRight: space(10), gap: space(10) }}
    >
      <View className="flex-1" style={{ gap: space(7), minWidth: 0 }}>
        <View className="flex-row flex-wrap items-baseline" style={{ columnGap: space(8), rowGap: space(2) }}>
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {reference}
          </AppText>
          <AppText variant="micro" className="font-sans font-medium text-ink-3">
            {meta}
          </AppText>
          {nextLabel && (
            <AppText variant="caption" className="font-sans text-ink-2 ml-auto">
              {nextLabel}
            </AppText>
          )}
        </View>

        {p.stage === 'learning' ? (
          <>
            <AppText variant="caption" className="font-serif text-ink-2" numberOfLines={1}>
              {first.text}
            </AppText>
            <View className="flex-row items-center" style={{ gap: space(8) }}>
              {p.steps && <LearningDots done={p.steps.done} total={p.steps.total} />}
              <AppText variant="caption" className="font-sans text-ink-2">
                {p.position}
              </AppText>
            </View>
          </>
        ) : (
          <>
            <StageBar stage={p.stage} fraction={p.fraction} faded={!!p.refresher} />
            <View className="flex-row flex-wrap items-center" style={{ gap: space(8) }}>
              <AppText variant="caption" className="font-sans text-ink-2">
                {position}
              </AppText>
              {badges.map((b) => (
                <Badge key={b.label} label={b.label} tone={b.tone} />
              ))}
            </View>
          </>
        )}
      </View>
      <ChevronRight size={Math.round(18 * scale)} color={palette.ink3} />
    </Pressable>
  );
});

/** Filled for each perfect recall banked, hollow for each still needed. */
export function LearningDots({ done, total }: { done: number; total: number }) {
  const space = useScaledSpace();
  const d = Math.max(8, Math.round(space(9)));
  return (
    <View className="flex-row" style={{ gap: space(4) }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          className={`rounded-full ${i < done ? 'bg-stage-learning' : 'bg-surface border-2 border-stage-learning'}`}
          // layout-ok: a dot holds no text.
          style={{ width: d, height: d }}
        />
      ))}
    </View>
  );
}

/** Complete verses as compact chips, so a long list of them stays short. */
export const CompleteChips = React.memo(function CompleteChips({ groups, onPress }: { groups: StageGroup[]; onPress: (group: StageGroup) => void }) {
  const space = useScaledSpace();
  return (
    <View className="bg-surface border border-line rounded-card flex-row flex-wrap" style={{ padding: space(12), gap: space(8) }}>
      {groups.map((g) => {
        const reference = referenceFor(g.book, g.chapter, g.verses);
        return (
          <Pressable
            key={g.key}
            onPress={() => onPress(g)}
            accessibilityRole="button"
            accessibilityLabel={`${reference}, complete`}
            className="flex-row items-center bg-surface-2 border border-line rounded-btn active:opacity-70"
            style={{ paddingHorizontal: space(10), paddingVertical: space(6), gap: space(6) }}
          >
            <StageDot stage="complete" size={8} />
            <AppText variant="caption" className="font-sans font-medium text-ink">
              {reference}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
});

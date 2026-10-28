import React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { AppText, useFontScale, useScaledSpace } from './design';
import { Badge } from './blocks';
import { useThemeColors } from './theme';
import { translationLabel } from '../data';
import { STAGE_LABEL, STAGE_ORDER, StageGroup, StagePlan, VerseStage, referenceFor } from '../lib/stageProgress';
import { LADDER_GROUPS } from '../lib/ladder';

// ============================================================================
// The pieces My Verses, the road and the verse page share: a group's dot, the
// strip of every group with its count, the bar for how far through a step a
// verse is, and one passage row. Stage colors are dots and bars only (theme
// rules: Settling and Kept fail contrast as text), so every label is ink.
// The top step (every 6 months) is its own cool "platinum" fill.
// ============================================================================

/** Fill for a group's dot. Waiting is an empty ring: nothing has started. */
export const STAGE_FILL: Record<VerseStage, string> = {
  waiting: 'bg-surface border-2 border-ink-3',
  learning: 'bg-stage-learning',
  settling: 'bg-stage-daily',
  steady: 'bg-stage-weekly',
  kept: 'bg-stage-complete',
  secure: 'bg-stage-top border border-stage-top-edge',
};

/** Fill for the top step (Secure): a cool platinum with a thin edge. */
export const TOP_FILL = 'bg-stage-top border border-stage-top-edge';

export const fillFor = (stage: VerseStage, top?: boolean) => (top ? TOP_FILL : STAGE_FILL[stage]);

export function stageCaption(stage: VerseStage, plan: StagePlan): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  switch (stage) {
    case 'waiting':
      return "In the order you'll learn them. Press and hold one to move it.";
    case 'learning':
      return `${plural(plan.masteryTouches, 'perfect recall')}, at least an hour apart, and it joins Settling.`;
    case 'settling':
    case 'steady':
    case 'kept':
    case 'secure':
      return `${LADDER_GROUPS[stage].description}.`;
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

export function StageDot({ stage, size = 10, top }: { stage: VerseStage; size?: number; top?: boolean }) {
  const scale = useFontScale();
  const d = Math.round(size * Math.min(scale, 1.3));
  // layout-ok: a dot holds no text.
  return <View className={`rounded-full ${fillFor(stage, top)}`} style={{ width: d, height: d }} />;
}

/** How far through its step a passage is. */
export function StageBar({ stage, fraction, top = false, thick = false }: { stage: VerseStage; fraction: number; top?: boolean; thick?: boolean }) {
  const h = thick ? 8 : 6;
  return (
    // layout-ok: a progress track holds no text.
    <View className="bg-hairline rounded-full overflow-hidden" style={{ height: h }}>
      <View
        className={`rounded-full ${fillFor(stage, top)}`}
        // layout-ok: the filled part of the track.
        style={{ height: h, width: `${Math.max(3, Math.round(fraction * 100))}%` }}
      />
    </View>
  );
}

/**
 * Every group with its count, in ladder order. A single row with a line
 * through the dots; at large text sizes the five labels can't share one row,
 * so it becomes two rows of three and drops the line.
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
              {/* Five labels share a phone's width; on a narrow one the longest
                  ("Learning") shrinks a little rather than being cut off. */}
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

/** Learned stages first, Waiting last: the grey remainder of the bar. */
const BAR_ORDER: VerseStage[] = ['learning', 'settling', 'steady', 'kept', 'secure', 'waiting'];

/**
 * Every stage as one slim bar, each stage as wide as its count. The counts
 * themselves live in the stage headers below, so the bar carries no text.
 */
export function StageCountBar({ counts }: { counts: Record<VerseStage, number> }) {
  return (
    // layout-ok: a progress bar holds no text.
    <View className="flex-row" style={{ gap: 2 }}>
      {BAR_ORDER.filter((s) => counts[s] > 0).map((s) => (
        <View
          key={s}
          className={`rounded-full ${s === 'waiting' ? 'bg-line-strong' : s === 'secure' ? 'bg-stage-top' : STAGE_FILL[s]}`}
          // layout-ok: a segment of the bar.
          style={{ flex: counts[s], height: 8, minWidth: 6 }}
        />
      ))}
    </View>
  );
}

/**
 * A stage's heading on My Verses. Tapping it opens or closes the stage's
 * rows; the chevron says which. A stage with reviews due carries a small
 * "n due" badge, so a closed stage still tells you where today's work is.
 */
export function StageSectionHeader({
  stage,
  title,
  count,
  due,
  open,
  onToggle,
}: {
  stage: VerseStage;
  title: string;
  count: number;
  due: number;
  open: boolean;
  onToggle: () => void;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}, ${count} ${count === 1 ? 'verse' : 'verses'}${due > 0 ? `, ${due} due` : ''}`}
      className="flex-row items-center bg-surface border border-line rounded-card active:opacity-70"
      style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(10) }}
    >
      <StageDot stage={stage} />
      <AppText variant="title" className="font-sans font-bold text-ink flex-1">
        {title}
      </AppText>
      {due > 0 && <Badge label={`${due} due`} tone="accent" />}
      <AppText variant="label" className="font-sans font-semibold text-ink-2">
        {count}
      </AppText>
      <Chevron size={Math.round(18 * scale)} color={palette.ink3} />
    </Pressable>
  );
}

/** The badges a row can carry, most useful first. */
function rowBadges(group: StageGroup, now: Date): { label: string; tone: 'success' | 'accent' | 'warning' }[] {
  const p = group.progress;
  const out: { label: string; tone: 'success' | 'accent' | 'warning' }[] = [];
  if (p.catchUp) out.push({ label: 'Catching up', tone: 'accent' });
  if (p.movesUpOn && dayDiff(p.movesUpOn, now) < 7) out.push({ label: `Moves up ${dayWord(p.movesUpOn, now)}`, tone: 'success' });
  else if (p.justMovedUp && !p.catchUp) out.push({ label: 'Just moved up', tone: 'accent' });
  return out;
}

/** Verse numbers in a group that slipped in the passage's last review, as "verse 3" / "verses 3, 5". */
export function slippedNote(group: Pick<StageGroup, 'items'>): string | null {
  const nums = group.items.filter((i) => i.slipped).map((i) => i.verseNumber);
  if (nums.length === 0) return null;
  return `${nums.length === 1 ? 'Verse' : 'Verses'} ${nums.join(', ')} slipped last time`;
}

/**
 * The weak-spot dot: a small warning-colored ring, a hint and never a score.
 * A ring, not a filled dot, so it can't be mistaken for a status dot (the
 * chapter page's Learning dot is the same amber).
 */
export function WeakSpotDot({ size = 8 }: { size?: number }) {
  const scale = useFontScale();
  const d = Math.round(size * Math.min(scale, 1.3));
  // layout-ok: a dot holds no text.
  return <View className="rounded-full bg-surface border-2 border-warning" style={{ width: d, height: d }} />;
}

/**
 * One row on My Verses for a Learning verse or a passage (a run of
 * neighbours at the same point on the ladder). Tapping opens the verse page.
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
  const position = p.position;
  const badges = rowBadges(group, now);
  const slipped = slippedNote(group);

  return (
    <Pressable
      onPress={() => onOpen(group)}
      accessibilityRole="button"
      accessibilityLabel={[reference, STAGE_LABEL[p.stage], position, nextLabel, slipped, group.joins, ...badges.map((b) => b.label)].filter(Boolean).join('. ')}
      className="flex-row items-center bg-surface border border-line rounded-card active:opacity-70"
      style={{ paddingVertical: space(12), paddingLeft: space(14), paddingRight: space(10), gap: space(10) }}
    >
      <View className="flex-1" style={{ gap: space(7), minWidth: 0 }}>
        <View className="flex-row flex-wrap items-baseline" style={{ columnGap: space(8), rowGap: space(2) }}>
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {reference}
          </AppText>
          {slipped && <WeakSpotDot />}
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
            {group.joins && (
              <AppText variant="caption" className="font-sans text-ink-2">
                {group.joins}
              </AppText>
            )}
          </>
        ) : (
          <>
            <StageBar stage={p.stage} fraction={p.fraction} top={p.top} />
            <View className="flex-row flex-wrap items-center" style={{ gap: space(8) }}>
              <AppText variant="caption" className="font-sans text-ink-2">
                {position}
              </AppText>
              {badges.map((b) => (
                <Badge key={b.label} label={b.label} tone={b.tone} />
              ))}
            </View>
            {slipped && (
              <AppText variant="caption" className="font-sans text-ink-2">
                {slipped}
              </AppText>
            )}
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

/** Verses on the top step (every 6 months) as compact chips, so a long list of them stays short. */
export const TopChips = React.memo(function TopChips({ groups, onPress }: { groups: StageGroup[]; onPress: (group: StageGroup) => void }) {
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
            accessibilityLabel={`${reference}, every 6 months${g.items.some((i) => i.slipped) ? ', slipped last time' : ''}`}
            className="flex-row items-center bg-surface-2 border border-line rounded-btn active:opacity-70"
            style={{ paddingHorizontal: space(10), paddingVertical: space(6), gap: space(6) }}
          >
            <StageDot stage="kept" top size={8} />
            <AppText variant="caption" className="font-sans font-medium text-ink">
              {reference}
            </AppText>
            {g.items.some((i) => i.slipped) && <WeakSpotDot size={6} />}
          </Pressable>
        );
      })}
    </View>
  );
});

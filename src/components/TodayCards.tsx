import { Pressable, View } from 'react-native';
import { X } from 'lucide-react-native';

import type { QueueItem } from '../types';
import type { FirmUpItem, WelcomeBack } from '../lib/todayCards';
import type { CalendarDayProjection } from '../lib/ladderCalendar';
import type { LadderGroup } from '../lib/ladder';
import { AppButton, AppIconButton, AppText, CollapsibleCard, useScaledSpace } from './design';
import { useThemeColors } from './theme';

// ============================================================================
// TODAY'S LADDER CARDS (REVIEW_LADDER_PLAN.md stage 7)
// ----------------------------------------------------------------------------
// "Welcome back" after time away, and the Firm-up item that wins back a review
// after a slip, and the collapsible Next 7 days. Plain props, so the demo
// harness can drive them.
// ============================================================================

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function WelcomeBackCard({ data, onDismiss }: { data: WelcomeBack; onDismiss: () => void }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const spreadOver = data.days.length;
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
      <View style={{ gap: space(4) }}>
        <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
          <AppText variant="title" className="font-sans font-bold text-ink flex-1">
            Welcome back
          </AppText>
          {/* Dismiss: the card is information, not a task, so it closes where the eye lands. */}
          <AppIconButton Icon={X} variant="bare" diameter={32} iconColor={palette.ink3} accessibilityLabel="Dismiss welcome back" onPress={onDismiss} />
        </View>
        <AppText variant="label" className="font-sans text-ink-2">
          {`Some reviews piled up while you were away. We've spread ${plural(data.verses, 'verse')} over ${spreadOver === 1 ? 'today' : `the next ${spreadOver} days`} so no day is too much. The ones you review most often come first.`}
        </AppText>
      </View>
      <View style={{ gap: space(6) }}>
        {data.days.map((d) => (
          <View key={d.day} className="flex-row flex-wrap items-baseline justify-between" style={{ columnGap: space(8), rowGap: space(2) }}>
            <AppText variant="label" className="font-sans font-medium text-ink">
              {d.label}
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {`${plural(d.passages, 'passage')} · ${plural(d.verses, 'verse')}`}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

export function FirmUpCard({
  items,
  onStart,
}: {
  items: FirmUpItem[];
  /** Practice these verses; saying them all clean wins the review back. */
  onStart: (verses: QueueItem[]) => void;
}) {
  const space = useScaledSpace();
  if (items.length === 0) return null;
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
      <View style={{ gap: space(2) }}>
        <AppText variant="title" className="font-sans font-bold text-ink">
          Win back a review
        </AppText>
        <AppText variant="label" className="font-sans text-ink-2">
          A short second try at what slipped last time.
        </AppText>
      </View>
      {items.map((item, i) => (
        <View key={item.title} className={i === 0 ? '' : 'border-t border-hairline'} style={{ paddingTop: i === 0 ? 0 : space(10), gap: space(8) }}>
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {item.title}
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            {item.line}
          </AppText>
          <AppButton size="sm" variant="secondary" label="Firm up" onPress={() => onStart(item.verses)} />
        </View>
      ))}
    </View>
  );
}

// ----------------------------------------------------------------------------
// Next 7 days
// ----------------------------------------------------------------------------

const BAR_FILL: Record<LadderGroup | 'learning', string> = {
  settling: 'bg-stage-daily',
  steady: 'bg-stage-weekly',
  kept: 'bg-stage-complete',
  secure: 'bg-stage-top',
  learning: 'bg-stage-learning',
};
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const GROUPS: LadderGroup[] = ['settling', 'steady', 'kept', 'secure'];

/** How heavy the heaviest day is against the rest, for the one-line note; null when nothing stands out. */
export function heaviestDay(days: readonly CalendarDayProjection[]): CalendarDayProjection | null {
  const busy = days.filter((d) => !d.isSabbath && !d.isPaused && d.minutes > 0);
  if (busy.length < 2) return null;
  const avg = busy.reduce((n, d) => n + d.minutes, 0) / busy.length;
  const top = busy.reduce((best, d) => (d.minutes > best.minutes ? d : best), busy[0]);
  return top.minutes >= avg * 1.5 && top.minutes >= avg + 3 ? top : null;
}

/**
 * The week ahead as a small chart, folded away under "Listen to all of today's
 * verses": today is the point of the screen, the week ahead is for the curious.
 * One bar a day, stacked by where each passage sits on the ladder.
 */
export function NextSevenDays({ days, onOpenCalendar }: { days: readonly CalendarDayProjection[]; onOpenCalendar: () => void }) {
  const space = useScaledSpace();
  const week = days.slice(0, 7);
  const max = Math.max(1, ...week.map((d) => d.minutes));
  const active = week.filter((d) => !d.isSabbath && !d.isPaused);
  const avg = active.length > 0 ? Math.round(active.reduce((n, d) => n + d.minutes, 0) / active.length) : 0;
  const heavy = heaviestDay(week);
  const heavyName = heavy ? DAY_LONG[heavy.date.getDay()] : null;
  // Short on purpose: the title and summary share the header row (the heaviest day is named inside).
  const summary = `about ${avg} min a day`;
  const CHART_H = 96;
  return (
    <CollapsibleCard storageKey="home.next7" title="Next 7 days" summary={summary} defaultCollapsed>
      <View className="flex-row items-end" style={{ gap: space(8), height: CHART_H }}>
        {week.map((d, i) => {
          const reviewMinutes = GROUPS.reduce((n, g) => n + d.groupSeconds[g], 0) / 60;
          const learning = Math.max(0, d.minutes - reviewMinutes);
          const h = d.isSabbath || d.minutes === 0 ? 3 : Math.max(8, Math.round((d.minutes / max) * CHART_H));
          return (
            <View
              key={d.date.toISOString()}
              accessibilityLabel={`${i === 0 ? 'Today' : DAY_LONG[d.date.getDay()]}, ${d.isSabbath ? 'Sabbath, no reviews' : `about ${d.minutes} minutes`}`}
              className={`flex-1 rounded-sm overflow-hidden ${d.isSabbath || d.minutes === 0 ? 'bg-hairline' : ''} ${heavy === d ? 'border-2 border-warning' : ''}`}
              // layout-ok: a chart bar holds no text.
              style={{ height: h }}
            >
              {/* Top to bottom: the groups furthest along, then Settling, then Learning. */}
              {GROUPS.slice()
                .reverse()
                .map((g) => (d.groupSeconds[g] > 0 ? <View key={g} className={BAR_FILL[g]} style={{ flex: d.groupSeconds[g] / 60 }} /> : null))}
              {learning > 0 ? <View className={BAR_FILL.learning} style={{ flex: learning }} /> : null}
            </View>
          );
        })}
      </View>
      <View className="flex-row" style={{ gap: space(8) }}>
        {week.map((d, i) => (
          <AppText key={d.date.toISOString()} variant="micro" className="font-sans text-ink-3 flex-1 text-center" numberOfLines={1}>
            {i === 0 ? 'Today' : DAY_SHORT[d.date.getDay()]}
          </AppText>
        ))}
      </View>
      {heavy && heavyName ? (
        <AppText variant="caption" className="font-sans text-ink-2">
          {heavyName} is your heaviest day, about {heavy.minutes} minutes: several reviews land together.
        </AppText>
      ) : null}
      <Pressable onPress={onOpenCalendar} accessibilityRole="link" hitSlop={8} className="self-start active:opacity-60">
        <AppText variant="label" className="font-sans font-semibold text-accent">
          See the full calendar
        </AppText>
      </Pressable>
    </CollapsibleCard>
  );
}

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppState } from '../state/useAppState';
import type { CalendarDayProjection } from '../lib/ladderCalendar';
import { useCalendarDays } from '../state/useCalendarDays';
import { LADDER, LADDER_GROUPS, type LadderGroup } from '../lib/ladder';
import { FadeInView } from '../components/ui';
import { AppText, useScaledSpace } from '../components/design';
import { Dialog, GroupedList, ListRow, ScreenHeader } from '../components/blocks';
import { VersesTabs } from '../components/VersesTabs';
import { heaviestDay } from '../components/TodayCards';

// MEMORY CALENDAR -- the Verses tab's Calendar section: the next two weeks as
// a list, one row a day. Bar length is how long the day takes, split by where
// each passage sits on the ladder. Tap a day for its passages. Every date is
// the ladder played forward assuming each review goes well (ladderCalendar.ts).

const DAYS_AHEAD = 14;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const GROUP_FILL: Record<LadderGroup | 'learning', string> = {
  settling: 'bg-stage-daily',
  steady: 'bg-stage-weekly',
  kept: 'bg-stage-complete',
  secure: 'bg-stage-top',
  learning: 'bg-stage-learning',
};
const GROUP_ORDER: LadderGroup[] = ['settling', 'steady', 'kept', 'secure'];

const shortDay = (d: Date, i: number) => (i === 0 ? 'Today' : `${DAY_NAMES[d.getDay()]} ${d.getDate()}`);
const longDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const minutesWord = (m: number) => `${m} min`;

function versesLabel(first: number, last: number) {
  return first === last ? `${first}` : `${first}–${last}`;
}

export default function MemoryCalendarScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { navigateTo, switchVersesTab, joinedGroupPlanDetails } = state;

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const days = useCalendarDays(state, DAYS_AHEAD);

  const totals = useMemo(() => {
    const reviews = days.reduce((n, d) => n + d.dueReviews.length, 0);
    const minutes = days.reduce((n, d) => n + d.minutes, 0);
    const busy = days.filter((d) => !d.isSabbath && !d.isPaused && d.minutes > 0);
    const max = Math.max(1, ...days.map((d) => d.minutes));
    // The heavy day is one that clearly stands out, not simply the biggest.
    const heavy = heaviestDay(days);
    // Days after today with the least on them, for starting something new.
    const light = [...busy.slice(1)].sort((a, b) => a.minutes - b.minutes || a.date.getTime() - b.date.getTime()).slice(0, 2);
    return { reviews, minutes, max, heavy, light };
  }, [days]);

  const selected = selectedIdx != null ? days[selectedIdx] : null;
  const openChapter = (book: string, chapter: number) => {
    setSelectedIdx(null);
    navigateTo('chapterLanding', book, chapter, { keepBack: true });
  };

  const newGroups = useMemo(() => {
    if (!selected) return [] as { key: string; label: string; book: string; chapter: number; plan?: string }[];
    const out: { key: string; label: string; book: string; chapter: number; plan?: string }[] = [];
    const items = [...selected.newVerseItems].sort((a, b) => (a.book === b.book && a.chapter === b.chapter ? a.verseNumber - b.verseNumber : `${a.book}${a.chapter}`.localeCompare(`${b.book}${b.chapter}`)));
    let last: { book: string; chapter: number; first: number; lastVerse: number; plan?: string } | null = null;
    const flush = () => {
      if (last) out.push({ key: `${last.book}${last.chapter}:${last.first}`, book: last.book, chapter: last.chapter, label: `${last.book} ${last.chapter}:${versesLabel(last.first, last.lastVerse)}`, plan: last.plan });
    };
    for (const item of items) {
      const plan = item.originPlanId ? joinedGroupPlanDetails.find((p) => p.planId === item.originPlanId)?.name : undefined;
      if (last && last.book === item.book && last.chapter === item.chapter && last.lastVerse === item.verseNumber - 1 && last.plan === plan) {
        last.lastVerse = item.verseNumber;
      } else {
        flush();
        last = { book: item.book, chapter: item.chapter, first: item.verseNumber, lastVerse: item.verseNumber, plan };
      }
    }
    flush();
    return out;
  }, [selected, joinedGroupPlanDetails]);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }}>
        {/* A tab of the Verses section, so no back link. */}
        <ScreenHeader title="Verses" />
        <VersesTabs value="memoryCalendar" onChange={switchVersesTab} />

        <AppText variant="label" className="font-sans text-ink-2">
          The next two weeks. Bar length is how long that day takes. Tap a day to see its passages. If every review goes well; a late
          one moves a passage back, so treat this as a preview, not a promise.
        </AppText>

        <View className="flex-row" style={{ gap: space(8) }}>
          <View className="flex-1 bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(2) }}>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {totals.reviews}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-2">
              reviews in 2 weeks
            </AppText>
          </View>
          <View className="flex-1 bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(2) }}>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {minutesWord(totals.minutes)}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-2">
              in total
            </AppText>
          </View>
        </View>

        <View className="bg-surface border border-line rounded-card overflow-hidden">
          {days.map((d, i) => {
            const heavy = totals.heavy === d;
            const reviewMinutes = GROUP_ORDER.reduce((n, g) => n + d.groupSeconds[g], 0) / 60;
            const learningMinutes = Math.max(0, d.minutes - reviewMinutes);
            const barPct = Math.max(4, Math.round((d.minutes / totals.max) * 100));
            return (
              <Pressable
                key={d.date.toISOString()}
                onPress={() => setSelectedIdx(i)}
                accessibilityRole="button"
                accessibilityLabel={
                  d.isSabbath
                    ? `${longDay(d.date)}, Sabbath, no reviews`
                    : `${longDay(d.date)}, ${d.dueReviews.length} ${d.dueReviews.length === 1 ? 'review' : 'reviews'}, about ${minutesWord(d.minutes)}${heavy ? ', your heaviest day' : ''}`
                }
                className={`flex-row items-center active:opacity-70 ${i > 0 ? 'border-t border-hairline' : ''} ${heavy ? 'bg-warning-soft' : ''}`}
                style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(10), minHeight: 48 }}
              >
                <AppText variant="label" className={`font-sans ${i === 0 ? 'font-bold' : ''} ${d.isSabbath ? 'text-ink-3' : 'text-ink'}`} style={{ width: space(58) }}>
                  {shortDay(d.date, i)}
                </AppText>
                {d.isSabbath ? (
                  <AppText variant="caption" className="font-sans text-ink-3 flex-1">
                    Sabbath, no reviews
                  </AppText>
                ) : d.isPaused ? (
                  <AppText variant="caption" className="font-sans text-ink-3 flex-1">
                    Paused
                  </AppText>
                ) : (
                  <>
                    <View className="flex-1">
                      {/* layout-ok: a stacked bar holds no text. */}
                      <View className="flex-row" style={{ width: `${barPct}%`, height: 12, gap: 2 }}>
                        {GROUP_ORDER.map((g) =>
                          d.groupSeconds[g] > 0 ? <View key={g} className={`rounded-sm ${GROUP_FILL[g]}`} style={{ flex: d.groupSeconds[g] / 60 }} /> : null
                        )}
                        {learningMinutes > 0 ? <View className={`rounded-sm ${GROUP_FILL.learning}`} style={{ flex: learningMinutes }} /> : null}
                      </View>
                    </View>
                    <AppText variant="caption" className={`font-sans text-right ${heavy ? 'text-warning font-semibold' : 'text-ink-2'}`} style={{ minWidth: space(72) }}>
                      {d.dueReviews.length} · {minutesWord(d.minutes)}
                    </AppText>
                  </>
                )}
              </Pressable>
            );
          })}
        </View>

        <View className="flex-row flex-wrap" style={{ columnGap: space(14), rowGap: space(4), paddingHorizontal: space(4) }}>
          {([...GROUP_ORDER.filter((g) => g !== 'secure'), 'secure', 'learning'] as (LadderGroup | 'learning')[]).map((g) => (
            <View key={g} className="flex-row items-center" style={{ gap: space(6) }}>
              {/* layout-ok: a legend dot holds no text. */}
              <View className={`rounded-full ${GROUP_FILL[g]}`} style={{ width: 8, height: 8 }} />
              <AppText variant="caption" className="font-sans text-ink-2">
                {g === 'learning' ? 'Learning' : LADDER_GROUPS[g].name}
              </AppText>
            </View>
          ))}
        </View>

        {totals.light.length > 0 && (
          <View className="bg-success-soft rounded-card" style={{ padding: space(12) }}>
            <AppText variant="label" className="font-sans text-success">
              Lightest days: {totals.light.map((d) => shortDay(d.date, days.indexOf(d))).join(' and ')}. Good days to start a new chapter.
            </AppText>
          </View>
        )}
      </ScrollView>

      {/* One day's detail. */}
      <Dialog
        visible={selected != null}
        onClose={() => setSelectedIdx(null)}
        placement="sheet"
        title={selected ? longDay(selected.date) : ''}
        message={selected?.isSabbath ? 'Sabbath. Nothing is scheduled.' : selected?.isPaused ? 'Reviews are paused.' : undefined}
      >
        {selected && !selected.isSabbath && (
          <>
            {selected.dueReviews.length > 0 && (
              <GroupedList header={`Due for review · about ${minutesWord(selected.minutes)}`}>
                {selected.dueReviews.map((r) => (
                  <ListRow
                    key={r.key}
                    title={r.label}
                    subtitle={`${LADDER_GROUPS[r.group].name} · ${LADDER[r.step].label}${r.need ? ` · review ${r.reviews + 1} of ${r.need}` : ', for good'}`}
                    onPress={() => openChapter(r.book, r.chapter)}
                  />
                ))}
              </GroupedList>
            )}

            {/* The specific verses this day's pull would start, not just how
                many. The projection runs the real computeDailyPull forward,
                so this also reflects any joined group plans and their
                priority. */}
            {newGroups.length > 0 && (
              <GroupedList header="Starting this day">
                {newGroups.map((g) => (
                  <ListRow key={g.key} title={g.label} value={g.plan} onPress={() => openChapter(g.book, g.chapter)} />
                ))}
              </GroupedList>
            )}

            {selected.learningCount > 0 && (
              <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
                Plus {selected.learningCount} {selected.learningCount === 1 ? 'verse' : 'verses'} you're learning, which aren't tied to a day.
              </AppText>
            )}

            {selected.dueReviews.length === 0 && newGroups.length === 0 && selected.learningCount === 0 && (
              <AppText variant="label" className="font-sans text-ink-3">
                Nothing scheduled this day.
              </AppText>
            )}
          </>
        )}
      </Dialog>
    </FadeInView>
  );
}

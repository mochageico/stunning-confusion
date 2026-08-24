import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView, HelpTooltip } from '../components/ui';
import { AppIconButton, AppText } from '../components/design';

// Streak/memorized-count thresholds for the milestone badges section --
// purely derived from existing counts (memoryStreak/memorizedCount), no
// new persistence needed.
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 365];
const MEMORIZED_MILESTONES = [5, 10, 25, 50, 100, 250, 500];

// A retained set can run to hundreds of verses; rendering every chip into a
// horizontal ScrollView would cost more than anyone scrolls through. Show a
// generous prefix and count the rest.
const MAX_CHIPS_PER_ROW = 60;

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
  if (hours === 0 && minutes === 0) return '0m';
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function DashboardScreen({ state }: { state: AppState }) {
  const { handleBack, navigateTo, memoryQueue, memorizedCount, learningCount, memoryStreak, totalStudySeconds, activityLast90Days } = state;

  const totalReviewsCompleted = memoryQueue.reduce((sum, item) => sum + (item.totalSuccessfulReviews || 0), 0);

  // Each retention row now carries the verses themselves, not just a tally --
  // the count answers "how many?" and the horizontal strip beside it answers
  // "which ones?" without leaving the screen.
  const retentionRows = [
    {
      key: 'learning',
      label: 'Learning',
      accent: 'border-l-violet-500',
      countColor: 'text-violet-600',
      chip: 'bg-violet-50 border-violet-200',
      chipText: 'text-violet-700',
      items: memoryQueue.filter((item) => item.status === 'learning'),
    },
    {
      key: 'daily',
      label: 'Daily',
      accent: 'border-l-emerald-500',
      countColor: 'text-emerald-600',
      chip: 'bg-emerald-50 border-emerald-200',
      chipText: 'text-emerald-700',
      items: memoryQueue.filter((item) => item.status === 'reviewing' && item.retentionPhase === 'daily'),
    },
    {
      key: 'weekly',
      label: 'Weekly',
      accent: 'border-l-blue-500',
      countColor: 'text-blue-600',
      chip: 'bg-blue-50 border-blue-200',
      chipText: 'text-blue-700',
      items: memoryQueue.filter((item) => item.status === 'reviewing' && item.retentionPhase === 'weekly'),
    },
    {
      key: 'monthly',
      label: 'Monthly',
      accent: 'border-l-amber-500',
      countColor: 'text-amber-600',
      chip: 'bg-amber-50 border-amber-200',
      chipText: 'text-amber-700',
      items: memoryQueue.filter((item) => item.status === 'reviewing' && item.retentionPhase === 'monthly'),
    },
    {
      key: 'completed',
      label: 'Completed',
      accent: 'border-l-teal-500',
      countColor: 'text-teal-600',
      chip: 'bg-teal-50 border-teal-200',
      chipText: 'text-teal-700',
      items: memoryQueue.filter((item) => item.status === 'retained'),
    },
  ];

  const dailyCount = retentionRows[1].items.length;
  const weeklyCount = retentionRows[2].items.length;
  const monthlyCount = retentionRows[3].items.length;

  // "Verses Memorized" means verses learned -- anything that's graduated out
  // of the initial Learning phase into spaced review (any of Daily/Weekly/
  // Monthly) or fully Completed, not just the narrower "Completed" count.
  // memorizedCount itself stays retained-only for the retention breakdown's
  // own Completed box below.
  const versesLearnedCount = dailyCount + weeklyCount + monthlyCount + memorizedCount;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 20 }}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={14} iconColor="#262626" onPress={handleBack} className="rounded-full border border-neutral-200 bg-white" />
          <View>
            {/* "Progress Dashboard" was jargon standing in front of a plain
                idea. This screen is the answer to "how am I doing?". */}
            <AppText variant="title" className="font-serif font-black text-[#1A1A1A] leading-none mt-0.5">My Progress</AppText>
          </View>
        </View>

        {/* STAT GRID */}
        <View className="flex-row flex-wrap gap-2.5">
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <AppText variant="display" className="font-black text-[#1A1A1A] font-mono">{versesLearnedCount}</AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">Verses Memorized</AppText>
          </View>
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <AppText variant="display" className="font-black text-amber-600 font-mono">{learningCount}</AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">Verses In Progress</AppText>
          </View>
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <AppText variant="display" className="font-black text-emerald-600 font-mono">{memoryStreak}</AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">Day Streak</AppText>
          </View>
          <View className="flex-1 min-w-[45%] bg-[#F3F2F1]/50 border border-[#E5E5E5] rounded-xl p-3 items-center" style={{ gap: 2 }}>
            <AppText variant="display" className="font-black text-indigo-600 font-mono">{totalReviewsCompleted}</AppText>
            <AppText variant="micro" className="font-bold text-neutral-400 uppercase tracking-wide">Reviews Completed</AppText>
          </View>
        </View>

        {/* TIME STUDIED */}
        <View className="bg-[#1A1A1A] rounded-2xl p-5 items-center" style={{ gap: 4 }}>
          <AppText variant="micro" className="font-sans font-extrabold uppercase tracking-widest text-neutral-400">Time Studied</AppText>
          <AppText variant="display" className="font-black text-white font-mono">{formatStudyTime(totalStudySeconds)}</AppText>
          <AppText variant="micro" className="font-sans text-neutral-500 text-center leading-relaxed">
            Total time with a practice or listen session open.
          </AppText>
        </View>

        {/* RETENTION PHASE BREAKDOWN */}
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center px-1">
            <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">Retention Breakdown</AppText>
            <HelpTooltip text="Where your memorized verses sit in the spaced-repetition cycle. Daily/Weekly/Monthly recur on that cadence; Completed verses have graduated out and no longer recur." />
          </View>
          {/* One row per phase, stacked -- five columns squeezed the numbers
              into a strip too narrow to say anything else. Vertical rows leave
              room beside each count for the verses that make it up, scrolled
              horizontally. */}
          <View style={{ gap: 6 }}>
            {retentionRows.map((row) => {
              const references = summarizeReferences(row.items);
              const shown = references.slice(0, MAX_CHIPS_PER_ROW);
              const overflow = references.length - shown.length;
              return (
                <View
                  key={row.key}
                  className={`flex-row items-stretch border-l-4 ${row.accent} bg-white border border-neutral-200 rounded-lg overflow-hidden`}
                >
                  <View className="px-2.5 py-2.5 items-center justify-center" style={{ minWidth: 82, flexShrink: 0 }}>
                    <AppText variant="title" className={`font-black font-mono ${row.countColor}`}>{row.items.length}</AppText>
                    <AppText variant="micro" className="font-bold text-neutral-400 uppercase">{row.label}</AppText>
                  </View>
                  <View className="flex-1 border-l border-neutral-100 justify-center">
                    {row.items.length === 0 ? (
                      <AppText variant="micro" className="font-sans text-neutral-300 px-3">No verses here yet</AppText>
                    ) : (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center' }}
                      >
                        {shown.map((reference) => (
                          <View key={reference.key} className={`px-2 py-1 rounded-md border ${row.chip}`}>
                            <AppText variant="micro" className={`font-mono font-bold ${row.chipText}`}>
                              {reference.label}
                            </AppText>
                          </View>
                        ))}
                        {overflow > 0 && (
                          <AppText variant="micro" className="font-sans font-bold text-neutral-400 px-1">+{overflow} more</AppText>
                        )}
                      </ScrollView>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* 90-DAY ACTIVITY HEATMAP. Profile carried its own 15-day strip of
            the same data, above the button that led here -- a worse view of a
            thing this screen already shows better. Deleted there; its "View
            Full History" link came along, since that's the only place it was
            reachable from besides the Memory Desk. */}
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center justify-between px-1">
            <View className="flex-row items-center flex-1">
              <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">Past 90 Days</AppText>
              <HelpTooltip text="One square per day. A square fills in on days you banked a mastery touch on a verse you're learning — darker green means more touches that day. Spaced reviews aren't counted here." />
            </View>
            <Pressable onPress={() => navigateTo('fullHistory')} hitSlop={8} className="shrink-0">
              <AppText variant="micro" className="font-sans font-bold underline text-neutral-500">View Full History</AppText>
            </Pressable>
          </View>
          <View className="border border-[#E5E5E5] rounded-xl p-2.5 bg-white">
            <View className="flex-row flex-wrap gap-[3px] justify-center">
              {activityLast90Days.map((item, index) => {
                const color =
                  item.count === 0
                    ? 'bg-[#F3F2F1] border-[#E5E5E5]'
                    : item.count > 6
                      ? 'bg-emerald-600 border-emerald-700'
                      : 'bg-emerald-300 border-emerald-400';
                return <View key={index} style={{ width: '6.2%', height: 16 }} className={`border rounded-sm ${color}`} />;
              })}
            </View>
          </View>
        </View>

        {/* MILESTONE BADGES */}
        <View style={{ gap: 8 }}>
          <View className="flex-row items-center px-1">
            <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">Streak Milestones</AppText>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {STREAK_MILESTONES.map((threshold) => {
              const achieved = memoryStreak >= threshold;
              return (
                <View
                  key={threshold}
                  className={`px-3 py-2 rounded-xl border items-center ${
                    achieved ? 'bg-emerald-50 border-emerald-300' : 'bg-neutral-50 border-neutral-200'
                  }`}
                  style={{ minWidth: 78 }}
                >
                  <AppText variant="body" className={`font-black font-mono ${achieved ? 'text-emerald-700' : 'text-neutral-300'}`}>
                    {threshold}
                  </AppText>
                  <AppText variant="micro" className={`font-bold uppercase tracking-wide ${achieved ? 'text-emerald-700' : 'text-neutral-400'}`}>
                    Day{threshold === 1 ? '' : 's'}
                  </AppText>
                  {!achieved && (
                    <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">{threshold - memoryStreak} to go</AppText>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <View className="flex-row items-center px-1">
            <AppText variant="section" className="font-bold text-neutral-400 tracking-wider font-sans uppercase">Memorized Milestones</AppText>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {MEMORIZED_MILESTONES.map((threshold) => {
              const achieved = versesLearnedCount >= threshold;
              return (
                <View
                  key={threshold}
                  className={`px-3 py-2 rounded-xl border items-center ${
                    achieved ? 'bg-indigo-50 border-indigo-300' : 'bg-neutral-50 border-neutral-200'
                  }`}
                  style={{ minWidth: 78 }}
                >
                  <AppText variant="body" className={`font-black font-mono ${achieved ? 'text-indigo-700' : 'text-neutral-300'}`}>
                    {threshold}
                  </AppText>
                  <AppText variant="micro" className={`font-bold uppercase tracking-wide ${achieved ? 'text-indigo-700' : 'text-neutral-400'}`}>
                    Verses
                  </AppText>
                  {!achieved && (
                    <AppText variant="micro" className="font-sans text-neutral-400 mt-0.5">{threshold - versesLearnedCount} to go</AppText>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

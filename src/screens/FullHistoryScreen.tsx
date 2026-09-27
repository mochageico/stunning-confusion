import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { BookPicker } from '../components/BookPicker';
import { Dropdown } from '../components/Dropdown';
import { AppText, useScaledSpace } from '../components/design';
import { EmptyState, ScreenHeader, SectionHeader } from '../components/blocks';

import { formatDate } from '../lib/format';

// A dropdown rather than a row of chips: four date ranges in chips truncated
// to "Last 30 D…" at large text.
const DATE_FILTER_OPTIONS = [
  { id: 'all', label: 'Any time' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
];

type HistoryEntry = { title: string; kind: 'started' | 'memorized'; book: string; date: string };

export default function FullHistoryScreen({ state }: { state: AppState }) {
  const { handleBack, memoryQueue } = state;
  const space = useScaledSpace();
  const [bookFilter, setBookFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('all');

  // Real timeline, derived from the actual memory queue rather than fake
  // sample data: each verse contributes a "started learning" event (from
  // dateStarted) and, once it has come through every review stage, a
  // "memorized" event (dated by its last real review).
  const timelineItems = useMemo<HistoryEntry[]>(() => {
    const items: HistoryEntry[] = [];
    memoryQueue.forEach((item) => {
      const ref = `${item.book} ${item.chapter}:${item.verseNumber}`;
      if (item.dateStarted) {
        items.push({ title: `Started learning ${ref}`, kind: 'started', book: item.book, date: item.dateStarted });
      }
      if (item.status === 'retained') {
        const retainedDate = item.lastReviewDate || item.dateStarted;
        if (retainedDate) {
          items.push({ title: `Memorized ${ref}`, kind: 'memorized', book: item.book, date: retainedDate });
        }
      }
    });
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [memoryQueue]);

  const filteredItems = timelineItems.filter((item) => {
    if (bookFilter && item.book !== bookFilter) return false;
    if (dateFilter !== 'all') {
      const cutoff = new Date(Date.now() - Number(dateFilter) * 24 * 3600 * 1000);
      if (new Date(item.date) < cutoff) return false;
    }
    return true;
  });

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader title="History" onBack={handleBack} />

        {/* Filters: side by side, wrapping one above the other at large text. */}
        <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
          <View style={{ flexGrow: 1, flexBasis: space(150), gap: space(4) }}>
            <AppText variant="caption" className="font-sans font-medium text-ink-2">
              Book
            </AppText>
            <BookPicker value={bookFilter} allowAll allLabel="All books" onChange={setBookFilter} />
          </View>
          <View style={{ flexGrow: 1, flexBasis: space(150), gap: space(4) }}>
            <AppText variant="caption" className="font-sans font-medium text-ink-2">
              When
            </AppText>
            <Dropdown
              value={dateFilter}
              onChange={setDateFilter}
              options={DATE_FILTER_OPTIONS}
              title="When"
              searchable={false}
            />
          </View>
        </View>

        {filteredItems.length === 0 ? (
          <EmptyState
            title={timelineItems.length === 0 ? 'Nothing here yet' : 'Nothing matches'}
            message={
              timelineItems.length === 0
                ? 'Verses show up here when you start learning them, and again once they are memorized for good.'
                : 'Try another book or a longer time range.'
            }
          />
        ) : (
          <View style={{ gap: space(6) }}>
            <SectionHeader title={`${filteredItems.length} ${filteredItems.length === 1 ? 'event' : 'events'}`} />
            {/* A timeline: a dot per event on a thin rule down the left. */}
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(14) }}>
              <View className="border-l border-line" style={{ paddingLeft: space(16), marginLeft: space(4), gap: space(16) }}>
                {filteredItems.map((item, idx) => (
                  <View key={idx}>
                    <View
                      className={`absolute w-2 h-2 rounded-full ${item.kind === 'memorized' ? 'bg-success' : 'bg-accent'}`}
                      style={{ left: -space(16) - 4.5, top: space(6) }}
                    />
                    <AppText variant="label" className="font-sans font-semibold text-ink">
                      {item.title}
                    </AppText>
                    <AppText variant="caption" className="font-sans text-ink-3">
                      {formatDate(item.date)}
                      {item.kind === 'memorized' ? ' · memorized for good' : ''}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}

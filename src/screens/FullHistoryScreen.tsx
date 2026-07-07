import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { ChipRow, FadeInView } from '../components/ui';
import { BookPicker } from '../components/BookPicker';

const DATE_FILTER_OPTIONS = [
  { id: 'all', label: 'All Time' },
  { id: '7', label: 'Last 7 Days' },
  { id: '30', label: 'Last 30 Days' },
  { id: '90', label: 'Last 90 Days' },
];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

type HistoryEntry = { title: string; subtitle: string; book: string; date: string };

export default function FullHistoryScreen({ state }: { state: AppState }) {
  const { handleBack, triggerToast, memoryQueue } = state;
  const [bookFilter, setBookFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('all');

  // Real timeline, derived from the actual memory queue rather than fake
  // sample data: each verse contributes a "started learning" event (from
  // dateStarted) and, once it graduates all the way through the retention
  // phases, a "memorized" event (dated by its last real review).
  const timelineItems = useMemo<HistoryEntry[]>(() => {
    const items: HistoryEntry[] = [];
    memoryQueue.forEach((item) => {
      const ref = `${item.book} ${item.chapter}:${item.verseNumber}`;
      if (item.dateStarted) {
        items.push({
          title: `Started learning ${ref}`,
          subtitle: `${formatDate(item.dateStarted)} • Added to your active memorization queue`,
          book: item.book,
          date: item.dateStarted,
        });
      }
      if (item.status === 'retained') {
        const retainedDate = item.lastReviewDate || item.dateStarted;
        if (retainedDate) {
          items.push({
            title: `Memorized ${ref}`,
            subtitle: `${formatDate(retainedDate)} • Fully memorized — reached long-term retention`,
            book: item.book,
            date: retainedDate,
          });
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
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: 16 }}>
        {/* Header */}
        <View className="flex-row items-center gap-3 border-b border-neutral-100 pb-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={14} color="#262626" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400 font-sans">
              HISTORY LOGS
            </Text>
            <Text className="text-base font-serif font-bold text-neutral-900 leading-none mt-0.5">
              Full Memorization History
            </Text>
          </View>
        </View>

        {/* Filters Box */}
        <View className="border border-neutral-200 rounded-2xl p-3 bg-neutral-50/50" style={{ gap: 10 }}>
          <View>
            <Text className="text-[8.5px] font-bold text-neutral-400 uppercase tracking-wider mb-1">
              Filter by Scripture
            </Text>
            <BookPicker
              value={bookFilter}
              allowAll
              allLabel="All Books"
              onChange={(name) => {
                setBookFilter(name);
                triggerToast(`Filtered history by: ${(name || 'All Books').toUpperCase()}`);
              }}
            />
          </View>

          <View>
            <Text className="text-[8.5px] font-bold text-neutral-400 uppercase tracking-wider mb-1">
              Filter by Date Range
            </Text>
            <ChipRow
              options={DATE_FILTER_OPTIONS}
              value={dateFilter}
              onChange={(id) => {
                setDateFilter(String(id));
                const label = DATE_FILTER_OPTIONS.find((o) => o.id === id)?.label || String(id);
                triggerToast(`Filtered timeline range: ${label.toUpperCase()}`);
              }}
            />
          </View>
        </View>

        {/* Filtered Timeline List */}
        <View style={{ gap: 10 }}>
          <Text className="text-[10px] font-bold text-neutral-400 tracking-wider font-sans uppercase">
            TIMELINE LOGS
          </Text>

          <View className="border border-neutral-200 rounded-2xl p-4 bg-white shadow-xs">
            {filteredItems.length === 0 ? (
              <Text className="text-xs text-neutral-400 italic text-center py-4">
                {timelineItems.length === 0
                  ? "You haven't started memorizing any verses yet."
                  : 'No history matches these filters.'}
              </Text>
            ) : (
              <View className="relative pl-5 border-l border-neutral-200" style={{ gap: 18 }}>
                {filteredItems.map((item, idx) => (
                  <View key={idx} className="relative">
                    <View
                      className="absolute w-2 h-2 rounded-full bg-emerald-500"
                      style={{ left: -25, top: 6 }}
                    />
                    <Text className="text-xs font-sans font-bold text-neutral-800">{item.title}</Text>
                    <Text className="text-[10px] text-neutral-400 leading-snug mt-0.5">{item.subtitle}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </FadeInView>
  );
}

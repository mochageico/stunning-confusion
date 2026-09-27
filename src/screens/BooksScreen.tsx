import { useState } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppTextInput, useFontScale, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, ScreenHeader } from '../components/blocks';

import { useThemeColors } from '../components/theme';
export default function BooksScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const { BOOKS, handleBack, navigateTo } = state;
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const otBooks = q ? BOOKS.ot.filter((b) => b.name.toLowerCase().includes(q)) : BOOKS.ot;
  const ntBooks = q ? BOOKS.nt.filter((b) => b.name.toLowerCase().includes(q)) : BOOKS.nt;
  const iconSize = Math.round(16 * scale);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: space(20) }}>
        {/* Home is the only way in, so back always goes to Today. */}
        <ScreenHeader title="Verse Finder" onBack={handleBack} backLabel="Today" />

        {/* Search — 66 books is too many to scan without one */}
        <View className="flex-row items-center bg-surface border border-line rounded-btn" style={{ paddingHorizontal: space(12), gap: space(8) }}>
          <Search size={iconSize} color={palette.ink3} />
          <AppTextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search books"
            placeholderTextColor={palette.ink3}
            accessibilityLabel="Search books"
            variant="body"
            className="flex-1 text-ink font-sans"
            style={{ minWidth: 0, paddingVertical: space(10) }}
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <X size={iconSize} color={palette.ink3} />
            </Pressable>
          )}
        </View>

        {otBooks.length > 0 && (
          <GroupedList header="Old Testament">
            {otBooks.map((book) => (
              <ListRow key={book.id} title={book.name} onPress={() => navigateTo('chapters', book.name)} />
            ))}
          </GroupedList>
        )}

        {ntBooks.length > 0 && (
          <GroupedList header="New Testament">
            {ntBooks.map((book) => (
              <ListRow key={book.id} title={book.name} onPress={() => navigateTo('chapters', book.name)} />
            ))}
          </GroupedList>
        )}

        {otBooks.length === 0 && ntBooks.length === 0 && (
          <EmptyState title={`No books match "${query.trim()}"`} message="Check the spelling, or try the first few letters." />
        )}
      </ScrollView>
    </FadeInView>
  );
}

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { BOOKS } from '../data';
import { AppText, useScaledSpace } from '../components/design';
import { EmptyState, ScreenHeader } from '../components/blocks';

export default function ChaptersScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { handleBack, navigateTo, selectedBook } = state;
  // The grid's real width, so tiles can be sized to fill each row exactly.
  const [gridWidth, setGridWidth] = useState(0);

  const allCombinedBooks = [...BOOKS.ot, ...BOOKS.nt];
  const bookData = allCombinedBooks.find((b) => b.name === selectedBook);

  // As many columns as fit at the smallest comfortable tile (which grows with
  // text size), then every tile widened to share the leftover room. Rows
  // start at the left rather than centering: these are numbers in order,
  // read like a calendar, and a centered last row would break the columns.
  const gap = space(8);
  const minTile = space(56);
  const columns = Math.max(1, Math.floor((gridWidth + gap) / (minTile + gap)));
  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - gap * (columns - 1)) / columns) : minTile;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: space(20) }}>
        <ScreenHeader
          title={selectedBook ?? 'Chapters'}
          subtitle={bookData ? `${bookData.chapters} ${bookData.chapters === 1 ? 'chapter' : 'chapters'}` : undefined}
          onBack={handleBack}
          backLabel="Books"
        />

        {!bookData ? (
          <EmptyState title="No chapters to show" message="Go back and pick a book." />
        ) : (
          <View
            className="flex-row flex-wrap"
            style={{ gap }}
            onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
          >
            {Array.from({ length: bookData.chapters }, (_, i) => i + 1).map((chNum) => (
              <Pressable
                key={chNum}
                onPress={() => navigateTo('chapterLanding', selectedBook, chNum)}
                accessibilityRole="button"
                accessibilityLabel={`${selectedBook} ${chNum}`}
                style={{ width: tileWidth, minHeight: space(52) }}
                className="bg-surface border border-line rounded-btn items-center justify-center active:bg-surface-2"
              >
                <AppText variant="title" className="font-sans font-semibold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
                  {chNum}
                </AppText>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </FadeInView>
  );
}

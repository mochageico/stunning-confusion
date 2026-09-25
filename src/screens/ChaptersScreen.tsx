import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { BOOKS } from '../data';
import { AppIconButton, AppText } from '../components/design';

import { useThemeColors } from '../components/theme';
export default function ChaptersScreen({ state }: { state: AppState }) {
  const palette = useThemeColors();
  const { handleBack, navigateTo, selectedBook } = state;

  const allCombinedBooks = [...BOOKS.ot, ...BOOKS.nt];
  const bookData = allCombinedBooks.find((b) => b.name === selectedBook);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={15} iconColor={palette.ink} onPress={handleBack} className="rounded-full border border-line bg-surface" />
          <View className="flex-1">
            <AppText variant="micro" className="uppercase tracking-wider font-bold text-ink-3 font-sans">
              CHAPTERS AVAILABLE
            </AppText>
            <AppText variant="title" className="font-serif font-bold text-ink">{selectedBook}</AppText>
          </View>
        </View>

        {/* Simple Grid of Chapters */}
        <View className="flex-1 pt-3">
          {!bookData ? (
            <AppText variant="label" className="text-ink-3 ">No chapters.</AppText>
          ) : (
            <View className="flex-row flex-wrap gap-3">
              {Array.from({ length: bookData.chapters }, (_, i) => i + 1).map((chNum) => (
                <Pressable
                  key={chNum}
                  onPress={() => navigateTo('chapterLanding', selectedBook, chNum)}
                  style={{ width: '22%' }}
                  className="h-16 border-2 border-ink rounded-xl bg-surface items-center justify-center shadow-sm active:opacity-70"
                >
                  <AppText variant="title" className="text-ink font-serif font-bold ">{chNum}</AppText>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}

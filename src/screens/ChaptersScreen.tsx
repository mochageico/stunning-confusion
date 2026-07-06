import { Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { BOOKS } from '../data';

export default function ChaptersScreen({ state }: { state: AppState }) {
  const { handleBack, navigateTo, selectedBook } = state;

  const allCombinedBooks = [...BOOKS.ot, ...BOOKS.nt];
  const bookData = allCombinedBooks.find((b) => b.name === selectedBook);

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={handleBack}
            className="w-8 h-8 rounded-full border border-neutral-200 items-center justify-center bg-white"
          >
            <ArrowLeft size={15} color="#1A1A1A" />
          </Pressable>
          <View>
            <Text className="text-[9px] uppercase tracking-wider font-bold text-neutral-400 font-sans">
              CHAPTERS AVAILABLE
            </Text>
            <Text className="text-xl font-serif font-bold text-[#1A1A1A]">{selectedBook}</Text>
          </View>
        </View>

        {/* Simple Grid of Chapters */}
        <View className="flex-1 pt-3">
          {!bookData ? (
            <Text className="text-neutral-400 text-xs">No chapters.</Text>
          ) : (
            <View className="flex-row flex-wrap gap-3">
              {Array.from({ length: bookData.chapters }, (_, i) => i + 1).map((chNum) => (
                <Pressable
                  key={chNum}
                  onPress={() => navigateTo('chapterLanding', selectedBook, chNum)}
                  style={{ width: '22%' }}
                  className="h-16 border-2 border-[#1A1A1A] rounded-xl bg-white items-center justify-center shadow-sm active:opacity-70"
                >
                  <Text className="text-[#1A1A1A] font-serif font-bold text-lg">{chNum}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}

import { useState } from 'react';
import { ScrollView, View, Text, Pressable } from 'react-native';
import { ArrowLeft, ChevronRight, Search, X } from 'lucide-react-native';
import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppIconButton, AppTextInput, AppText } from '../components/design';

export default function BooksScreen({ state }: { state: AppState }) {
  const { BOOKS, handleBack, navigateTo } = state;
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const otBooks = q ? BOOKS.ot.filter((b) => b.name.toLowerCase().includes(q)) : BOOKS.ot;
  const ntBooks = q ? BOOKS.nt.filter((b) => b.name.toLowerCase().includes(q)) : BOOKS.nt;

  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-white" contentContainerClassName="p-5" contentContainerStyle={{ gap: 16 }}>
        {/* Header Row */}
        <View className="flex-row items-center gap-3">
          <AppIconButton Icon={ArrowLeft} diameter={32} iconSize={15} iconColor="#1A1A1A" onPress={handleBack} className="rounded-full border border-[#E5E5E5] bg-white" />
          <View>
            <AppText variant="title" className="font-serif font-bold text-[#1A1A1A]">Select Book</AppText>
          </View>
        </View>

        {/* Search — 66 books is too many to scan without one */}
        <View className="relative justify-center">
          <View className="absolute left-3 z-10">
            <Search size={16} color="#a3a3a3" />
          </View>
          <AppTextInput value={query} onChangeText={setQuery} placeholder="Search books..." placeholderTextColor="#a3a3a3" className="w-full bg-[#F3F2F1] border border-[#E5E5E5] rounded-xl py-2 pl-9 pr-8 text-[#1A1A1A]" />
          {!!query && (
            <Pressable onPress={() => setQuery('')} className="absolute right-3">
              <X size={14} color="#a3a3a3" />
            </Pressable>
          )}
        </View>

        {/* Testament Split lists */}
        <View className="gap-5 pt-2">
          {/* Old Testament */}
          {otBooks.length > 0 && (
            <View className="gap-2">
              <AppText variant="caption" className="font-bold text-[#888] tracking-widest font-sans border-b border-[#E5E5E5] pb-1">
                OLD TESTAMENT
              </AppText>
              <View className="divide-y divide-neutral-100 border border-[#E5E5E5] rounded-xl overflow-hidden bg-white">
                {otBooks.map((book) => (
                  <Pressable
                    key={book.id}
                    onPress={() => navigateTo('chapters', book.name)}
                    className="w-full px-4 py-3 flex-row items-center justify-between"
                  >
                    <AppText variant="title" className="font-serif font-medium text-[#1A1A1A]">{book.name}</AppText>
                    <ChevronRight size={16} color="#888888" />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* New Testament */}
          {ntBooks.length > 0 && (
            <View className="gap-2">
              <AppText variant="caption" className="font-bold text-[#888] tracking-widest font-sans border-b border-[#E5E5E5] pb-1">
                NEW TESTAMENT
              </AppText>
              <View className="divide-y divide-neutral-100 border border-[#E5E5E5] rounded-xl overflow-hidden bg-white">
                {ntBooks.map((book) => (
                  <Pressable
                    key={book.id}
                    onPress={() => navigateTo('chapters', book.name)}
                    className="w-full px-4 py-3 flex-row items-center justify-between"
                  >
                    <AppText variant="title" className="font-serif font-medium text-[#1A1A1A]">{book.name}</AppText>
                    <ChevronRight size={16} color="#888888" />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {otBooks.length === 0 && ntBooks.length === 0 && (
            <AppText variant="label" className="text-center text-neutral-400 py-6">No books match "{query}".</AppText>
          )}
        </View>
      </ScrollView>
    </FadeInView>
  );
}

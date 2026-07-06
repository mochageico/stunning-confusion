import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';

import { BOOKS } from '../data';

/**
 * Replaces the old "4 books in a row" chip pickers. Book names vary a lot in
 * length and — once the full 66-book canon is loaded — there are far too many
 * to fit in a row of buttons (or even a wrapped grid) the way chapter numbers
 * can. This renders a single trigger button that opens a searchable, scrollable
 * full-screen list grouped by Old/New Testament, the same way most Bible apps'
 * book pickers work.
 */
export function BookPicker({
  value,
  onChange,
  allowAll,
  allLabel = 'All Books',
  placeholder = 'Select a book',
  title = 'Select a Book',
}: {
  value: string;
  onChange: (bookName: string) => void;
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const otBooks = useMemo(() => (q ? BOOKS.ot.filter((b) => b.name.toLowerCase().includes(q)) : BOOKS.ot), [q]);
  const ntBooks = useMemo(() => (q ? BOOKS.nt.filter((b) => b.name.toLowerCase().includes(q)) : BOOKS.nt), [q]);
  const showAllRow = allowAll && (!q || allLabel.toLowerCase().includes(q));

  const displayLabel = value || (allowAll ? allLabel : placeholder);

  const select = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between bg-white border border-neutral-300 rounded-xl px-3 py-2.5"
      >
        <Text className={`text-xs font-sans font-bold ${value ? 'text-[#1A1A1A]' : 'text-neutral-400'}`} numberOfLines={1}>
          {displayLabel}
        </Text>
        <ChevronDown size={14} color="#737373" />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-3xl" style={{ maxHeight: '85%' }}>
            {/* Header */}
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
              <Text className="text-base font-serif font-bold text-[#1A1A1A]">{title}</Text>
              <Pressable
                onPress={() => setOpen(false)}
                className="w-7 h-7 rounded-full border border-neutral-300 items-center justify-center"
              >
                <X size={14} color="#262626" />
              </Pressable>
            </View>

            {/* Search */}
            <View className="px-5 pt-3">
              <View className="relative justify-center">
                <View className="absolute left-3 z-10">
                  <Search size={14} color="#a3a3a3" />
                </View>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search books..."
                  placeholderTextColor="#a3a3a3"
                  autoFocus
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl py-2 pl-9 pr-3 text-xs text-[#1A1A1A]"
                />
              </View>
            </View>

            <ScrollView className="px-5" contentContainerStyle={{ paddingTop: 12, paddingBottom: 24, gap: 16 }}>
              {showAllRow && (
                <Pressable
                  onPress={() => select('')}
                  className="flex-row items-center justify-between py-3 px-3 rounded-xl bg-neutral-50 border border-neutral-200"
                >
                  <Text className="font-serif font-medium text-base text-[#1A1A1A]">{allLabel}</Text>
                  {!value && <Check size={16} color="#1A1A1A" />}
                </Pressable>
              )}

              {otBooks.length > 0 && (
                <View className="gap-2">
                  <Text className="text-[10px] font-bold text-neutral-400 tracking-widest font-sans border-b border-neutral-100 pb-1">
                    OLD TESTAMENT
                  </Text>
                  <View className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden">
                    {otBooks.map((book) => (
                      <Pressable
                        key={book.id}
                        onPress={() => select(book.name)}
                        className="w-full px-4 py-3 flex-row items-center justify-between bg-white"
                      >
                        <Text className="font-serif font-medium text-base text-[#1A1A1A]">{book.name}</Text>
                        {value === book.name && <Check size={16} color="#1A1A1A" />}
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {ntBooks.length > 0 && (
                <View className="gap-2">
                  <Text className="text-[10px] font-bold text-neutral-400 tracking-widest font-sans border-b border-neutral-100 pb-1">
                    NEW TESTAMENT
                  </Text>
                  <View className="divide-y divide-neutral-100 border border-neutral-200 rounded-xl overflow-hidden">
                    {ntBooks.map((book) => (
                      <Pressable
                        key={book.id}
                        onPress={() => select(book.name)}
                        className="w-full px-4 py-3 flex-row items-center justify-between bg-white"
                      >
                        <Text className="font-serif font-medium text-base text-[#1A1A1A]">{book.name}</Text>
                        {value === book.name && <Check size={16} color="#1A1A1A" />}
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}

              {!showAllRow && otBooks.length === 0 && ntBooks.length === 0 && (
                <Text className="text-center text-xs text-neutral-400 py-6">No books match "{query}".</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';

import { BOOKS } from '../data';
import { AppIconButton, AppTextInput, AppText, MIN_TOUCH, useFontScale, useScaledSpace } from './design';
import { GroupedList, ListRow } from './blocks';

import { useThemeColors } from './theme';
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
  allLabel = 'All books',
  placeholder = 'Select a book',
  title = 'Choose a book',
}: {
  value: string;
  onChange: (bookName: string) => void;
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  title?: string;
}) {
  const palette = useThemeColors();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const scale = useFontScale();
  const space = useScaledSpace();
  const checkMark = <Check size={Math.round(18 * scale)} color={palette.accent} strokeWidth={2.4} />;

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
        accessibilityRole="button"
        accessibilityLabel={`Book: ${displayLabel}`}
        className="flex-row items-center justify-between bg-surface border border-line rounded-btn active:bg-surface-2"
        style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(12), paddingVertical: space(8), gap: space(8) }}
      >
        <AppText variant="body" className={`font-sans flex-1 ${value ? 'text-ink' : 'text-ink-3'}`} numberOfLines={1}>
          {displayLabel}
        </AppText>
        <ChevronDown size={Math.round(16 * scale)} color={palette.ink3} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-black/40 justify-end">
          {/* Fixed height, not maxHeight: a shrink-to-fit sheet slides the
              header/search bar down toward the keyboard as filtered results
              narrow, eventually covering the very rows you'd tap. (Which is
              also why this isn't the shared Dialog, which shrinks to fit.) */}
          <View className="bg-surface rounded-t-card" style={{ height: '85%' }}>
            <View className="flex-row items-center justify-between" style={{ paddingHorizontal: space(18), paddingTop: space(16), paddingBottom: space(10), gap: space(12) }}>
              <AppText variant="title" className="font-sans font-bold text-ink flex-1">{title}</AppText>
              <AppIconButton Icon={X} variant="outline" diameter={30} onPress={() => setOpen(false)} accessibilityLabel="Close" />
            </View>

            <View style={{ paddingHorizontal: space(18) }}>
              <View className="flex-row items-center bg-surface-2 border border-line rounded-btn" style={{ paddingHorizontal: space(12), gap: space(8) }}>
                <Search size={Math.round(16 * scale)} color={palette.ink3} />
                <AppTextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search books"
                  accessibilityLabel="Search books"
                  autoFocus
                  variant="body"
                  className="flex-1 text-ink font-sans"
                  style={{ minWidth: 0, paddingVertical: space(10) }}
                />
              </View>
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: space(18), paddingTop: space(14), paddingBottom: space(24), gap: space(18) }}>
              {showAllRow && (
                <GroupedList>
                  <ListRow title={allLabel} onPress={() => select('')} accessory={!value ? checkMark : 'none'} />
                </GroupedList>
              )}

              {otBooks.length > 0 && (
                <GroupedList header="Old Testament">
                  {otBooks.map((book) => (
                    <ListRow key={book.id} title={book.name} onPress={() => select(book.name)} accessory={value === book.name ? checkMark : 'none'} />
                  ))}
                </GroupedList>
              )}

              {ntBooks.length > 0 && (
                <GroupedList header="New Testament">
                  {ntBooks.map((book) => (
                    <ListRow key={book.id} title={book.name} onPress={() => select(book.name)} accessory={value === book.name ? checkMark : 'none'} />
                  ))}
                </GroupedList>
              )}

              {!showAllRow && otBooks.length === 0 && ntBooks.length === 0 && (
                <AppText variant="label" className="font-sans text-center text-ink-3 py-6">No books match "{query.trim()}".</AppText>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

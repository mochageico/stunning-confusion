import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Search, X } from 'lucide-react-native';

/**
 * Generic single-select dropdown: a trigger button showing the current value,
 * opening a scrollable modal list of options. Use this (instead of a ChipRow
 * of buttons side by side) for any choice list that's long, will grow over
 * time (e.g. translations, once more are added), or pairs with another field
 * in a way that a horizontal row of chips can't comfortably fit next to
 * (chapter numbers alongside a book picker, etc).
 */
export interface DropdownOption<T extends string | number> {
  id: T;
  label: string;
}

export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  title = 'Select an option',
  searchable,
  staticLabel,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (id: T) => void;
  placeholder?: string;
  title?: string;
  /** Adds a search box above the list. Defaults to on for longer lists. */
  searchable?: boolean;
  /** Trigger always shows `placeholder` (e.g. "View") instead of the current
   * selection -- for a compact action-menu feel where discovering the
   * current value is a secondary concern to keeping the trigger label
   * stable and short. Off by default (trigger shows the selected option, a
   * real value-picker) to match every other use of this component. */
  staticLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const showSearch = searchable ?? options.length > 10;

  const filtered = useMemo(() => {
    if (!showSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, showSearch]);

  const selected = options.find((o) => o.id === value);

  const select = (id: T) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between bg-white border border-neutral-300 rounded-xl px-3 py-2.5"
      >
        <Text className={`text-xs font-sans font-bold ${selected || staticLabel ? 'text-[#1A1A1A]' : 'text-neutral-400'}`} numberOfLines={1}>
          {staticLabel ? placeholder : selected ? selected.label : placeholder}
        </Text>
        <ChevronDown size={14} color="#737373" />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 bg-black/60 justify-end">
          {/* Fixed height, not maxHeight: a shrink-to-fit sheet slides the
              header/search bar down toward the keyboard as filtered results
              narrow, eventually covering the very rows you'd tap. */}
          <View className="bg-white rounded-t-3xl" style={{ height: '75%' }}>
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3 border-b border-neutral-100">
              <Text className="text-base font-serif font-bold text-[#1A1A1A]">{title}</Text>
              <Pressable
                onPress={() => setOpen(false)}
                className="w-7 h-7 rounded-full border border-neutral-300 items-center justify-center"
              >
                <X size={14} color="#262626" />
              </Pressable>
            </View>

            {showSearch && (
              <View className="px-5 pt-3">
                <View className="relative justify-center">
                  <View className="absolute left-3 z-10">
                    <Search size={14} color="#a3a3a3" />
                  </View>
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search..."
                    placeholderTextColor="#a3a3a3"
                    autoFocus
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl py-2 pl-9 pr-3 text-xs text-[#1A1A1A]"
                  />
                </View>
              </View>
            )}

            <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingTop: 12, paddingBottom: 24, gap: 6 }}>
              {filtered.length === 0 ? (
                <Text className="text-center text-xs text-neutral-400 py-6">No matches.</Text>
              ) : (
                filtered.map((opt) => (
                  <Pressable
                    key={String(opt.id)}
                    onPress={() => select(opt.id)}
                    className={`w-full px-4 py-3 flex-row items-center justify-between rounded-xl border ${
                      opt.id === value ? 'bg-neutral-50 border-neutral-300' : 'bg-white border-neutral-100'
                    }`}
                  >
                    <Text className="font-sans text-sm text-[#1A1A1A]">{opt.label}</Text>
                    {opt.id === value && <Check size={16} color="#1A1A1A" />}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Highlighter, Pencil, X } from 'lucide-react-native';

import { firstLetterLine, firstLetterOnly } from '../lib/recitation';
import DoodleCanvas from './DoodleCanvas';

// ============================================================================
// MEMORY GRID
// ----------------------------------------------------------------------------
// Scripture Memory Fellowship-style grid: one box per verse, showing every
// word's first letter permanently (not a random hidden subset -- that's
// Recall's separate First Letter hint mode). A deliberately separate feature
// from that inline hint mode, per explicit product direction -- they share
// the "first letter" idea but are accessed and behave differently.
//
// This component is presentation + tap/highlight plumbing only. Each context
// that renders it (Chapter page, Listen mode, Recall) decides what tapping a
// box means (select for queue, jump playback, grade recitation) via
// `onTapVerse`; highlighting (marking a box as a personal memory anchor) is
// handled the same way everywhere via `onToggleHighlight`.
//
// Per-word color grading (Recall integration -- letters turning green/red as
// you recite) and doodles are intentionally NOT built here yet; `wordStates`
// is accepted now so that integration doesn't require reshaping this
// component later.
// ============================================================================

export interface MemoryGridVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

/** Stable per-verse key for highlight/doodle persistence -- shared by every
 * screen that reads or writes verse annotations, so a highlight set on the
 * Chapter page shows up the same way in Listen/Recall. */
export const verseAnnotationKey = (book: string, chapter: number, verse: number): string =>
  `${book.replace(/\s+/g, '_')}_${chapter}_${verse}`;

interface MemoryGridProps {
  verses: MemoryGridVerse[];
  /** Boxes per row -- kept to 2 or 4 (never odd) so they tile evenly on a phone width. */
  columns?: 2 | 4;
  highlightedKeys?: Set<string>;
  onToggleHighlight?: (key: string, verse: MemoryGridVerse) => void;
  /** Chapter-page multi-select (add to queue / listen / learn), shown as a checkmark. */
  selectedKeys?: Set<string>;
  /** Fires on tapping a box's word area -- meaning is caller-defined (select, jump playback, etc). */
  onTapVerse?: (verse: MemoryGridVerse, index: number) => void;
  /** Index currently playing/active (Listen mode), shown with a solid fill. */
  activeIndex?: number;
  /** Per-word correctness for a live Recall session -- index-aligned with
   * each verse's `text.split(/\s+/).filter(w => w.length > 0)` (the exact
   * same split+filter this component renders words from). */
  wordStates?: Record<string, ('correct' | 'close' | 'incorrect' | undefined)[]>;
  /** Per-verse doodle strokes (SVG path "d" strings) -- backbone feature, a
   * single-pen freehand layer per verse. Omit both this and onSaveDoodle to
   * hide the doodle entry point entirely (e.g. a read-only context). */
  doodles?: Record<string, string[]>;
  onSaveDoodle?: (key: string, verse: MemoryGridVerse, strokes: string[]) => void;
  /** 'firstLetter' (default) shows every word's first letter, same as
   * always. 'blank' hides words entirely -- just the verse number, no text
   * at all -- for reciting from pure recall with only box order as a cue. */
  hideMode?: 'firstLetter' | 'blank';
}

export default function MemoryGrid({
  verses,
  columns = 4,
  highlightedKeys,
  onToggleHighlight,
  selectedKeys,
  onTapVerse,
  activeIndex,
  wordStates,
  doodles,
  onSaveDoodle,
  hideMode = 'firstLetter',
}: MemoryGridProps) {
  // Percentages leave extra margin beyond the naive (100/columns)% split --
  // RN adds each box's border on top of its stated width rather than
  // absorbing it (no true border-box sizing), so a tighter percentage plus
  // the flex-wrap gap was overflowing 4-per-row down to 3.
  const widthPct = columns === 2 ? '47%' : '22%';
  const [doodleOpenKey, setDoodleOpenKey] = useState<string | null>(null);
  const doodleOpenVerse = verses.find((v) => verseAnnotationKey(v.book, v.chapter, v.verse) === doodleOpenKey) || null;

  return (
    <View className="flex-row flex-wrap gap-2">
      {verses.map((v, index) => {
        const key = verseAnnotationKey(v.book, v.chapter, v.verse);
        const isHighlighted = !!highlightedKeys?.has(key);
        const isSelected = !!selectedKeys?.has(key);
        const isActive = activeIndex === index;
        const words = v.text.split(/\s+/).filter((w) => w.length > 0);
        const grades = wordStates?.[key];

        const boxClass = isActive
          ? 'border-[#1A1A1A] bg-[#1A1A1A]'
          : isHighlighted
            ? 'border-amber-300 bg-amber-50'
            : isSelected
              ? 'border-[#1A1A1A] bg-[#F3F2F1]'
              : 'border-neutral-200 bg-white';

        return (
          <View key={key} style={{ width: widthPct }} className={`rounded-xl border relative ${boxClass}`}>
            {isSelected && !isActive && (
              <View className="absolute -top-1.5 -right-1.5 bg-black w-3.5 h-3.5 rounded-full items-center justify-center border border-white z-10">
                <Text className="text-white text-[8px] font-black">✓</Text>
              </View>
            )}
            <View className="flex-row items-center justify-between px-2 pt-1.5">
              <View className={`px-1 rounded ${isActive ? 'bg-white/20' : 'bg-neutral-100'}`}>
                <Text className={`text-[8px] font-mono font-extrabold ${isActive ? 'text-white' : 'text-neutral-500'}`}>{v.verse}</Text>
              </View>
              <View className="flex-row items-center gap-2">
                {onToggleHighlight && (
                  <Pressable hitSlop={8} onPress={() => onToggleHighlight(key, v)}>
                    <Highlighter size={11} color={isActive ? '#ffffff' : isHighlighted ? '#d97706' : '#c7c7c7'} />
                  </Pressable>
                )}
                {onSaveDoodle && (
                  <Pressable hitSlop={8} onPress={() => setDoodleOpenKey(key)}>
                    <Pencil size={11} color={isActive ? '#ffffff' : (doodles?.[key]?.length ?? 0) > 0 ? '#0284c7' : '#c7c7c7'} />
                  </Pressable>
                )}
              </View>
            </View>
            <Pressable onPress={() => onTapVerse?.(v, index)} className="px-2 pb-2 pt-0.5">
              {hideMode === 'blank' ? (
                <View className="flex-row flex-wrap items-center" style={{ gap: 3 }}>
                  {words.map((w, wi) => {
                    const grade = grades?.[wi];
                    const dotColor =
                      grade === 'correct'
                        ? '#10b981'
                        : grade === 'close'
                          ? '#d97706'
                          : grade === 'incorrect'
                            ? '#dc2626'
                            : isActive
                              ? 'rgba(255,255,255,0.4)'
                              : '#d4d4d4';
                    return <View key={wi} style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: dotColor }} />;
                  })}
                </View>
              ) : (
                <Text className={`font-mono text-[11px] leading-tight flex-row flex-wrap ${isActive ? 'text-white' : 'text-neutral-800'}`}>
                  {words.map((w, wi) => {
                    const grade = grades?.[wi];
                    const gradeColor =
                      grade === 'correct'
                        ? '#10b981'
                        : grade === 'close'
                          ? '#d97706'
                          : grade === 'incorrect'
                            ? '#dc2626'
                            : isActive
                              ? '#ffffff'
                              : undefined;
                    return (
                      <Text key={wi} style={gradeColor ? { color: gradeColor } : undefined}>
                        {firstLetterOnly(w)}{' '}
                      </Text>
                    );
                  })}
                </Text>
              )}
            </Pressable>
          </View>
        );
      })}

      {doodleOpenVerse && onSaveDoodle && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setDoodleOpenKey(null)}>
          <View className="flex-1 bg-black/60 items-center justify-center p-6">
            <View className="bg-white rounded-2xl p-4 gap-3 w-full max-w-[320px]">
              <View className="flex-row items-center justify-between">
                <Text className="font-serif font-bold text-neutral-900">
                  {doodleOpenVerse.book} {doodleOpenVerse.chapter}:{doodleOpenVerse.verse}
                </Text>
                <Pressable hitSlop={8} onPress={() => setDoodleOpenKey(null)}>
                  <X size={18} color="#262626" />
                </Pressable>
              </View>
              <Text className="text-[11px] font-mono text-neutral-400" numberOfLines={2}>
                {firstLetterLine(doodleOpenVerse.text)}
              </Text>
              <DoodleCanvas
                strokes={doodles?.[doodleOpenKey!] || []}
                onChange={(strokes) => onSaveDoodle(doodleOpenKey!, doodleOpenVerse, strokes)}
              />
              <Pressable onPress={() => setDoodleOpenKey(null)} className="py-2.5 bg-[#1A1A1A] rounded-xl items-center">
                <Text className="text-white text-xs font-sans font-bold">Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

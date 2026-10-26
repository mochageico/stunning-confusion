import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Search, X } from 'lucide-react-native';

import type { QueueItem, StarRef } from '../../types';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../design';
import { Dialog, SegmentedControl } from '../blocks';
import { useThemeColors } from '../theme';
import { BOOKS } from '../../data';
import { useChapterText } from '../../state/useScripture';
import { refsOverlap } from '../../lib/constellations';
import { starLabel } from '../../lib/mapLayout';
import { EndTrim, Stepper } from './ConnectSheet';
import { Run, heldRuns, runLabel, runRef } from './linkRuns';

// ============================================================================
// "Add a star" -- put a verse on the map on its own, joined to nothing.
// Two ways in: one of your verses that isn't on the map yet (trim it, add it),
// or any verse in the Bible (pick the book, chapter and verses; it goes onto
// My Verses through the usual add path and starts when My Schedule says).
// ============================================================================

type Mode = 'mine' | 'any';

const RECENT_COUNT = 6;
const MAX_RESULTS = 30;
const ALL_BOOKS = [...BOOKS.ot, ...BOOKS.nt];

export default function AddStarSheet({
  visible,
  queue,
  mapRefs,
  translationId,
  onClose,
  onAdd,
}: {
  visible: boolean;
  queue: QueueItem[];
  /** The stars already on the map, so the same verses aren't offered twice. */
  mapRefs: StarRef[];
  /** The translation a verse from outside My Verses is read and added in. */
  translationId: string;
  onClose: () => void;
  onAdd: (ref: StarRef) => void;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();
  const iconSize = Math.round(18 * scale);

  const [mode, setMode] = useState<Mode>('mine');
  const [query, setQuery] = useState('');
  // "Mine": the run picked, and the part of it kept.
  const [run, setRun] = useState<Run | null>(null);
  const [range, setRange] = useState<StarRef | null>(null);
  // "Any verse": the book, chapter and verses.
  const [bookName, setBookName] = useState<string | null>(null);
  const [chapter, setChapter] = useState(1);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);

  useEffect(() => {
    if (!visible) return;
    setMode('mine');
    setQuery('');
    setRun(null);
    setRange(null);
    setBookName(null);
    setChapter(1);
    setFrom(1);
    setTo(1);
  }, [visible]);

  // ---- My verses ----
  const onMap = (r: Run) => mapRefs.some((m) => refsOverlap(m, runRef(r)));
  const runs = useMemo(() => heldRuns(queue).filter((r) => !onMap(r)), [queue, mapRefs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs.slice(0, RECENT_COUNT);
    return runs.filter((r) => `${runLabel(r)} ${r.text}`.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [runs, query]);

  // ---- Any verse ----
  const book = bookName ? ALL_BOOKS.find((b) => b.name === bookName) ?? null : null;
  const { data: chapterData, loading } = useChapterText(book ? translationId : null, book?.id ?? null, book ? chapter : null);
  const lastVerse = useMemo(() => {
    const nums = chapterData ? Object.keys(chapterData.verses).map(Number).filter((n) => n > 0) : [];
    return nums.length ? Math.max(...nums) : 0;
  }, [chapterData]);
  useEffect(() => {
    // A new chapter starts at its first verse; a shorter one keeps the verses inside it.
    if (lastVerse === 0) return;
    setFrom((f) => Math.min(Math.max(1, f), lastVerse));
    setTo((t) => Math.min(Math.max(1, t), lastVerse));
  }, [lastVerse]);
  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? ALL_BOOKS.filter((b) => b.name.toLowerCase().includes(q)) : ALL_BOOKS).slice(0, MAX_RESULTS);
  }, [query]);
  const anyRef: StarRef | null = book && lastVerse > 0 ? { book: book.name, chapter, start: from, end: Math.max(from, to) } : null;
  const anyTaken = !!anyRef && mapRefs.some((m) => refsOverlap(m, anyRef));
  const anyReady = !!anyRef && !anyTaken;

  const pickRun = (r: Run) => {
    setRun(r);
    setRange(runRef(r));
  };

  const searchBox = (placeholder: string) => (
    <View className="flex-row items-center bg-surface border border-line rounded-btn" style={{ paddingHorizontal: space(12), gap: space(8) }}>
      <Search size={iconSize} color={palette.ink3} />
      <AppTextInput
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        accessibilityLabel={placeholder}
        variant="body"
        className="flex-1 text-ink font-sans"
        style={{ minWidth: 0, paddingVertical: space(10) }}
      />
      {query ? (
        <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <X size={iconSize} color={palette.ink3} />
        </Pressable>
      ) : null}
    </View>
  );

  const trimming = mode === 'mine' && !!run && !!range;
  const choosingPassage = mode === 'any' && !!book;
  const title = trimming ? 'Trim the passage' : choosingPassage ? 'Choose the verses' : 'Add a star';

  let actions: React.ReactNode;
  if (trimming) {
    actions = (
      <>
        <AppButton variant="quiet" label="Back" onPress={() => { setRun(null); setRange(null); }} />
        <AppButton variant="primary" label="Add star" onPress={() => range && onAdd(range)} />
      </>
    );
  } else if (choosingPassage) {
    actions = (
      <>
        <AppButton variant="quiet" label="Back" onPress={() => { setBookName(null); setQuery(''); }} />
        <AppButton variant="primary" label="Add star" disabled={!anyReady} onPress={() => anyRef && onAdd(anyRef)} />
      </>
    );
  }

  return (
    <Dialog visible={visible} onClose={onClose} placement="sheet" title={title} actions={actions}>
      {trimming && run && range ? (
        <View style={{ gap: space(12) }}>
          <AppText variant="label" className="font-sans text-ink-2">
            You can shorten it. It can only cover verses you already have.
          </AppText>
          <EndTrim title="Star" run={run} range={range} onChange={setRange} />
        </View>
      ) : choosingPassage && book ? (
        <View style={{ gap: space(12) }}>
          <View className="bg-surface-2 rounded-card" style={{ padding: space(14), gap: space(10) }}>
            <AppText variant="title" className="font-sans font-bold text-ink">
              {anyRef ? starLabel(anyRef) : `${book.name} ${chapter}`}
            </AppText>
            <Stepper
              label="Chapter"
              value={chapter}
              canDown={chapter > 1}
              canUp={chapter < book.chapters}
              onDown={() => { setChapter(chapter - 1); setFrom(1); setTo(1); }}
              onUp={() => { setChapter(chapter + 1); setFrom(1); setTo(1); }}
            />
            {lastVerse > 0 ? (
              <>
                <Stepper label="From verse" value={from} canDown={from > 1} canUp={from < to} onDown={() => setFrom(from - 1)} onUp={() => setFrom(from + 1)} />
                <Stepper label="To verse" value={to} canDown={to > from} canUp={to < lastVerse} onDown={() => setTo(to - 1)} onUp={() => setTo(to + 1)} />
              </>
            ) : (
              <AppText variant="label" className="font-sans text-ink-2">
                {loading ? 'Loading the chapter…' : 'Couldn\'t load this chapter. Check your connection and try another.'}
              </AppText>
            )}
          </View>
          {anyTaken ? (
            <AppText variant="label" className="font-sans text-ink-2">
              Some of these verses are already on the map.
            </AppText>
          ) : anyRef ? (
            <AppText variant="label" className="font-sans text-ink-2">
              It's added to My Verses too, and starts when My Schedule says.
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: space(12) }}>
          <SegmentedControl
            accessibilityLabel="Where the star comes from"
            options={[
              { id: 'mine', label: 'My verses' },
              { id: 'any', label: 'Any verse' },
            ]}
            value={mode}
            onChange={(m: Mode) => {
              setMode(m);
              setQuery('');
            }}
          />
          {mode === 'mine' ? (
            <>
              {searchBox('Search your verses')}
              {!query ? (
                <AppText variant="caption" className="font-sans font-semibold text-ink-2">
                  Not on the map yet
                </AppText>
              ) : null}
              {shown.length === 0 ? (
                <AppText variant="label" className="font-sans text-ink-2">
                  {query ? 'No verse of yours matches that.' : 'All your verses are on the map already. Try Any verse.'}
                </AppText>
              ) : (
                shown.map((r) => (
                  <Pressable
                    key={`${r.book}|${r.chapter}|${r.start}`}
                    onPress={() => pickRun(r)}
                    accessibilityRole="button"
                    className="border-b border-hairline active:opacity-60"
                    style={{ minHeight: 48, paddingVertical: space(8), gap: space(2) }}
                  >
                    <AppText variant="label" className="font-sans font-bold text-ink">
                      {runLabel(r)}
                    </AppText>
                    <AppText variant="caption" className="font-serif text-ink-2" numberOfLines={1}>
                      {r.text}
                    </AppText>
                  </Pressable>
                ))
              )}
            </>
          ) : (
            <>
              {searchBox('Search for a book')}
              {books.length === 0 ? (
                <AppText variant="label" className="font-sans text-ink-2">
                  No book matches that.
                </AppText>
              ) : (
                books.map((b) => (
                  <Pressable
                    key={b.id}
                    onPress={() => {
                      setBookName(b.name);
                      setChapter(1);
                      setFrom(1);
                      setTo(1);
                      setQuery('');
                    }}
                    accessibilityRole="button"
                    className="border-b border-hairline active:opacity-60 justify-center"
                    style={{ minHeight: 48, paddingVertical: space(8) }}
                  >
                    <AppText variant="label" className="font-sans font-bold text-ink">
                      {b.name}
                    </AppText>
                  </Pressable>
                ))
              )}
            </>
          )}
        </View>
      )}
    </Dialog>
  );
}

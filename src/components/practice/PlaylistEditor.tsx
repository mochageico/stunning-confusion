import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, GripVertical, Search, Square, SquareCheck, SquareMinus, Trash2, X } from 'lucide-react-native';

import { ALL_BIBLE_BOOKS, DEFAULT_TRANSLATION_ID, PICKER_TRANSLATIONS, getBookByName, translationLabel } from '../../data';
import type { ListenPlaylist, QueueItem, VerseState } from '../../types';
import { scriptOfVerse } from '../../lib/textScript';
import { useChapterText } from '../../state/useScripture';
import { useDragSelect } from '../useDragSelect';
import { BookPicker } from '../BookPicker';
import { Dropdown } from '../Dropdown';
import { AppButton, AppIconButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../design';
import { Badge, SegmentedControl, type BadgeTone } from '../blocks';
import { useThemeColors } from '../theme';

// ============================================================================
// PLAYLIST EDITOR
// ----------------------------------------------------------------------------
// Builds or edits a Listen playlist. Two ways to pick verses, sharing one
// selection:
//   - My verses: your saved verses, already grouped into passages. Tick a
//     passage to take all of it; open it to tick single verses.
//   - Browse the Bible: any chapter, any verse, with the chapter page's
//     hold-and-drag select.
// The tray at the bottom lists what's in the playlist, by passage, in play
// order. Reorder swaps the picker for a list of those passages to drag (or
// nudge with the arrows) into the order they should play.
// ============================================================================

type Stage = QueueItem['status'];

const STAGE_LABEL: Record<Stage, string> = {
  queued: 'Coming up',
  learning: 'Learning',
  reviewing: 'Review',
  retained: 'Complete',
};
const STAGE_TONE: Record<Stage, BadgeTone> = {
  queued: 'neutral',
  learning: 'warning',
  reviewing: 'accent',
  retained: 'success',
};

const verseKey = (v: Pick<VerseState, 'book' | 'chapter' | 'verse' | 'translationId'>) =>
  `${v.translationId ?? ''}|${v.book}|${v.chapter}|${v.verse}`;

const bookOrder = (book: string) => {
  const i = ALL_BIBLE_BOOKS.findIndex((b) => b.name.toLowerCase() === book.toLowerCase());
  return i < 0 ? ALL_BIBLE_BOOKS.length : i;
};

/** "Romans 8:28–39", or "Psalms 119:11" for one verse. */
const rangeLabel = (verses: VerseState[]) => {
  const first = verses[0];
  const last = verses[verses.length - 1];
  return verses.length === 1
    ? `${first.book} ${first.chapter}:${first.verse}`
    : `${first.book} ${first.chapter}:${first.verse}–${last.verse}`;
};

interface Passage {
  key: string;
  label: string;
  verses: VerseState[];
  /** One stage when every verse shares it, else null. */
  stage: Stage | null;
}

/**
 * Splits verses into runs of consecutive verses in one chapter, in Bible
 * order. Romans 8:1–2 and 8:28–39 are two passages, as they are on Home.
 */
function splitIntoPassages(verses: VerseState[], stageOf?: (v: VerseState) => Stage | undefined): Passage[] {
  const sorted = [...verses].sort(
    (a, b) =>
      bookOrder(a.book) - bookOrder(b.book) ||
      a.chapter - b.chapter ||
      (a.translationId ?? '').localeCompare(b.translationId ?? '') ||
      a.verse - b.verse
  );
  const runs: VerseState[][] = [];
  for (const v of sorted) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (prev && prev.book === v.book && prev.chapter === v.chapter && prev.translationId === v.translationId && v.verse === prev.verse + 1) {
      run.push(v);
    } else {
      runs.push([v]);
    }
  }
  return runs.map((run) => {
    const stages = new Set(run.map((v) => stageOf?.(v)));
    const only = stages.size === 1 ? [...stages][0] : undefined;
    return { key: verseKey(run[0]), label: rangeLabel(run), verses: run, stage: only ?? null };
  });
}

/**
 * The picked verses as passages in play order. `picked` is a Map, so it keeps
 * insertion order; each passage sits where its earliest-added verse does.
 * New picks go to the end, and a verse added next to an existing passage
 * joins it in place.
 */
function orderedPassages(picked: Map<string, VerseState>): Passage[] {
  const position = new Map<string, number>();
  [...picked.keys()].forEach((key, i) => position.set(key, i));
  const first = (p: Passage) => Math.min(...p.verses.map((v) => position.get(verseKey(v)) ?? Infinity));
  return splitIntoPassages([...picked.values()])
    .map((p) => ({ p, at: first(p) }))
    .sort((a, b) => a.at - b.at)
    .map(({ p }) => p);
}

/** A default name from the first passages picked: "Romans 8 + Isaiah 55". */
function suggestedName(passages: Passage[]) {
  const chapters: string[] = [];
  for (const p of passages) {
    const c = `${p.verses[0].book} ${p.verses[0].chapter}`;
    if (!chapters.includes(c)) chapters.push(c);
  }
  if (chapters.length === 0) return 'My playlist';
  return chapters.length <= 2 ? chapters.join(' + ') : `${chapters[0]} + ${chapters.length - 1} more`;
}

export function PlaylistEditor({
  visible,
  playlist,
  memoryQueue,
  preferredTranslationId,
  onSave,
  onDelete,
  onClose,
}: {
  visible: boolean;
  /** The playlist being edited, or null for a new one. */
  playlist: ListenPlaylist | null;
  memoryQueue: QueueItem[];
  preferredTranslationId?: string;
  onSave: (playlist: ListenPlaylist) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Map<string, VerseState>>(new Map());
  const [tab, setTab] = useState<'mine' | 'browse'>('mine');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reordering, setReordering] = useState(false);

  // Fresh state each time the editor opens.
  useEffect(() => {
    if (!visible) return;
    setName(playlist?.name ?? '');
    setPicked(new Map((playlist?.verses ?? []).map((v) => [verseKey(v), v])));
    setTab(memoryQueue.length > 0 ? 'mine' : 'browse');
    setQuery('');
    setExpanded(null);
    setConfirmDelete(false);
    setReordering(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pickedPassages = useMemo(() => orderedPassages(picked), [picked]);

  // Rebuilds `picked` in the given passage order, which is what play order
  // is read from.
  const setPassageOrder = (passages: Passage[]) =>
    setPicked(new Map(passages.flatMap((p) => p.verses.map((v) => [verseKey(v), v] as const))));
  const movePassage = (from: number, to: number) => {
    if (to < 0 || to >= pickedPassages.length) return;
    const next = [...pickedPassages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPassageOrder(next);
  };

  const addVerses = (verses: VerseState[]) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const v of verses) next.set(verseKey(v), v);
      return next;
    });
  const removeVerses = (verses: Pick<VerseState, 'book' | 'chapter' | 'verse' | 'translationId'>[]) =>
    setPicked((prev) => {
      const next = new Map(prev);
      for (const v of verses) next.delete(verseKey(v));
      return next;
    });

  const save = () => {
    const verses = pickedPassages.flatMap((p) => p.verses);
    if (verses.length === 0) return;
    onSave({
      id: playlist?.id ?? `pl_${Date.now().toString(36)}`,
      name: name.trim() || suggestedName(pickedPassages),
      verses,
      updatedAt: new Date().toISOString(),
    });
  };

  const verseCount = picked.size;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {/* GestureHandlerRootView inside the Modal: on Android a Modal is its
          own window, and Browse's drag-select needs a gesture root there. */}
      <GestureHandlerRootView
        // A style, not className: GestureHandlerRootView isn't a styled
        // component, so flex-1 was dropped and the tray ran off the screen.
        style={{ flex: 1, backgroundColor: palette.surface, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }}
      >
        <View className="px-4 flex-1" style={{ gap: space(10) }}>
          {/* Header */}
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <AppButton size="sm" variant="quiet" label="Cancel" onPress={onClose} />
            <AppText variant="section" className="font-sans font-bold text-ink flex-1 text-center" numberOfLines={1}>
              {playlist ? 'Edit playlist' : 'New playlist'}
            </AppText>
            <AppButton
              size="sm"
              variant="primary"
              label="Save"
              onPress={save}
              accessibilityHint={verseCount === 0 ? 'Pick at least one verse first' : undefined}
              className={verseCount === 0 ? 'opacity-40' : ''}
            />
          </View>

          <AppTextInput
            value={name}
            onChangeText={setName}
            placeholder={pickedPassages.length > 0 ? suggestedName(pickedPassages) : 'Playlist name'}
            accessibilityLabel="Playlist name"
            className="bg-surface-2 border border-line rounded-btn text-ink font-sans"
            style={{ paddingHorizontal: space(12), paddingVertical: space(10) }}
            returnKeyType="done"
          />

          {!reordering && (
          <SegmentedControl
            value={tab}
            onChange={setTab}
            accessibilityLabel="Where to pick verses from"
            options={[
              { id: 'mine' as const, label: 'My verses' },
              { id: 'browse' as const, label: 'Browse the Bible' },
            ]}
          />
          )}

          <View className="flex-1">
            {reordering ? (
              <PassageOrder passages={pickedPassages} onReorder={setPassageOrder} onMove={movePassage} />
            ) : tab === 'mine' ? (
              <MyVersesPicker
                memoryQueue={memoryQueue}
                picked={picked}
                query={query}
                setQuery={setQuery}
                expanded={expanded}
                setExpanded={setExpanded}
                addVerses={addVerses}
                removeVerses={removeVerses}
                onBrowse={() => setTab('browse')}
              />
            ) : (
              <BiblePicker
                picked={picked}
                addVerses={addVerses}
                removeVerses={removeVerses}
                startTranslationId={preferredTranslationId}
                startAt={pickedPassages[0]?.verses[0]}
              />
            )}
          </View>

          {/* Tray: what's in the playlist so far. */}
          <View className="border-t border-line pt-2" style={{ gap: space(6) }}>
            <View className="flex-row items-center justify-between">
              <AppText variant="caption" className="font-sans font-semibold text-ink-2">
                {verseCount === 0
                  ? 'Nothing picked yet'
                  : `${verseCount} ${verseCount === 1 ? 'verse' : 'verses'} · ${pickedPassages.length} ${pickedPassages.length === 1 ? 'passage' : 'passages'}`}
              </AppText>
              <View className="flex-row items-center" style={{ gap: space(6) }}>
              {(pickedPassages.length > 1 || reordering) && (
                <AppButton
                  size="sm"
                  variant={reordering ? 'primary' : 'quiet'}
                  Icon={reordering ? undefined : GripVertical}
                  label={reordering ? 'Done' : 'Reorder'}
                  onPress={() => setReordering(!reordering)}
                />
              )}
              {playlist && onDelete && !reordering && (
                <AppButton
                  size="sm"
                  variant={confirmDelete ? 'destructive' : 'quiet'}
                  Icon={Trash2}
                  label={confirmDelete ? 'Tap again to delete' : 'Delete'}
                  onPress={() => (confirmDelete ? onDelete(playlist.id) : setConfirmDelete(true))}
                />
              )}
              </View>
            </View>
            {pickedPassages.length > 0 && !reordering && (
              <ScrollView style={{ maxHeight: space(96) }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(6) }}>
                {pickedPassages.map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => removeVerses(p.verses)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${p.label}`}
                    className="flex-row items-center rounded-full bg-accent-soft active:opacity-70"
                    style={{ paddingLeft: space(10), paddingRight: space(6), paddingVertical: space(4), gap: space(4) }}
                  >
                    <AppText variant="caption" className="font-sans font-semibold text-accent">
                      {p.label}
                    </AppText>
                    <X size={Math.round(14 * scale)} color={palette.accent} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// Reorder: the playlist's passages in play order. Hold the grip to drag, or
// use the arrows (which also work where dragging is awkward, and with a
// screen reader).
// ----------------------------------------------------------------------------
function PassageOrder({
  passages,
  onReorder,
  onMove,
}: {
  passages: Passage[];
  onReorder: (passages: Passage[]) => void;
  onMove: (from: number, to: number) => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const iconSize = Math.round(18 * scale);
  return (
    <View className="flex-1" style={{ gap: space(8) }}>
      <AppText variant="caption" className="font-sans text-ink-3">
        Plays top to bottom. Hold the handle to drag a passage, or use the arrows.
      </AppText>
      <DraggableFlatList
        data={passages}
        keyExtractor={(p) => p.key}
        containerStyle={{ flex: 1 }}
        contentContainerStyle={{ gap: space(6), paddingBottom: space(8) }}
        onDragEnd={({ data }) => onReorder(data)}
        renderItem={({ item, drag, isActive, getIndex }: RenderItemParams<Passage>) => {
          const index = getIndex() ?? 0;
          return (
            <View
              className={`rounded-btn border flex-row items-center ${isActive ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
              style={{ paddingVertical: space(6), paddingLeft: space(6), paddingRight: space(4), gap: space(6) }}
            >
              <Pressable
                onLongPress={drag}
                delayLongPress={200}
                hitSlop={10}
                accessibilityLabel={`Hold to move ${item.label}`}
                style={{ padding: space(6) }}
              >
                <GripVertical size={iconSize} color={palette.ink3} />
              </Pressable>
              <AppText
                variant="caption"
                className="font-sans font-semibold text-ink-3"
                style={{ minWidth: space(18), fontVariant: ['tabular-nums'] }}
              >
                {index + 1}
              </AppText>
              <AppText variant="label" className="font-sans font-semibold text-ink flex-1" numberOfLines={1}>
                {item.label}
              </AppText>
              <AppIconButton
                variant="bare"
                Icon={ArrowUp}
                diameter={iconSize + 22}
                iconColor={index === 0 ? palette.line : palette.ink2}
                accessibilityLabel={`Move ${item.label} up`}
                onPress={() => onMove(index, index - 1)}
              />
              <AppIconButton
                variant="bare"
                Icon={ArrowDown}
                diameter={iconSize + 22}
                iconColor={index === passages.length - 1 ? palette.line : palette.ink2}
                accessibilityLabel={`Move ${item.label} down`}
                onPress={() => onMove(index, index + 1)}
              />
            </View>
          );
        }}
      />
    </View>
  );
}

// ----------------------------------------------------------------------------
// My verses: your saved verses as passages.
// ----------------------------------------------------------------------------
function MyVersesPicker({
  memoryQueue,
  picked,
  query,
  setQuery,
  expanded,
  setExpanded,
  addVerses,
  removeVerses,
  onBrowse,
}: {
  memoryQueue: QueueItem[];
  picked: Map<string, VerseState>;
  query: string;
  setQuery: (q: string) => void;
  expanded: string | null;
  setExpanded: (key: string | null) => void;
  addVerses: (verses: VerseState[]) => void;
  removeVerses: (verses: VerseState[]) => void;
  onBrowse: () => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const iconSize = Math.round(22 * scale);

  const passages = useMemo(() => {
    const stageByKey = new Map<string, Stage>();
    const verses: VerseState[] = memoryQueue.map((item) => {
      const v: VerseState = {
        book: item.book,
        chapter: item.chapter,
        verse: item.verseNumber,
        text: item.text,
        status: item.status === 'retained' ? 'memorized' : 'learning',
        translationId: item.translationId || 'ESV',
      };
      stageByKey.set(verseKey(v), item.status);
      return v;
    });
    return splitIntoPassages(verses, (v) => stageByKey.get(verseKey(v)));
  }, [memoryQueue]);

  const q = query.trim().toLowerCase();
  const shown = q ? passages.filter((p) => p.label.toLowerCase().includes(q)) : passages;

  if (passages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center" style={{ gap: space(10) }}>
        <AppText variant="label" className="font-sans text-ink-3 text-center">
          You haven't added any verses yet.
        </AppText>
        <AppButton size="sm" variant="secondary" label="Browse the Bible" onPress={onBrowse} />
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ gap: space(8) }}>
      <View
        className="flex-row items-center bg-surface-2 border border-line rounded-btn"
        style={{ paddingHorizontal: space(10), gap: space(8) }}
      >
        <Search size={Math.round(16 * scale)} color={palette.ink3} />
        <AppTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your verses"
          accessibilityLabel="Search your verses"
          className="flex-1 text-ink font-sans"
          style={{ paddingVertical: space(9) }}
          autoCorrect={false}
        />
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ gap: space(6), paddingBottom: space(8) }} keyboardShouldPersistTaps="handled">
        {shown.map((p) => {
          const count = p.verses.filter((v) => picked.has(verseKey(v))).length;
          const all = count === p.verses.length;
          const Mark = all ? SquareCheck : count > 0 ? SquareMinus : Square;
          const open = expanded === p.key;
          return (
            <View key={p.key} className={`rounded-btn border ${count > 0 ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
              <View className="flex-row items-center" style={{ paddingVertical: space(4), paddingLeft: space(4), paddingRight: space(8) }}>
                <AppIconButton
                  variant="bare"
                  Icon={Mark}
                  iconColor={count > 0 ? palette.accent : palette.ink3}
                  diameter={iconSize + 20}
                  accessibilityLabel={all ? `Remove ${p.label}` : `Add all of ${p.label}`}
                  onPress={() => (all ? removeVerses(p.verses) : addVerses(p.verses))}
                />
                <Pressable
                  className="flex-1 flex-row items-center active:opacity-60"
                  style={{ gap: space(8), minHeight: 44 }}
                  onPress={() => setExpanded(open ? null : p.key)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${p.label}, pick single verses`}
                >
                  <View className="flex-1">
                    <AppText variant="label" className={`font-sans font-semibold ${count > 0 ? 'text-accent' : 'text-ink'}`}>
                      {p.label}
                    </AppText>
                    {count > 0 && !all && (
                      <AppText variant="caption" className="font-sans text-accent">
                        {count} of {p.verses.length} verses
                      </AppText>
                    )}
                  </View>
                  {/* Wrapped: Badge pins itself to the top of a row. */}
                  {p.stage && (
                    <View>
                      <Badge label={STAGE_LABEL[p.stage]} tone={STAGE_TONE[p.stage]} />
                    </View>
                  )}
                  {p.verses.length > 1 &&
                    (open ? <ChevronUp size={Math.round(16 * scale)} color={palette.ink3} /> : <ChevronDown size={Math.round(16 * scale)} color={palette.ink3} />)}
                </Pressable>
              </View>
              {open && p.verses.length > 1 && (
                <View className="border-t border-hairline">
                  {p.verses.map((v) => {
                    const on = picked.has(verseKey(v));
                    return (
                      <Pressable
                        key={v.verse}
                        onPress={() => (on ? removeVerses([v]) : addVerses([v]))}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        className="flex-row active:opacity-60"
                        style={{ paddingVertical: space(8), paddingHorizontal: space(12), gap: space(10) }}
                      >
                        {on ? (
                          <SquareCheck size={Math.round(18 * scale)} color={palette.accent} />
                        ) : (
                          <Square size={Math.round(18 * scale)} color={palette.ink3} />
                        )}
                        <AppText variant="caption" className="font-sans font-semibold text-ink-3" style={{ minWidth: space(22) }}>
                          {v.verse}
                        </AppText>
                        <AppText variant="caption" script={scriptOfVerse(v)} className="font-serif text-ink flex-1" numberOfLines={2}>
                          {v.text}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
        {shown.length === 0 && (
          <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(24) }}>
            No passages match “{query.trim()}”.
          </AppText>
        )}
      </ScrollView>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Browse the Bible: one chapter at a time, tap or hold-and-drag to pick.
// ----------------------------------------------------------------------------
function BiblePicker({
  picked,
  addVerses,
  removeVerses,
  startTranslationId,
  startAt,
}: {
  picked: Map<string, VerseState>;
  addVerses: (verses: VerseState[]) => void;
  removeVerses: (verses: Pick<VerseState, 'book' | 'chapter' | 'verse' | 'translationId'>[]) => void;
  startTranslationId?: string;
  /** Opens on this verse's chapter (the playlist's first passage), when set. */
  startAt?: VerseState;
}) {
  const space = useScaledSpace();
  const [translationId, setTranslationId] = useState(startAt?.translationId ?? startTranslationId ?? DEFAULT_TRANSLATION_ID);
  const [book, setBook] = useState(startAt?.book ?? 'Psalms');
  const [chapter, setChapter] = useState(startAt?.chapter ?? 1);
  const bookInfo = getBookByName(book);
  const { data, loading, error } = useChapterText(translationId, bookInfo?.id ?? null, chapter);

  const chapterVerses: VerseState[] = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.verses)
      .map(([n, text]) => ({ book, chapter, verse: Number(n), text, status: 'untouched' as const, translationId }))
      .sort((a, b) => a.verse - b.verse);
  }, [data, book, chapter, translationId]);

  const selected = chapterVerses.filter((v) => picked.has(verseKey(v))).map((v) => v.verse);
  const setSelected = (next: number[]) => {
    const on = new Set(next);
    removeVerses(chapterVerses.filter((v) => !on.has(v.verse)));
    addVerses(chapterVerses.filter((v) => on.has(v.verse)));
  };
  const toggle = (verse: number) => {
    const v = chapterVerses.find((x) => x.verse === verse);
    if (!v) return;
    if (picked.has(verseKey(v))) removeVerses([v]);
    else addVerses([v]);
  };

  const scrollRef = useRef<ScrollView>(null);
  const dragSelect = useDragSelect({
    ids: chapterVerses.map((v) => v.verse),
    selected,
    setSelected,
    onTap: toggle,
    scrollRef,
  });

  return (
    <View className="flex-1" style={{ gap: space(8) }}>
      <View className="flex-row items-center" style={{ gap: space(8) }}>
        <View className="flex-1">
          <BookPicker
            value={book}
            onChange={(b) => {
              setBook(b);
              setChapter(1);
            }}
          />
        </View>
        <Dropdown
          value={chapter}
          onChange={(c) => setChapter(Number(c))}
          options={Array.from({ length: bookInfo?.chapters ?? 1 }, (_, i) => ({ id: i + 1, label: `Ch. ${i + 1}` }))}
          title="Chapter"
        />
        <Dropdown
          value={translationId}
          onChange={setTranslationId}
          options={PICKER_TRANSLATIONS.map((t) => ({ id: t.id, label: translationLabel(t.id) }))}
          title="Translation"
          searchable={false}
        />
      </View>
      <AppText variant="caption" className="font-sans text-ink-3">
        Tap verses, or hold one and drag to pick a run.
      </AppText>
      <ScrollView ref={scrollRef} {...dragSelect.scrollProps} className="flex-1" contentContainerStyle={{ paddingBottom: space(8) }}>
        {loading && chapterVerses.length === 0 ? (
          <AppText variant="label" className="font-sans text-ink-3 text-center" style={{ paddingVertical: space(24) }}>
            Loading {book} {chapter}…
          </AppText>
        ) : error ? (
          <AppText variant="label" className="font-sans text-danger text-center" style={{ paddingVertical: space(24) }}>
            Couldn't load {book} {chapter}.
          </AppText>
        ) : (
          <GestureDetector gesture={dragSelect.gesture}>
            <View className="bg-surface border border-line rounded-card overflow-hidden" collapsable={false}>
              {chapterVerses.map((v, index) => {
                const on = selected.includes(v.verse);
                return (
                  <Pressable
                    key={v.verse}
                    onLayout={dragSelect.itemLayout(index)}
                    onPress={() => dragSelect.handleTap(v.verse)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${book} ${chapter}:${v.verse}`}
                    className={`flex-row ${index > 0 ? 'border-t border-hairline' : ''} ${on ? 'bg-accent-soft' : ''}`}
                    style={{ paddingVertical: space(10), paddingHorizontal: space(12), gap: space(10) }}
                  >
                    <AppText
                      variant="caption"
                      className={`font-sans font-semibold ${on ? 'text-accent' : 'text-ink-3'}`}
                      style={{ minWidth: space(22), paddingTop: space(2), fontVariant: ['tabular-nums'] }}
                    >
                      {v.verse}
                    </AppText>
                    <AppText variant="body" script={scriptOfVerse(v)} className="font-serif leading-relaxed text-ink flex-1">
                      {v.text}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </GestureDetector>
        )}
      </ScrollView>
    </View>
  );
}

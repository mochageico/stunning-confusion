import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Check, ChevronRight, Flag } from 'lucide-react-native';

import { AppText, useFontScale, useScaledSpace } from './design';
import { Badge } from './blocks';
import { useThemeColors } from './theme';
import { STAGE_FILL } from './VerseStages';
import { ALL_BIBLE_BOOKS, BOOKS, getBookByName } from '../data';
import { fetchChapterText } from '../state/useScripture';
import { QueueItem } from '../types';
import { STAGE_LABEL, STAGE_ORDER, StagePlan, VerseStage, bookIndex, verseStage } from '../lib/stageProgress';
import { allLearnedBy } from '../lib/forecast';

// ============================================================================
// My Verses › By book. The whole Bible at a glance (which books you have
// verses in), then each of those books in Bible order with a square per verse
// of every chapter you're working in, colored by stage. Tapping a chapter
// opens its page, where verses are added and their stage can be set.
// ============================================================================

/** Past this many verses a chapter is a line with marks instead of squares (Psalm 119 has 176). */
const SQUARES_MAX = 60;
const LOTS = 5;

interface ChapterSummary {
  key: string;
  book: string;
  bookId: string;
  chapter: number;
  translationId: string;
  /** Verse number -> the furthest stage it has reached in any translation. */
  stages: Map<number, VerseStage>;
  items: QueueItem[];
}

const rank = (s: VerseStage) => STAGE_ORDER.indexOf(s);

function summarize(queue: QueueItem[]) {
  const chapters = new Map<string, ChapterSummary>();
  const versesPerBook = new Map<string, Set<string>>();
  for (const item of queue) {
    const book = getBookByName(item.book);
    if (!book) continue;
    const key = `${book.id}_${item.chapter}`;
    let ch = chapters.get(key);
    if (!ch) {
      ch = { key, book: book.name, bookId: book.id, chapter: item.chapter, translationId: item.translationId || 'ESV', stages: new Map(), items: [] };
      chapters.set(key, ch);
    }
    ch.items.push(item);
    const stage = verseStage(item);
    const prev = ch.stages.get(item.verseNumber);
    if (!prev || rank(stage) > rank(prev)) ch.stages.set(item.verseNumber, stage);
    if (!versesPerBook.has(book.name)) versesPerBook.set(book.name, new Set());
    versesPerBook.get(book.name)!.add(`${item.chapter}:${item.verseNumber}`);
  }
  const byBook = new Map<string, ChapterSummary[]>();
  for (const ch of chapters.values()) {
    if (!byBook.has(ch.book)) byBook.set(ch.book, []);
    byBook.get(ch.book)!.push(ch);
  }
  const books = Array.from(byBook.entries())
    .map(([name, chs]) => ({ name, chapters: chs.sort((a, b) => a.chapter - b.chapter), verseCount: versesPerBook.get(name)?.size ?? 0 }))
    .sort((a, b) => bookIndex(a.name) - bookIndex(b.name));
  return { books, versesPerBook };
}

/**
 * How many verses each chapter has. Nothing local knows that, so it comes
 * from the chapter's text -- cached on the device, and usually already there
 * because the verses were added from that chapter's page.
 */
function useVerseCounts(chapters: ChapterSummary[]) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const wanted = chapters.map((c) => `${c.translationId}|${c.bookId}|${c.chapter}|${c.key}`).join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of chapters) {
        if (counts[c.key] !== undefined) continue;
        try {
          const text = await fetchChapterText(c.translationId, c.bookId, c.chapter);
          if (cancelled) return;
          const n = text?.verseCount || (text ? Object.keys(text.verses).length : 0);
          if (n > 0) setCounts((prev) => ({ ...prev, [c.key]: n }));
        } catch {
          // Offline or not found: the row falls back to showing just your verses.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  return counts;
}

/** 'GEN' -> 'Gen', '1SA' -> '1Sa'. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** Near dates get a day; far ones only a month, since a few misses move them by weeks. */
function learnedDate(d: Date, now: Date = new Date()): string {
  if (d.getTime() - now.getTime() < 60 * DAY_MS) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

const abbrev = (id: string) => (/\d/.test(id[0]) ? id.slice(0, 2) + id.slice(2).toLowerCase() : id[0] + id.slice(1).toLowerCase());

export default function VersesByBook({
  queue,
  plan,
  starts,
  onOpenChapter,
}: {
  queue: QueueItem[];
  plan: StagePlan;
  /** When each waiting verse starts learning (forecast.ts), for the "all learned" dates. */
  starts: Map<string, Date>;
  onOpenChapter: (book: string, chapter: number) => void;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const { books, versesPerBook } = useMemo(() => summarize(queue), [queue]);
  const allChapters = useMemo(() => books.flatMap((b) => b.chapters), [books]);
  const verseCounts = useVerseCounts(allChapters);
  const columns = scale <= 1.15 ? 8 : 6;

  const bookGrid = (list: typeof ALL_BIBLE_BOOKS) => (
    <View className="flex-row flex-wrap" style={{ marginHorizontal: -2 }}>
      {list.map((b) => {
        const n = versesPerBook.get(b.name)?.size ?? 0;
        const tone = n >= LOTS ? 'bg-accent' : n > 0 ? 'bg-accent-soft border border-accent/30' : 'bg-surface-2';
        const text = n >= LOTS ? 'text-on-accent' : n > 0 ? 'text-accent' : 'text-ink-3';
        return (
          <View key={b.id} style={{ width: `${100 / columns}%`, padding: 2 }}>
            <View
              className={`items-center justify-center rounded-md ${tone}`}
              style={{ minHeight: space(26), paddingVertical: space(3) }}
              accessible
              accessibilityLabel={`${b.name}: ${n} ${n === 1 ? 'verse' : 'verses'}`}
            >
              <AppText variant="micro" className={`font-sans font-semibold ${text}`} numberOfLines={1}>
                {abbrev(b.id)}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );

  const swatch = (stage: VerseStage | 'none') => (
    <View
      className={`rounded-sm ${stage === 'none' ? 'bg-fill' : stage === 'waiting' ? 'bg-surface border border-ink-3' : STAGE_FILL[stage]}`}
      // layout-ok: a square holds no text.
      style={{ width: 12, height: 12 }}
    />
  );

  return (
    <View style={{ gap: space(20) }}>
      <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(10) }}>
        <View style={{ gap: space(2) }}>
          <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
            Your Bible
          </AppText>
          <AppText variant="label" className="font-sans text-ink-2">
            Verses in {versesPerBook.size} of 66 books
          </AppText>
        </View>
        <AppText variant="section" className="font-sans font-semibold text-ink-3">
          Old Testament
        </AppText>
        {bookGrid(BOOKS.ot)}
        <AppText variant="section" className="font-sans font-semibold text-ink-3">
          New Testament
        </AppText>
        {bookGrid(BOOKS.nt)}
      </View>

      <View className="flex-row flex-wrap" style={{ columnGap: space(12), rowGap: space(6), paddingHorizontal: space(4) }}>
        {(['none', ...STAGE_ORDER] as (VerseStage | 'none')[]).map((s) => (
          <View key={s} className="flex-row items-center" style={{ gap: space(5) }}>
            {swatch(s)}
            <AppText variant="caption" className="font-sans text-ink-2">
              {s === 'none' ? 'Not added' : STAGE_LABEL[s]}
            </AppText>
          </View>
        ))}
      </View>

      {books.map((book) => (
        <View key={book.name} style={{ gap: space(8) }}>
          <View className="flex-row items-baseline" style={{ gap: space(8), paddingHorizontal: space(4) }}>
            <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
              {book.name}
            </AppText>
            <AppText variant="label" className="font-sans text-ink-2">
              {book.verseCount} {book.verseCount === 1 ? 'verse' : 'verses'}
            </AppText>
          </View>
          <View className="bg-surface border border-line rounded-card overflow-hidden">
            {book.chapters.map((ch, i) => (
              <ChapterRow
                key={ch.key}
                chapter={ch}
                verseCount={verseCounts[ch.key]}
                learnedBy={allLearnedBy(ch.items, plan, starts)}
                first={i === 0}
                onPress={() => onOpenChapter(ch.book, ch.chapter)}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function ChapterRow({
  chapter,
  verseCount,
  learnedBy,
  first,
  onPress,
}: {
  chapter: ChapterSummary;
  verseCount: number | undefined;
  /** When every verse of this chapter on your list is learned: 'done', a date, or unknown. */
  learnedBy: Date | 'done' | null;
  first: boolean;
  onPress: () => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const held = chapter.stages.size;
  const highest = Math.max(...chapter.stages.keys());
  // Until the chapter's length is known, draw up to the last verse you have.
  const total = Math.max(verseCount ?? highest, highest);
  const allComplete = verseCount !== undefined && held >= verseCount && Array.from(chapter.stages.values()).every((s) => s === 'complete');
  const toGo = verseCount !== undefined ? verseCount - held : null;
  const title = `${chapter.book} ${chapter.chapter}`;
  const countLabel = verseCount !== undefined ? `${held} of ${verseCount}` : `${held} ${held === 1 ? 'verse' : 'verses'}`;
  const sq = Math.round(13 * Math.min(scale, 1.3));

  let badge: { label: string; tone: 'success' | 'accent' } | null = null;
  if (allComplete) badge = { label: 'Whole chapter complete', tone: 'success' };
  else if (toGo === 0) badge = { label: 'The whole chapter', tone: 'accent' };
  else if (toGo !== null && toGo <= 2 && held >= 3) badge = { label: `${toGo} ${toGo === 1 ? 'verse' : 'verses'} from the whole chapter`, tone: 'success' };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${countLabel} verses${badge ? `. ${badge.label}` : ''}`}
      className={`active:bg-surface-2 ${first ? '' : 'border-t border-hairline'}`}
      style={{ paddingVertical: space(12), paddingHorizontal: space(14), gap: space(8) }}
    >
      <View className="flex-row items-center" style={{ gap: space(8) }}>
        <AppText variant="label" className="font-sans font-semibold text-ink flex-1">
          {title}
        </AppText>
        <AppText variant="caption" className="font-sans text-ink-2">
          {countLabel}
        </AppText>
        <ChevronRight size={Math.round(18 * scale)} color={palette.ink3} />
      </View>

      {total <= SQUARES_MAX ? (
        <View className="flex-row flex-wrap" style={{ gap: 3 }}>
          {Array.from({ length: total }).map((_, i) => {
            const s = chapter.stages.get(i + 1);
            return (
              <View
                key={i}
                className={`rounded-sm ${!s ? 'bg-fill' : s === 'waiting' ? 'bg-surface border border-ink-3' : STAGE_FILL[s]}`}
                // layout-ok: a square holds no text.
                style={{ width: sq, height: sq }}
              />
            );
          })}
        </View>
      ) : (
        // A long chapter: one track, with a mark where each of your verses sits.
        // layout-ok: a track holds no text.
        <View className="bg-fill rounded-full" style={{ height: 8, position: 'relative' }}>
          {Array.from(chapter.stages.entries()).map(([v, s]) => (
            <View
              key={v}
              className={`rounded-sm ${s === 'waiting' ? 'bg-surface border border-ink-3' : STAGE_FILL[s]}`}
              // layout-ok: a mark on the track.
              style={{ position: 'absolute', top: -2, width: 5, height: 12, left: `${((v - 1) / total) * 98}%` }}
            />
          ))}
        </View>
      )}

      {badge && <Badge label={badge.label} tone={badge.tone} />}

      {/* Only "all learned": the Complete date is years off for most
          chapters, which read as discouraging rather than motivating. */}
      {learnedBy && (
        <View className="flex-row items-center bg-surface-2 rounded-btn" style={{ paddingVertical: space(8), paddingHorizontal: space(10), gap: space(8) }}>
          {learnedBy === 'done' ? (
            <Check size={Math.round(16 * scale)} color={palette.success} strokeWidth={3} />
          ) : (
            <Flag size={Math.round(16 * scale)} color={palette.ink2} />
          )}
          <AppText variant="caption" className="font-sans text-ink flex-1">
            {verseCount !== undefined && held >= verseCount ? 'Whole chapter' : held === 1 ? 'Your verse' : `All ${held} on your list`}
            {learnedBy === 'done' ? ' learned' : ' learned around'}
          </AppText>
          <AppText variant="caption" className={`font-sans font-semibold ${learnedBy === 'done' ? 'text-success' : 'text-ink'}`}>
            {learnedBy === 'done' ? 'Done' : learnedDate(learnedBy)}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Bookmark, ChevronDown, ChevronUp, Trash2 } from 'lucide-react-native';

import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { AppButton, AppText, useFontScale, useScaledSpace } from '../components/design';
import { Badge, EmptyState, ScreenHeader } from '../components/blocks';
import { bracketColor, useThemeColors } from '../components/theme';
import { SectionTitle, spotName, TakeawayForm } from '../components/TakeawayAsk';
import { sectionIndexOf } from '../lib/sections';
import { buildPath, PathEntry, sectionStatuses } from '../lib/takeaways';
import type { Takeaway } from '../types';

// ============================================================================
// THE TAKEAWAYS PATH
// ----------------------------------------------------------------------------
// A journal of what you've memorized: one stop per section, newest on top,
// alternating sides of one line, each in its section's bracket color. A
// dashed stop is a takeaway not written yet ("Later") or the section that
// unlocks next. Tap a stop to open it and change it.
//
// Mine only for now. The "With my circle" view, the share switch and replies
// are the next stage (MIXED_REVIEW_PLAN.md, stage 6, second half): the opened
// takeaway has a `shareSlot` marked below for the switch.
// ============================================================================

const STOP_LINE = 3;

function Stop({ entry, onOpen }: { entry: Extract<PathEntry, { kind: 'stop' }>; onOpen: () => void }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const color = bracketColor(palette, entry.index);
  const t = entry.takeaway;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${entry.label ?? entry.range}, ${entry.empty ? 'not written yet' : t.text}`}
      className="active:opacity-70 rounded-card bg-surface"
      // layout-ok: the stop's border; dashed while it has no words, in the section's color.
      style={{ borderWidth: 1.5, borderStyle: entry.empty ? 'dashed' : 'solid', borderColor: color, padding: space(10), gap: space(4) }}
    >
      <AppText variant="caption" className="font-sans font-bold text-ink" numberOfLines={2}>
        {entry.label ?? entry.range}
      </AppText>
      {entry.label ? (
        <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
          {entry.range}
        </AppText>
      ) : null}
      {entry.empty ? (
        <AppText variant="caption" className="font-sans italic text-ink-3">
          Not written yet
        </AppText>
      ) : (
        <AppText variant="label" className="font-serif text-ink" numberOfLines={STOP_LINE + 2}>
          {t.text}
        </AppText>
      )}
      {!entry.empty && t.note ? (
        <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
          + a note
        </AppText>
      ) : null}
    </Pressable>
  );
}

function NextStop({ entry }: { entry: Extract<PathEntry, { kind: 'next' }> }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const color = bracketColor(palette, entry.status.index);
  return (
    <View
      className="rounded-card"
      // layout-ok: the stop's dashed border, in the section's color.
      style={{ borderWidth: 1.5, borderStyle: 'dashed', borderColor: color, padding: space(10), gap: space(4) }}
    >
      <AppText variant="caption" className="font-sans font-bold text-ink-2" numberOfLines={2}>
        {entry.status.label ?? entry.range}
      </AppText>
      {entry.status.label ? (
        <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
          {entry.range}
        </AppText>
      ) : null}
      <AppText variant="caption" className="font-sans text-ink-3">
        Unlocks at weekly reviews
      </AppText>
    </View>
  );
}

function Path({ entries, onOpen }: { entries: PathEntry[]; onOpen: (id: string) => void }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const rail = space(30);
  const dot = Math.round(14 * Math.min(scale, 1.3));
  // At large text two half-width columns leave a card a few words a line, so
  // every stop moves to one side of the line (the line then runs down the left).
  const stacked = scale >= 1.3;
  return (
    <View>
      {entries.map((e, i) => {
        const first = i === 0;
        const last = i === entries.length - 1;
        // The line runs through every row; it starts below the first dot and ends at the last.
        const line = (
          // layout-ok: the path's line.
          <View
            style={{
              position: 'absolute',
              left: '50%',
              marginLeft: -1.5,
              width: 3,
              top: first ? '50%' : 0,
              bottom: last ? '50%' : 0,
              backgroundColor: palette.lineStrong,
            }}
          />
        );
        if (e.kind === 'chapter') {
          return (
            <View key={e.key} className={stacked ? 'flex-row items-center' : 'items-center justify-center'}>
              {stacked ? <View className="self-stretch" style={{ width: rail }}>{line}</View> : line}
              <View className="bg-canvas border border-line rounded-full" style={{ marginVertical: space(8), paddingHorizontal: space(12), paddingVertical: space(4) }}>
                <AppText variant="caption" className="font-sans font-bold text-ink-2">
                  {e.book} {e.chapter}
                </AppText>
              </View>
            </View>
          );
        }
        const color = bracketColor(palette, e.kind === 'stop' ? e.index : e.status.index);
        const filled = e.kind === 'stop' && !e.empty;
        const card = e.kind === 'stop' ? <Stop entry={e} onOpen={() => onOpen(e.takeaway.id)} /> : <NextStop entry={e} />;
        const gap = { marginVertical: space(6) };
        const dotView = (
          <View className="items-center justify-center self-stretch" style={{ width: rail }}>
            {line}
            {/* layout-ok: the stop's dot, filled once written. */}
            <View className="rounded-full" style={{ width: dot, height: dot, borderWidth: 3, borderColor: color, backgroundColor: filled ? color : palette.canvas }} />
          </View>
        );
        if (stacked) {
          return (
            <View key={e.key} className="flex-row items-center">
              {dotView}
              <View className="flex-1" style={gap}>{card}</View>
            </View>
          );
        }
        return (
          <View key={e.key} className="flex-row items-center">
            <View className="flex-1" style={gap}>{e.side === 'left' ? card : null}</View>
            {dotView}
            <View className="flex-1" style={gap}>{e.side === 'right' ? card : null}</View>
          </View>
        );
      })}
    </View>
  );
}

function Opened({ state, takeaway, onClose }: { state: AppState; takeaway: Takeaway; onClose: () => void }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  const [showVerses, setShowVerses] = useState(false);
  const doc = state.sectionsForChapter(takeaway.book, takeaway.chapter);
  const index = doc ? Math.max(0, sectionIndexOf(doc.starts, takeaway.sectionStart)) : 0;
  const label = doc?.labels[takeaway.sectionStart]?.trim() || takeaway.label || undefined;
  const name = spotName(takeaway);
  const empty = takeaway.status === 'later' || takeaway.text.trim() === '';
  const spot = {
    book: takeaway.book,
    chapter: takeaway.chapter,
    sectionStart: takeaway.sectionStart,
    sectionEnd: takeaway.sectionEnd,
    label,
  };

  const verses = useMemo(() => {
    const seen = new Map<number, string>();
    for (const q of state.memoryQueue) {
      if (q.book === takeaway.book && q.chapter === takeaway.chapter && q.verseNumber >= takeaway.sectionStart && q.verseNumber <= takeaway.sectionEnd && !seen.has(q.verseNumber)) {
        seen.set(q.verseNumber, q.text);
      }
    }
    return [...seen.entries()].sort((a, b) => a[0] - b[0]);
  }, [state.memoryQueue, takeaway.book, takeaway.chapter, takeaway.sectionStart, takeaway.sectionEnd]);

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }} keyboardShouldPersistTaps="handled">
      <ScreenHeader title={empty ? 'Takeaway' : 'Your takeaway'} onBack={onClose} backLabel="Path" />
      <SectionTitle index={index} label={label} name={name} />
      {empty && (
        <View className="flex-row">
          <Badge label="Not written yet" tone="neutral" />
        </View>
      )}

      <TakeawayForm
        key={takeaway.id + takeaway.updatedAt}
        initialText={takeaway.text}
        initialNote={takeaway.note ?? ''}
        saveLabel="Save"
        onSave={(text, note) => {
          void state.saveTakeaway(spot, { text, note, status: 'saved' });
          onClose();
        }}
        // The share switch goes here when sharing with a circle is built (next stage).
        shareSlot={null}
      />

      {verses.length > 0 && (
        <View style={{ gap: space(8) }}>
          <Pressable onPress={() => setShowVerses((v) => !v)} accessibilityRole="button" className="flex-row items-center self-start active:opacity-60" style={{ gap: space(4), minHeight: 44 }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">
              {showVerses ? 'Hide the verses' : 'Show the verses'}
            </AppText>
            {showVerses ? <ChevronUp size={16} color={palette.ink3} /> : <ChevronDown size={16} color={palette.ink3} />}
          </Pressable>
          {showVerses && (
            <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(12), gap: space(6) }}>
              {verses.map(([n, text]) => (
                <AppText key={n} variant="label" className="font-serif text-ink-2">
                  <AppText variant="caption" className="font-sans font-bold text-ink-3">{n}  </AppText>
                  {text}
                </AppText>
              ))}
            </View>
          )}
        </View>
      )}

      <AppButton
        variant="quiet"
        Icon={Trash2}
        label={empty ? 'Remove this stop' : 'Remove this takeaway'}
        onPress={() => {
          void state.deleteTakeaway(takeaway.id);
          onClose();
        }}
      />
    </ScrollView>
  );
}

export default function TakeawaysScreen({ state }: { state: AppState }) {
  const { memoryQueue, sectionsForChapter, takeaways, handleBack } = state;
  const space = useScaledSpace();
  const [openId, setOpenId] = useState<string | null>(null);

  const entries = useMemo(
    () => buildPath(takeaways, sectionStatuses(memoryQueue, sectionsForChapter), sectionsForChapter),
    // sectionsForChapter is remade each render; chapterSections is what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [takeaways, memoryQueue, state.chapterSections]
  );
  const opened = openId ? takeaways[openId] : null;
  if (opened) {
    return (
      <FadeInView style={{ flex: 1 }}>
        <Opened state={state} takeaway={opened} onClose={() => setOpenId(null)} />
      </FadeInView>
    );
  }

  const written = Object.values(takeaways).filter((t) => t.status !== 'draft' && t.status !== 'later' && t.text.trim()).length;
  return (
    <FadeInView style={{ flex: 1 }}>
      <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-5 pb-12" contentContainerStyle={{ gap: space(16) }}>
        <ScreenHeader
          title="Takeaways"
          onBack={handleBack}
          subtitle={written === 0 ? 'The main point of each section, in your own words.' : `${written} written. Newest on top.`}
        />
        {entries.length === 0 ? (
          <EmptyState
            Icon={Bookmark}
            title="Nothing here yet"
            message="When every verse of a section is in weekly reviews, you'll be asked for its main point. It lands here, one stop at a time."
          />
        ) : (
          <Path entries={entries} onOpen={setOpenId} />
        )}
      </ScrollView>
    </FadeInView>
  );
}

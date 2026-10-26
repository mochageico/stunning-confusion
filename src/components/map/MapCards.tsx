import React from 'react';
import { Pressable, View } from 'react-native';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

import type { QueueItem, StarRef } from '../../types';
import type { VersePageRef } from '../../state/useAppState';
import { AppButton, AppIconButton, AppText, useFontScale, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';
import { StageDot } from '../VerseStages';
import { useChapterText } from '../../state/useScripture';
import { getBookByName } from '../../data';
import { starLabel } from '../../lib/mapLayout';
import { STAGE_LABEL, STAGE_ORDER, verseStage } from '../../lib/stageProgress';
import { starStage } from '../../lib/constellations';
import type { EchoView } from './mapModel';

// ============================================================================
// The card along the bottom of the map: the tapped star, line or echo.
// One at a time; the map stays usable above it.
// ============================================================================

/** The verses of this star the user holds, as a verse page ref (furthest translation wins ties). */
export function heldPage(ref: StarRef, queue: QueueItem[]): VersePageRef | null {
  const held = queue.filter(
    (q) =>
      q.book === ref.book &&
      q.chapter === ref.chapter &&
      q.verseNumber >= ref.start &&
      q.verseNumber <= ref.end &&
      STAGE_ORDER.indexOf(verseStage(q)) > STAGE_ORDER.indexOf('waiting')
  );
  if (held.length === 0) return null;
  const count = new Map<string, number>();
  for (const q of held) count.set(q.translationId || 'BSB', (count.get(q.translationId || 'BSB') ?? 0) + 1);
  const translationId = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const verses = [...new Set(held.filter((q) => (q.translationId || 'BSB') === translationId).map((q) => q.verseNumber))].sort((a, b) => a - b);
  return { book: ref.book, chapter: ref.chapter, verses, translationId };
}

/** The verse text the user already has for this star, from the queue (no fetch). */
function heldText(ref: StarRef, queue: QueueItem[]): string {
  const page = heldPage(ref, queue);
  if (!page) return '';
  return page.verses
    .map((v) => queue.find((q) => q.book === ref.book && q.chapter === ref.chapter && q.verseNumber === v && (q.translationId || 'BSB') === page.translationId)?.text ?? '')
    .filter(Boolean)
    .join(' ');
}

export interface CardActions {
  onOpenVerse: (page: VersePageRef) => void;
  /** Stage 4 sends "Add to My Verses" to the chapter page, where adding already lives. */
  onAddVerses: (ref: StarRef) => void;
  /** Connect to another verse. Stage 5; the button is left out until it's passed. */
  onConnect?: (ref: StarRef) => void;
}

function CardShell({ children, onClose, onLayout }: { children: React.ReactNode; onClose: () => void; onLayout?: (h: number) => void }) {
  const space = useScaledSpace();
  const palette = useThemeColors();
  return (
    <View
      className="bg-surface border border-line-strong rounded-card"
      style={{ padding: space(14), gap: space(10) }}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.height)}
    >
      <View style={{ position: 'absolute', top: space(8), right: space(8), zIndex: 1 }}>
        <AppIconButton Icon={X} variant="bare" diameter={32} iconColor={palette.ink2} accessibilityLabel="Close" onPress={onClose} />
      </View>
      {children}
    </View>
  );
}

/** "Daily" with its dot, or "Not in My Verses yet". */
function StageLine({ refr, queue, note }: { refr: StarRef; queue: QueueItem[]; note?: string }) {
  const space = useScaledSpace();
  const stage = starStage(refr, queue);
  return (
    <View className="flex-row items-center" style={{ gap: space(8) }}>
      {stage ? <StageDot stage={stage} /> : <StageDot stage="waiting" />}
      <AppText variant="label" className="font-sans text-ink-2 flex-1" numberOfLines={1}>
        {stage ? STAGE_LABEL[stage] : 'Not in My Verses yet'}
        {note ? ` · ${note}` : ''}
      </AppText>
    </View>
  );
}

export function StarCard({
  refr,
  constellationTitle,
  queue,
  echoes,
  onCompare,
  onClose,
  onLayout,
  actions,
  compact,
}: {
  refr: StarRef;
  constellationTitle?: string;
  queue: QueueItem[];
  echoes: EchoView[];
  onCompare: (index: number) => void;
  onClose: () => void;
  onLayout?: (h: number) => void;
  actions: CardActions;
  /** A short screen (iPhone SE): leave out the verse text so the map keeps some room. */
  compact?: boolean;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();
  const page = heldPage(refr, queue);
  const text = page && !compact ? heldText(refr, queue) : '';
  return (
    <CardShell onClose={onClose} onLayout={onLayout}>
      <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header" style={{ paddingRight: space(36) }}>
        {starLabel(refr)}
      </AppText>
      <StageLine refr={refr} queue={queue} note={constellationTitle ? `In ${constellationTitle}` : undefined} />
      {text ? (
        <AppText variant="caption" className="font-serif text-ink-2" numberOfLines={2}>
          {text}
        </AppText>
      ) : null}
      {echoes.map((e, i) => (
        <Pressable
          key={i}
          onPress={() => onCompare(i)}
          accessibilityRole="button"
          accessibilityHint="Shows both passages"
          className="flex-row items-center border-t border-hairline active:opacity-60"
          style={{ paddingTop: space(8), gap: space(6), minHeight: 44 }}
        >
          <AppText variant="label" className="font-sans text-ink flex-1">
            {e.sentence}
          </AppText>
          <AppText variant="label" className="font-sans font-semibold text-accent">
            Compare
          </AppText>
          <ChevronRight size={Math.round(16 * scale)} color={palette.accent} />
        </Pressable>
      ))}
      <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
        {page ? (
          <AppButton size="md" variant="primary" label="Open verse" onPress={() => actions.onOpenVerse(page)} />
        ) : (
          <AppButton size="md" variant="primary" label="Add to My Verses" onPress={() => actions.onAddVerses(refr)} />
        )}
        {page && actions.onConnect ? (
          <AppButton size="md" variant="secondary" label="Connect" onPress={() => actions.onConnect!(refr)} />
        ) : null}
      </View>
    </CardShell>
  );
}

/** One end of a line or echo: reference, stage, and its open/add button. */
function PassageBlock({ refr, queue, actions, withText }: { refr: StarRef; queue: QueueItem[]; actions: CardActions; withText?: string }) {
  const space = useScaledSpace();
  const page = heldPage(refr, queue);
  return (
    <View style={{ gap: space(6) }}>
      <View className="flex-row items-center" style={{ gap: space(8) }}>
        <AppText variant="label" className="font-sans font-bold text-ink flex-1">
          {starLabel(refr)}
        </AppText>
        {page ? (
          <AppButton size="sm" variant="secondary" label="Open" accessibilityLabel={`Open ${starLabel(refr)}`} onPress={() => actions.onOpenVerse(page)} />
        ) : (
          <AppButton size="sm" variant="secondary" label="Add to My Verses" accessibilityLabel={`Add ${starLabel(refr)} to My Verses`} onPress={() => actions.onAddVerses(refr)} />
        )}
      </View>
      <StageLine refr={refr} queue={queue} />
      {withText ? (
        <AppText variant="caption" className="font-serif text-ink-2" numberOfLines={4}>
          {withText}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * A line between two stars. Stage 5 fills this in (the user's label, naming
 * it once both are learned, deleting, the curated guide); for now it shows
 * the two passages and any label already written.
 */
export function LineCard({
  a,
  b,
  label,
  constellationTitle,
  queue,
  onClose,
  onLayout,
  actions,
}: {
  a: StarRef;
  b: StarRef;
  label?: string;
  constellationTitle?: string;
  queue: QueueItem[];
  onClose: () => void;
  onLayout?: (h: number) => void;
  actions: CardActions;
}) {
  const space = useScaledSpace();
  return (
    <CardShell onClose={onClose} onLayout={onLayout}>
      <View style={{ gap: space(2), paddingRight: space(36), minHeight: space(28), justifyContent: 'center' }}>
        {label ? (
          <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
            {label}
          </AppText>
        ) : null}
        <AppText variant="label" className="font-sans text-ink-2">
          {constellationTitle ? `A line in ${constellationTitle}` : 'You joined these'}
        </AppText>
      </View>
      <PassageBlock refr={a} queue={queue} actions={actions} />
      <View className="border-t border-hairline" />
      <PassageBlock refr={b} queue={queue} actions={actions} />
    </CardShell>
  );
}

/** Both ends of an echo, one above the other (a phone is too narrow for two columns of verse). */
export function EchoCard({
  view,
  queue,
  translationId,
  onBack,
  onClose,
  onLayout,
  actions,
}: {
  view: EchoView;
  queue: QueueItem[];
  translationId: string;
  onBack: () => void;
  onClose: () => void;
  onLayout?: (h: number) => void;
  actions: CardActions;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();
  const nt = useRangeText(view.echo.nt, queue, translationId);
  const ot = useRangeText(view.echo.ot, queue, translationId);
  return (
    <CardShell onClose={onClose} onLayout={onLayout}>
      <Pressable onPress={onBack} accessibilityRole="button" hitSlop={10} className="flex-row items-center self-start active:opacity-60" style={{ gap: space(2) }}>
        <ChevronLeft size={Math.round(16 * scale)} color={palette.accent} />
        <AppText variant="label" className="font-sans font-semibold text-accent">
          {starLabel(view.here)}
        </AppText>
      </Pressable>
      <AppText variant="label" className="font-sans font-semibold text-ink" style={{ paddingRight: space(30) }}>
        {view.sentence}
      </AppText>
      <PassageBlock refr={view.echo.nt} queue={queue} actions={actions} withText={nt} />
      <View className="border-t border-hairline" />
      <PassageBlock refr={view.echo.ot} queue={queue} actions={actions} withText={ot} />
    </CardShell>
  );
}

/** A passage's text: the held translation from the queue if there is one, else fetched. */
function useRangeText(ref: StarRef, queue: QueueItem[], fallbackTranslation: string): string {
  const page = heldPage(ref, queue);
  const translationId = page?.translationId ?? fallbackTranslation;
  const { data } = useChapterText(translationId, getBookByName(ref.book)?.id ?? null, ref.chapter);
  const parts: string[] = [];
  for (let v = ref.start; v <= ref.end; v++) {
    const t = data?.verses[String(v)] ?? queue.find((q) => q.book === ref.book && q.chapter === ref.chapter && q.verseNumber === v)?.text;
    if (t) parts.push(t);
  }
  return parts.join(' ');
}

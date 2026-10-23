import React, { useState } from 'react';
import { View } from 'react-native';
import { BookmarkCheck } from 'lucide-react-native';

import type { AppState } from '../state/useAppState';
import type { TakeawaySpot } from '../state/useTakeaways';
import { PendingAsk } from '../lib/takeaways';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from './design';
import { bracketColor, useThemeColors } from './theme';

// ============================================================================
// THE ASK -- "What's the main point?"
// ----------------------------------------------------------------------------
// TakeawayForm is the one form: the ask (end of a Mixed review, a quiet card on
// Today) and an opened takeaway on the path both use it. TakeawayAsk wraps it
// for a section that just reached weekly reviews. MIXED_REVIEW_PLAN.md,
// stage 6. Nothing here shares a takeaway with anyone; see `shareSlot`.
// ============================================================================

export const spotOf = (a: Pick<PendingAsk, 'book' | 'chapter' | 'start' | 'end' | 'label'>): TakeawaySpot => ({
  book: a.book,
  chapter: a.chapter,
  sectionStart: a.start,
  sectionEnd: a.end,
  label: a.label,
});

/** "Matthew 7:1–5" */
export const spotName = (s: Pick<TakeawaySpot, 'book' | 'chapter' | 'sectionStart' | 'sectionEnd'>): string =>
  `${s.book} ${s.chapter}:${s.sectionStart === s.sectionEnd ? s.sectionStart : `${s.sectionStart}–${s.sectionEnd}`}`;

/** The section's name and verses, with its bracket color down the side. */
export function SectionTitle({ index, label, name }: { index: number; label?: string; name: string }) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  return (
    <View className="flex-row items-stretch" style={{ gap: space(10) }}>
      {/* layout-ok: the section's bracket, a colored bar with no text. */}
      <View className="rounded-full" style={{ width: Math.max(4, Math.round(space(4))), backgroundColor: bracketColor(palette, index) }} />
      <View className="flex-1" style={{ gap: space(2) }}>
        <AppText variant="title" className="font-sans font-bold text-ink">
          {label || name}
        </AppText>
        {label ? (
          <AppText variant="caption" className="font-sans text-ink-3">
            {name}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The main point and an optional note. `onSave` gets both; `onLater` (the ask
 * only) leaves the empty dashed stop. `shareSlot` is where the share switch
 * goes when sharing is built (the next stage); it draws nothing until then.
 */
export function TakeawayForm({
  initialText = '',
  initialNote = '',
  saveLabel = 'Save',
  onSave,
  onLater,
  shareSlot = null,
}: {
  initialText?: string;
  initialNote?: string;
  saveLabel?: string;
  onSave: (text: string, note: string) => void;
  onLater?: (text: string, note: string) => void;
  shareSlot?: React.ReactNode;
}) {
  const space = useScaledSpace();
  const [text, setText] = useState(initialText);
  const [note, setNote] = useState(initialNote);
  const canSave = text.trim().length > 0;
  return (
    <View style={{ gap: space(12) }}>
      <View style={{ gap: space(6) }}>
        <AppText variant="label" className="font-sans font-semibold text-ink">
          What's the main point?
        </AppText>
        <AppTextInput
          value={text}
          onChangeText={setText}
          multiline
          variant="label"
          placeholder="In a sentence, in your own words"
          accessibilityLabel="The main point, in your own words"
          className="font-sans text-ink bg-surface border border-line rounded-card"
          style={{ padding: space(10), minHeight: space(96), textAlignVertical: 'top' }}
        />
      </View>
      <View style={{ gap: space(6) }}>
        <AppText variant="caption" className="font-sans font-semibold text-ink-3">
          A note (optional)
        </AppText>
        <AppTextInput
          value={note}
          onChangeText={setNote}
          multiline
          variant="label"
          placeholder="Anything else you want to remember"
          accessibilityLabel="A note under the takeaway, optional"
          className="font-sans text-ink bg-surface border border-line rounded-card"
          style={{ padding: space(10), minHeight: space(56), textAlignVertical: 'top' }}
        />
      </View>
      {shareSlot}
      <View className="flex-row" style={{ gap: space(8) }}>
        {onLater && <AppButton variant="quiet" label="Later" onPress={() => onLater(text, note)} className="flex-1" />}
        <AppButton variant="primary" label={saveLabel} disabled={!canSave} onPress={() => onSave(text, note)} className="flex-1" />
      </View>
    </View>
  );
}

/**
 * The ask for the section that is ready, or nothing. `quiet` is Today's card:
 * a short line and two buttons, the form opening in place on "Write it".
 * Otherwise (the end of a Mixed review) the form is open from the start.
 */
export function TakeawayAsk({ state, quiet = false }: { state: AppState; quiet?: boolean }) {
  const ask = state.nextTakeawayAsk;
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const [open, setOpen] = useState(!quiet);
  if (!ask) return null;

  const spot = spotOf(ask);
  const name = spotName(spot);
  const later = (text: string, note: string) => {
    void state.saveTakeaway(spot, { text, note, status: 'later' });
    setOpen(!quiet);
  };
  const save = (text: string, note: string) => {
    void state.saveTakeaway(spot, { text, note, status: 'saved' });
    setOpen(!quiet);
  };

  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(12) }}>
      <View className="flex-row items-center" style={{ gap: space(8) }}>
        <BookmarkCheck size={Math.round(18 * scale)} color={palette.accent} />
        <AppText variant="label" className="font-sans font-semibold text-accent flex-1">
          Ready for a takeaway
        </AppText>
      </View>
      <SectionTitle index={ask.index} label={ask.label} name={name} />
      <AppText variant="caption" className="font-sans text-ink-2">
        Every verse here is in weekly reviews now. Asked once, and you can write it later from the path.
      </AppText>
      {open ? (
        // Keyed by section: the next ask starts empty rather than keeping the last one's words.
        <TakeawayForm key={`${ask.book}|${ask.chapter}|${ask.start}`} initialText={ask.prefill} initialNote={ask.note} onSave={save} onLater={later} />
      ) : (
        <View className="flex-row" style={{ gap: space(8) }}>
          <AppButton variant="quiet" label="Later" onPress={() => later(ask.prefill, ask.note)} className="flex-1" />
          <AppButton variant="primary" label="Write it" onPress={() => setOpen(true)} className="flex-1" />
        </View>
      )}
    </View>
  );
}

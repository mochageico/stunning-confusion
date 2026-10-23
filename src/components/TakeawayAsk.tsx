import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { BookmarkCheck, Check } from 'lucide-react-native';

import type { AppState } from '../state/useAppState';
import type { TakeawaySpot } from '../state/useTakeaways';
import { PendingAsk } from '../lib/takeaways';
import { nextSharedTo, rememberedChoice } from '../lib/takeawaySharing';
import { AppButton, AppText, AppTextInput, Switch, useFontScale, useScaledSpace } from './design';
import { bracketColor, useThemeColors } from './theme';

// ============================================================================
// THE ASK -- "What's the main point?"
// ----------------------------------------------------------------------------
// TakeawayForm is the one form: the ask (end of a Mixed review, a quiet card on
// Today) and an opened takeaway on the path both use it. TakeawayAsk wraps it
// for a section that just reached weekly reviews. MIXED_REVIEW_PLAN.md,
// stage 6. ShareSwitch goes in the form's `shareSlot`, in both places: it
// shares the takeaway with one or more circles and remembers the last choice.
// ============================================================================

export const spotOf = (a: Pick<PendingAsk, 'book' | 'chapter' | 'start' | 'end' | 'label' | 'index'>): TakeawaySpot => ({
  book: a.book,
  chapter: a.chapter,
  sectionStart: a.start,
  sectionEnd: a.end,
  label: a.label,
  index: a.index,
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
 * "Share with my circle": a switch, and with more than one circle a checkbox
 * per circle under it. `value` is the circle ids switched on (empty = not
 * shared). Draws nothing for someone in no circle.
 */
export function ShareSwitch({
  circles,
  value,
  onChange,
}: {
  circles: { id: string; name: string }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  // The circles picked before the switch went off, so switching back on restores them.
  const lastPick = useRef<string[]>([]);
  if (circles.length === 0) return null;
  const on = value.length > 0;
  const many = circles.length > 1;
  const title = many ? 'Share with my circles' : `Share with ${circles[0].name}`;
  const box = Math.round(22 * scale);
  const toggle = (next: boolean) => {
    if (!next) {
      lastPick.current = value;
      onChange([]);
    } else {
      const back = lastPick.current.filter((id) => circles.some((c) => c.id === id));
      onChange(back.length ? back : [circles[0].id]);
    }
  };
  const pick = (id: string) => {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    // Unticking the last circle is the same as switching sharing off.
    if (next.length === 0) lastPick.current = value;
    onChange(next);
  };
  return (
    <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(12), gap: space(10) }}>
      <View className="flex-row items-center justify-between" style={{ gap: space(10) }}>
        <View className="flex-1" style={{ gap: space(2) }}>
          <AppText variant="label" className="font-sans font-semibold text-ink">
            {title}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3">
            {on ? 'They see it and your note, and can reply.' : 'Only you see it.'}
          </AppText>
        </View>
        <Switch value={on} onChange={toggle} accessibilityLabel={title} />
      </View>
      {on && many && (
        <View style={{ gap: space(2) }}>
          {circles.map((c) => {
            const ticked = value.includes(c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() => pick(c.id)}
                accessibilityRole="checkbox"
                accessibilityLabel={c.name}
                accessibilityState={{ checked: ticked }}
                aria-checked={ticked}
                className="flex-row items-center active:opacity-70"
                style={{ minHeight: 44, gap: space(10) }}
              >
                {/* The box keeps its border either way; only the fill changes. */}
                <View
                  className={`rounded-md border-2 items-center justify-center shrink-0 ${ticked ? 'bg-accent border-accent' : 'border-line'}`}
                  style={{ width: box, height: box }}
                >
                  {ticked ? <Check size={Math.round(14 * scale)} color={palette.onAccent} strokeWidth={3} /> : null}
                </View>
                <AppText variant="label" className="font-sans text-ink flex-1">
                  {c.name}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

/**
 * The share switch's state for a takeaway not written yet: it starts on the
 * last choice (once that has loaded from the device) until the user changes
 * it. Returns [choice, change, the circle ids the switch offers].
 */
export function useNewShareChoice(state: AppState): [string[], (ids: string[]) => void, string[]] {
  const offered = state.myCircles.map((c) => c.id);
  const remembered = rememberedChoice(state.lastShareChoice, offered);
  const [choice, setChoice] = useState<string[]>(remembered);
  const touched = useRef(false);
  const rememberedKey = remembered.join(',');
  useEffect(() => {
    if (!touched.current) setChoice(rememberedKey ? rememberedKey.split(',') : []);
  }, [rememberedKey]);
  const change = (ids: string[]) => {
    touched.current = true;
    setChoice(ids);
  };
  return [choice, change, offered];
}

/**
 * The main point and an optional note. `onSave` gets both; `onLater` (the ask
 * only) leaves the empty dashed stop. `shareSlot` holds the share switch
 * (ShareSwitch), above the buttons.
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
  const [share, setShare, offered] = useNewShareChoice(state);
  if (!ask) return null;

  const spot = spotOf(ask);
  const name = spotName(spot);
  const later = (text: string, note: string) => {
    void state.saveTakeaway(spot, { text, note, status: 'later' });
    setOpen(!quiet);
  };
  const save = (text: string, note: string) => {
    void state.saveTakeaway(spot, { text, note, status: 'saved', sharedTo: nextSharedTo(undefined, share, offered) });
    state.setLastShareChoice(share);
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
        <TakeawayForm
          key={`${ask.book}|${ask.chapter}|${ask.start}`}
          initialText={ask.prefill}
          initialNote={ask.note}
          onSave={save}
          onLater={later}
          shareSlot={<ShareSwitch circles={state.myCircles} value={share} onChange={setShare} />}
        />
      ) : (
        <View className="flex-row" style={{ gap: space(8) }}>
          <AppButton variant="quiet" label="Later" onPress={() => later(ask.prefill, ask.note)} className="flex-1" />
          <AppButton variant="primary" label="Write it" onPress={() => setOpen(true)} className="flex-1" />
        </View>
      )}
    </View>
  );
}

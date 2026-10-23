import { useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GripHorizontal } from 'lucide-react-native';

import type { TextScript } from '../types';
import { Section, sectionRangeText } from '../lib/sections';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from './design';
import { bracketColor, useThemeColors } from './theme';

// ============================================================================
// CHAPTER SECTION BRACKETS
// ----------------------------------------------------------------------------
// The pieces ChapterLandingScreen's verse list draws sections with: a colored
// bracket down the side of each section's verses, a header row at the top of
// it (label, memory-phrase word), and in Edit sections mode a handle on the
// bracket's top edge to drag, plus fields to name the section and give it a
// phrase word. The logic (splitting, moving, merging) is in lib/sections.ts.
//
// The bracket is drawn one row at a time -- each row has a gutter holding its
// slice of the bar -- so it grows with its rows at any text size with no
// measuring. Bracket colors are their own tokens, never the stage colors
// (theme.tsx, BRACKETS).
// ============================================================================

/** Width of the bracket gutter. Edit mode is wider: it holds the handle. */
export function useGutterWidth(editing: boolean): number {
  const space = useScaledSpace();
  return editing ? space(40) : space(20);
}

const BAR = 3;

/**
 * One row's slice of a section bracket. `top`: the row opens the section, so
 * the bar starts with a tick toward the text; `bottom`: it closes the section.
 * `width` 0 draws nothing (a chapter with no sections).
 */
export function BracketGutter({
  index,
  width,
  top,
  bottom,
  rtl,
  tickOffset,
  children,
}: {
  index: number;
  width: number;
  top?: boolean;
  bottom?: boolean;
  rtl?: boolean;
  /** How far down the row the top tick sits, to line up with the label. */
  tickOffset?: number;
  children?: React.ReactNode;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  if (width === 0) return null;
  const color = bracketColor(palette, index);
  const barX = Math.round(width / 2 - BAR / 2);
  const tickY = tickOffset ?? space(14);
  const end = space(10);
  // The tick points toward the text: right of the bar, or left in Hebrew.
  const tick = rtl ? { left: 0, width: barX + BAR } : { left: barX, width: width - barX };
  return (
    <View style={{ width, alignSelf: 'stretch' }} importantForAccessibility="no-hide-descendants">
      <View
        style={{
          position: 'absolute',
          left: barX,
          width: BAR,
          top: top ? tickY : 0,
          bottom: bottom ? end : 0,
          backgroundColor: color,
          borderTopLeftRadius: top ? BAR : 0,
          borderTopRightRadius: top ? BAR : 0,
          borderBottomLeftRadius: bottom ? BAR : 0,
          borderBottomRightRadius: bottom ? BAR : 0,
        }}
      />
      {top ? (
        <View style={{ position: 'absolute', top: tickY, height: BAR, borderRadius: BAR, backgroundColor: color, ...tick }} />
      ) : null}
      {bottom ? (
        <View style={{ position: 'absolute', bottom: end, height: BAR, borderRadius: BAR, backgroundColor: color, ...tick }} />
      ) : null}
      {children}
    </View>
  );
}

/**
 * While a handle is dragged: an accent line across the top of the verse the
 * section will start on when the finger lifts.
 */
export function DropLine() {
  return (
    <View
      className="bg-accent"
      // layout-ok: a fixed 3pt rule, not a box holding text.
      style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 3, borderRadius: 2 }}
      pointerEvents="none"
    />
  );
}

/**
 * The handle on a section's top edge. Drag to move where the section starts;
 * double-tap to join it to the section above. Screen readers get the same
 * through adjust actions (swipe up/down) and a "Join" action.
 */
function SectionHandle({
  index,
  label,
  onDragStart,
  onDragMove,
  onDragEnd,
  onJoin,
  onStep,
}: {
  index: number;
  label: string;
  onDragStart: (absoluteY: number) => void;
  onDragMove: (absoluteY: number) => void;
  onDragEnd: (commit: boolean) => void;
  onJoin: () => void;
  /** Move the start one verse: +1 down, -1 up. */
  onStep: (delta: 1 | -1) => void;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  const scale = useFontScale();
  const size = space(26);

  // The gestures are built once; their callbacks read the latest props here.
  // No state of their own: gesture callbacks are compiled as worklets, which
  // get a copy of the variables they close over, so a flag set in onStart
  // would never be seen in onEnd. The screen tracks the drag (dragRef there),
  // and its onDragEnd does nothing when no drag is under way.
  const latest = useRef({ onDragStart, onDragMove, onDragEnd, onJoin });
  latest.current = { onDragStart, onDragMove, onDragEnd, onJoin };

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(2)
      .onStart((e) => latest.current.onDragStart(e.absoluteY))
      .onUpdate((e) => latest.current.onDragMove(e.absoluteY))
      .onEnd((_e, success) => latest.current.onDragEnd(success))
      // After onEnd this is a no-op; alone (a cancelled drag) it drops the drag.
      .onFinalize(() => latest.current.onDragEnd(false));
    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((_e, success) => {
        if (success) latest.current.onJoin();
      });
    return Gesture.Race(pan, doubleTap);
  }, []);

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Start of ${label}`}
        accessibilityHint="Swipe up or down to move where this section starts."
        accessibilityActions={[
          { name: 'increment', label: 'Start one verse later' },
          { name: 'decrement', label: 'Start one verse earlier' },
          { name: 'join', label: 'Join with the section above' },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') onStep(1);
          else if (e.nativeEvent.actionName === 'decrement') onStep(-1);
          else if (e.nativeEvent.actionName === 'join') onJoin();
        }}
        hitSlop={10}
        className="items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bracketColor(palette, index),
        }}
      >
        <GripHorizontal size={Math.round(14 * scale)} color={palette.onAccent} strokeWidth={2.4} />
      </View>
    </GestureDetector>
  );
}

/**
 * The row at the top of a section's bracket: its label (or its verse range
 * when it has none) and its memory-phrase word (or the letter the word starts
 * with). In edit mode: the handle, a label field and a word field.
 */
export function SectionHeaderRow({
  section,
  letter,
  script,
  rtl,
  editing,
  gutter,
  first,
  onLayout,
  labelText,
  wordText,
  onLabel,
  onPhraseWord,
  handle,
}: {
  section: Section;
  /** The opening verse's first letter, '' if unknown. */
  letter: string;
  script: TextScript;
  rtl: boolean;
  editing: boolean;
  gutter: number;
  /** The chapter's first section: no divider above, no handle (it can't move). */
  first: boolean;
  onLayout?: (e: import('react-native').LayoutChangeEvent) => void;
  /** Edit mode: the fields' text exactly as typed (section.label is trimmed). */
  labelText?: string;
  wordText?: string;
  onLabel?: (text: string) => void;
  onPhraseWord?: (text: string) => void;
  handle?: Omit<React.ComponentProps<typeof SectionHandle>, 'index' | 'label'>;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const range = sectionRangeText(section);
  const shownLetter = displayLetter(letter, script);
  const name = section.label || range;
  const handleSize = space(26);
  // The tick (or handle) lines up with the middle of the label's first line.
  const tickOffset = editing ? space(12) + Math.round(handleSize / 2) - 1 : space(10) + Math.round(9 * scale);

  return (
    <View
      onLayout={onLayout}
      className={`${rtl ? 'flex-row-reverse' : 'flex-row'} ${first ? '' : 'border-t border-hairline'}`}
    >
      <BracketGutter index={section.index} width={gutter} top rtl={rtl} tickOffset={tickOffset}>
        {editing && !first && handle ? (
          <View
            style={{ position: 'absolute', left: 0, right: 0, top: tickOffset - Math.round(handleSize / 2) + 1 }}
            className="items-center"
          >
            <SectionHandle index={section.index} label={name} {...handle} />
          </View>
        ) : null}
      </BracketGutter>

      {editing ? (
        <View
          className="flex-1"
          style={{ paddingVertical: space(10), paddingRight: space(14), paddingLeft: space(4), gap: space(6) }}
        >
          {/* Side by side when they fit, the word under the name when not.
              minWidth 0: a web input's built-in minimum would force the wrap. */}
          <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
            <AppTextInput
              value={labelText ?? ''}
              onChangeText={onLabel}
              placeholder="Name this section"
              accessibilityLabel={`Name for ${range}`}
              variant="label"
              maxLength={60}
              className="bg-surface border border-line rounded-btn text-ink font-sans font-semibold"
              style={{ flexGrow: 3, flexBasis: space(150), minWidth: 0, paddingHorizontal: space(10), paddingVertical: space(8) }}
            />
            <AppTextInput
              value={wordText ?? ''}
              onChangeText={onPhraseWord}
              placeholder={shownLetter ? `${shownLetter}…` : 'Word'}
              accessibilityLabel={`Memory phrase word for ${range}${shownLetter ? `, starts with ${shownLetter}` : ''}`}
              variant="label"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
              className="bg-surface border border-line rounded-btn text-ink font-sans"
              style={{ flexGrow: 1, flexBasis: space(90), minWidth: 0, paddingHorizontal: space(10), paddingVertical: space(8) }}
            />
          </View>
          <AppText variant="caption" className="font-sans text-ink-3">
            {range}
          </AppText>
        </View>
      ) : (
        <View
          className={`flex-1 ${rtl ? 'flex-row-reverse' : 'flex-row'} items-baseline`}
          style={{ paddingTop: space(10), paddingBottom: space(4), paddingRight: space(14), paddingLeft: space(4), gap: space(8) }}
        >
          <View className="flex-1" style={{ minWidth: 0 }}>
            <AppText variant="label" className={`font-sans font-semibold ${section.label ? 'text-ink' : 'text-ink-3'}`}>
              {name}
            </AppText>
            {section.label ? (
              <AppText variant="caption" className="font-sans text-ink-3">
                {range}
              </AppText>
            ) : null}
          </View>
          {section.phraseWord ? (
            <AppText variant="label" className="font-sans font-medium text-ink-2" accessibilityLabel={`Phrase word: ${section.phraseWord}`}>
              {section.phraseWord}
            </AppText>
          ) : shownLetter ? (
            <AppText variant="label" className="font-sans text-ink-3" accessibilityLabel={`Starts with ${shownLetter}`}>
              {shownLetter}
            </AppText>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** A phrase letter as shown: capital for English and Greek; Hebrew has no case. */
export function displayLetter(letter: string, script: TextScript): string {
  return script === 'hebrew' ? letter : letter.toUpperCase();
}

/**
 * The chapter's memory phrase in one line: the user's words, with the
 * opening letter standing in for any section that has none. Null when the
 * chapter has no sections.
 */
export function phraseSummary(sections: Section[], letters: string[], script: TextScript): string | null {
  if (sections.length < 2 && !sections[0]?.phraseWord) return null;
  return sections.map((s, i) => s.phraseWord || displayLetter(letters[i] ?? '', script) || '·').join(' ');
}

/**
 * The card at the top of the verse list in Edit sections mode: how editing
 * works, and Start over.
 */
export function SectionsEditIntro({ onStartOver, canStartOver }: { onStartOver: () => void; canStartOver: boolean }) {
  const space = useScaledSpace();
  const lines = [
    'Tap a verse to start a new section there.',
    'Drag a round handle up or down to move where a section starts.',
    'Double-tap a handle to join that section to the one above.',
    'Give each section a name and, if you like, a memory-phrase word that starts with its first letter.',
  ];
  return (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(8) }}>
      <AppText variant="title" className="font-sans font-semibold text-ink" accessibilityRole="header">
        Edit sections
      </AppText>
      <View style={{ gap: space(4) }}>
        {lines.map((line) => (
          <View key={line} className="flex-row" style={{ gap: space(8) }}>
            <AppText variant="caption" className="font-sans text-ink-3">
              •
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-2 flex-1">
              {line}
            </AppText>
          </View>
        ))}
      </View>
      {canStartOver ? (
        <View className="flex-row">
          <AppButton size="sm" variant="quiet" label="Start over" accessibilityLabel="Remove all sections" onPress={onStartOver} />
        </View>
      ) : null}
    </View>
  );
}

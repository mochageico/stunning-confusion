import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { threadSpan, ThreadSpanVerse } from '../lib/drills';
import { getSpeechRecognizer, gradeTranscriptDetailed, classifyFirstLetterAttempt, SpeechRecognizer, tokenizeWords, WordOutcome } from '../lib/recitation';
import { blankExceptFirstLetter, blankLetters, joinWords, normalizeToken, scriptOfVerse, typedLetters, wordGap } from '../lib/textScript';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from './design';
import { WaveBars } from './ui';
import { recordSpeechSlip } from '../lib/speechSlips';

// ============================================================================
// ONE GRADED RECITATION
// ----------------------------------------------------------------------------
// Recite a stretch of verses -- from a word in one verse through the end of a
// later one -- by voice or by typing first letters, then see it graded word
// by word. A red word the speech engine misheard can be tapped to mark it
// right before continuing. Pick up the thread builds its rounds on this, and
// Guided learning uses it for every graded rung (with `shownWords` for the
// partly hidden one). The typed first-letter drill is this in type mode with
// the result ignored.
// ============================================================================

export type RecitationVerse = { book: string; chapter: number; verse: number; text: string; translationId?: string };
export type RecitationMode = 'speak' | 'type';

/** Auto-stops listening once the last words are heard and most of the stretch has been said. */
const AUTO_FINISH_SHARE = 0.6;

/** Whether this device can grade speech for these verses. */
export const canSpeakVerses = (verses: RecitationVerse[]): boolean => {
  // Phone speech engines can't hear Biblical Hebrew or Koine Greek -- same
  // rule as Recall. Typing still works for both.
  if (verses.length === 0 || scriptOfVerse(verses[0]) !== 'latin') return false;
  return getSpeechRecognizer() !== null;
};

/**
 * Every recitation stage is the same frame: content that scrolls when it
 * doesn't fit (the SE at the largest text size), and the stage's actions
 * pinned under it.
 */
export function RoundFrame({ children, footer, center = false }: { children: React.ReactNode; footer?: React.ReactNode; center?: boolean }) {
  const space = useScaledSpace();
  return (
    <View className="flex-1" style={{ gap: space(12) }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, gap: space(12), paddingBottom: space(4), justifyContent: center ? 'center' : 'flex-start' }}
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

/** Two buttons side by side that stack once they no longer fit. */
export function ButtonPair({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const space = useScaledSpace();
  return (
    <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
      <View style={{ flexGrow: 1, flexBasis: space(130) }}>{left}</View>
      <View style={{ flexGrow: 1, flexBasis: space(130) }}>{right}</View>
    </View>
  );
}

type WordLook = { text: string; className: string; onPress?: () => void };

/**
 * The stretch, word by word. `show` decides each graded word's look; words
 * before the start are greyed, and the first `highlightWords` are tinted as
 * the cue.
 */
export function SpanText({
  verses,
  span,
  highlightWords = 0,
  show,
}: {
  verses: RecitationVerse[];
  span: ThreadSpanVerse[];
  highlightWords?: number;
  show: (flatIdx: number, word: string) => WordLook;
}) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verses[span[0]?.index ?? 0]);
  let flat = 0;
  return (
    <View style={{ gap: space(10) }}>
      {span.map((sv, k) => (
        <AppText key={sv.index} variant="body" script={script} className="font-serif leading-relaxed text-ink">
          <AppText variant="caption" className="font-sans font-bold text-ink-3">
            {verses[sv.index].verse}{' '}
          </AppText>
          {sv.before.map((w, i) => (
            <AppText variant="inherit" key={`b${i}`} className="font-serif text-ink-3">
              {w}{wordGap(w)}
            </AppText>
          ))}
          {sv.words.map((w, i) => {
            const isCue = k === 0 && i < highlightWords;
            if (normalizeToken(w, script).length === 0) {
              return (
                <AppText variant="inherit" key={i} className="font-serif text-ink">
                  {w}{wordGap(w)}
                </AppText>
              );
            }
            const look = show(flat++, w);
            // The space after a word sits outside its styling, so an
            // underline stops at the word -- except between the cue words,
            // whose highlight reads as one block.
            const gapInside = isCue && i < highlightWords - 1;
            return (
              <AppText variant="inherit" key={i}>
                <AppText variant="inherit" onPress={look.onPress} className={`${look.className} ${isCue ? 'bg-accent-soft rounded' : ''}`}>
                  {look.text}{gapInside ? wordGap(w) : ''}
                </AppText>
                {gapInside ? '' : wordGap(w)}
              </AppText>
            );
          })}
        </AppText>
      ))}
    </View>
  );
}

export default function GradedRecitation({
  verses,
  startVerse,
  startWord,
  endVerse,
  mode,
  shownWords,
  highlightWords = 0,
  header,
  gradedDetail,
  continueLabel = 'Next',
  showHeard = false,
  hintFirstLetters = false,
  onSwitchMode,
  onCancel,
  onResult,
}: {
  verses: RecitationVerse[];
  /** Index into `verses` where reciting begins. */
  startVerse: number;
  /** Index into splitWords(text) of the start verse. */
  startWord: number;
  /** Index of the verse the recitation runs through to its end. */
  endVerse: number;
  /** How the user answers. Remount (change the key) to switch. */
  mode: RecitationMode;
  /** Graded-word indices left visible while reciting (partly hidden). Showing words is the caller's call to grade. */
  shownWords?: Set<number>;
  /** Leading words tinted as the cue. */
  highlightWords?: number;
  /** Shown above the text while reciting (the cue card). */
  header?: React.ReactNode;
  /** Shown under the graded text, from per-verse outcomes indexed like the span. */
  gradedDetail?: (perVerse: WordOutcome[][]) => React.ReactNode;
  continueLabel?: string;
  /** Under the graded text, list what the speech engine heard in place of each missed word. */
  showHeard?: boolean;
  /** Typing: hidden words show their first letter (an ungraded look-up, not a test). */
  hintFirstLetters?: boolean;
  /**
   * Offers "Type instead" while listening and "Recite instead" while typing.
   * The caller remounts with the other mode; this attempt is dropped unscored.
   */
  onSwitchMode?: (to: RecitationMode) => void;
  /** Listening ended with nothing heard, failed, or was cancelled. */
  onCancel: () => void;
  /** The user tapped Continue on the graded result, after any corrections. */
  onResult: (perVerse: WordOutcome[][], mode: RecitationMode) => void;
}) {
  const space = useScaledSpace();
  const fontScale = useFontScale();
  const script = scriptOfVerse(verses[endVerse]);
  const span = useMemo(
    () => threadSpan(verses, { startVerse, startWord, endVerse, cueWords: [] }),
    [verses, startVerse, startWord, endVerse]
  );

  // Every graded word in the stretch, in order, with where it sits.
  const graded = useMemo(() => {
    const out: { k: number; w: number; word: string }[] = [];
    span.forEach((sv, k) =>
      sv.words.forEach((word, w) => {
        if (normalizeToken(word, script).length > 0) out.push({ k, w, word });
      })
    );
    return out;
  }, [span, script]);
  const expectedText = useMemo(() => span.map((sv) => joinWords(sv.words)).join(' '), [span]);

  const [stage, setStage] = useState<'speak' | 'type' | 'graded'>(mode);
  // Per graded word; filled by the speech grade or by typing.
  const [outcomes, setOutcomes] = useState<WordOutcome[]>([]);
  // Per graded word, what speech heard there (speak mode only).
  const [heard, setHeard] = useState<(string | null)[]>([]);

  // --- Speech -----------------------------------------------------------------
  const engineRef = useRef<SpeechRecognizer | null>(null);
  const [transcript, setTranscript] = useState('');
  const transcriptRef = useRef('');
  const finishedRef = useRef(false);

  const finishSpeaking = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    engineRef.current?.stop();
    const graded = gradeTranscriptDetailed(expectedText, transcriptRef.current);
    setOutcomes(graded.outcomes);
    setHeard(graded.heard);
    setStage('graded');
  };

  useEffect(() => {
    if (mode !== 'speak') return;
    const engine = getSpeechRecognizer();
    engineRef.current = engine;
    if (!engine) {
      onCancel();
      return;
    }
    finishedRef.current = false;
    // Callbacks from an engine this attempt no longer owns are ignored.
    const live = () => engineRef.current === engine;
    engine.prime?.(expectedText);
    const expectedTokens = tokenizeWords(expectedText);
    const tail = expectedTokens.slice(-2).join(' ');
    engine.start({
      onTranscript: (full) => {
        if (!live()) return;
        transcriptRef.current = full;
        setTranscript(full);
        const heard = tokenizeWords(full);
        if (heard.length >= expectedTokens.length * AUTO_FINISH_SHARE && heard.slice(-2).join(' ') === tail) finishSpeaking();
      },
      onEnd: () => {
        // The engine stopping on its own (silence) ends the attempt with what
        // it heard. Nothing heard at all goes back instead.
        if (!live() || finishedRef.current) return;
        if (transcriptRef.current.trim().length === 0) {
          finishedRef.current = true;
          onCancel();
        } else finishSpeaking();
      },
      onError: () => {
        if (!live() || finishedRef.current) return;
        finishedRef.current = true;
        onCancel();
      },
    });
    return () => {
      finishedRef.current = true;
      engineRef.current = null;
      engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelSpeaking = () => {
    finishedRef.current = true;
    engineRef.current?.stop();
    onCancel();
  };

  // --- Typing -----------------------------------------------------------------
  const [pointer, setPointer] = useState(0);
  const [flash, setFlash] = useState(false);
  // Refs, not just state: fast typing can deliver several letters before a
  // re-render, and each one has to see where the previous one left off.
  const pointerRef = useRef(0);
  const outcomesRef = useRef<WordOutcome[]>([]);

  const commitTyping = () => {
    setOutcomes([...outcomesRef.current]);
    setPointer(pointerRef.current);
    if (pointerRef.current >= graded.length) setStage('graded');
  };

  const showWord = () => {
    if (pointerRef.current >= graded.length) return;
    outcomesRef.current[pointerRef.current] = 'missed';
    pointerRef.current += 1;
    commitTyping();
  };

  // The field is cleared after every change, so whatever arrives is only the
  // letters not yet handled -- usually one, several when typing fast.
  const handleTyped = (val: string) => {
    let wrong = false;
    // Hebrew/Greek: letters only -- points and invisible marks the keyboard
    // sends along aren't guesses (see typedLetters). English: every character.
    for (const ch of typedLetters(val, script)) {
      const i = pointerRef.current;
      if (i >= graded.length) break;
      const verdict = classifyFirstLetterAttempt(ch, graded[i].word, script);
      if (verdict === 'wrong') {
        // A wrong letter keeps you on the word, and the word stays missed.
        outcomesRef.current[i] = 'missed';
        wrong = true;
        continue;
      }
      outcomesRef.current[i] = outcomesRef.current[i] === 'missed' ? 'missed' : verdict === 'close' ? 'close' : 'perfect';
      pointerRef.current = i + 1;
    }
    commitTyping();
    if (wrong) {
      setFlash(true);
      setTimeout(() => setFlash(false), 200);
    }
  };

  // --- Results ----------------------------------------------------------------
  const perVerseOutcomes = useMemo(() => {
    const out: WordOutcome[][] = span.map(() => []);
    graded.forEach((g, i) => out[g.k].push(outcomes[i] || 'missed'));
    return out;
  }, [span, graded, outcomes]);

  // Speech mishears words people said right; tapping one marks it right, as in Recall.
  // Only reachable in speak mode, on a word speech graded missed -- so what
  // the engine heard there is worth learning from (lib/speechSlips).
  const markRight = (flatIdx: number) => {
    setOutcomes((prev) => prev.map((o, i) => (i === flatIdx ? 'perfect' : o)));
    recordSpeechSlip(graded[flatIdx]?.word ?? '', heard[flatIdx]);
  };

  // Switching drops this attempt: stop listening first so the engine's own
  // end callback can't report a cancel after the switch.
  const switchTo = (to: RecitationMode) => {
    finishedRef.current = true;
    engineRef.current?.stop();
    onSwitchMode?.(to);
  };
  const canRecite = !!onSwitchMode && canSpeakVerses([verses[endVerse]]);

  // ---- Listening ---------------------------------------------------------------
  if (stage === 'speak') {
    return (
      <RoundFrame
        footer={
          <View style={{ gap: space(8) }}>
            {onSwitchMode && <AppButton variant="quiet" label="Type instead" onPress={() => switchTo('type')} />}
            <ButtonPair
              left={<AppButton variant="secondary" label="Cancel" onPress={cancelSpeaking} />}
              right={<AppButton variant="primary" label="Done" onPress={finishSpeaking} />}
            />
          </View>
        }
      >
        {header}
        {shownWords && (
          <SpanText
            verses={verses}
            span={span}
            highlightWords={highlightWords}
            show={(i, w) =>
              shownWords.has(i)
                ? { text: w, className: 'font-serif text-ink' }
                : { text: blankLetters(w, script), className: 'font-serif text-ink-3' }
            }
          />
        )}
        <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(14), gap: space(10), minHeight: space(120) }}>
          <View className="h-6 items-center justify-center">
            <WaveBars active count={16} />
          </View>
          <AppText variant="label" className="font-serif italic text-ink-2">
            {transcript || 'Listening'}
          </AppText>
        </View>
      </RoundFrame>
    );
  }

  // ---- Typing ------------------------------------------------------------------
  if (stage === 'type') {
    return (
      <RoundFrame
        footer={
          <View style={{ gap: space(8) }}>
            <View className="flex-row flex-wrap items-center justify-between" style={{ gap: space(8) }}>
              <AppText variant="caption" className="font-sans font-medium text-ink-3 px-1">
                {pointer} of {graded.length}
              </AppText>
              <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
                {canRecite && <AppButton size="sm" variant="quiet" label="Recite instead" onPress={() => switchTo('speak')} />}
                <AppButton size="sm" variant="secondary" label="Show this word" onPress={showWord} />
              </View>
            </View>
            <AppTextInput
              value=""
              onChangeText={handleTyped}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={fontScale >= 1.3 ? 'First letters' : 'First letter of each word'}
              className={`border rounded-btn py-2 px-3 text-center font-sans font-semibold text-ink ${flash ? 'bg-danger-soft border-danger' : 'bg-surface-2 border-line'}`}
            />
          </View>
        }
      >
        {header}
        <SpanText
          verses={verses}
          span={span}
          highlightWords={highlightWords}
          show={(i, w) => {
            if (i < pointer) {
              const o = outcomes[i];
              return { text: w, className: `font-serif ${o === 'missed' ? 'text-danger' : o === 'close' ? 'text-warning' : 'text-ink'}` };
            }
            if (shownWords?.has(i)) return { text: w, className: `font-serif ${i === pointer ? 'bg-accent-soft text-accent' : 'text-ink-2'}` };
            return {
              text: hintFirstLetters ? blankExceptFirstLetter(w, script) : blankLetters(w, script),
              className: i === pointer ? 'font-serif font-bold text-accent' : 'font-serif text-ink-3',
            };
          }}
        />
      </RoundFrame>
    );
  }

  // ---- Graded ------------------------------------------------------------------
  const total = graded.length;
  const right = outcomes.filter((o) => o === 'perfect' || o === 'close').length;
  const missed = total - right;
  return (
    <RoundFrame footer={<AppButton size="lg" variant="primary" label={continueLabel} onPress={() => onResult(perVerseOutcomes, mode)} />}>
      <View style={{ gap: space(2) }}>
        <AppText variant="title" className="font-sans font-bold text-ink">
          {missed === 0 ? 'Every word right' : `${missed} ${missed === 1 ? 'word' : 'words'} missed`}
        </AppText>
        {mode === 'speak' && missed > 0 ? (
          <AppText variant="label" className="font-sans font-medium text-ink-2">
            Did it mishear you? Tap any word you said right.
          </AppText>
        ) : (
          <AppText variant="caption" className="font-sans text-ink-3">
            {`${right} of ${total} words`}
          </AppText>
        )}
      </View>
      <SpanText
        verses={verses}
        span={span}
        highlightWords={highlightWords}
        show={(i, w) => {
          const o = outcomes[i] || 'missed';
          return {
            text: w,
            className: `font-serif ${o === 'missed' ? 'text-danger underline' : o === 'close' ? 'text-warning' : 'text-ink'}`,
            onPress: mode === 'speak' && o === 'missed' ? () => markRight(i) : undefined,
          };
        }}
      />
      {showHeard && mode === 'speak' && (() => {
        const rows = graded
          .map((g, i) => ({ i, word: g.word, said: heard[i] }))
          .filter((r) => outcomes[r.i] === 'missed' && r.said);
        if (rows.length === 0) return null;
        return (
          <View style={{ gap: space(4) }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">
              What it heard
            </AppText>
            {rows.slice(0, 6).map((r) => (
              <AppText key={r.i} variant="label" className="font-sans text-ink-2">
                “{r.said}” for “{r.word}”
              </AppText>
            ))}
          </View>
        );
      })()}
      {gradedDetail?.(perVerseOutcomes)}
    </RoundFrame>
  );
}

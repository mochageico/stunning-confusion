import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Eye, Keyboard, Mic, RefreshCw } from 'lucide-react-native';

import { ThreadCue, threadSlips, ThreadSlip, threadSpan } from '../lib/drills';
import { getSpeechRecognizer, gradeTranscript, classifyFirstLetterAttempt, SpeechRecognizer, tokenizeWords, WordOutcome } from '../lib/recitation';
import { joinWords, maskLetters, normalizeToken, scriptOfVerse, wordGap } from '../lib/textScript';
import { AppButton, AppText, AppTextInput, useFontScale, useScaledSpace } from './design';
import { WaveBars } from './ui';

// ============================================================================
// ONE ROUND OF PICK UP THE THREAD
// ----------------------------------------------------------------------------
// The cue card and the three ways to answer it: say it (graded by speech),
// type first letters (graded per word, same forgiveness as Recall), or reveal
// the text and say how it went. ThreadDrillScreen owns the session around it:
// picking cues, crediting reviews, and the recap.
// ============================================================================

export type ThreadVerse = { book: string; chapter: number; verse: number; text: string; translationId?: string };

export type ThreadAnswerMode = 'speak' | 'type' | 'self';

export interface ThreadRoundResult {
  mode: ThreadAnswerMode;
  /**
   * One entry per verse in the stretch, by index into `verses`. `outcomes` is
   * per graded word for speak/type; null for a self-check, where `ok` is the
   * user's own call.
   */
  perVerse: { index: number; outcomes: WordOutcome[] | null; ok: boolean; perfect: boolean }[];
  slips: ThreadSlip[];
}

/** What the screen says about one verse's credit, under the graded text. */
export type CreditPreview = (index: number, passed: boolean, perfect: boolean, mode: ThreadAnswerMode) => string;

type Stage = 'cue' | 'speak' | 'type' | 'graded' | 'reveal' | 'pickSlip';

/** Auto-stops listening once the last words are heard and most of the stretch has been said. */
const AUTO_FINISH_SHARE = 0.6;

export default function ThreadRound({
  verses,
  cue,
  hideVerseNumber,
  creditPreview,
  onFinish,
  onDifferentCue,
}: {
  verses: ThreadVerse[];
  cue: ThreadCue;
  hideVerseNumber: boolean;
  creditPreview: CreditPreview;
  onFinish: (result: ThreadRoundResult) => void;
  /** Skips this cue for another, logging nothing. */
  onDifferentCue: () => void;
}) {
  const space = useScaledSpace();
  const fontScale = useFontScale();
  const script = scriptOfVerse(verses[cue.endVerse]);
  const span = useMemo(() => threadSpan(verses, cue), [verses, cue]);

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

  const [stage, setStage] = useState<Stage>('cue');
  const [mode, setMode] = useState<ThreadAnswerMode>('speak');
  // Per graded word; filled by the speech grade or by typing.
  const [outcomes, setOutcomes] = useState<WordOutcome[]>([]);

  // --- Speech -----------------------------------------------------------------
  const engineRef = useRef<SpeechRecognizer | null>(null);
  const [voiceAvailable] = useState(() => {
    engineRef.current = getSpeechRecognizer();
    return engineRef.current !== null;
  });
  // Phone speech engines can't hear Biblical Hebrew or Koine Greek -- same
  // rule as Recall. Typing still works for both.
  const canSpeak = voiceAvailable && script === 'latin';
  const [transcript, setTranscript] = useState('');
  const transcriptRef = useRef('');
  const finishedRef = useRef(false);

  useEffect(() => () => engineRef.current?.stop(), []);

  const finishSpeaking = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    engineRef.current?.stop();
    setOutcomes(gradeTranscript(expectedText, transcriptRef.current));
    setStage('graded');
  };

  const startSpeaking = () => {
    const engine = engineRef.current;
    if (!engine) return;
    finishedRef.current = false;
    transcriptRef.current = '';
    setTranscript('');
    setMode('speak');
    setStage('speak');
    engine.prime?.(expectedText);
    const expectedTokens = tokenizeWords(expectedText);
    const tail = expectedTokens.slice(-2).join(' ');
    engine.start({
      onTranscript: (full) => {
        transcriptRef.current = full;
        setTranscript(full);
        const heard = tokenizeWords(full);
        if (heard.length >= expectedTokens.length * AUTO_FINISH_SHARE && heard.slice(-2).join(' ') === tail) finishSpeaking();
      },
      onEnd: () => {
        // The engine stopping on its own (silence) ends the attempt with what
        // it heard. Nothing heard at all goes back to the cue instead.
        if (finishedRef.current) return;
        if (transcriptRef.current.trim().length === 0) setStage('cue');
        else finishSpeaking();
      },
      onError: () => {
        finishedRef.current = true;
        setStage('cue');
      },
    });
  };

  const cancelSpeaking = () => {
    finishedRef.current = true;
    engineRef.current?.stop();
    setStage('cue');
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

  const startTyping = () => {
    pointerRef.current = 0;
    outcomesRef.current = [];
    setMode('type');
    commitTyping();
    setStage('type');
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
    for (const ch of Array.from(val)) {
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
  const markRight = (flatIdx: number) =>
    setOutcomes((prev) => prev.map((o, i) => (i === flatIdx ? 'perfect' : o)));

  const verseResult = (k: number) => {
    const o = perVerseOutcomes[k];
    const right = o.filter((x) => x !== 'missed').length;
    const pct = o.length === 0 ? 1 : right / o.length;
    return { pct, passed: pct >= 0.9, perfect: o.length > 0 && right === o.length };
  };

  const finishGraded = () => {
    onFinish({
      mode,
      perVerse: span.map((sv, k) => {
        const r = verseResult(k);
        return { index: sv.index, outcomes: perVerseOutcomes[k], ok: r.passed, perfect: r.perfect };
      }),
      slips: threadSlips(span, perVerseOutcomes.map((o) => o.map((x) => x === 'missed'))),
    });
  };

  const finishSelf = (slipK: number | null) => {
    onFinish({
      mode: 'self',
      perVerse: span.map((sv, k) => ({ index: sv.index, outcomes: null, ok: k !== slipK, perfect: false })),
      slips: slipK === null ? [] : [{ verse: span[slipK].index, kind: 'inside' }],
    });
  };

  // --- Rendering --------------------------------------------------------------
  const verseLabel = (index: number) => `v${verses[index].verse}`;
  const endLabel = verseLabel(cue.endVerse);
  const cueText = cue.cueWords.join(' ');

  const cueCard = (compact: boolean) => (
    <View className="bg-surface border border-line rounded-card items-center" style={{ padding: space(compact ? 12 : 20), gap: space(4) }}>
      <AppText variant="caption" className="font-sans font-medium text-ink-3">
        {hideVerseNumber ? 'Start at' : `Start at · ${verseLabel(cue.startVerse)}`}
      </AppText>
      <AppText variant={compact ? 'title' : 'display'} script={script} className="font-serif text-ink text-center">
        “{cueText}”
      </AppText>
      <AppText variant="caption" className="font-sans text-ink-2 text-center">
        through the end of {endLabel}
      </AppText>
    </View>
  );

  // The stretch, word by word. `show` decides each graded word's look.
  const renderSpan = (
    show: (flatIdx: number, word: string) => { text: string; className: string; onPress?: () => void }
  ) => {
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
              const isCue = k === 0 && i < cue.cueWords.length;
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
              const gapInside = isCue && i < cue.cueWords.length - 1;
              return (
                <AppText variant="inherit" key={i}>
                  <AppText
                    variant="inherit"
                    onPress={look.onPress}
                    className={`${look.className} ${isCue ? 'bg-accent-soft rounded' : ''}`}
                  >
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
  };

  // Every stage is the same frame: content that scrolls when it doesn't fit
  // (the SE at the largest text size), and the stage's actions pinned under
  // it. The cue stage scrolls its buttons too -- it has four of them.
  const frame = (body: React.ReactNode, footer?: React.ReactNode, center = false) => (
    <View className="flex-1" style={{ gap: space(12) }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, gap: space(12), paddingBottom: space(4), justifyContent: center ? 'center' : 'flex-start' }}
      >
        {body}
      </ScrollView>
      {footer}
    </View>
  );
  // Two buttons side by side that stack once they no longer fit.
  const pair = (left: React.ReactNode, right: React.ReactNode) => (
    <View className="flex-row flex-wrap" style={{ gap: space(8) }}>
      <View style={{ flexGrow: 1, flexBasis: space(130) }}>{left}</View>
      <View style={{ flexGrow: 1, flexBasis: space(130) }}>{right}</View>
    </View>
  );

  // ---- Cue -------------------------------------------------------------------
  if (stage === 'cue') {
    return frame(
      <>
        <View className="flex-1 justify-center" style={{ minHeight: space(160) }}>
          {cueCard(false)}
        </View>
        <View style={{ gap: space(8) }}>
          {canSpeak && <AppButton size="lg" variant="primary" Icon={Mic} label="Recite" onPress={startSpeaking} />}
          <AppButton
            variant={canSpeak ? 'secondary' : 'primary'}
            size={canSpeak ? 'md' : 'lg'}
            Icon={Keyboard}
            label="Type first letters"
            onPress={startTyping}
          />
          {pair(
            <AppButton variant="quiet" Icon={Eye} label="Show text" onPress={() => { setMode('self'); setStage('reveal'); }} />,
            <AppButton variant="quiet" Icon={RefreshCw} label="Different cue" onPress={onDifferentCue} />
          )}
        </View>
      </>
    );
  }

  // ---- Listening ---------------------------------------------------------------
  if (stage === 'speak') {
    return frame(
      <>
        {cueCard(true)}
        <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(14), gap: space(10), minHeight: space(120) }}>
          <View className="h-6 items-center justify-center">
            <WaveBars active count={16} />
          </View>
          <AppText variant="label" className="font-serif italic text-ink-2">
            {transcript || 'Listening'}
          </AppText>
        </View>
      </>,
      pair(
        <AppButton variant="secondary" label="Cancel" onPress={cancelSpeaking} />,
        <AppButton variant="primary" label="Done" onPress={finishSpeaking} />
      )
    );
  }

  // ---- Typing ------------------------------------------------------------------
  if (stage === 'type') {
    return frame(
      <>
        {cueCard(true)}
        {renderSpan((i, w) => {
          if (i < pointer) {
            const o = outcomes[i];
            return { text: w, className: `font-serif ${o === 'missed' ? 'text-danger' : o === 'close' ? 'text-warning' : 'text-ink'}` };
          }
          return {
            text: maskLetters(w, script),
            className: `font-sans font-bold rounded px-1 ${i === pointer ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'}`,
          };
        })}
      </>,
      <View style={{ gap: space(8) }}>
        <View className="flex-row items-center justify-between" style={{ gap: space(8) }}>
          <AppText variant="caption" className="font-sans font-medium text-ink-3 px-1">
            {pointer} of {graded.length}
          </AppText>
          <AppButton size="sm" variant="secondary" label="Show this word" onPress={showWord} />
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
    );
  }

  // ---- Graded ------------------------------------------------------------------
  if (stage === 'graded') {
    const total = graded.length;
    const right = outcomes.filter((o) => o === 'perfect' || o === 'close').length;
    const missed = total - right;
    return frame(
      <>
        <View style={{ gap: space(2) }}>
          <AppText variant="title" className="font-sans font-bold text-ink">
            {missed === 0 ? 'Every word right' : `${missed} ${missed === 1 ? 'word' : 'words'} missed`}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3">
            {mode === 'speak' && missed > 0 ? 'Tap a red word if you said it and it was misheard.' : `${right} of ${total} words`}
          </AppText>
        </View>
        {renderSpan((i, w) => {
          const o = outcomes[i] || 'missed';
          return {
            text: w,
            className: `font-serif ${o === 'missed' ? 'text-danger underline' : o === 'close' ? 'text-warning' : 'text-ink'}`,
            onPress: mode === 'speak' && o === 'missed' ? () => markRight(i) : undefined,
          };
        })}
        <View className="border-t border-line" style={{ paddingTop: space(10), gap: space(6) }}>
          {span.map((sv, k) => {
            const r = verseResult(k);
            return (
              <View key={sv.index} className="flex-row items-start justify-between" style={{ gap: space(8) }}>
                <AppText variant="label" className="font-sans font-semibold text-ink" style={{ minWidth: space(36) }}>
                  {verseLabel(sv.index)}
                </AppText>
                <AppText variant="caption" className={`font-sans flex-1 text-right ${r.passed ? 'text-ink-2' : 'text-ink-3'}`}>
                  {creditPreview(sv.index, r.passed, r.perfect, mode)}
                </AppText>
              </View>
            );
          })}
        </View>
      </>,
      <AppButton size="lg" variant="primary" label="Next" onPress={finishGraded} />
    );
  }

  // ---- Self-check: reveal, then where it slipped -----------------------------
  if (stage === 'pickSlip') {
    return frame(
      <View style={{ gap: space(12) }}>
        <AppText variant="title" className="font-sans font-bold text-ink text-center">
          Where did you slip?
        </AppText>
        <View className="flex-row flex-wrap justify-center" style={{ gap: space(8) }}>
          {span.map((sv, k) => (
            <Pressable
              key={sv.index}
              onPress={() => finishSelf(k)}
              accessibilityRole="button"
              className="bg-surface border border-line rounded-btn active:bg-surface-2"
              style={{ paddingHorizontal: space(16), paddingVertical: space(10) }}
            >
              <AppText variant="label" className="font-sans font-semibold text-ink">
                {verseLabel(sv.index)}
              </AppText>
            </Pressable>
          ))}
        </View>
        <AppText variant="caption" className="font-sans text-ink-3 text-center">
          The other verses still count as checked by you.
        </AppText>
      </View>,
      <AppButton variant="quiet" label="Back" onPress={() => setStage('reveal')} />,
      true
    );
  }

  // stage === 'reveal'
  return frame(
    <>
      {cueCard(true)}
      {renderSpan((_i, w) => ({ text: w, className: 'font-serif text-ink' }))}
    </>,
    pair(
      <AppButton size="lg" variant="secondary" label="Missed some" onPress={() => setStage('pickSlip')} />,
      <AppButton size="lg" variant="primary" label="Got it" onPress={() => finishSelf(null)} />
    )
  );
}

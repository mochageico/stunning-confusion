import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Eye, Keyboard, Mic, RefreshCw } from 'lucide-react-native';

import { ThreadCue, threadSlips, ThreadSlip, threadSpan } from '../lib/drills';
import { reviewPassAccuracy, WordOutcome } from '../lib/recitation';
import { scriptOfVerse } from '../lib/textScript';
import { AppButton, AppText, useScaledSpace } from './design';
import GradedRecitation, { ButtonPair, canSpeakVerses, RoundFrame, SpanText } from './GradedRecitation';
import { SelfCheckFlow, SelfCheckResult } from './practice/SelfCheck';
import type { SelfCheckAnswer } from '../lib/grading';

// ============================================================================
// ONE ROUND OF PICK UP THE THREAD
// ----------------------------------------------------------------------------
// The cue card and the three ways to answer it: say it (graded by speech),
// type first letters (graded per word, same forgiveness as Recall), or reveal
// the text and say how each verse went (Got it / Stumbled / Blanked, then a
// spot check: practice/SelfCheck). The first two are GradedRecitation.
// ThreadDrillScreen owns the session around it: picking cues, crediting
// reviews, and the recap.
// ============================================================================

export type ThreadVerse = { book: string; chapter: number; verse: number; text: string; translationId?: string };

export type ThreadAnswerMode = 'speak' | 'type' | 'self';

export interface ThreadRoundResult {
  mode: ThreadAnswerMode;
  /**
   * One entry per verse in the stretch, by index into `verses`. `outcomes` is
   * per graded word for speak/type; null for a self-check, where `answer` is
   * the user's own call and `ok` means Got it.
   */
  perVerse: { index: number; outcomes: WordOutcome[] | null; ok: boolean; perfect: boolean; answer?: SelfCheckAnswer }[];
  slips: ThreadSlip[];
  /** Self-check: the spot check's result (false holds the review); null when none ran. */
  spotPassed?: boolean | null;
}

/** What the screen says about one verse's credit, under the graded text. */
export type CreditPreview = (index: number, passed: boolean, perfect: boolean, mode: ThreadAnswerMode, outcomes: WordOutcome[]) => string;

type Stage = 'cue' | 'speak' | 'type' | 'reveal' | 'pickSlip' | 'spot';

/** Whether a verse's words clear the review bar, and whether every one was right. */
const verseResult = (o: WordOutcome[]) => {
  const right = o.filter((x) => x !== 'missed').length;
  const pct = o.length === 0 ? 1 : right / o.length;
  return { passed: pct >= reviewPassAccuracy(), perfect: o.length > 0 && right === o.length };
};

export default function ThreadRound({
  verses,
  cue,
  hideVerseNumber,
  creditPreview,
  onFinish,
  onDifferentCue,
  allowSelfCheck = true,
  spotCheck = true,
}: {
  verses: ThreadVerse[];
  cue: ThreadCue;
  hideVerseNumber: boolean;
  creditPreview: CreditPreview;
  onFinish: (result: ThreadRoundResult) => void;
  /** Skips this cue for another, logging nothing. */
  onDifferentCue: () => void;
  /** Off where a self-check can't count (the every-other rule): no Show text. */
  allowSelfCheck?: boolean;
  /** Off where nothing here could move a passage up anyway. */
  spotCheck?: boolean;
}) {
  const space = useScaledSpace();
  const script = scriptOfVerse(verses[cue.endVerse]);
  const span = useMemo(() => threadSpan(verses, cue), [verses, cue]);

  const [stage, setStage] = useState<Stage>('cue');
  const [canSpeak] = useState(() => canSpeakVerses([verses[cue.endVerse]]));

  const finishGraded = (perVerseOutcomes: WordOutcome[][], mode: ThreadAnswerMode) => {
    onFinish({
      mode,
      perVerse: span.map((sv, k) => {
        const r = verseResult(perVerseOutcomes[k]);
        return { index: sv.index, outcomes: perVerseOutcomes[k], ok: r.passed, perfect: r.perfect };
      }),
      slips: threadSlips(span, perVerseOutcomes.map((o) => o.map((x) => x === 'missed'))),
    });
  };

  const finishSelf = (r: SelfCheckResult) => {
    onFinish({
      mode: 'self',
      perVerse: span.map((sv, k) => ({ index: sv.index, outcomes: null, ok: r.answers[k] === 'gotIt', perfect: false, answer: r.answers[k] })),
      slips: span.flatMap((sv, k) => (r.answers[k] === 'gotIt' ? [] : [{ verse: sv.index, kind: 'inside' as const }])),
      spotPassed: r.spotPassed,
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

  // ---- Speak or type: one graded recitation ---------------------------------
  if (stage === 'speak' || stage === 'type') {
    const mode = stage;
    return (
      <GradedRecitation
        key={mode}
        verses={verses}
        startVerse={cue.startVerse}
        startWord={cue.startWord}
        endVerse={cue.endVerse}
        mode={mode}
        highlightWords={cue.cueWords.length}
        header={cueCard(true)}
        onCancel={() => setStage('cue')}
        onSwitchMode={setStage}
        onResult={finishGraded}
        gradedDetail={(perVerse) => (
          <View className="border-t border-line" style={{ paddingTop: space(10), gap: space(6) }}>
            {span.map((sv, k) => {
              const r = verseResult(perVerse[k]);
              return (
                <View key={sv.index} className="flex-row items-start justify-between" style={{ gap: space(8) }}>
                  <AppText variant="label" className="font-sans font-semibold text-ink" style={{ minWidth: space(36) }}>
                    {verseLabel(sv.index)}
                  </AppText>
                  <AppText variant="caption" className={`font-sans flex-1 text-right ${r.passed ? 'text-ink-2' : 'text-ink-3'}`}>
                    {creditPreview(sv.index, r.passed, r.perfect, mode, perVerse[k])}
                  </AppText>
                </View>
              );
            })}
          </View>
        )}
      />
    );
  }

  // ---- Cue -------------------------------------------------------------------
  // The cue stage scrolls its buttons too -- it has four of them.
  if (stage === 'cue') {
    return (
      <RoundFrame>
        <View className="flex-1 justify-center" style={{ minHeight: space(160) }}>
          {cueCard(false)}
        </View>
        <View style={{ gap: space(8) }}>
          {canSpeak && <AppButton size="lg" variant="primary" Icon={Mic} label="Recite" onPress={() => setStage('speak')} />}
          <AppButton
            variant={canSpeak ? 'secondary' : 'primary'}
            size={canSpeak ? 'md' : 'lg'}
            Icon={Keyboard}
            label="Type first letters"
            onPress={() => setStage('type')}
          />
          {allowSelfCheck ? (
            <ButtonPair
              left={<AppButton variant="quiet" Icon={Eye} label="Show text" onPress={() => setStage('reveal')} />}
              right={<AppButton variant="quiet" Icon={RefreshCw} label="Different cue" onPress={onDifferentCue} />}
            />
          ) : (
            <AppButton variant="quiet" Icon={RefreshCw} label="Different cue" onPress={onDifferentCue} />
          )}
        </View>
      </RoundFrame>
    );
  }

  // ---- Self-check: reveal, then how each verse went, then the spot check ----
  if (stage === 'pickSlip' || stage === 'spot') {
    const spanVerses = span.map((sv) => verses[sv.index]);
    return (
      <SelfCheckFlow
        verses={spanVerses}
        allGotIt={stage === 'spot'}
        spotCheck={spotCheck}
        previousText={(k) => {
          const i = span[k].index;
          const prev = verses[i - 1];
          return prev && prev.chapter === verses[i].chapter && prev.verse === verses[i].verse - 1 ? prev.text : null;
        }}
        onBack={() => setStage('reveal')}
        onDone={finishSelf}
      />
    );
  }

  // stage === 'reveal'
  return (
    <RoundFrame
      footer={
        <ButtonPair
          left={<AppButton size="lg" variant="secondary" label="Missed some" onPress={() => setStage('pickSlip')} />}
          right={<AppButton size="lg" variant="primary" label="Got it" onPress={() => setStage('spot')} />}
        />
      }
    >
      {cueCard(true)}
      <SpanText
        verses={verses}
        span={span}
        highlightWords={cue.cueWords.length}
        show={(_i, w) => ({ text: w, className: 'font-serif text-ink' })}
      />
    </RoundFrame>
  );
}

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Eye, Keyboard, Mic, SkipForward } from 'lucide-react-native';

import { threadSpan } from '../../lib/drills';
import { reviewPassAccuracy, WordOutcome } from '../../lib/recitation';
import { scriptOfVerse } from '../../lib/textScript';
import { AppButton, AppText, useScaledSpace } from '../design';
import GradedRecitation, { ButtonPair, canSpeakVerses, RecitationVerse, RoundFrame, SpanText } from '../GradedRecitation';

// ============================================================================
// ONE STEP OF WALK THE CONSTELLATION
// ----------------------------------------------------------------------------
// The blank circle is on the map above (WalkConstellation); this is the part
// under it: recite what's there by voice, by typing first letters, or look at
// the text and say how it went. The first two are GradedRecitation, the same
// way ThreadRound uses it. The whole star is recited, from its first word to
// its last. WalkConstellation owns the walk around it and the crediting.
// ============================================================================

export type WalkMode = 'speak' | 'type' | 'self';

export interface WalkRoundResult {
  mode: WalkMode;
  /** One entry per verse of the star, in order. `outcomes` is null for a self-check, where `ok` is the user's own call. */
  perVerse: { index: number; outcomes: WordOutcome[] | null; ok: boolean; perfect: boolean }[];
}

/** What the screen says about one verse's credit, under the graded text. */
export type WalkCreditPreview = (index: number, passed: boolean, perfect: boolean, mode: WalkMode) => string;

type Stage = 'cue' | 'speak' | 'type' | 'reveal';

/** Whether a verse's words clear the review bar, and whether every one was right. */
const verseResult = (o: WordOutcome[]) => {
  const right = o.filter((x) => x !== 'missed').length;
  const pct = o.length === 0 ? 1 : right / o.length;
  return { passed: pct >= reviewPassAccuracy(), perfect: o.length > 0 && right === o.length };
};

export default function WalkRound({
  verses,
  creditPreview,
  onFinish,
  onSkip,
}: {
  verses: RecitationVerse[];
  creditPreview: WalkCreditPreview;
  onFinish: (result: WalkRoundResult) => void;
  /** Passes this star by, logging nothing. */
  onSkip: () => void;
}) {
  const space = useScaledSpace();
  const last = verses.length - 1;
  const span = useMemo(() => threadSpan(verses, { startVerse: 0, startWord: 0, endVerse: last, cueWords: [] }), [verses, last]);
  const [stage, setStage] = useState<Stage>('cue');
  const [canSpeak] = useState(() => canSpeakVerses(verses));
  const verseLabel = (index: number) => `v${verses[index].verse}`;

  if (stage === 'speak' || stage === 'type') {
    const mode = stage;
    return (
      <GradedRecitation
        key={mode}
        verses={verses}
        startVerse={0}
        startWord={0}
        endVerse={last}
        mode={mode}
        onCancel={() => setStage('cue')}
        onSwitchMode={setStage}
        onResult={(perVerseOutcomes, m) =>
          onFinish({
            mode: m,
            perVerse: span.map((sv, k) => {
              const r = verseResult(perVerseOutcomes[k]);
              return { index: sv.index, outcomes: perVerseOutcomes[k], ok: r.passed, perfect: r.perfect };
            }),
          })
        }
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
                    {creditPreview(sv.index, r.passed, r.perfect, mode)}
                  </AppText>
                </View>
              );
            })}
          </View>
        )}
      />
    );
  }

  if (stage === 'reveal') {
    const selfDone = (ok: boolean) =>
      onFinish({ mode: 'self', perVerse: span.map((sv) => ({ index: sv.index, outcomes: null, ok, perfect: false })) });
    return (
      <RoundFrame
        footer={
          <ButtonPair
            left={<AppButton size="lg" variant="secondary" label="Missed some" onPress={() => selfDone(false)} />}
            right={<AppButton size="lg" variant="primary" label="Got it" onPress={() => selfDone(true)} />}
          />
        }
      >
        <SpanText verses={verses} span={span} show={(_i, w) => ({ text: w, className: 'font-serif text-ink' })} />
      </RoundFrame>
    );
  }

  // stage === 'cue'
  return (
    <RoundFrame
      footer={
        <View style={{ gap: space(8) }}>
          {canSpeak && <AppButton size="lg" variant="primary" Icon={Mic} label="Recite" onPress={() => setStage('speak')} />}
          <AppButton
            variant={canSpeak ? 'secondary' : 'primary'}
            size={canSpeak ? 'md' : 'lg'}
            Icon={Keyboard}
            label="Type first letters"
            onPress={() => setStage('type')}
          />
          <ButtonPair
            left={<AppButton variant="quiet" Icon={Eye} label="Show text" onPress={() => setStage('reveal')} />}
            right={<AppButton variant="quiet" Icon={SkipForward} label="Skip" onPress={onSkip} />}
          />
        </View>
      }
    >
      <AppText variant="label" script={scriptOfVerse(verses[0])} className="font-sans text-ink-2 text-center">
        Say what's in the empty circle.
      </AppText>
    </RoundFrame>
  );
}

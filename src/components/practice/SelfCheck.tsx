import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Keyboard, Mic } from 'lucide-react-native';

import { AppButton, AppText, useScaledSpace } from '../design';
import { SegmentedControl } from '../blocks';
import GradedRecitation, { ButtonPair, canSpeakVerses, RecitationMode, RecitationVerse, RoundFrame } from '../GradedRecitation';
import { pickSpotCheck, SelfCheckAnswer, spotCheckLeadIn, wordAccuracy } from '../../lib/grading';
import { reviewPassAccuracy } from '../../lib/recitation';
import { scriptOfVerse } from '../../lib/textScript';

// ============================================================================
// SELF-CHECK (REVIEW_LADDER_PLAN.md §4)
// ----------------------------------------------------------------------------
// After checking themselves against the text, the user says per verse: Got
// it, Stumbled or Blanked. Then the spot check: one random Got it verse, said
// from the last words of the verse before. Missing it holds the review (the
// engine reads `spotPassed: false` as canMoveUp: false). Shared by Mixed
// review, Pick up the thread and the manual log.
// ============================================================================

export interface SelfCheckResult {
  /** One per verse, in the order given. */
  answers: SelfCheckAnswer[];
  /** The spot check's result; null when none ran (nothing was Got it, or it was off). */
  spotPassed: boolean | null;
}

const ANSWER_OPTIONS: { id: SelfCheckAnswer; label: string }[] = [
  { id: 'gotIt', label: 'Got it' },
  { id: 'stumbled', label: 'Stumbled' },
  { id: 'blanked', label: 'Blanked' },
];

/** The text of the verse just before verses[i], when it is in the list. */
const previousInList = (verses: RecitationVerse[], i: number): string | null => {
  const prev = verses[i - 1];
  return prev && prev.chapter === verses[i].chapter && prev.verse === verses[i].verse - 1 ? prev.text : null;
};

/** Per verse: Got it, Stumbled or Blanked. */
export function SelfCheckPicker({
  verses,
  note,
  onBack,
  onDone,
}: {
  verses: RecitationVerse[];
  /** A line under the list (what the check counts for). */
  note?: string;
  onBack?: () => void;
  onDone: (answers: SelfCheckAnswer[]) => void;
}) {
  const space = useScaledSpace();
  const [answers, setAnswers] = useState<SelfCheckAnswer[]>(() => verses.map(() => 'gotIt'));
  return (
    <RoundFrame
      footer={
        onBack ? (
          <ButtonPair
            left={<AppButton variant="quiet" label="Back" onPress={onBack} />}
            right={<AppButton size="lg" variant="primary" label="Next" onPress={() => onDone(answers)} />}
          />
        ) : (
          <AppButton size="lg" variant="primary" label="Next" onPress={() => onDone(answers)} />
        )
      }
    >
      <AppText variant="title" className="font-sans font-bold text-ink text-center">
        How did each verse go?
      </AppText>
      <View style={{ gap: space(12) }}>
        {verses.map((v, i) => (
          <View key={`${v.chapter}:${v.verse}`} style={{ gap: space(4) }}>
            <AppText variant="label" className="font-sans font-semibold text-ink">
              {verses.some((o) => o.chapter !== v.chapter) ? `${v.chapter}:${v.verse}` : `Verse ${v.verse}`}
            </AppText>
            <SegmentedControl
              options={ANSWER_OPTIONS}
              value={answers[i]}
              onChange={(a) => setAnswers((prev) => prev.map((x, k) => (k === i ? a : x)))}
              accessibilityLabel={`Verse ${v.verse}`}
            />
          </View>
        ))}
      </View>
      {note ? (
        <AppText variant="caption" className="font-sans text-ink-3 text-center">
          {note}
        </AppText>
      ) : null}
    </RoundFrame>
  );
}

/** One verse said from the last words of the verse before. */
export function SpotCheck({
  verse,
  leadIn,
  onDone,
}: {
  verse: RecitationVerse;
  /** spotCheckLeadIn of the verse before; null at the start of a chapter. */
  leadIn: string | null;
  onDone: (passed: boolean) => void;
}) {
  const space = useScaledSpace();
  const [stage, setStage] = useState<'ready' | RecitationMode>('ready');
  const [canSpeak] = useState(() => canSpeakVerses([verse]));
  const script = scriptOfVerse(verse);

  const card = (
    <View className="bg-surface border border-line rounded-card" style={{ padding: space(16), gap: space(6) }}>
      <AppText variant="caption" className="font-sans font-medium text-ink-3 text-center">
        Spot check
      </AppText>
      <AppText variant="body" script={script} className="font-serif text-ink text-center">
        {leadIn ? `${leadIn} ` : ''}
        <AppText variant="body" className="font-sans font-bold text-ink">
          {verse.verse}
        </AppText>{' '}
        ___
      </AppText>
    </View>
  );

  if (stage === 'speak' || stage === 'type') {
    return (
      <GradedRecitation
        key={stage}
        verses={[verse]}
        startVerse={0}
        startWord={0}
        endVerse={0}
        mode={stage}
        header={card}
        continueLabel="Next"
        onCancel={() => setStage('ready')}
        onSwitchMode={setStage}
        // Said well enough to pass a review: the same mark Recall uses.
        onResult={(perVerse) => onDone(wordAccuracy(perVerse[0] ?? []) >= reviewPassAccuracy() - 1e-9)}
      />
    );
  }

  return (
    <RoundFrame>
      <View className="flex-1 justify-center" style={{ gap: space(10), minHeight: space(140) }}>
        {card}
        <AppText variant="label" className="font-sans text-ink-2 text-center">
          Say verse {verse.verse} to back up your check. If it slips, this review can't move your verses up.
        </AppText>
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
        <AppButton variant="quiet" label="I can't say it" onPress={() => onDone(false)} />
      </View>
    </RoundFrame>
  );
}

/**
 * The whole self-check: the per-verse picker (or straight on, when the user
 * said Got it for everything), then the spot check on one Got it verse.
 */
export function SelfCheckFlow({
  verses,
  allGotIt,
  spotCheck = true,
  previousText,
  note,
  onBack,
  onDone,
}: {
  verses: RecitationVerse[];
  /** The user tapped Got it for the lot: skip the picker. */
  allGotIt: boolean;
  /** Off when the check can't move anything up anyway (practice, not due). */
  spotCheck?: boolean;
  /** The verse before verses[i], for the spot check's lead-in. Defaults to the one before it in the list. */
  previousText?: (i: number) => string | null | undefined;
  note?: string;
  onBack?: () => void;
  onDone: (result: SelfCheckResult) => void;
}) {
  const [spot, setSpot] = useState<{ answers: SelfCheckAnswer[]; index: number } | null>(null);

  const answered = (answers: SelfCheckAnswer[]) => {
    const index = spotCheck ? pickSpotCheck(answers) : null;
    if (index === null) onDone({ answers, spotPassed: null });
    else setSpot({ answers, index });
  };

  // Got it for everything: straight to the spot check, decided once.
  const [initial] = useState(() => {
    if (!allGotIt) return null;
    const answers: SelfCheckAnswer[] = verses.map(() => 'gotIt');
    const index = spotCheck ? pickSpotCheck(answers) : null;
    return index === null ? null : { answers, index };
  });
  const current = spot ?? initial;

  if (current) {
    const i = current.index;
    const prev = previousText ? previousText(i) : previousInList(verses, i);
    return (
      <SpotCheck
        key={i}
        verse={verses[i]}
        leadIn={spotCheckLeadIn(prev)}
        onDone={(passed) => onDone({ answers: current.answers, spotPassed: passed })}
      />
    );
  }
  if (allGotIt) {
    // Nothing to spot check (it's off): Got it for everything stands.
    return <AutoDone onDone={() => onDone({ answers: verses.map(() => 'gotIt'), spotPassed: null })} />;
  }
  return <SelfCheckPicker verses={verses} note={note} onBack={onBack} onDone={answered} />;
}

/** Reports once, after mounting. */
function AutoDone({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

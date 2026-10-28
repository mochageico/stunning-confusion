import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { AppButton, AppText, useScaledSpace } from '../design';
import { Dialog, SegmentedControl } from '../blocks';
import type { SelfCheckAnswer } from '../../lib/grading';
import type { ReviewCompletedOpts } from '../../state/useAppState';
import type { VerseState } from '../../types';

// ============================================================================
// MANUAL LOG -- a review done off-app (in the car, from a card), logged as a
// self-check: Got it / Stumbled / Blanked per verse (REVIEW_LADDER_PLAN.md
// §4). The every-other rule applies (the engine holds a passage whose last
// move up was a self-check). There is no spot check: the review happened
// somewhere else. One sheet for Today's rows and the practice screen.
// ============================================================================

const ANSWERS: { id: SelfCheckAnswer; label: string }[] = [
  { id: 'gotIt', label: 'Got it' },
  { id: 'stumbled', label: 'Stumbled' },
  { id: 'blanked', label: 'Blanked' },
];

type UpdateStatus = (
  versesToUpdate: VerseState[],
  newStatus: 'memorized' | 'learning',
  customDrillType?: 'speak' | 'type' | 'reveal',
  opts?: ReviewCompletedOpts
) => unknown;

/**
 * Logs the answers. A verse past Learning is graded by its answer. A verse
 * still in Learning keeps the old meanings: Got it is a claimed perfect run
 * (banks a touch), Stumbled counts without a touch, Blanked is practice.
 * 'reveal' marks the touch as self-reported rather than machine-graded.
 */
export const logManualAnswers = async (verses: VerseState[], answers: SelfCheckAnswer[], update: UpdateStatus) => {
  const answerOf = (v: VerseState) => answers[verses.indexOf(v)] ?? 'gotIt';
  const gradeFor: ReviewCompletedOpts['gradeFor'] = (v) => {
    const i = verses.findIndex((x) => x.book === v.book && x.chapter === v.chapter && x.verse === v.verse);
    return i < 0 ? undefined : { kind: 'self', answer: answers[i] ?? 'gotIt' };
  };
  const pick = (a: SelfCheckAnswer) => verses.filter((v) => answerOf(v) === a);
  const gotIt = pick('gotIt');
  const stumbled = pick('stumbled');
  const blanked = pick('blanked');
  if (gotIt.length > 0) await update(gotIt, 'memorized', 'reveal', { gradeFor });
  if (stumbled.length > 0) await update(stumbled, 'memorized', 'reveal', { perfect: false, gradeFor });
  if (blanked.length > 0) await update(blanked, 'learning', 'reveal', { gradeFor });
};

export default function ManualLogSheet({
  visible,
  title,
  verses,
  selfCheckedLast,
  onClose,
  onLog,
}: {
  visible: boolean;
  title?: string;
  verses: VerseState[];
  /** A passage here was last moved up by a self-check: this one can't move it up. */
  selfCheckedLast?: boolean;
  onClose: () => void;
  onLog: (answers: SelfCheckAnswer[]) => void;
}) {
  const space = useScaledSpace();
  const [answers, setAnswers] = useState<SelfCheckAnswer[]>([]);
  // Fresh answers (all Got it) every time the sheet opens.
  useEffect(() => {
    if (visible) setAnswers(verses.map(() => 'gotIt'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const multi = verses.length > 1;

  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      placement="sheet"
      title={title}
      message="For a review you actually did somewhere else — out loud in the car, from a card, anywhere but here."
      actions={<AppButton variant="primary" label="Log it" onPress={() => onLog(verses.map((_v, i) => answers[i] ?? 'gotIt'))} />}
    >
      <View style={{ gap: space(12) }}>
        {verses.map((v, i) => (
          <View key={`${v.book}:${v.chapter}:${v.verse}`} style={{ gap: space(4) }}>
            {multi && (
              <AppText variant="label" className="font-sans font-semibold text-ink">
                Verse {v.verse}
              </AppText>
            )}
            <SegmentedControl
              options={ANSWERS}
              value={answers[i] ?? 'gotIt'}
              onChange={(a) => setAnswers((prev) => verses.map((_v, k) => (k === i ? a : prev[k] ?? 'gotIt')))}
              accessibilityLabel={`Verse ${v.verse}`}
            />
          </View>
        ))}
        {selfCheckedLast && (
          <AppText variant="caption" className="font-sans text-ink-3">
            Your last review here was checked by you too, so this one can hold or drop it but can't move it up.
          </AppText>
        )}
      </View>
    </Dialog>
  );
}

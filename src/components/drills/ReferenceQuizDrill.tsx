import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { DrillVerse } from '../../lib/drills';
import {
  buildRefRound,
  refAskable,
  refLabel,
  refManyChapters,
  refOpening,
  type RefDirectionPref,
  type RefQuestion,
} from '../../lib/referenceQuiz';
import { AppButton, AppText, useScaledSpace } from '../design';
import { SegmentedControl } from '../blocks';
import { OptionsPopup, type DrillGear } from '../session';

// ============================================================================
// REFERENCES -- multiple choice on verse numbers (lib/referenceQuiz.ts has the
// rules). One tap per question: a right answer moves on after half a second,
// a wrong one shows the right answer first. The end screen gives the score,
// the average time per answer and the missed verses, with a round of just
// those. Practice only: nothing here credits a review.
// ============================================================================

const RIGHT_PAUSE_MS = 500;
const WRONG_PAUSE_MS = 1300;

const DIRECTION_OPTIONS = [
  { id: 'v2n' as const, label: 'Verse → number' },
  { id: 'n2v' as const, label: 'Number → verse' },
  { id: 'both' as const, label: 'Both' },
];

interface Answer<V extends DrillVerse> {
  target: V;
  right: boolean;
  ms: number;
}

export default React.memo(function ReferenceQuizDrill<V extends DrillVerse>({
  verses,
  gear,
}: {
  verses: V[];
  /** The direction setting in the practice header's gear pop-up; without it, it sits above the quiz. */
  gear?: DrillGear;
}) {
  const space = useScaledSpace();
  const [pref, setPref] = useState<RefDirectionPref>('both');
  const [round, setRound] = useState<RefQuestion<V>[]>(() => buildRefRound(verses, 'both'));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer<V>[]>([]);
  const [tapped, setTapped] = useState<V | null>(null);
  const [missedRound, setMissedRound] = useState(false);
  const shownAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const manyChapters = useMemo(() => refManyChapters(verses), [verses]);
  const askable = useMemo(() => refAskable(verses).length, [verses]);

  const start = (p: RefDirectionPref, only?: V[]) => {
    if (timer.current) clearTimeout(timer.current);
    setRound(buildRefRound(verses, p, Math.random, only));
    setIndex(0);
    setAnswers([]);
    setTapped(null);
    setMissedRound(!!only);
    shownAt.current = Date.now();
  };

  // A new set of verses (or direction) starts a fresh round.
  useEffect(() => {
    start(pref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses, pref]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const q = round[index] ?? null;
  const done = round.length > 0 && index >= round.length;

  const pick = (choice: V) => {
    if (!q || tapped) return;
    const right = choice === q.target;
    setTapped(choice);
    setAnswers((a) => [...a, { target: q.target, right, ms: Date.now() - shownAt.current }]);
    timer.current = setTimeout(() => {
      setTapped(null);
      setIndex((i) => i + 1);
      shownAt.current = Date.now();
    }, right ? RIGHT_PAUSE_MS : WRONG_PAUSE_MS);
  };

  const rightCount = answers.filter((a) => a.right).length;
  const avgSeconds = answers.length > 0 ? answers.reduce((s, a) => s + a.ms, 0) / answers.length / 1000 : 0;
  const missed = answers.filter((a) => !a.right).map((a) => a.target);

  const directionControl = (
    <SegmentedControl value={pref} onChange={setPref} options={DIRECTION_OPTIONS} accessibilityLabel="Which way to quiz" />
  );

  if (askable === 0) {
    return (
      <View className="flex-1 items-center justify-center" style={{ gap: space(6), padding: space(16) }}>
        <AppText variant="body" className="font-sans font-bold text-ink-2 text-center">Nothing to choose between</AppText>
        <AppText variant="caption" className="font-sans text-ink-3 text-center">
          References needs at least 2 verses from the same chapter, in English.
        </AppText>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ gap: space(12) }}>
      {gear ? (
        <OptionsPopup visible={gear.open} onClose={gear.onClose} title={gear.title}>
          <View style={{ gap: space(6) }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-2">Which way</AppText>
            {directionControl}
          </View>
          {gear.footer}
        </OptionsPopup>
      ) : (
        directionControl
      )}

      {done ? (
        <ScrollView className="flex-1" contentContainerStyle={{ gap: space(12), paddingBottom: space(12) }}>
          <AppText variant="caption" className="font-sans text-ink-3 text-center">
            {missedRound ? 'Missed ones done' : 'Done'}
          </AppText>
          <AppText variant="display" className="font-sans font-bold text-ink text-center" style={{ fontVariant: ['tabular-nums'] }}>
            {`${rightCount} of ${answers.length}`}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3 text-center">
            {`${avgSeconds.toFixed(1)}s per answer · practice, never counts`}
          </AppText>
          {missed.length > 0 ? (
            <View className="bg-surface border border-line rounded-card" style={{ padding: space(12), gap: space(6) }}>
              <AppText variant="caption" className="font-sans font-semibold text-ink-3">Missed</AppText>
              {missed.map((m) => (
                <AppText key={refLabel(m)} variant="label" className="font-sans text-ink-2">
                  <AppText variant="label" className="font-sans font-bold text-ink">{refLabel(m)}</AppText>
                  {` · ${refOpening(m)}`}
                </AppText>
              ))}
            </View>
          ) : null}
          {missed.length > 0 && !missedRound ? (
            <AppButton variant="primary" label="Go again with the missed ones" onPress={() => start(pref, missed)} />
          ) : null}
          <AppButton variant={missed.length > 0 && !missedRound ? 'secondary' : 'primary'} label="Start over" onPress={() => start(pref)} />
        </ScrollView>
      ) : q ? (
        <ScrollView className="flex-1" contentContainerStyle={{ gap: space(12), paddingBottom: space(12) }}>
          {/* layout-ok: a progress track, no text. */}
          <View className="bg-fill rounded-full overflow-hidden" style={{ height: 4 }}>
            <View className="bg-accent rounded-full" style={{ height: 4 /* layout-ok: track fill */, width: `${(index / round.length) * 100}%` }} />
          </View>
          <AppText variant="caption" className="font-sans text-ink-3 text-center">
            {q.direction === 'v2n' ? 'Which verse number?' : 'Which verse is this?'}
          </AppText>
          <View className="bg-surface border border-line rounded-card justify-center" style={{ padding: space(16), gap: space(6), minHeight: space(110) }}>
            {q.direction === 'v2n' ? (
              <>
                {manyChapters ? (
                  <AppText variant="caption" className="font-sans font-semibold text-ink-3">{`${q.target.book} ${q.target.chapter}`}</AppText>
                ) : null}
                <AppText variant="body" className="font-serif leading-relaxed text-ink">{q.target.text}</AppText>
              </>
            ) : (
              <AppText variant="display" className="font-sans font-bold text-ink text-center">
                {manyChapters ? refLabel(q.target) : `v${q.target.verse}`}
              </AppText>
            )}
          </View>

          <View className={q.direction === 'v2n' ? 'flex-row flex-wrap' : ''} style={{ gap: space(8) }}>
            {q.choices.map((c) => {
              const isTarget = c === q.target;
              const state = tapped ? (isTarget ? 'right' : c === tapped ? 'wrong' : 'idle') : 'idle';
              const box =
                state === 'right' ? 'bg-success-soft border-success' : state === 'wrong' ? 'bg-danger-soft border-danger' : 'bg-surface border-line';
              const ink = state === 'right' ? 'text-success' : state === 'wrong' ? 'text-danger' : 'text-ink';
              return (
                <Pressable
                  key={`${c.chapter}:${c.verse}`}
                  onPress={() => pick(c)}
                  disabled={!!tapped}
                  accessibilityRole="button"
                  accessibilityLabel={q.direction === 'v2n' ? `Verse ${c.verse}` : refOpening(c)}
                  className={`border rounded-btn active:opacity-70 ${box}`}
                  style={
                    q.direction === 'v2n'
                      ? { flexBasis: '47%', flexGrow: 1, paddingVertical: space(16), alignItems: 'center' }
                      : { padding: space(12) }
                  }
                >
                  <AppText
                    variant={q.direction === 'v2n' ? 'title' : 'label'}
                    className={`font-sans ${q.direction === 'v2n' ? 'font-bold' : ''} ${ink}`}
                    style={q.direction === 'v2n' ? { fontVariant: ['tabular-nums'] } : undefined}
                  >
                    {q.direction === 'v2n' ? String(c.verse) : refOpening(c)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <View className="flex-row justify-between">
            <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {`${index + 1} of ${round.length}${missedRound ? ' · missed ones' : ''}`}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {`${rightCount} right${answers.length > 0 ? ` · ${avgSeconds.toFixed(1)}s avg` : ''}`}
            </AppText>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}) as <V extends DrillVerse>(props: { verses: V[]; gear?: DrillGear }) => React.ReactElement;

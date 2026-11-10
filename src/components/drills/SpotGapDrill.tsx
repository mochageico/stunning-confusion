import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Check, Info } from 'lucide-react-native';

import { DrillVerse } from '../../lib/drills';
import { blankCorrect, buildGapRound, GapAnswers, GapBlank, GapScore, GapVerse, GapVerseScore, scoreGap } from '../../lib/spotGap';
import { isRtl } from '../../lib/textScript';
import { AppButton, AppText, AppTextInput, useScaledSpace } from '../design';
import { useThemeColors } from '../theme';

// ============================================================================
// SPOT THE GAP -- Mixed review's graded drill (see src/lib/spotGap.ts).
// Tap the words that look wrong, type the first letters of each blank, and,
// when verse numbers are hidden, type each verse's number. How many words were
// planted is never said until the check. The first check is the one that
// counts, so there's no reshuffle after it.
// ============================================================================

interface Props {
  verses: DrillVerse[];
  hideNumbers: boolean;
  shuffle: boolean;
  /** Said under the score once checked. */
  resultNote: string;
  /** Fires on Check with the section's score. */
  onScored: (score: GapScore) => void;
}

export default React.memo(function SpotGapDrill({ verses, hideNumbers, shuffle, resultNote, onScored }: Props) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  // One round per mount: the screen keys it per round, so a chained review
  // gets fresh planted words.
  const round = useMemo(() => buildGapRound(verses, { hideNumbers, shuffle }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [numbers, setNumbers] = useState<Record<number, string>>({});
  const [score, setScore] = useState<GapScore | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  if (!round) {
    return (
      <AppText variant="caption" className="text-ink-3 font-sans">
        This passage is too short to hide anything in.
      </AppText>
    );
  }

  const rtl = isRtl(round.script);
  const submitted = score !== null;
  const answers: GapAnswers = { flagged, typed, numbers };

  const submit = () => {
    const result = scoreGap(round, answers);
    setScore(result);
    onScored(result);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const toggle = (index: number) =>
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  // After the check, the verses snap into their own order.
  const display: GapVerse[] = submitted ? [...round.verses].sort((a, b) => a.verseIndex - b.verseIndex) : round.verses;
  const rowOf = (gv: GapVerse): GapVerseScore | undefined => score?.perVerse.find((p) => p.verseIndex === gv.verseIndex);
  const blankOf = (id: number): GapBlank => round.blanks[id];

  const blankView = (id: number) => {
    const blank = blankOf(id);
    const value = typed[id] ?? '';
    if (!submitted) {
      return (
        <AppTextInput
          key={`blank-${id}`}
          value={value}
          onChangeText={(t) => setTyped((prev) => ({ ...prev, [id]: t }))}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={blank.words.map(() => '·').join(' ')}
          accessibilityLabel={`First letters of ${blank.words.length} hidden ${blank.words.length === 1 ? 'word' : 'words'}`}
          className="border border-accent rounded-btn bg-accent-soft text-center font-sans font-semibold text-ink px-2 py-0.5"
          style={{ minWidth: space(24) + space(18) * blank.words.length }}
        />
      );
    }
    const right = blankCorrect(value, blank.words, round.script);
    return (
      <AppText key={`blank-${id}`} variant="body" script={round.script} className={`font-serif font-bold ${right ? 'text-success' : 'text-danger'}`}>
        {blank.words.join(' ')}
      </AppText>
    );
  };

  const wordView = (gv: GapVerse, i: number) => {
    const w = gv.words[i];
    if (w.blank !== undefined) {
      // A blank is drawn once, at its first word.
      return i === 0 || gv.words[i - 1].blank !== w.blank ? blankView(w.blank) : null;
    }
    const isFlagged = flagged.has(w.index);
    let cls = 'text-ink';
    if (submitted) {
      if (w.isDecoy && isFlagged) cls = 'text-success font-bold';
      else if (w.isDecoy) cls = 'text-danger font-bold underline';
      else if (isFlagged) cls = 'text-warning line-through';
    } else if (isFlagged) {
      cls = 'text-accent font-bold underline';
    }
    return (
      <View key={w.index} className="flex-row items-baseline" style={{ columnGap: 4 }}>
        <AppText
          variant="body"
          script={round.script}
          className={`font-serif ${cls}`}
          onPress={submitted ? undefined : () => toggle(w.index)}
          accessibilityRole={submitted ? undefined : 'button'}
        >
          {w.text}
        </AppText>
        {submitted && w.isDecoy && (
          <AppText variant="body" script={round.script} className="font-serif font-bold text-success">
            {w.original}
          </AppText>
        )}
      </View>
    );
  };

  const numberBox = (gv: GapVerse) => {
    const row = rowOf(gv);
    if (!round.hideNumbers) return null;
    if (!submitted) {
      return (
        <AppTextInput
          value={numbers[gv.verseIndex] ?? ''}
          onChangeText={(t) => setNumbers((prev) => ({ ...prev, [gv.verseIndex]: t.replace(/[^0-9]/g, '') }))}
          keyboardType="number-pad"
          maxLength={3}
          accessibilityLabel="Verse number"
          className="border border-line-strong rounded-btn bg-surface text-center font-sans font-semibold text-ink"
          style={{ width: space(36), minHeight: space(32), paddingVertical: 2, paddingHorizontal: 2 }}
        />
      );
    }
    const right = row?.numberRight === true;
    const given = (numbers[gv.verseIndex] ?? '').trim();
    return (
      <View
        className={`items-center justify-center rounded-btn border ${right ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft'}`}
        style={{ width: space(36), minHeight: space(32) }}
      >
        {!right && given !== '' && (
          <AppText variant="caption" className="font-sans text-ink-3 line-through">
            {given}
          </AppText>
        )}
        <AppText variant="label" className={`font-sans font-semibold ${right ? 'text-success' : 'text-danger'}`}>
          {gv.verse}
        </AppText>
      </View>
    );
  };

  return (
    <View className="flex-1 justify-between">
      <ScrollView ref={scrollRef} className="flex-1 mb-2" contentContainerClassName="pb-2" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center gap-1" style={{ marginBottom: space(8) }}>
          <Info size={12} color={palette.ink3} />
          <AppText variant="caption" className="text-ink-3 font-sans flex-1">
            {submitted
              ? 'Green = right, red = missed, amber = wrongly flagged'
              : `Tap any word that looks wrong. Type the first letters of each blank${round.hideNumbers ? ' and the number of each verse' : ''}.`}
          </AppText>
        </View>

        {display.map((gv) => {
          const row = rowOf(gv);
          return (
            <View key={gv.verseIndex} className="flex-row items-center" style={{ gap: space(8), marginBottom: space(8) }}>
              {round.hideNumbers && numberBox(gv)}
              <View
                className={`flex-1 flex-row flex-wrap items-baseline bg-surface border rounded-card ${
                  submitted && row && !row.perfect ? 'border-danger' : 'border-line'
                }`}
                style={{ padding: space(10), columnGap: 4, rowGap: 4, flexDirection: rtl ? 'row-reverse' : 'row', flexWrap: 'wrap' }}
              >
                {!round.hideNumbers && (
                  <AppText variant="caption" className="font-sans font-bold text-ink-3">
                    {gv.verse}
                  </AppText>
                )}
                {gv.words.map((_w, i) => wordView(gv, i))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View className="shrink-0 gap-2">
        {submitted && score ? (
          <View className="bg-surface-2 border border-line rounded-card p-2.5 gap-1">
            <AppText variant="caption" className="font-sans font-bold text-ink text-center">
              {`${score.blanksRight} of ${score.blanks} blanks`}
              {score.planted > 0 ? ` · wrong words ${score.caught} of ${score.planted}` : ' · nothing was wrong'}
              {score.falseAlarms > 0 ? ` · ${score.falseAlarms} wrongly flagged` : ''}
              {score.numbers > 0 ? ` · numbers ${score.numbersRight} of ${score.numbers}` : ''}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-3 text-center">
              {resultNote}
            </AppText>
          </View>
        ) : (
          <AppButton variant="primary" Icon={Check} label="Check" onPress={submit} />
        )}
      </View>
    </View>
  );
});

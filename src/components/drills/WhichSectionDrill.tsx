import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ArrowRight, Check, Info, RotateCcw, Trophy, X } from 'lucide-react-native';

import type { TextScript } from '../../types';
import { buildQuestions, choiceText, DrillSection } from '../../lib/sectionDrills';
import { formatLabel, formatTag } from '../../lib/formatNames';
import { isRtl } from '../../lib/textScript';
import { AppButton, AppText, useFontScale, useScaledSpace } from '../design';
import { bracketColor, useThemeColors } from '../theme';

// ============================================================================
// WHICH SECTION -- MIXED_REVIEW_PLAN.md, stage 3
// ----------------------------------------------------------------------------
// One verse at a time, without its number; pick the section it belongs to from
// three: the right one and its neighbors. Answering shows where the verse sits.
// Practice: recognizing a verse's place is not saying it from memory, so it
// never credits a review. The caller checks there are 3+ sections.
// ============================================================================

export default React.memo(function WhichSectionDrill({
  sections,
  script = 'latin',
}: {
  sections: DrillSection[];
  script?: TextScript;
}) {
  const palette = useThemeColors();
  const space = useScaledSpace();
  // At large text the picker above leaves a phone almost no height, so the
  // button scrolls with the verse instead of staying pinned below it.
  const compact = useFontScale() >= 1.3;
  const rtl = isRtl(script);

  const signature = sections.map((s) => `${s.start}-${s.end}:${s.label ?? ''}`).join('|');
  const [questions, setQuestions] = useState(() => buildQuestions(sections));
  const [at, setAt] = useState(0);
  // The choice (a position in `sections`) picked for the current question.
  const [picked, setPicked] = useState<number | null>(null);
  const [rightCount, setRightCount] = useState(0);

  const restart = () => {
    setQuestions(buildQuestions(sections));
    setAt(0);
    setPicked(null);
    setRightCount(0);
  };

  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const question = questions[at];
  const finished = questions.length > 0 && at >= questions.length;
  const answered = picked !== null;
  const choiceTexts = useMemo(() => sections.map((s) => choiceText(s, script)), [sections, script]);

  const pick = (choice: number) => {
    if (answered || !question) return;
    setPicked(choice);
    if (choice === question.answer) setRightCount((n) => n + 1);
  };
  const next = () => {
    setPicked(null);
    setAt((n) => n + 1);
  };

  if (!question && !finished) return null;

  if (finished) {
    return (
      <View className="flex-1 justify-between">
        <View className="flex-1 items-center justify-center" style={{ gap: space(8), paddingHorizontal: space(16) }}>
          <Trophy size={Math.round(space(28))} color={palette.success} />
          <AppText variant="title" className="font-sans font-bold text-ink text-center">
            {rightCount} of {questions.length} right
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-3 text-center">
            {formatTag('whichSection')} only, nothing logged.
          </AppText>
        </View>
        <AppButton variant="primary" Icon={RotateCcw} label="Play again" onPress={restart} />
      </View>
    );
  }

  const footer = (
    <View className="shrink-0" style={{ gap: space(8) }}>
      {!answered && (
        <AppText variant="micro" className="font-sans text-ink-3 text-center">
          {formatLabel('whichSection')} is {formatTag('whichSection')}: it never counts as a review.
        </AppText>
      )}
      <AppButton
        variant="primary"
        Icon={ArrowRight}
        label={at + 1 < questions.length ? 'Next verse' : 'See score'}
        onPress={next}
        disabled={!answered}
      />
    </View>
  );

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1 mb-2" contentContainerStyle={{ gap: space(10), paddingBottom: space(8) }}>
        <View className="flex-row items-center" style={{ gap: space(6) }}>
          <Info size={Math.round(space(14))} color={palette.ink3} />
          <AppText variant="caption" className="text-ink-3 font-sans flex-1">
            Which section is this verse in?
          </AppText>
          <AppText variant="caption" className="text-ink-3 font-sans font-medium">
            {at + 1} of {questions.length}
          </AppText>
        </View>

        {/* The verse, without its number until it's answered. */}
        <View className="bg-surface border border-line rounded-card" style={{ padding: space(14), gap: space(6) }}>
          <AppText variant="body" script={script} className={`font-serif text-ink ${rtl ? 'text-right' : ''}`}>
            {question.verse.text}
          </AppText>
          {answered && (
            <AppText variant="caption" className="font-sans font-semibold text-ink-3">
              {question.verse.book} {question.verse.chapter}:{question.verse.verse}
            </AppText>
          )}
        </View>

        {/* The three choices. */}
        <View style={{ gap: space(8) }}>
          {question.choices.map((choice) => {
            const isAnswer = choice === question.answer;
            const isPicked = choice === picked;
            const text = choiceTexts[choice];
            const state = !answered ? 'open' : isAnswer ? 'right' : isPicked ? 'wrong' : 'quiet';
            return (
              <Pressable
                key={choice}
                onPress={() => pick(choice)}
                disabled={answered}
                accessibilityRole="button"
                accessibilityLabel={`${text.name}, ${text.range}`}
                className={`border rounded-card flex-row items-center ${
                  state === 'right'
                    ? 'border-success bg-success-soft'
                    : state === 'wrong'
                      ? 'border-danger/60 bg-danger-soft'
                      : state === 'quiet'
                        ? 'border-line bg-surface-2'
                        : 'border-line-strong bg-surface active:bg-surface-2'
                }`}
                style={{ padding: space(12), gap: space(10), minHeight: space(52) }}
              >
                {/* layout-ok: a color swatch for the section, not a box holding text. */}
                <View style={{ width: space(4), alignSelf: 'stretch', borderRadius: space(2), backgroundColor: bracketColor(palette, sections[choice].index) }} />
                <View className="flex-1" style={{ gap: space(2) }}>
                  <AppText variant="label" script={script} className={`font-serif leading-snug ${state === 'quiet' ? 'text-ink-3' : 'text-ink'}`}>
                    {text.name}
                  </AppText>
                  <AppText variant="caption" className="font-sans text-ink-3">{text.range}</AppText>
                </View>
                {state === 'right' && <Check size={Math.round(space(18))} color={palette.success} />}
                {state === 'wrong' && <X size={Math.round(space(18))} color={palette.danger} />}
              </Pressable>
            );
          })}
        </View>

        {answered && (
          <AppText variant="caption" className="font-sans text-ink-2">
            {picked === question.answer
              ? `Yes. Verse ${question.verse.verse} is in ${choiceTexts[question.answer].name}.`
              : `It's in ${choiceTexts[question.answer].name} (${choiceTexts[question.answer].range.toLowerCase()}).`}
          </AppText>
        )}
        {compact && footer}
      </ScrollView>

      {!compact && footer}
    </View>
  );
});

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronRight, Eye, EyeOff, Layers, Mic, RefreshCw, Sliders, Undo2 } from 'lucide-react-native';

import { buildUpStages, BUILD_UP_REPS, BiteSize, BuildDirection, DrillVerse } from '../../lib/drills';
import { joinWords, maskExceptFirstLetter, maskLetters, scriptOfVerse, splitWords, wordGap } from '../../lib/textScript';
import { loadPracticePrefs, savePracticePrefs } from '../../lib/practicePrefs';
import { AppButton, AppText } from '../design';
import { ChipRow } from '../ui';
import { useThemeColors } from '../theme';

// ============================================================================
// BUILD UP -- learn a verse a phrase at a time, each stage adding one bite to
// everything already stacked, each stage fading from full text to first
// letters to nothing. Ungraded; the end screen offers a blind graded run.
// ============================================================================

export default React.memo(function BuildUpDrill({
  verses,
  onTryBlind,
  onComplete,
}: {
  verses: DrillVerse[];
  /** The end screen's main button: prove it cold in a graded recitation. */
  onTryBlind?: () => void;
  /** Fires when the last stage's last rep is done. */
  onComplete?: () => void;
}) {
  const palette = useThemeColors();
  const script = useMemo(() => (verses.length > 0 ? scriptOfVerse(verses[0]) : 'latin'), [verses]);

  // The two settings persist across sessions in the shared practice prefs.
  const [buildSize, setBuildSize] = useState<BiteSize>('medium');
  const [buildDirection, setBuildDirection] = useState<BuildDirection>('forward');
  // Saving waits for the load, so the defaults never overwrite a saved choice.
  const prefsLoadedRef = useRef(false);
  useEffect(() => {
    (async () => {
      const saved: any = await loadPracticePrefs();
      if (saved.buildSize === 'short' || saved.buildSize === 'medium' || saved.buildSize === 'long') setBuildSize(saved.buildSize);
      if (saved.buildDirection === 'forward' || saved.buildDirection === 'backward') setBuildDirection(saved.buildDirection);
      prefsLoadedRef.current = true;
    })();
  }, []);
  useEffect(() => {
    if (prefsLoadedRef.current) savePracticePrefs({ buildSize, buildDirection });
  }, [buildSize, buildDirection]);

  // Two things move, and never at the same time: `buildStageIdx` is how much
  // of the verse is stacked (only grows when a phrase is finished), and
  // `buildRepIdx` is how much help you're getting right now (resets to 0 --
  // full text -- every time a phrase is added). The three reps ARE the fade;
  // there's no separate repetition counter, because three reps of identical
  // fully-visible text is parroting rather than recall.
  const [buildStageIdx, setBuildStageIdx] = useState(0);
  const [buildRepIdx, setBuildRepIdx] = useState(0);
  // A no-penalty full reveal on the hint/blind reps. Nothing is graded here,
  // so there is nothing to penalise -- being stuck and having no way out is
  // the only real failure state this drill has.
  const [buildPeek, setBuildPeek] = useState(false);
  const [buildFinished, setBuildFinished] = useState(false);
  const [buildSettingsOpen, setBuildSettingsOpen] = useState(false);

  const buildStages = useMemo(
    () => buildUpStages(verses, { size: buildSize, direction: buildDirection }),
    [verses, buildSize, buildDirection]
  );
  const buildStage = buildStages[buildStageIdx];
  const buildRep = BUILD_UP_REPS[buildRepIdx];

  const resetBuildUp = () => {
    setBuildStageIdx(0);
    setBuildRepIdx(0);
    setBuildPeek(false);
    setBuildFinished(false);
  };

  // A new passage (a chained review swaps `verses` in place) re-cuts the
  // stages, so the old position means nothing.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    resetBuildUp();
  }, [verses]);

  // Changing either setting re-cuts the verse underneath us, so the stage
  // index it was pointing at no longer means anything (and may not exist).
  const changeBuildSize = (size: BiteSize) => {
    setBuildSize(size);
    resetBuildUp();
  };
  const changeBuildDirection = (direction: BuildDirection) => {
    setBuildDirection(direction);
    resetBuildUp();
  };

  // The entire interaction: say it out loud (or in your head -- the app can't
  // tell and shouldn't care), then tap. No mic, no typing, nothing graded.
  const advanceBuildUp = () => {
    setBuildPeek(false);
    if (buildFinished) {
      resetBuildUp();
    } else if (buildRepIdx < BUILD_UP_REPS.length - 1) {
      setBuildRepIdx(buildRepIdx + 1);
    } else if (buildStageIdx < buildStages.length - 1) {
      setBuildStageIdx(buildStageIdx + 1);
      setBuildRepIdx(0);
    } else {
      setBuildFinished(true);
      onComplete?.();
    }
  };

  const stepBackBuildUp = () => {
    setBuildPeek(false);
    if (buildFinished) setBuildFinished(false);
    else if (buildRepIdx > 0) setBuildRepIdx(buildRepIdx - 1);
    else if (buildStageIdx > 0) {
      setBuildStageIdx(buildStageIdx - 1);
      setBuildRepIdx(BUILD_UP_REPS.length - 1);
    }
  };

  // Build up can't count toward review -- the text was on screen for the
  // first of every three reps and the user self-reported by tapping. Rather
  // than pretend otherwise, finishing hands off to a real blind graded run.
  const tryBlind = () => {
    resetBuildUp();
    onTryBlind?.();
  };

  // Applies the current rep's support level to one segment. 'read' shows the
  // text; 'hint' keeps each word's first letter; 'blind' shows nothing but
  // shape and punctuation. Peeking overrides all of it.
  const maskBuildSegment = (text: string) => {
    if (buildRep === 'read' || buildPeek) return text;
    const maskWord = buildRep === 'hint' ? maskExceptFirstLetter : maskLetters;
    return joinWords(splitWords(text, script).map((w) => maskWord(w, script)));
  };

  if (!buildStage && !buildFinished) {
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2">
        <Layers size={28} color={palette.ink3} />
        <AppText variant="body" className="font-sans font-bold text-ink-2 text-center">Nothing to build</AppText>
        <AppText variant="caption" className="text-ink-3 font-sans text-center">There's no verse text here to split into phrases.</AppText>
      </View>
    );
  }

  if (buildFinished) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-4">
        <View className="w-12 h-12 rounded-full bg-success-soft items-center justify-center">
          <Check size={24} color={palette.success} />
        </View>
        <AppText variant="body" className="font-sans font-bold text-ink text-center">
          {verses.length > 1 ? 'The whole passage, from memory' : 'The whole verse, from memory'}
        </AppText>
        <AppText variant="caption" className="text-ink-3 font-sans text-center">
          Build up doesn't count toward review — the words were on screen and you graded yourself. Want to prove it cold?
        </AppText>
        {onTryBlind && <AppButton size="lg" variant="primary" Icon={Mic} label="Try it blind in Recall" onPress={tryBlind} className="w-full" />}
        <AppButton variant="quiet" Icon={RefreshCw} label="Run it again" onPress={resetBuildUp} className="w-full" />
      </View>
    );
  }

  const stage = buildStage;
  const verse = verses[stage.verseIndex];
  const isLastRep = buildRepIdx === BUILD_UP_REPS.length - 1;
  const isLastStage = buildStageIdx === buildStages.length - 1;
  // The button names the one thing to do right now, so the rep ladder never
  // has to be interpreted to know what's being asked. The exception is the
  // blind rep, where the ladder is already saying "from memory" and the
  // useful thing to name is what the tap commits you to next.
  const actionLabel = !isLastRep
    ? buildRep === 'read'
      ? 'Read it aloud'
      : 'Say it with hints'
    : isLastStage
      ? 'Finish'
      : stage.step === stage.stepCount
        ? buildStages[buildStageIdx + 1]?.phase === 'reassemble'
          ? 'Put it all together'
          : 'Next verse'
        : stage.phase === 'reassemble'
          ? 'Add the next verse'
          : 'Add the next phrase';

  return (
    <View className="flex-1 justify-between">
      {/* Progress: how much is stacked, and where we are. */}
      <View className="shrink-0 gap-1.5 mb-2">
        <View className="flex-row items-center justify-between">
          <AppText variant="caption" className="font-sans font-semibold text-ink-3 flex-1">
            {stage.phase === 'reassemble'
              ? `Putting it together — verse ${stage.step} of ${stage.stepCount}`
              : `${verse ? `${verse.chapter}:${verse.verse} — ` : ''}phrase ${stage.step} of ${stage.stepCount}`}
          </AppText>
          <Pressable onPress={() => setBuildSettingsOpen((p) => !p)} hitSlop={8} className="flex-row items-center gap-1">
            <Sliders size={12} color={palette.ink3} />
            <AppText variant="caption" className="font-sans font-semibold text-ink-2">
              {buildDirection === 'forward' ? 'Forward' : 'Backward'}
            </AppText>
          </Pressable>
        </View>

        <View className="flex-row gap-1">
          {Array.from({ length: stage.stepCount }).map((_, i) => {
            // Backward chaining fills from the right, so the bar mirrors
            // what's actually on screen.
            const filledFromEnd = buildDirection === 'backward';
            const pos = filledFromEnd ? stage.stepCount - 1 - i : i;
            const inPlay = pos < stage.step;
            const isNewest = pos === stage.step - 1;
            return <View key={i} className={`h-1.5 flex-1 rounded-full ${isNewest ? 'bg-warning' : inPlay ? 'bg-accent' : 'bg-fill'}`} />;
          })}
        </View>
      </View>

      {/* Bite size lives behind the gear rather than on a setup screen --
          it's a once-in-a-while decision, and a card between the user and
          phrase 1 is a tax on every session to serve the rare one. */}
      {buildSettingsOpen && (
        <View className="shrink-0 bg-surface-2 border border-line rounded-card p-2.5 gap-2 mb-2">
          {/* Label ABOVE the chips, not beside them. ChipRow's default chips
              are flex-1, so they need the full row width to divide -- sitting
              them next to a label in a justify-between row leaves them sizing
              against whatever's left over, and the labels spill out. */}
          <View className="gap-1">
            <AppText variant="caption" className="font-sans font-bold text-ink-2">Bite size</AppText>
            <ChipRow
              options={[
                { id: 'short' as BiteSize, label: 'Short' },
                { id: 'medium' as BiteSize, label: 'Medium' },
                { id: 'long' as BiteSize, label: 'Long' },
              ]}
              value={buildSize}
              onChange={changeBuildSize}
            />
          </View>
          <View className="gap-1">
            <AppText variant="caption" className="font-sans font-bold text-ink-2">Build from</AppText>
            <ChipRow
              options={[
                { id: 'forward' as BuildDirection, label: 'The start' },
                { id: 'backward' as BuildDirection, label: 'The end' },
              ]}
              value={buildDirection}
              onChange={changeBuildDirection}
            />
          </View>
          <AppText variant="caption" className="text-ink-3 font-sans">
            Building from the end means every repetition finishes on the words you know best. Changing either setting restarts the verse.
          </AppText>
        </View>
      )}

      {/* The passage. Everything in play fades together; the phrase just
          added is the amber one. */}
      <ScrollView className="flex-1" contentContainerClassName="grow justify-center py-2">
        <View className="border border-line bg-surface rounded-card p-4">
          <AppText variant="title" script={script} className="font-serif leading-[30px]">
            {stage.segments.map((seg, i) => (
              <AppText variant="inherit" key={i} className={seg.isNew ? 'text-warning' : 'text-ink'}>
                {maskBuildSegment(seg.text)}
                {i < stage.segments.length - 1 ? wordGap(seg.text) : ''}
              </AppText>
            ))}
          </AppText>
        </View>
      </ScrollView>

      <View className="shrink-0 gap-2">
        {/* The rep ladder — the only other moving part. */}
        <View className="flex-row items-center justify-between px-1">
          {BUILD_UP_REPS.map((rep, i) => {
            const reached = i <= buildRepIdx;
            return (
              <View key={rep} className="flex-row items-center gap-1.5">
                <View className={`w-2 h-2 rounded-full ${reached ? 'bg-accent' : 'border border-line-strong'}`} />
                <AppText variant="caption" className={`font-sans ${i === buildRepIdx ? 'font-semibold text-ink' : 'font-medium text-ink-3'}`}>
                  {rep === 'read' ? 'Read' : rep === 'hint' ? 'Hints' : 'From memory'}
                </AppText>
              </View>
            );
          })}
        </View>

        <AppButton size="lg" variant="primary" label={actionLabel} onPress={advanceBuildUp} className="w-full">
          <ChevronRight size={17} color={palette.onAccent} />
        </AppButton>

        <View className="flex-row gap-2">
          <AppButton
            variant="quiet"
            Icon={Undo2}
            label="Back"
            onPress={stepBackBuildUp}
            disabled={buildStageIdx === 0 && buildRepIdx === 0}
            className="flex-1"
          />
          {buildRep !== 'read' && (
            <AppButton
              variant={buildPeek ? 'secondary' : 'quiet'}
              Icon={buildPeek ? EyeOff : Eye}
              label={buildPeek ? 'Hide' : 'Peek'}
              onPress={() => setBuildPeek((p) => !p)}
              className="flex-1"
            />
          )}
        </View>
      </View>
    </View>
  );
});

import { ScrollView, View } from 'react-native';
import { Check, Eye, Mic, MicOff, RefreshCw, Shuffle, Sparkles } from 'lucide-react-native';
import { normalizeToken, summarizeOutcomes, REVIEW_PASS_ACCURACY } from '../../lib/recitation';
import { maskExceptFirstLetter, maskLetters, splitWords, wordGap } from '../../lib/textScript';
import { MIN_JIGSAW_VERSES } from '../../lib/drills';
import { MIX_NAMES } from '../../lib/formatNames';
import { BounceView, DiscreteSlider, FadeInView, SpinView, WaveBars } from '../ui';
import MemoryGrid from '../MemoryGrid';
import { AppButton, AppIconButton, AppTextInput, AppText, RangeCaption } from '../design';
import { Badge, SegmentedControl } from '../blocks';
import BuildUpDrill from '../drills/BuildUpDrill';
import JigsawDrill from '../drills/JigsawDrill';
import ScrambleDrill from '../drills/ScrambleDrill';
import SpotSwapDrill from '../drills/SpotSwapDrill';
import OutlineDrill from '../drills/OutlineDrill';
import SectionOrderDrill from '../drills/SectionOrderDrill';
import WhichSectionDrill from '../drills/WhichSectionDrill';
import TeachItDrill from '../drills/TeachItDrill';
import type { OutlineVerseResult } from '../../lib/outline';
import { DrillSetting, DrillSettings, HIDE_LEVELS } from './shared';
import type { PracticeModalsProps } from '../PracticeModals';
import type { TextScript, VerseState } from '../../types';
import type { useThemeColors } from '../theme';
import type { RecallState } from './useRecall';

// The practice screen's Learn layout: the mode picker, graded Recall (passage
// or memory grid, input row, results) and the supplementary drills. All state
// comes from useRecall via PracticeModals. Split out of PracticeModals.tsx
// (see .claude/file-split-plan.md).

interface RecallPanelProps {
  recall: RecallState;
  verses: PracticeModalsProps['verses'];
  onUpdateStatus: PracticeModalsProps['onUpdateStatus'];
  onPickUpThread: PracticeModalsProps['onPickUpThread'];
  highlightedVerses: PracticeModalsProps['highlightedVerses'];
  onToggleVerseHighlight: PracticeModalsProps['onToggleVerseHighlight'];
  verseDoodles: PracticeModalsProps['verseDoodles'];
  onSaveVerseDoodle: PracticeModalsProps['onSaveVerseDoodle'];
  memoryGridColumns: NonNullable<PracticeModalsProps['memoryGridColumns']>;
  palette: ReturnType<typeof useThemeColors>;
  fontScale: number;
  handleGroupComplete: () => void;
  passageScript: TextScript;
  sectionsForChapter: PracticeModalsProps['sectionsForChapter'];
  onSaveOutlineExtra: PracticeModalsProps['onSaveOutlineExtra'];
  onSaveTakeawayDraft: PracticeModalsProps['onSaveTakeawayDraft'];
}

export default function RecallPanel({
  recall,
  verses,
  onUpdateStatus,
  onPickUpThread,
  highlightedVerses,
  onToggleVerseHighlight,
  verseDoodles,
  onSaveVerseDoodle,
  memoryGridColumns,
  palette,
  fontScale,
  handleGroupComplete,
  passageScript,
  sectionsForChapter,
  onSaveOutlineExtra,
  onSaveTakeawayDraft,
}: RecallPanelProps) {
  const {
    learnTab,
    reciteWordObjects,
    recitePointer,
    reciteOrder,
    lastToFirst,
    switchLastToFirst,
    reciteOutcomes,
    verseStrikes,
    strikeLimit,
    showStrikeResetAlert,
    typedInput,
    flashError,
    isFinishedRecite,
    finalOutcomes,
    isListeningSpeak,
    localToast,
    speechAvailable,
    usedSpeechRef,
    handleReciteTypeChar,
    overrideWordAsCorrect,
    handleReciteHint,
    resetReciteGame,
    hideLevel,
    setHideLevel,
    hintMode,
    activeLevel,
    setActiveLevel,
    switchHintMode,
    recallDisplayMode,
    setRecallDisplayMode,
    gridHideMode,
    setGridHideMode,
    hiddenWordIndices,
    regenerateHiddenWords,
    gridWordStates,
    switchLearnTab,
    learnModes,
    sectionList,
    threadTarget,
    notDueLine,
    allNotDue,
    isDueForReview,
    startListening,
    stopListening,
    onBuildUpTryBlind,
  } = recall;

  // First words counts as a review: a verse said from its first words that
  // clears the same 90% a review needs, and is due, is logged quietly (the
  // drill marks the verse itself). Anything else was practice.
  const creditOutlineVerse = (r: OutlineVerseResult) => {
    if (!r.passed || !isDueForReview(r.verse)) return;
    const verse: VerseState = {
      book: r.verse.book,
      chapter: r.verse.chapter,
      verse: r.verse.verse,
      text: r.verse.text,
      status: 'memorized',
      translationId: r.verse.translationId,
    };
    onUpdateStatus([verse], 'memorized', r.mode, { perfect: false, quiet: true, via: 'outline' });
  };

  return (
    <View className="flex-1 justify-between relative">
      {/* Local custom toast alert */}
      {localToast && (
        <BounceView style={{ position: 'absolute', top: 56, left: '50%', marginLeft: -100, zIndex: 30 }}>
          <View className="bg-accent px-3.5 py-1.5 rounded-full">
            <AppText variant="caption" className="text-on-accent font-sans font-bold">{localToast}</AppText>
          </View>
        </BounceView>
      )}

      {/* Mode picker. Recall is the only graded mode; the rest are
          supplementary drills (see the LearnMode comment above). */}
      {/* The standard segmented control, labels only: at five modes
          the icons were what pushed the old picker onto two rows.
          Segments size to their labels, so "Scramble" gets more room
          than "Spot", and a label wraps rather than being cut off at
          large text sizes. */}
      <View className="mb-3 shrink-0">
        <SegmentedControl
          value={learnTab}
          onChange={switchLearnTab}
          accessibilityLabel="Practice mode"
          wrap={fontScale >= 1.3 || learnModes.length > 6}
          options={learnModes.map(({ id, label }) => ({ id, label }))}
        />
      </View>

      {learnTab === 'recite' ? (
        !isFinishedRecite ? (
          <View className="flex-1 justify-between">
            {/* Passage card frame — typed + spoken progress share one
                highlight: words before the pointer are graded, the
                word at the pointer is the "current" target for both
                channels, everything after is masked. */}
            <View className={`border rounded-card p-4 flex-1 justify-between relative ${flashError ? 'border-danger bg-danger-soft' : 'border-line bg-surface'}`}>
              {/* Strike Reset Alert Overlay */}
              {showStrikeResetAlert && (
                <FadeInView style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
                  <View className="flex-1 bg-surface/95 items-center justify-center p-4 rounded-card">
                    <SpinView>
                      <View className="w-10 h-10 rounded-full bg-danger-soft items-center justify-center mb-2">
                        <RefreshCw size={20} color={palette.danger} />
                      </View>
                    </SpinView>
                    <AppText variant="body" className="font-sans font-bold text-ink">Starting the verse over</AppText>
                    <AppText variant="caption" className="font-sans text-ink-2 px-4 text-center">
                      That's {strikeLimit} mistakes in this verse, so it starts again from the top. You can change
                      this in Settings.
                    </AppText>
                  </View>
                </FadeInView>
              )}

              <View className="mb-3 shrink-0">
                <SegmentedControl
                  value={recallDisplayMode}
                  onChange={setRecallDisplayMode}
                  accessibilityLabel="Show the verses as"
                  options={[
                    { id: 'passage' as const, label: 'Passage' },
                    { id: 'memoryGrid' as const, label: 'Memory grid' },
                  ]}
                />
              </View>

              {recallDisplayMode === 'memoryGrid' ? (
                <ScrollView className="flex-1 mb-2">
                  <MemoryGrid
                    verses={reciteOrder.verseOrder.map((vi) => verses[vi]).map((v) => ({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, translationId: v.translationId }))}
                    columns={memoryGridColumns}
                    highlightedKeys={highlightedVerses}
                    onToggleHighlight={onToggleVerseHighlight ? (key) => onToggleVerseHighlight(key) : undefined}
                    doodles={verseDoodles}
                    onSaveDoodle={onSaveVerseDoodle ? (key, _v, strokes) => onSaveVerseDoodle(key, strokes) : undefined}
                    wordStates={gridWordStates}
                    hideMode={gridHideMode}
                  />
                </ScrollView>
              ) : (
              <ScrollView className="flex-1 mb-2">
                <View className="gap-3">
                  {(() => {
                    // Verses show in recite order (last verse on top for
                    // Last to first), but each word keeps its passage-order
                    // index g; isPast/isCurrent compare its recite position.
                    const firstWord: number[] = [];
                    let count = 0;
                    verses.forEach((v) => {
                      firstWord.push(count);
                      count += splitWords(v.text, passageScript).filter((w) => normalizeToken(w, passageScript).length > 0).length;
                    });
                    return reciteOrder.verseOrder.map((vi) => {
                      const v = verses[vi];
                      let flatIdx = firstWord[vi];
                      const words = splitWords(v.text, passageScript);
                      return (
                        <AppText variant="body" script={passageScript} key={`${v.book}-${v.chapter}-${v.verse}`} className="font-serif leading-relaxed text-ink">
                          <AppText variant="caption" className="font-sans font-bold text-ink-3">{v.verse} </AppText>
                          {words.map((w, idx) => {
                            const isCountedWord = normalizeToken(w, passageScript).length > 0;
                            const g = isCountedWord ? flatIdx++ : -1;
                            const isPast = g >= 0 && reciteOrder.posOf[g] < recitePointer;
                            const isCurrent = g >= 0 && reciteOrder.posOf[g] === recitePointer;
                            const isGivenHint = g >= 0 && !hiddenWordIndices.has(g);

                            if (isPast) {
                              const outcome = reciteOutcomes[g];
                              const gradeClass =
                                outcome === 'missed'
                                  ? 'text-danger underline decoration-dotted decoration-danger/50'
                                  : outcome === 'close'
                                    ? 'text-warning'
                                    : 'text-ink';
                              // Missed words are tappable -- the speech
                              // engine mis-hears plenty of words the
                              // user actually said right, and there's
                              // no reliable automatic fix, so this is
                              // the manual escape valve.
                              return (
                                <AppText variant="inherit"
                                  key={idx}
                                  className={`font-serif font-semibold ${gradeClass}`}
                                  onPress={outcome === 'missed' ? () => overrideWordAsCorrect(g) : undefined}
                                >
                                  {w}{wordGap(w)}
                                </AppText>
                              );
                            }

                            if (!isCountedWord) {
                              // Punctuation-only token (e.g. a standalone
                              // dash) -- not part of the recite pointer,
                              // just render it plainly.
                              return (
                                <AppText variant="inherit" key={idx} className="font-serif text-ink">
                                  {w}{wordGap(w)}
                                </AppText>
                              );
                            }

                            if (isGivenHint) {
                              // This word wasn't drawn into the hidden
                              // sample, so it's shown as a given hint --
                              // still has to be typed/spoken to advance,
                              // but isn't a blind guess.
                              return (
                                <AppText variant="inherit"
                                  key={idx}
                                  className={`font-serif rounded px-1 ${isCurrent ? 'bg-warning-soft text-ink-2' : 'text-ink-3'}`}
                                >
                                  {w}{wordGap(w)}
                                </AppText>
                              );
                            }

                            if (hintMode === 'firstLetter') {
                              // Assisted hint -- kept visually distinct
                              // (sky, not amber/neutral) from both a
                              // given-hint word and a true blind mask,
                              // since this run can only ever count as
                              // a review, never mastery.
                              return (
                                <AppText variant="inherit"
                                  key={idx}
                                  className={`font-sans rounded px-1 font-bold ${
                                    isCurrent ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'
                                  }`}
                                >
                                  {maskExceptFirstLetter(w, passageScript)}{wordGap(w)}
                                </AppText>
                              );
                            }

                            return (
                              <AppText variant="inherit"
                                key={idx}
                                className={`font-sans rounded px-1 font-bold ${
                                  isCurrent ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'
                                }`}
                              >
                                {maskLetters(w, passageScript)}{wordGap(w)}
                              </AppText>
                            );
                          })}
                        </AppText>
                      );
                    });
                  })()}
                </View>
              </ScrollView>
              )}

              {/* Input row -- mic lives inline at the right edge of the
                  typed-input box (was a whole separate labeled row
                  above; tapping a mic icon to talk is self-evident, and
                  this saves the vertical/horizontal room for the words
                  themselves instead). */}
              <View className="gap-2.5 pt-2">
                <View className="flex-row justify-between items-center px-1">
                  <View className="flex-row items-center gap-2">
                    {/* Red only once there's a mistake to count. */}
                    {strikeLimit !== 'unlimited' && (
                      <AppText variant="caption" className={`font-sans font-medium ${verseStrikes > 0 ? 'text-danger' : 'text-ink-3'}`}>
                        {verseStrikes} of {strikeLimit} mistakes
                      </AppText>
                    )}
                  </View>
                  <AppText variant="caption" className="font-sans font-medium text-ink-3">{recitePointer} of {reciteWordObjects.length} words</AppText>
                </View>

                <View className="flex-row items-center gap-2">
                  {/* Short enough to fit an SE at 1.5x. Nearby keys still
                      count; that's forgiveness, not an instruction. */}
                  <AppTextInput value={typedInput} onChangeText={handleReciteTypeChar} autoCapitalize="none" autoCorrect={false} spellCheck={false} placeholder={showStrikeResetAlert ? 'Starting over…' : fontScale >= 1.3 ? 'First letters' : 'First letter of each word'} style={{ minWidth: 0 }} className="flex-1 bg-surface-2 border border-line rounded-btn py-2 px-3 text-center font-sans font-semibold text-ink" editable={!showStrikeResetAlert} />
                  {/* English only: phone speech engines know modern
                      Hebrew at best, with no vowel points, so they
                      can't grade Biblical Hebrew or Koine Greek. Typing
                      still works for both. */}
                  {speechAvailable && passageScript === 'latin' && (
                    <AppIconButton
                      Icon={isListeningSpeak ? MicOff : Mic}
                      diameter={40}
                      iconColor={palette.onAccent}
                      onPress={() => (isListeningSpeak ? stopListening() : startListening())}
                      accessibilityLabel={isListeningSpeak ? 'Stop listening' : 'Say it out loud'}
                      className={`shrink-0 ${isListeningSpeak ? 'bg-danger' : 'bg-accent'}`}
                    />
                  )}
                </View>
                {isListeningSpeak && (
                  <View className="h-6 items-center justify-center bg-surface-2 rounded-lg border border-line">
                    <WaveBars active count={16} />
                  </View>
                )}
              </View>
            </View>

            <DrillSettings>
            {/* How many words get hidden this attempt -- changing it or
                resetting always re-rolls a fresh random subset.
                % Hidden only grades at 100% (Blind); First Letter
                grades as a review at any level, but never mastery --
                see the finish panel split below. Passage-mode only --
                %-hidden has no meaning against the grid, which is
                always first-letter (or now, always blank). */}
            {recallDisplayMode === 'passage' && (
              <DrillSetting
                storageKey="recall.hiding"
                first
                label="Words hidden"
                valueClassName={hintMode === 'firstLetter' ? 'text-accent' : 'text-ink-2'}
                value={
                  hintMode === 'firstLetter'
                    ? 'First letters · review only'
                    : activeLevel === 100
                      ? 'All (blind)'
                      : `${activeLevel}% · practice only`
                }
              >
                <SegmentedControl
                  value={hintMode}
                  onChange={switchHintMode}
                  accessibilityLabel="How words are hidden"
                  options={[
                    { id: 'percent' as const, label: 'Hide words' },
                    { id: 'firstLetter' as const, label: 'Show first letters' },
                  ]}
                />
                {hintMode === 'percent' && (
                  // 0-100 in steps of 5. The row above reads the
                  // current value out, so the slider needs only its
                  // two ends labeled rather than 21 stops.
                  <View style={{ gap: 2 }}>
                    <DiscreteSlider
                      value={activeLevel}
                      onChange={(level) => {
                        setActiveLevel(level);
                        resetReciteGame();
                        regenerateHiddenWords(level);
                      }}
                      options={HIDE_LEVELS}
                      showStopLabels={false}
                      accessibilityLabel="Words hidden"
                    />
                    <RangeCaption min="None" max="All" />
                  </View>
                )}
                <AppText variant="caption" className="text-ink-3 font-sans">
                  {hintMode === 'firstLetter'
                    ? 'Counts as a review, but never toward learning a verse.'
                    : 'Only a run with every word hidden counts as a review.'}
                </AppText>
              </DrillSetting>
            )}

            {/* Memory Grid's own hide setting -- no slider, since the
                grid is either showing first letters or not; there's no
                in-between percentage to speak of. */}
            {recallDisplayMode === 'memoryGrid' && (
              <DrillSetting
                storageKey="recall.grid"
                first
                label="Grid shows"
                value={gridHideMode === 'blank' ? 'Nothing' : 'First letters'}
              >
                <SegmentedControl
                  value={gridHideMode}
                  onChange={setGridHideMode}
                  accessibilityLabel="What the grid shows"
                  options={[
                    { id: 'firstLetter' as const, label: 'First letters' },
                    { id: 'blank' as const, label: 'Nothing' },
                  ]}
                />
              </DrillSetting>
            )}

            {/* Last to first: the verses in reverse, each one still said
                forward. Speaking and typing both follow it, and it counts
                like any other run. Changing it starts the run over. */}
            {verses.length >= 2 && (
              <DrillSetting
                storageKey="recall.order"
                label="Verse order"
                value={lastToFirst ? MIX_NAMES.lastToFirst : MIX_NAMES.firstToLast}
              >
                <SegmentedControl
                  value={lastToFirst ? 'lastToFirst' : 'firstToLast'}
                  onChange={(id) => switchLastToFirst(id === 'lastToFirst')}
                  accessibilityLabel="Verse order"
                  options={[
                    { id: 'firstToLast' as const, label: MIX_NAMES.firstToLast },
                    { id: 'lastToFirst' as const, label: MIX_NAMES.lastToFirst },
                  ]}
                />
                <AppText variant="caption" className="text-ink-3 font-sans">
                  Each verse is still said start to finish. Counts as a review the same way.
                </AppText>
              </DrillSetting>
            )}
            </DrillSettings>

            <View className="mt-2.5 flex-row gap-2.5">
              <AppButton
                variant="quiet"
                Icon={fontScale >= 1.3 ? undefined : RefreshCw}
                label="Start over"
                onPress={() => { resetReciteGame(); regenerateHiddenWords(activeLevel); }}
                className="flex-1"
              />
              <AppButton variant="secondary" Icon={fontScale >= 1.3 ? undefined : Eye} label="Reveal word" onPress={handleReciteHint} className="flex-1" />
            </View>
          </View>
        ) : hintMode === 'percent' && hideLevel < 100 ? (
          /* Partially-hidden finish panel -- accuracy feedback only, no
             mastery/review logging buttons, since anything short of a
             fully blind attempt never counts. */
          (() => {
            const summary = summarizeOutcomes(finalOutcomes || []);
            const pct = Math.round(summary.accuracy * 100);
            return (
              <ScrollView className="flex-1" contentContainerClassName="items-center justify-center p-4 gap-4" contentContainerStyle={{ flexGrow: 1 }}>
                <BounceView>
                  <View className="w-12 h-12 bg-accent-soft rounded-full items-center justify-center">
                    <Shuffle size={24} color={palette.accent} />
                  </View>
                </BounceView>
                <View className="items-center gap-1">
                  <AppText variant="title" className="font-sans font-bold text-ink leading-tight">Nice practice run</AppText>
                  <AppText variant="label" className="text-ink-2 font-sans text-center px-4">
                    {pct}% word accuracy with {hideLevel}% of words hidden. Anything short of every word hidden is
                    warm-up only, so nothing was logged.
                  </AppText>
                </View>

                <View className="w-full gap-2">
                  <AppButton
                    variant="primary"
                    Icon={Shuffle}
                    label="Practice again with new words hidden"
                    onPress={() => { resetReciteGame(); regenerateHiddenWords(hideLevel); }}
                  />
                  <AppButton
                    variant="quiet"
                    label="Try it with every word hidden"
                    onPress={() => {
                      setHideLevel(100);
                      resetReciteGame();
                      regenerateHiddenWords(100);
                    }}
                  />
                </View>
              </ScrollView>
            );
          })()
        ) : (
          /* Graded results panel. The accuracy tier decides which
             logging actions exist: perfect (no missed words) with
             First Letter mode OFF -> counts as a mastery touch AND a
             review; perfect WITH First Letter assist, or >=
             REVIEW_PASS_ACCURACY otherwise -> counts as a review only;
             below that -> the run logs as a failed attempt. */
          (() => {
            const summary = summarizeOutcomes(finalOutcomes || []);
            const drill: 'speak' | 'type' = usedSpeechRef.current ? 'speak' : 'type';
            const pct = Math.round(summary.accuracy * 100);
            const passPct = Math.round(REVIEW_PASS_ACCURACY * 100);
            const assisted = hintMode === 'firstLetter' || recallDisplayMode === 'memoryGrid';
            const isMasteryEligible = summary.isPerfect && !assisted;
            return (
              <ScrollView className="flex-1" contentContainerClassName="items-center justify-center p-4 gap-4" contentContainerStyle={{ flexGrow: 1 }}>
                <BounceView>
                  <View className={`w-12 h-12 rounded-full items-center justify-center ${summary.passesReview ? 'bg-success-soft' : 'bg-accent-soft'}`}>
                    <Sparkles size={24} color={summary.passesReview ? palette.success : palette.accent} />
                  </View>
                </BounceView>
                <View className="items-center gap-1">
                  {assisted && <Badge tone="accent" label="First letters shown" />}
                  <AppText variant="title" className="font-sans font-bold text-ink leading-tight text-center">
                    {isMasteryEligible ? 'Perfect recall' : summary.passesReview ? (assisted && summary.isPerfect ? 'Nicely recalled' : 'Close enough') : 'Keep practicing'}
                  </AppText>
                  <AppText variant="label" className="text-ink-2 font-sans text-center">
                    {pct}% word accuracy: {summary.perfectWords} exact
                    {summary.closeWords > 0 ? `, ${summary.closeWords} near-miss` : ''}
                    {summary.missedWords > 0 ? `, ${summary.missedWords} missed` : ''} of {summary.totalWords} words.
                  </AppText>
                </View>

                <View className="w-full bg-surface-2 border border-line rounded-card p-3 gap-1.5 max-h-[110px]">
                  <ScrollView>
                    {verses.map((v) => (
                      <AppText variant="label" script={passageScript} key={v.verse} className="font-serif italic text-ink-2">
                        <AppText variant="micro" className="font-sans font-bold text-ink-3 not-italic">{v.verse} </AppText>
                        {v.text}
                      </AppText>
                    ))}
                  </ScrollView>
                </View>

                <View className="w-full gap-2">
                  {allNotDue ? (
                    <>
                      <AppButton size="lg" variant="primary" Icon={Check} label="Done" onPress={handleGroupComplete} />
                      <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                        {notDueLine}
                      </AppText>
                    </>
                  ) : isMasteryEligible ? (
                    <>
                      <AppButton
                        size="lg"
                        variant="primary"
                        Icon={Check}
                        label="Log perfect recall"
                        onPress={() => { onUpdateStatus(verses, 'memorized', drill, { perfect: true }); handleGroupComplete(); }}
                      />
                      <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                        Counts as a review, and as one of the perfect recalls a new verse needs.
                      </AppText>
                    </>
                  ) : summary.passesReview ? (
                    <>
                      <AppButton
                        size="lg"
                        variant="primary"
                        Icon={Check}
                        label="Count as a review"
                        onPress={() => { onUpdateStatus(verses, 'memorized', drill, { perfect: false }); handleGroupComplete(); }}
                      />
                      <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                        {assisted
                          ? 'With first letters shown, this counts as a review but not toward learning a new verse. Hide every word for that.'
                          : `${pct}% clears the ${passPct}% a review needs. A new verse only moves forward on a perfect run.`}
                      </AppText>
                    </>
                  ) : (
                    <>
                      <AppButton
                        size="lg"
                        variant="primary"
                        label="Log as needs practice"
                        onPress={() => { onUpdateStatus(verses, 'learning', drill); handleGroupComplete(); }}
                      />
                      <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                        A review needs {passPct}% of the words right.
                      </AppText>
                    </>
                  )}
                  {!allNotDue && notDueLine !== '' && (
                    <AppText variant="caption" className="text-center text-ink-3 font-sans px-4">
                      {notDueLine}
                    </AppText>
                  )}
                  {summary.passesReview && threadTarget && (
                    <AppButton
                      variant="secondary"
                      label={allNotDue ? `Pick up the thread to v${threadTarget.verse}` : `Count it and pick up the thread to v${threadTarget.verse}`}
                      onPress={() => {
                        if (!allNotDue) onUpdateStatus(verses, 'memorized', drill, { perfect: isMasteryEligible });
                        onPickUpThread?.(threadTarget);
                      }}
                    />
                  )}
                  <AppButton variant="quiet" label="Practice again" onPress={resetReciteGame} />
                </View>
              </ScrollView>
            );
          })()
        )
      ) : null}

      {/* Drills extracted into their own components stay mounted while
          another tab is showing, so switching away and back keeps your
          place, as it did when their state lived up here. */}
      {verses.length >= MIN_JIGSAW_VERSES && (
        <View className="flex-1" style={{ display: learnTab === 'jigsaw' ? 'flex' : 'none' }}>
          <JigsawDrill verses={verses} />
        </View>
      )}
      <View className="flex-1" style={{ display: learnTab === 'buildUp' ? 'flex' : 'none' }}>
        <BuildUpDrill verses={verses} onTryBlind={onBuildUpTryBlind} />
      </View>
      <View className="flex-1" style={{ display: learnTab === 'scramble' ? 'flex' : 'none' }}>
        <ScrambleDrill verses={verses} />
      </View>
      <View className="flex-1" style={{ display: learnTab === 'spotSwap' ? 'flex' : 'none' }}>
        <SpotSwapDrill verses={verses} />
      </View>
      <View className="flex-1" style={{ display: learnTab === 'outline' ? 'flex' : 'none' }}>
        <OutlineDrill
          verses={verses}
          sections={verses[0] ? sectionsForChapter?.(verses[0].book, verses[0].chapter) ?? null : null}
          onSaveExtra={onSaveOutlineExtra}
          onVerseGraded={creditOutlineVerse}
        />
      </View>
      {/* Put in order, Which section and Teach-It are Practice (formatNames):
          nothing here credits a review. The first two exist only with 3+
          sections; Teach-It teaches stretches when there are none. */}
      {sectionList.length >= 3 && (
        <>
          <View className="flex-1" style={{ display: learnTab === 'putInOrder' ? 'flex' : 'none' }}>
            <SectionOrderDrill sections={sectionList} script={passageScript} />
          </View>
          <View className="flex-1" style={{ display: learnTab === 'whichSection' ? 'flex' : 'none' }}>
            <WhichSectionDrill sections={sectionList} script={passageScript} />
          </View>
        </>
      )}
      <View className="flex-1" style={{ display: learnTab === 'teachIt' ? 'flex' : 'none' }}>
        <TeachItDrill verses={verses} sections={sectionList} script={passageScript} active={learnTab === 'teachIt'} onSaveDraft={onSaveTakeawayDraft} />
      </View>
    </View>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { verseStage } from '../lib/stageProgress';
import { Pressable, View } from 'react-native';
import { Target } from 'lucide-react-native';

import { AppState, isReviewDue } from '../state/useAppState';
import { scriptOfVerse } from '../lib/textScript';
import { NumericInput } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { BookPicker } from '../components/BookPicker';
import { AppButton, AppTextInput, AppText, Switch, useScaledSpace } from '../components/design';
import { EmptyState, GroupedList, ListRow, SectionHeader } from '../components/blocks';
import { OptionsPopup, SessionDone, SessionShell } from '../components/session';
import {
  buildReferenceRounds,
  formatReference,
  referenceAnswerMatches,
  DrillDirection,
  ReferenceItem,
  ReferenceRound,
} from '../lib/drills';

// ============================================================================
// REFERENCE <-> VERSE DRILL
// ----------------------------------------------------------------------------
// Quizzes "where is this?" against verses already in the review system. Two
// deliberate scoping decisions:
//
// 1. The pool is every matching queue item REGARDLESS of phase or due date.
//    This is a study tool you reach for on purpose, not a scheduled review
//    surface -- gating it to what's due today would make it useless the
//    moment you'd finished your reviews.
//
// 2. It never calls handleUpdateVerseStatus. Knowing a verse's address is a
//    different skill from reciting it, and the whole graduation engine is
//    built on the latter; letting this drill advance reviews would blur what
//    "graduated" means. Sessions end in their own scorecard instead.
// ============================================================================

const SESSION_LENGTHS = [
  { id: 5, label: '5' },
  { id: 10, label: '10' },
  { id: 20, label: '20' },
  { id: 0, label: 'All' },
];

// Which slice of the review system to quiz from. 'all' is every started
// verse (the original, and still the default). The ladder groups let you
// drill one set at a time -- e.g. "just my Kept verses", the ones most at risk
// of having quietly faded. 'learning' is the other end: verses still being
// learned, not yet on a schedule.
const REVIEW_SETS = [
  { id: 'all' as const, label: 'All started' },
  { id: 'learning' as const, label: 'Learning' },
  { id: 'settling' as const, label: 'Settling' },
  { id: 'steady' as const, label: 'Steady' },
  { id: 'kept' as const, label: 'Kept' },
  { id: 'secure' as const, label: 'Secure' },
];
const DIRECTIONS = [
  { id: 'both' as const, label: 'Both ways' },
  { id: 'refToVerse' as const, label: 'Reference → verse' },
  { id: 'verseToRef' as const, label: 'Verse → reference' },
];

type ReviewSet = (typeof REVIEW_SETS)[number]['id'];

type Phase = 'setup' | 'playing' | 'done';

// The last choices, kept for the session so the next visit starts with them.
let lastSettings = {
  book: '', startChapter: '', endChapter: '', startVerse: '', endVerse: '',
  reviewSet: 'all' as ReviewSet, dueTodayOnly: false, direction: 'both' as DrillDirection, sessionLength: 10, hardMode: false,
};

export default function ReferenceDrillScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  const { memoryQueue, navigateTo } = state;

  const [book, setBook] = useState(lastSettings.book);
  const [startChapter, setStartChapter] = useState(lastSettings.startChapter);
  const [endChapter, setEndChapter] = useState(lastSettings.endChapter);
  // Verse-level bounds, only applied when the range narrows to a single
  // chapter -- a "verse 5 to verse 20" span means nothing across chapters
  // with different verse counts. Same scoping rule the Goal feature uses.
  const [startVerse, setStartVerse] = useState(lastSettings.startVerse);
  const [endVerse, setEndVerse] = useState(lastSettings.endVerse);
  const [reviewSet, setReviewSet] = useState<ReviewSet>(lastSettings.reviewSet);
  const [dueTodayOnly, setDueTodayOnly] = useState(lastSettings.dueTodayOnly);
  const [direction, setDirection] = useState<DrillDirection>(lastSettings.direction);
  const [sessionLength, setSessionLength] = useState(lastSettings.sessionLength);
  const [hardMode, setHardMode] = useState(lastSettings.hardMode);

  const [phase, setPhase] = useState<Phase>('setup');
  const [rounds, setRounds] = useState<ReferenceRound[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [score, setScore] = useState(0);
  // Null while the current round is unanswered; otherwise the outcome, which
  // freezes the round until the user advances.
  const [lastResult, setLastResult] = useState<'right' | 'wrong' | null>(null);
  const [freeGuess, setFreeGuess] = useState({ book: '', chapter: '', verse: '' });
  // refToVerse in hard mode has no options to pick from -- the user recalls
  // it themselves, reveals, and self-scores.
  const [revealed, setRevealed] = useState(false);

  // Verse bounds only make sense inside one chapter, so they're offered (and
  // applied) only when the chapter range collapses to a single chapter.
  const singleChapter =
    !!book && !!startChapter && (endChapter === '' || endChapter === startChapter) ? Number(startChapter) : null;
  // Once a verse bound is actually typed, the chapter stops being a lower
  // bound and pins to exactly that chapter. Without this, "Romans 8, verses
  // 2-4" also matched Romans 12:2 -- From-chapter alone means "chapter >= 8",
  // so every later chapter stayed in the pool and got verse-filtered too.
  const verseBoundsActive = singleChapter !== null && (!!startVerse || !!endVerse);

  // Anything actually in the review system: learning, reviewing, or retained.
  // 'queued' verses haven't been started yet, so quizzing on them would be
  // testing something never taught.
  const pool = useMemo<ReferenceItem[]>(() => {
    const started = memoryQueue.filter((i) => i.status !== 'queued');
    const from = Number(startChapter);
    const to = Number(endChapter);
    const fromV = Number(startVerse);
    const toV = Number(endVerse);
    return started
      .filter((i) => {
        if (book && i.book !== book) return false;
        if (startChapter && Number.isFinite(from) && i.chapter < from) return false;
        if (endChapter && Number.isFinite(to) && i.chapter > to) return false;
        if (verseBoundsActive) {
          if (i.chapter !== singleChapter) return false;
          if (startVerse && Number.isFinite(fromV) && i.verseNumber < fromV) return false;
          if (endVerse && Number.isFinite(toV) && i.verseNumber > toV) return false;
        }

        // Review-set filter: 'learning' is a status; the others are the ladder
        // groups, read from where the verse sits on the ladder.
        if (reviewSet === 'learning' && i.status !== 'learning') return false;
        if (reviewSet !== 'all' && reviewSet !== 'learning') {
          if (verseStage(i) !== reviewSet) return false;
        }

        if (dueTodayOnly && !(i.status === 'reviewing' && isReviewDue(i.nextReviewDueDate))) return false;
        return true;
      })
      .map((i) => ({ book: i.book, chapter: i.chapter, verse: i.verseNumber, text: i.text, translationId: i.translationId || 'ESV' }));
  }, [
    memoryQueue,
    book,
    startChapter,
    endChapter,
    startVerse,
    endVerse,
    singleChapter,
    verseBoundsActive,
    reviewSet,
    dueTodayOnly,
  ]);

  const uniqueCount = useMemo(() => new Set(pool.map(formatReference)).size, [pool]);

  const currentRound = rounds[roundIndex] ?? null;

  const startSession = () => {
    const count = sessionLength === 0 ? uniqueCount : sessionLength;
    const built = buildReferenceRounds(pool, count, direction);
    if (built.length === 0) {
      setPhase('setup');
      return;
    }
    setRounds(built);
    setRoundIndex(0);
    setScore(0);
    setLastResult(null);
    setRevealed(false);
    setFreeGuess({ book: '', chapter: '', verse: '' });
    setPhase('playing');
  };

  const recordResult = (correct: boolean) => {
    setLastResult(correct ? 'right' : 'wrong');
    if (correct) setScore((s) => s + 1);
  };

  const advance = () => {
    setLastResult(null);
    setRevealed(false);
    setFreeGuess({ book: '', chapter: '', verse: '' });
    if (roundIndex >= rounds.length - 1) setPhase('done');
    else setRoundIndex((i) => i + 1);
  };

  const handleBack = () => navigateTo('home');

  const numberField = 'bg-surface border border-line rounded-btn text-ink font-sans';
  const boundField = (label: string, value: string, onChange: (t: string) => void) => (
    <View style={{ flexGrow: 1, flexBasis: space(120), gap: space(4) }}>
      <AppText variant="caption" className="font-sans font-medium text-ink-2">
        {label}
      </AppText>
      <NumericInput value={value} onChangeText={onChange} placeholder="Any" className={numberField} style={{ padding: space(10) }} />
    </View>
  );

  // ==========================================================================
  // SETTINGS (behind the gear, UI simplify Job 6). The session starts on the
  // first tap with the last choices; changing one starts a fresh round set
  // when the pop-up closes.
  // ==========================================================================
  const settingsKey = JSON.stringify([book, startChapter, endChapter, startVerse, endVerse, reviewSet, dueTodayOnly, direction, sessionLength, hardMode]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsKeyAtOpen, setOptionsKeyAtOpen] = useState('');
  const openOptions = () => {
    setOptionsKeyAtOpen(settingsKey);
    setOptionsOpen(true);
  };
  const closeOptions = () => {
    setOptionsOpen(false);
    lastSettings = { book, startChapter, endChapter, startVerse, endVerse, reviewSet, dueTodayOnly, direction, sessionLength, hardMode };
    if (settingsKey !== optionsKeyAtOpen) startSession();
  };
  // Start on arrival.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (started) return;
    setStarted(true);
    startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const optionsPopup = (
    <OptionsPopup visible={optionsOpen} onClose={closeOptions} title="Reference practice settings">
      <View style={{ gap: space(8) }}>
        <SectionHeader title="Which verses" />
        <BookPicker value={book} onChange={setBook} allowAll allLabel="All my verses" title="Limit to a book" />
        {!!book && (
          <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
            {boundField('From chapter', startChapter, setStartChapter)}
            {boundField('To chapter', endChapter, setEndChapter)}
          </View>
        )}
        {/* Verse bounds appear only once the range is a single chapter --
            see the singleChapter note above. */}
        {singleChapter !== null && (
          <View className="flex-row flex-wrap" style={{ gap: space(10) }}>
            {boundField('From verse', startVerse, setStartVerse)}
            {boundField('To verse', endVerse, setEndVerse)}
          </View>
        )}
        <AppText variant="caption" className={`font-sans ${uniqueCount > 0 ? 'text-ink-3' : 'text-warning'}`} style={{ paddingHorizontal: space(4) }}>
          {uniqueCount > 0 ? `${uniqueCount} ${uniqueCount === 1 ? 'verse' : 'verses'}` : 'No verses match.'}
        </AppText>
      </View>
      <GroupedList>
        <ListRow
          title="From"
          accessory={
            <Dropdown value={reviewSet} onChange={(s) => setReviewSet(s as ReviewSet)} options={REVIEW_SETS} title="Practice verses from" searchable={false} compact />
          }
        />
        <ListRow
          title="Ask me"
          accessory={
            <Dropdown value={direction} onChange={(d) => setDirection(d as DrillDirection)} options={DIRECTIONS} title="Ask me" searchable={false} compact />
          }
        />
        <ListRow
          title="How many"
          accessory={<Dropdown value={sessionLength} onChange={setSessionLength} options={SESSION_LENGTHS} title="How many questions" searchable={false} compact />}
        />
        <ListRow title="Due today only" accessory={<Switch value={dueTodayOnly} onChange={setDueTodayOnly} accessibilityLabel="Due today only" />} />
        <ListRow title="Type the answer" accessory={<Switch value={hardMode} onChange={setHardMode} accessibilityLabel="Type the answer" />} />
      </GroupedList>
    </OptionsPopup>
  );

  // ==========================================================================
  // NOTHING TO ASK (no started verse matches the choices)
  // ==========================================================================
  if (phase === 'setup') {
    return (
      <SessionShell onClose={handleBack} onOptions={openOptions} safeTop={false}>
        <EmptyState
          Icon={Target}
          title="No verses to practice"
          message={memoryQueue.some((i) => i.status !== 'queued') ? 'Change the choices in the gear.' : 'Start learning some verses first.'}
        />
        {optionsPopup}
      </SessionShell>
    );
  }

  // ==========================================================================
  // SCORECARD
  // ==========================================================================
  if (phase === 'done') {
    const pct = rounds.length === 0 ? 0 : Math.round((score / rounds.length) * 100);
    return (
      <SessionDone
        safeTop={false}
        title="Practice done"
        stats={[
          { value: `${score}/${rounds.length}`, label: 'right' },
          { value: `${pct}%`, label: 'score' },
        ]}
        onDone={handleBack}
        secondary={{ label: 'Go again', onPress: startSession }}
      />
    );
  }

  // ==========================================================================
  // PLAYING
  // ==========================================================================
  if (!currentRound) return null;

  const answered = lastResult !== null;
  const answerRef = formatReference(currentRound.answer);

  // One multiple-choice option. Colors change on answer; no shadow involved.
  const optionClass = (isAnswer: boolean) =>
    `border rounded-btn ${
      answered && isAnswer ? 'border-success bg-success-soft' : answered ? 'border-line bg-surface-2' : 'border-line bg-surface active:bg-surface-2'
    }`;
  const optionStyle = { paddingHorizontal: space(14), paddingVertical: space(12) };
  const questionLabel = (text: string) => (
    <AppText variant="label" className="font-sans font-semibold text-ink-2">
      {text}
    </AppText>
  );

  return (
    <SessionShell
      safeTop={false}
      onClose={() => (roundIndex === 0 && !answered ? handleBack() : setPhase('done'))}
      progress={(roundIndex + (answered ? 1 : 0)) / rounds.length}
      progressLabel={`${roundIndex + 1} of ${rounds.length}`}
      onOptions={openOptions}
      bottomBar={
        answered ? (
          <>
            <View className={`rounded-btn ${lastResult === 'right' ? 'bg-success-soft' : 'bg-danger-soft'}`} style={{ padding: space(10) }}>
              <AppText variant="label" className={`font-sans font-semibold text-center ${lastResult === 'right' ? 'text-success' : 'text-danger'}`}>
                {lastResult === 'right' ? 'Right!' : `Not quite. That was ${answerRef}.`}
              </AppText>
            </View>
            <AppButton size="lg" variant="primary" label={roundIndex >= rounds.length - 1 ? 'See how you did' : 'Next question'} onPress={advance} />
          </>
        ) : undefined
      }
    >
          {currentRound.kind === 'verseToRef' ? (
            <>
              {questionLabel('Where is this?')}
              <View className="bg-surface border border-line rounded-card" style={{ padding: space(16) }}>
                <AppText variant="body" script={scriptOfVerse(currentRound.answer)} className="font-serif leading-relaxed text-ink">{currentRound.answer.text}</AppText>
              </View>

              {hardMode ? (
                <View style={{ gap: space(8) }}>
                  {/* Plain text entry rather than the BookPicker sheet: typing
                      "Romans" is faster than scrolling a 66-book list mid-
                      quiz, and referenceAnswerMatches already compares book
                      names case/whitespace-insensitively. It also keeps the
                      answer path free of react-native's Modal, which does not
                      currently overlay on web anywhere in this app. */}
                  <AppTextInput
                    value={freeGuess.book}
                    onChangeText={(t) => setFreeGuess((g) => ({ ...g, book: t }))}
                    placeholder="Book (e.g. Romans)"
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!answered}
                    variant="body"
                    className={numberField}
                    style={{ padding: space(10) }}
                  />
                  <View className="flex-row" style={{ gap: space(8) }}>
                    <NumericInput
                      value={freeGuess.chapter}
                      onChangeText={(t) => setFreeGuess((g) => ({ ...g, chapter: t }))}
                      placeholder="Chapter"
                      editable={!answered}
                      className={`flex-1 ${numberField}`}
                      style={{ padding: space(10), minWidth: 0 }}
                    />
                    <NumericInput
                      value={freeGuess.verse}
                      onChangeText={(t) => setFreeGuess((g) => ({ ...g, verse: t }))}
                      placeholder="Verse"
                      editable={!answered}
                      className={`flex-1 ${numberField}`}
                      style={{ padding: space(10), minWidth: 0 }}
                    />
                  </View>
                  {!answered && (
                    <AppButton
                      variant="primary"
                      label="Check answer"
                      onPress={() => recordResult(referenceAnswerMatches(currentRound.answer, freeGuess))}
                      disabled={!freeGuess.book || !freeGuess.chapter || !freeGuess.verse}
                    />
                  )}
                </View>
              ) : (
                <View style={{ gap: space(8) }}>
                  {currentRound.options.map((opt) => {
                    const optRef = formatReference(opt);
                    const isAnswer = optRef === answerRef;
                    return (
                      <Pressable
                        key={optRef}
                        onPress={answered ? undefined : () => recordResult(isAnswer)}
                        accessibilityRole="button"
                        className={optionClass(isAnswer)}
                        style={optionStyle}
                      >
                        <AppText variant="body" className={`font-sans font-medium ${answered && isAnswer ? 'text-success' : 'text-ink'}`}>
                          {optRef}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <>
              {questionLabel('What does this say?')}
              <View className="bg-surface border border-line rounded-card items-center" style={{ padding: space(16) }}>
                <AppText variant="title" className="font-sans font-bold text-ink">{answerRef}</AppText>
              </View>

              {hardMode ? (
                <View style={{ gap: space(8) }}>
                  {revealed ? (
                    <>
                      <View className="bg-surface-2 border border-line rounded-card" style={{ padding: space(14) }}>
                        <AppText variant="body" script={scriptOfVerse(currentRound.answer)} className="font-serif leading-relaxed text-ink">{currentRound.answer.text}</AppText>
                      </View>
                      {!answered && (
                        <View className="flex-row" style={{ gap: space(8) }}>
                          <View className="flex-1">
                            <AppButton variant="secondary" label="Missed it" onPress={() => recordResult(false)} />
                          </View>
                          <View className="flex-1">
                            <AppButton variant="primary" label="I knew it" onPress={() => recordResult(true)} />
                          </View>
                        </View>
                      )}
                    </>
                  ) : (
                    <AppButton variant="primary" label="Recall it, then reveal" onPress={() => setRevealed(true)} />
                  )}
                </View>
              ) : (
                <View style={{ gap: space(8) }}>
                  {currentRound.options.map((opt) => {
                    const optRef = formatReference(opt);
                    const isAnswer = optRef === answerRef;
                    return (
                      <Pressable
                        key={optRef}
                        onPress={answered ? undefined : () => recordResult(isAnswer)}
                        accessibilityRole="button"
                        className={optionClass(isAnswer)}
                        style={optionStyle}
                      >
                        <AppText
                          variant="label"
                          script={scriptOfVerse(opt)}
                          className={`font-serif leading-snug ${answered && isAnswer ? 'text-success' : 'text-ink'}`}
                          numberOfLines={3}
                        >
                          {opt.text}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}
      {optionsPopup}
    </SessionShell>
  );
}
